"""Model-as-classifier background task for what-if analysis.

For each probe × model × trace, sends the trace text to the specified
model with a classification prompt and parses the structured result.
Results are ephemeral (in-memory) and do not modify existing traces.
"""

import asyncio
import json
import logging
import uuid
from typing import Any

import httpx
from pydantic import BaseModel, Field
from models.trace import TraceSession
from services import config_manager

logger = logging.getLogger("conductor")

CLASSIFY_TIMEOUT = 60.0  # per-cell timeout (models should respond within 60s)

# ---------------------------------------------------------------------------
# Classification prompts by attribute type
# ---------------------------------------------------------------------------

CLASSIFY_PROMPTS: dict[str, str] = {
    "ddc": """You are a Dewey Decimal Classification (DDC) classifier. Given a text, classify it into exactly one of the following DDC categories.

Return ONLY a JSON object with keys "code" (the DDC code), "label" (the category name), and "confidence" (a number 0.0-1.0). No other text.

Categories:
{categories}

Text: {text}

Classification:""",

    "lcc": """You are a Library of Congress Classification (LCC) classifier. Given a text, classify it into exactly one of the following subclasses.

Return ONLY a JSON object with keys "code" (the LCC code), "label" (the subclass name), and "confidence" (a number 0.0-1.0). No other text.

Categories:
{categories}

Text: {text}

Classification:""",

    "intent": """Classify the user intent of the following text.

Return ONLY a JSON object with keys "label" and "confidence" (0.0-1.0). No other text.

Categories:
- mathematical: Numerical calculation or mathematical operations
- reasoning_multi: Sequential multi-step reasoning
- factual_single: Simple factual question
- factual_multi: Complex multi-part factual question
- instructional: Request for step-by-step instructions
- creative: Creative or generative request
- analytical: Analysis or evaluation request
- conversational: Social or phatic communication
- command: Direct command or instruction

Text: {text}

Classification:""",

    "synesth_input": """Classify the input/prompt into one of these categories based on its nature.

Return ONLY a JSON object with keys "label" and "confidence" (0.0-1.0). No other text.

Categories:
1. Direct Command: Imperative instruction, command
2. Factual Question: Asking for specific facts, information, data
3. Creative Request: Asking for creative generation, storytelling
4. Simple Query: Short, simple question or request
5. Complex Inquiry: Multi-part or complex request requiring analysis

Text: {text}

Classification:""",

    "synesth_output": """Classify the output into one of these categories based on its structure and form.

Return ONLY a JSON object with keys "label" and "confidence" (0.0-1.0). No other text.

Categories:
1. Concise List/Facts: Short factual answer, list, bullet points
2. Prose Explanation: Detailed prose explanation, paragraphs
3. Creative/Verse: Poem, story, song, creative writing
4. Bulleted List: Structured bulleted or numbered list with explanations
5. Technical/Code: Code, technical documentation, formal specification

Text: {text}

Classification:""",
}


def _category_text(attr: str) -> str:
    """Return a condensed category list for model-as-classifier prompts.
    Uses main classes only (10 DDC, ~25 LCC single-letter) to keep prompts short and fast.
    """
    if attr == "lcc":
        # Single-letter main classes only — much shorter prompt than full subclass list
        return (
            "A General Works\nB Philosophy, Psychology, Religion\nC History of Civilization\n"
            "D World History\nE History of Americas\nF History of US/British America\n"
            "G Geography, Anthropology, Recreation\nH Social Sciences\nJ Political Science\n"
            "K Law\nL Education\nM Music\nN Fine Arts\nP Language & Literature\n"
            "Q Science\nR Medicine\nS Agriculture\nT Technology\n"
            "U Military Science\nV Naval Science\nZ Bibliography & Library Science"
        )
    elif attr == "ddc":
        return (
            "000 Computer Science, Information & General Works\n"
            "100 Philosophy & Psychology\n"
            "200 Religion\n"
            "300 Social Sciences\n"
            "400 Language\n"
            "500 Pure Science\n"
            "600 Technology & Applied Sciences\n"
            "700 Arts & Recreation\n"
            "800 Literature\n"
            "900 History & Geography"
        )
    return ""


def _text_for_probe(trace: TraceSession, artefact: str) -> str | None:
    if artefact == "prompt":
        return trace.prompt
    return trace.output


def _parse_json_response(raw: str) -> dict[str, Any] | None:
    """Extract the first JSON object from a model response, with lenient fallback."""
    raw = raw.strip()
    # Strip markdown fences
    if raw.startswith("```"):
        raw = raw.strip("`").strip()
        if raw.startswith("json"):
            raw = raw[4:].strip()
    try:
        start = raw.index("{")
        end = raw.rindex("}") + 1
        candidate = raw[start:end]
        return json.loads(candidate)
    except (ValueError, json.JSONDecodeError):
        pass

    # Fallback: try to fix common JSON errors (unclosed quotes, trailing commas)
    import re
    # Extract code/label from text like "...code: 510, label: Mathematics..."
    # Also handle cases like '{"code":"000", "label":null}' where label is null
    code_match = re.search(r'(?:code["\']?\s*[:=]\s*["\']?)(\w[\w.]*)(?:["\']?\s*,?\s*)', raw)
    label_match = re.search(r'(?:label["\']?\s*[:=]\s*["\']?)([^"\'}\n,]+?)(?:["\']?\s*,?\s*[}\]\n]|$)', raw)
    # Also try to extract just a DDC/LCC code or short label from free text
    code_only = re.search(r'\b(\d{3})\b', raw) if not code_match else None
    conf_match = re.search(r'(?:confidence["\']?\s*[:=]\s*["\']?)([\d.]+)', raw)
    if code_match or label_match or code_only:
        result: dict[str, Any] = {}
        if code_match:
            result["code"] = code_match.group(1)
        elif code_only:
            result["code"] = code_only.group(1)
        if label_match:
            result["label"] = label_match.group(1).strip()
        if not result.get("label") and "code" in result:
            ddc_labels = {
                "000": "Computer Science, Information & General Works",
                "100": "Philosophy & Psychology", "200": "Religion",
                "300": "Social Sciences", "400": "Language",
                "500": "Pure Science", "600": "Technology & Applied Sciences",
                "700": "Arts & Recreation", "800": "Literature",
                "900": "History & Geography",
            }
            code_str = str(result["code"])
            if len(code_str) == 3 and code_str[0] in "0123456789":
                main = code_str[0] + "00"
                if main in ddc_labels:
                    result["label"] = ddc_labels[main]
        if conf_match:
            try:
                result["confidence"] = float(conf_match.group(1))
            except ValueError:
                pass
        return result if result.get("label") or result.get("code") else None

    return None


# ---------------------------------------------------------------------------
# Task store
# ---------------------------------------------------------------------------

class ClassifyCellResult(BaseModel):
    trace_id: str
    model: str
    provider: str
    probe_idx: int
    value: str
    confidence: float | None = None
    error: str | None = None


class ClassifyTaskStatus(BaseModel):
    task_id: str
    total_cells: int
    completed_cells: int = 0
    status: str = "running"  # running | done | cancelled
    warmup_status: str | None = None  # "warming" | "ready" | None
    results: list[ClassifyCellResult] = Field(default_factory=list)


_classify_store: dict[str, ClassifyTaskStatus] = {}
_classify_semaphore = asyncio.Semaphore(5)

_cancel_flags: dict[str, asyncio.Event] = {}


def cancel_classify_task(task_id: str) -> bool:
    """Signal a running classify task to stop early."""
    if task_id not in _classify_store:
        return False
    flag = _cancel_flags.get(task_id)
    if flag:
        flag.set()
    _classify_store[task_id].status = "cancelled"
    return True


async def _classify_call_model(
    prompt: str,
    system: str,
    model_name_override: str,
    provider_override: str,
) -> str:
    """Call a model with retry for transient errors (502)."""
    base_url = (
        config_manager.get_ollama_url()
        if provider_override == "local"
        else config_manager.get_worker_url()
    )
    model_name = model_name_override
    if "/" in model_name:
        model_name = model_name.split("/")[-1]

    payload: dict[str, Any] = {
        "model": model_name,
        "prompt": prompt,
        "stream": False,
        "options": {"num_ctx": 4096 if provider_override == "local" else 16384},
    }
    if system:
        payload["system"] = system

    last_error: Exception | None = None
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=CLASSIFY_TIMEOUT) as client:
                resp = await client.post(f"{base_url}/api/generate", json=payload)
                resp.raise_for_status()
                data = resp.json()
                result = data.get("response", "").strip()
                if not result:
                    result = data.get("thinking", "").strip()
                return result
        except httpx.HTTPStatusError as e:
            last_error = e
            if e.response.status_code == 502:
                logger.warning("Classify 502 (attempt %d/3) for %s", attempt + 1, model_name)
                await asyncio.sleep(2 ** attempt)  # 1s, 2s, 4s backoff
                continue
            raise
    raise last_error  # type: ignore[misc]


async def start_classify_task(
    probes: list[dict[str, str]],
    models: list[dict[str, str]],
    traces: list[TraceSession],
) -> str:
    """Start a background classify task. Returns task_id for polling."""
    task_id = uuid.uuid4().hex[:12]
    total = len(probes) * len(models) * len(traces)
    status = ClassifyTaskStatus(task_id=task_id, total_cells=total)
    _classify_store[task_id] = status
    asyncio.create_task(_process_classify(task_id, probes, models, traces))
    return task_id


def get_classify_status(task_id: str) -> ClassifyTaskStatus | None:
    return _classify_store.get(task_id)


async def _process_classify(
    task_id: str,
    probes: list[dict[str, str]],
    models: list[dict[str, str]],
    traces: list[TraceSession],
) -> None:
    store = _classify_store[task_id]
    cancel_flag = asyncio.Event()
    _cancel_flags[task_id] = cancel_flag

    # ── Warmup: send a trivial prompt to pre-load each model ─────
    for mc in models:
        store.warmup_status = f"Warming up {mc['model']}…"
        logger.info("Classify warmup for %s", mc["model"])
        try:
            await _classify_call_model(
                "Respond with exactly: ready",
                "You are a ping responder. Reply only: ready",
                mc["model"],
                mc["provider"],
            )
        except Exception as e:
            logger.warning("Warmup failed for %s: %s", mc["model"], e)
    store.warmup_status = "ready"

    # ── Classify cells ───────────────────────────────────────────
    async def _classify_one(
        trace: TraceSession, model_cfg: dict[str, str], probe: dict[str, str], pi: int
    ) -> ClassifyCellResult:
        text = _text_for_probe(trace, probe.get("artefact", "prompt"))
        if not text:
            return ClassifyCellResult(
                trace_id=trace.id, model=model_cfg["model"],
                provider=model_cfg["provider"], probe_idx=pi,
                value="—", error="no text"
            )

        attr = probe.get("attribute", "ddc")
        prompt_template = CLASSIFY_PROMPTS.get(attr)
        if not prompt_template:
            return ClassifyCellResult(
                trace_id=trace.id, model=model_cfg["model"],
                provider=model_cfg["provider"], probe_idx=pi,
                value="—", error=f"unknown attribute: {attr}"
            )

        cats = _category_text(attr)
        classify_prompt = prompt_template.format(
            categories=cats,
            text=text[:2000],  # truncate to avoid context overflow
        )

        async with _classify_semaphore:
            try:
                raw = await _classify_call_model(
                    classify_prompt,
                    "You are a precise classifier. Respond only with valid JSON.",
                    model_cfg["model"],
                    model_cfg["provider"],
                )
                parsed = _parse_json_response(raw)
                if parsed and (parsed.get("label") or parsed.get("code")):
                    value = (parsed.get("label") or parsed.get("code")).strip()
                    return ClassifyCellResult(
                        trace_id=trace.id,
                        model=model_cfg["model"],
                        provider=model_cfg["provider"],
                        probe_idx=pi,
                        value=value,
                        confidence=parsed.get("confidence"),
                    )
                return ClassifyCellResult(
                    trace_id=trace.id, model=model_cfg["model"],
                    provider=model_cfg["provider"], probe_idx=pi,
                    value="—", confidence=None,
                    error="unparseable" if raw.strip() else "empty response",
                )
            except Exception as e:
                return ClassifyCellResult(
                    trace_id=trace.id, model=model_cfg["model"],
                    provider=model_cfg["provider"], probe_idx=pi,
                    value="—", error=str(e)[:200],
                )

    cells: list[asyncio.Task[ClassifyCellResult]] = []
    for pi, probe in enumerate(probes):
        for mc in models:
            for trace in traces:
                cells.append(
                    asyncio.ensure_future(_classify_one(trace, mc, probe, pi))
                )

    for fut in asyncio.as_completed(cells):
        if cancel_flag.is_set():
            for remaining in cells:
                if not remaining.done():
                    remaining.cancel()
            store.status = "cancelled"
            logger.info("Classify task %s cancelled: %d/%d cells", task_id, store.completed_cells, store.total_cells)
            break
        result = await fut
        store.results.append(result)
        store.completed_cells += 1
    else:
        store.status = "done"
        logger.info("Classify task %s done: %d/%d cells", task_id, store.completed_cells, store.total_cells)

    _cancel_flags.pop(task_id, None)
