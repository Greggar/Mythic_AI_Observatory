import asyncio
import json
import logging
import os
import uuid
from collections import deque
from datetime import datetime, timezone
from time import perf_counter
from typing import Any

import httpx
import psutil

logger = logging.getLogger("conductor")

from models.trace import TraceSession, TraceStep, TelemetryImpact, LlmInsight
from services import config_manager
from services.ddc_embeddings import classify_ddc, classify_multi as classify_multi_ddc
from services.lcc_embeddings import classify_lcc, classify_multi as classify_multi_lcc

# Set to "local" to use Gingerlong's CPU, "backoffice" for GPU worker
# Use set_model_provider() to change at runtime
_MODEL_PROVIDER: str = os.environ.get("ORCHESTRATOR_MODEL", "local").lower()

def get_model_provider() -> str:
    return _MODEL_PROVIDER

def set_model_provider(value: str) -> None:
    global _MODEL_PROVIDER
    value = value.lower()
    if value not in ("local", "backoffice"):
        raise ValueError(f"Invalid model provider: {value!r}. Must be 'local' or 'backoffice'.")
    _MODEL_PROVIDER = value
    logger.info("Model provider switched to: %s", value)

LLM_TIMEOUT = 180.0  # longer timeout for CPU-bound local inference

MAX_HISTORY = 500
HISTORY_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "traces.jsonl")


STAGES: list[dict[str, Any]] = [
    {"id": "step-1", "label": "Request Received", "model": None, "system": None},
    {"id": "step-2", "label": "Intent Classification", "model": "backoffice",
     "system": "You are an intent classifier. Respond with ONLY a JSON object with these fields:\n"
               "- \"classification\": a short one-sentence classification of the user request\n"
               "- \"intents\": an array of the top-3 most likely intents, each with \"label\" (short intent name), \"confidence\" (0.0 to 1.0, all values sum to 1.0), and \"reasoning\" (one sentence explaining why this path was chosen or rejected)\n\n"
               "Example: {\"classification\": \"User is asking a factual question about history.\", \"intents\": [{\"label\": \"factual_query\", \"confidence\": 0.85, \"reasoning\": \"Directly answers the factual request with evidence.\"}, {\"label\": \"educational_request\", \"confidence\": 0.10, \"reasoning\": \"While related, the user didn't ask for a lesson.\"}, {\"label\": \"casual_curiosity\", \"confidence\": 0.05, \"reasoning\": \"The phrasing is formal, not casual.\"}]}"},
    {"id": "step-3", "label": "Agent Selection", "model": None, "system": None},
    {"id": "step-4", "label": "Memory Retrieval", "model": None, "system": None},
    {"id": "step-5", "label": "Context Synthesis", "model": "backoffice",
     "system": "You are a synthesizer. In one sentence, note the key context for responding to this request."},
    {"id": "step-6", "label": "Response Generation", "model": "backoffice",
     "system": "You are a wise and knowledgeable AI oracle. Provide a thoughtful, clear response to the user."},
    {"id": "step-7", "label": "Final Response", "model": None, "system": None},
]

LOCAL_MODEL: str = os.environ.get("OLLAMA_MODEL", "qwen2.5:3b")

def get_local_model() -> str:
    return LOCAL_MODEL

def set_local_model(value: str) -> None:
    global LOCAL_MODEL
    value = value.strip()
    if not value:
        raise ValueError("Model name cannot be empty")
    LOCAL_MODEL = value
    logger.info("Local model switched to: %s", value)

_analysis_persisted = False

def _init_analysis_from_config() -> None:
    global ANALYSIS_MODEL, ANALYSIS_PROVIDER, _analysis_persisted
    if _analysis_persisted:
        return
    try:
        ac = config_manager.get_analysis_config()
        ANALYSIS_MODEL = ac.get("model", os.environ.get("ANALYSIS_MODEL", "qwen2.5:3b"))
        ANALYSIS_PROVIDER = ac.get("provider", os.environ.get("ANALYSIS_PROVIDER", "local")).lower()
    except Exception:
        ANALYSIS_MODEL = os.environ.get("ANALYSIS_MODEL", "qwen2.5:3b")
        ANALYSIS_PROVIDER = os.environ.get("ANALYSIS_PROVIDER", "local").lower()
    _analysis_persisted = True

ANALYSIS_MODEL: str = "qwen2.5:3b"
ANALYSIS_PROVIDER: str = "local"
_init_analysis_from_config()

def get_analysis_model() -> str:
    return ANALYSIS_MODEL

def set_analysis_model(value: str) -> None:
    global ANALYSIS_MODEL
    value = value.strip()
    if not value:
        raise ValueError("Analysis model name cannot be empty")
    ANALYSIS_MODEL = value
    config_manager.set_analysis_config(value, ANALYSIS_PROVIDER)
    logger.info("Analysis model switched to: %s", value)

def get_analysis_provider() -> str:
    return ANALYSIS_PROVIDER

def set_analysis_provider(value: str) -> None:
    global ANALYSIS_PROVIDER
    value = value.lower()
    if value not in ("local", "backoffice"):
        raise ValueError(f"Invalid analysis provider: {value!r}. Must be 'local' or 'backoffice'.")
    ANALYSIS_PROVIDER = value
    config_manager.set_analysis_config(ANALYSIS_MODEL, value)
    logger.info("Analysis provider switched to: %s", value)


async def warmup_model() -> None:
    """Preload model into Ollama memory so first real trace doesn't pay cold-start cost."""
    base_url = config_manager.get_ollama_url()
    if not base_url:
        logger.warning("No Ollama URL configured — skipping model warm-up")
        return
    model_name = LOCAL_MODEL
    payload = {
        "model": model_name,
        "prompt": "hello",
        "stream": False,
        "options": {"num_ctx": 4096},
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{base_url}/api/generate", json=payload)
            resp.raise_for_status()
            logger.info("Model warm-up complete: %s (%s)", model_name, resp.status_code)
    except Exception as e:
        logger.warning("Model warm-up failed (non-fatal): %s", e)


def _resolve_model_url(model_key: str) -> tuple[str, str]:
    if _MODEL_PROVIDER == "local":
        base_url = config_manager.get_ollama_url()
        model_name = LOCAL_MODEL
    else:
        base_url = config_manager.get_backoffice_url()
        model_name = config_manager.get_backoffice_model()
    return base_url, model_name


async def _call_model(model: str, prompt: str, system: str | None = None, *, model_name_override: str | None = None) -> tuple[str, int | None, int | None]:
    if model_name_override:
        if ANALYSIS_PROVIDER == "local":
            base_url = config_manager.get_ollama_url()
        else:
            base_url = config_manager.get_backoffice_url()
        model_name = model_name_override
    else:
        base_url, model_name = _resolve_model_url(model)

    payload: dict[str, Any] = {
        "model": model_name,
        "prompt": prompt,
        "stream": False,
    }

    provider_for_ctx = ANALYSIS_PROVIDER if model_name_override else _MODEL_PROVIDER
    if provider_for_ctx == "local":
        payload["options"] = {"num_ctx": 4096}

    if system:
        payload["system"] = system

    async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
        try:
            resp = await client.post(f"{base_url}/api/generate", json=payload)
            resp.raise_for_status()
            data = resp.json()
            result = data.get("response", "").strip()
            if not result:
                result = data.get("thinking", "").strip()
            eval_count = data.get("eval_count")
            eval_duration = data.get("eval_duration")
            return result, eval_count, eval_duration
        except Exception as e:
            logger.error("Model call failed: %s", e)
            return f"[{model_name} error: {e}]", None, None


def _compute_confidence(session: TraceSession) -> float:
    if not session.steps:
        return 0.0
    total = len(session.steps)
    completed = sum(1 for s in session.steps if s.status == "complete")
    stage_ratio = completed / total

    response_len_score = 0.0
    if session.output and len(session.output) > 20:
        length = len(session.output)
        response_len_score = min(length / 500, 1.0) * 0.25

    consistency = 0.0
    errors = sum(1 for s in session.steps if s.status == "error")
    if errors == 0:
        consistency = 0.25
    elif errors < total / 2:
        consistency = 0.15

    refinement_quality = 0.0
    if len(session.steps) >= 2:
        last_step = session.steps[-1]
        if last_step.status == "complete":
            refinement_quality = 0.15

    raw = stage_ratio * 0.35 + response_len_score + consistency + refinement_quality
    return round(min(raw, 0.99), 3)


def _detect_insights(session: TraceSession) -> list[str]:
    tags: list[str] = []
    if session.confidence and session.confidence > 0.85:
        tags.append("high_confidence")
    if session.output and len(session.output) > 300:
        tags.append("rich_response")
    if session.steps and all(s.status == "complete" for s in session.steps):
        tags.append("perfect_pipeline")
    return tags


async def _build_architecture_context() -> str:
    lines: list[str] = []
    machines = config_manager.get_machines_config()
    services = config_manager.get_services()
    for mid, m in machines.items():
        desc = m.get("insight", m.get("desc", ""))
        host = m.get("host", "?")
        svc_list = [s for s in m.get("services", []) if s in services]
        svc_names = []
        for sid in svc_list:
            svc = services[sid]
            svc_names.append(svc.get("label", sid))

        reachable = await _check_machine_reachable(m, services)
        status = "reachable" if reachable else "unreachable"
        lines.append(f"- {m.get('name', mid)} ({host}, {status}): {desc}")
        if svc_names:
            lines.append(f"  Services: {', '.join(svc_names)}")

    return "\n".join(lines)


async def _check_machine_reachable(machine: dict, services: dict) -> bool:
    host = machine.get("host", "")
    if host in ("127.0.0.1", "localhost", ""):
        return True
    svc_ids = machine.get("services", [])
    if not svc_ids:
        return False
    targets = []
    for sid in svc_ids:
        svc = services.get(sid)
        if svc and svc.get("enabled", True):
            svc_host = svc.get("host", host)
            svc_port = svc.get("port", 80)
            targets.append((svc_host, svc_port))
    if not targets:
        return False
    try:
        async with httpx.AsyncClient(timeout=2.0) as c:
            for svc_host, svc_port in targets:
                try:
                    r = await c.get(f"http://{svc_host}:{svc_port}/health", timeout=1.5)
                    if r.status_code < 500:
                        return True
                except Exception:
                    continue
    except Exception:
        pass
    return False


async def _generate_llm_insights(session: TraceSession) -> list[LlmInsight]:
    if not session.steps:
        return []

    step_map = {s.label: s.duration_ms for s in session.steps if s.label and s.duration_ms}
    total_ms = sum(step_map.values())

    stages_json = json.dumps(step_map, indent=2)
    arch = await _build_architecture_context()

    system_prompt = (
        "You are an AI observability analyst. Given trace data and system architecture, "
        "generate insights about pipeline performance.\n\n"
        "SYSTEM ARCHITECTURE (live network topology):\n"
        f"{arch}\n\n"
        "Generate exactly 2-4 insights as a JSON array. "
        'Each object has: "type" ("info" or "recommendation"), "title" (short), "body" (1-2 sentences).\n'
        "Rules:\n"
        "- info: factual observation about the trace\n"
        "- recommendation: specific actionable suggestion based on architecture\n"
        "- Do NOT mention the model response content, only latency and system behavior\n"
        "- Focus on bottlenecks, cold starts, and hardware-specific observations\n"
        "- If a remote GPU worker is unreachable, recommend investigating the connection\n"
        "- Return ONLY the JSON array, no other text"
    )

    prompt = (
        f"TRACE DATA:\n"
        f'prompt: "{session.prompt[:100]}"\n'
        f"model: {session.model_used or LOCAL_MODEL or 'unknown'}\n"
        f"total_ms: {total_ms}\n"
        f"stages:\n{stages_json}\n\n"
        f"Generate 2-4 insights as a JSON array."
    )

    base_url = config_manager.get_ollama_url()
    model_name = LOCAL_MODEL

    payload = {
        "model": model_name,
        "prompt": prompt,
        "system": system_prompt,
        "stream": False,
        "options": {"num_ctx": 4096},
    }

    try:
        async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
            resp = await client.post(f"{base_url}/api/generate", json=payload)
            resp.raise_for_status()
            data = resp.json()
            raw = data.get("response", "").strip()
            if not raw:
                raw = data.get("thinking", "").strip()

            raw = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            insights_data = json.loads(raw)
            if isinstance(insights_data, list):
                return [LlmInsight(**i) for i in insights_data if "type" in i and "title" in i and "body" in i]
    except Exception as e:
        logger.warning("LLM insight generation failed: %s", e)

    return []


async def _generate_response_rationale(session: TraceSession) -> str | None:
    if not session.output or not session.steps:
        return None

    step_summary = []
    for s in session.steps:
        out = (s.metadata.get("output") or "")[:300] if s.metadata else ""
        step_summary.append(f"[{s.label}]: {out}")

    context_step = next((s for s in session.steps if s.label == "Context Synthesis"), None)
    assembled = (context_step.context_assembled or "")[:1500] if context_step else ""

    prompt = (
        f"User prompt: \"{session.prompt}\"\n\n"
        f"Step-by-step trace:\n" + "\n".join(step_summary) + "\n\n"
        f"Full context sent to Response Generation:\n{assembled}\n\n"
        f"Final output: \"{session.output[:500]}\"\n\n"
        "You are the AI model that generated this response. Given the steps above, "
        "explain in 2-3 sentences why you chose this specific response. "
        "Focus on: how earlier step outputs influenced your decision, "
        "what tone or approach you decided to take, and why it fits the user's request. "
        "Be specific and honest — mention tradeoffs or alternative approaches you considered."
    )

    base_url = config_manager.get_ollama_url()
    payload = {
        "model": LOCAL_MODEL,
        "prompt": prompt,
        "system": "You are an AI reflecting on your own reasoning. Be introspective and specific.",
        "stream": False,
        "options": {"num_ctx": 4096},
    }

    try:
        async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
            resp = await client.post(f"{base_url}/api/generate", json=payload)
            resp.raise_for_status()
            data = resp.json()
            raw = data.get("response", "").strip() or data.get("thinking", "").strip()
            return raw if len(raw) > 20 else None
    except Exception as e:
        logger.warning("Response rationale generation failed: %s", e)
        return None


async def _generate_trace_explanation(session: TraceSession) -> str | None:
    if not session.steps:
        return None

    parts = [f"User prompt: \"{session.prompt}\""]
    for s in session.steps:
        out = (s.metadata.get("output") or "")[:400] if s.metadata else ""
        parts.append(f"[{s.label}] {out}")
        if s.label == "Memory Retrieval" and s.metadata:
            chunks = s.metadata.get("retrieved_chunks", [])
            if chunks:
                parts.append("  Retrieved chunks:")
                for c in chunks:
                    match_info = f"cos={c.get('relevance', 0):.3f}"
                    status = "USED" if c.get("used") else "discarded"
                    content = (c.get("content") or "")[:120]
                    parts.append(f"    - [{status}] ({match_info}) {content}")
        if s.context_assembled:
            assembled_short = s.context_assembled[:600]
            parts.append(f"  Context assembled:\n{assembled_short}")

    final = session.output or ""
    parts.append(f"Final output: \"{final[:400]}\"")

    trace_text = "\n".join(parts)

    prompt = (
        f"{trace_text}\n\n"
        "You are an AI observability analyst. Explain step-by-step what happened in this trace "
        "and why. Cover:\n"
        "- What the user asked for and how the system interpreted it\n"
        "- Which past traces (if any) were retrieved, why they matched, and whether they were used\n"
        "- How the context was assembled and what the model decided to do with it\n"
        "- Why the final response is what it is — tone, content, and any tradeoffs\n\n"
        "Write 3-6 concise paragraphs. Be specific to THIS trace — reference actual scores, "
        "chunk content, and step outputs. Avoid generic statements."
    )

    base_url = config_manager.get_ollama_url()
    payload = {
        "model": LOCAL_MODEL,
        "prompt": prompt,
        "system": "You are a precise observability analyst. Write clear, trace-specific explanations.",
        "stream": False,
        "options": {"num_ctx": 4096},
    }

    try:
        async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
            resp = await client.post(f"{base_url}/api/generate", json=payload)
            resp.raise_for_status()
            data = resp.json()
            raw = data.get("response", "").strip() or data.get("thinking", "").strip()
            return raw if len(raw) > 30 else None
    except Exception as e:
        logger.warning("Trace explanation generation failed: %s", e)
        return None


# ── Activity event bus ────────────────────────────────────────────
_activity_events: deque[dict[str, Any]] = deque(maxlen=200)
_event_counter = 0

def emit_event(kind: str, label: str, session_id: str | None = None, detail: str | None = None) -> None:
    global _event_counter
    _event_counter += 1
    event = {
        "id": f"evt-{_event_counter}",
        "kind": kind,
        "label": label,
        "session_id": session_id,
        "detail": detail,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    _activity_events.append(event)


def get_activity_events(since: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    events = list(_activity_events)
    if since:
        if since.startswith("evt-"):
            try:
                num = int(since[4:])
                events = [e for e in events if int(e["id"][4:]) > num]
            except ValueError:
                pass
        else:
            events = [e for e in events if e["timestamp"] > since]
    return events[-limit:]


# ── Telemetry snapshot ────────────────────────────────────────────
def _snapshot_cpu_mem() -> tuple[float, float]:
    return psutil.cpu_percent(interval=0), psutil.virtual_memory().percent


# ── Agent / model inference ───────────────────────────────────────
_AGENT_MAP: dict[str, str] = {
    "step-2": "Intent Classifier",
    "step-3": "Agent Selector",
    "step-4": "Memory Retriever",
    "step-5": "Context Synthesizer",
    "step-6": "Response Generator",
}


# ── In-memory store ───────────────────────────────────────────────
_store: dict[str, TraceSession] = {}


def _persist(session: TraceSession) -> None:
    try:
        data_dir = os.path.dirname(HISTORY_FILE)
        os.makedirs(data_dir, exist_ok=True)
        with open(HISTORY_FILE, "a") as f:
            f.write(session.model_dump_json() + "\n")
        if os.path.getsize(HISTORY_FILE) > 5_000_000:
            _trim_history()
    except Exception as e:
        logger.error("Failed to persist trace: %s", e)


def _trim_history() -> None:
    try:
        if not os.path.exists(HISTORY_FILE):
            return
        with open(HISTORY_FILE) as f:
            lines = f.readlines()
        if len(lines) > MAX_HISTORY:
            with open(HISTORY_FILE, "w") as f:
                f.writelines(lines[-MAX_HISTORY:])
    except Exception as e:
        logger.error("Failed to trim history: %s", e)


def load_history(limit: int = 50) -> list[TraceSession]:
    sessions: list[TraceSession] = []
    try:
        if not os.path.exists(HISTORY_FILE):
            return sessions
        with open(HISTORY_FILE) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        sessions.append(TraceSession.model_validate_json(line))
                    except Exception:
                        continue
        # Deduplicate: keep last occurrence of each trace_id
        seen: set[str] = set()
        deduped: list[TraceSession] = []
        for s in reversed(sessions):
            if s.id not in seen:
                seen.add(s.id)
                deduped.append(s)
        deduped.reverse()
        sessions = deduped
    except Exception as e:
        logger.error("Failed to load history: %s", e)
    return sessions[-limit:]


_embed_cache: dict[str, list[float]] = {}
EMBED_MODEL = "all-minilm:22m"


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    if na < 1e-12 or nb < 1e-12:
        return 0.0
    return round(dot / (na * nb), 4)


async def _embed(text: str) -> list[float]:
    if text in _embed_cache:
        return _embed_cache[text]
    base_url = config_manager.get_ollama_url()
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{base_url}/api/embeddings",
            json={"model": EMBED_MODEL, "prompt": text},
            timeout=30,
        )
        data = resp.json()
        emb = data["embedding"]
        _embed_cache[text] = emb
        return emb


async def orchestrate(prompt: str, trace_id: str | None = None) -> TraceSession:
    trace_id = trace_id or uuid.uuid4().hex[:12]
    session = _store.get(trace_id) or TraceSession(id=trace_id, prompt=prompt)
    _store[trace_id] = session

    context: list[str] = []
    cpu_samples: list[float] = []
    mem_samples: list[float] = []

    emit_event("session_start", "Orchestration started", trace_id, prompt[:80])
    _, resolved_model = _resolve_model_url("backoffice")
    if _MODEL_PROVIDER == "local":
        resolved_model = LOCAL_MODEL
    session.model_used = resolved_model

    for i, stage in enumerate(STAGES):
        stage_id = stage["id"]
        label = stage["label"]
        model = stage["model"]
        system = stage["system"]
        agent_name = _AGENT_MAP.get(stage_id, label)

        cpu_before, mem_before = _snapshot_cpu_mem()

        step = TraceStep(
            id=stage_id,
            label=label,
            status="processing",
            timestamp=datetime.now(timezone.utc).isoformat(),
            model_used=resolved_model if model else None,
            agent_used=agent_name,
            cpu_before=cpu_before,
            mem_before=mem_before,
        )
        session.steps.append(step)

        emit_event("stage_start", f"{label} started", trace_id, agent_name)

        start = perf_counter()

        if model:
            combined = "\n".join(context + [prompt])
            step.context_assembled = combined
            output, eval_count, eval_duration_ns = await _call_model(model, combined, system)
            step.eval_count = eval_count
            step.eval_duration_ns = eval_duration_ns
            # Parse structured output for Intent Classification (step-2)
            if stage_id == "step-2":
                try:
                    parsed = json.loads(output)
                    classification = parsed.get("classification", "").strip()
                    intents = parsed.get("intents", [])
                    if classification:
                        context.append(f"[{label}]: {classification}")
                    else:
                        context.append(f"[{label}]: {output}")
                    if intents and isinstance(intents, list):
                        step.metadata["intent_probs"] = intents[:3]
                    step.metadata["output"] = (classification or output)[:2000]
                except (json.JSONDecodeError, TypeError):
                    context.append(f"[{label}]: {output}")
                    step.metadata["output"] = output[:2000]
            else:
                context.append(f"[{label}]: {output}")
                step.metadata["output"] = output[:2000]
            emit_event("inference", f"Inference: {label}", trace_id, resolved_model)
        else:
            step.context_assembled = None
            if stage_id == "step-4":
                past_sessions = load_history(limit=20)
                query_emb = await _embed(prompt)
                chunks = []
                for ps in past_sessions:
                    if ps.id == trace_id or not ps.output or len(ps.output) < 20:
                        continue
                    if ps.embedding is None:
                        ps.embedding = await _embed(ps.prompt)
                    sim = _cosine_similarity(query_emb, ps.embedding)
                    chunks.append({
                        "trace_id": ps.id,
                        "content": ps.output[:2000],
                        "relevance": sim,
                    })
                chunks.sort(key=lambda c: c["relevance"], reverse=True)
                top_chunks = chunks[:5]
                threshold = 0.04
                for ci, chunk in enumerate(top_chunks):
                    chunk["used"] = ci == 0 or chunk["relevance"] >= threshold

                # Build pairwise similarity matrix for vector graph
                vector_points: list[dict] = []
                query_label = prompt[:60]
                vector_points.append({
                    "id": "query",
                    "label": query_label,
                    "is_query": True,
                })
                for chunk in top_chunks:
                    vector_points.append({
                        "id": chunk["trace_id"],
                        "label": chunk["content"][:60],
                        "content": chunk["content"],
                        "relevance": chunk["relevance"],
                        "used": chunk["used"],
                        "is_query": False,
                    })
                # Pairwise edges: query to each chunk, and chunk-to-chunk
                edges: list[dict] = []
                # query -> all chunks
                for ci, chunk in enumerate(top_chunks):
                    edges.append({
                        "source": "query",
                        "target": chunk["trace_id"],
                        "similarity": chunk["relevance"],
                    })
                # chunk-to-chunk
                for vi in range(len(top_chunks)):
                    for vj in range(vi + 1, len(top_chunks)):
                        # Find the actual past sessions to compute pairwise similarity
                        ps_i = next((ps for ps in past_sessions if ps.id == top_chunks[vi]["trace_id"]), None)
                        ps_j = next((ps for ps in past_sessions if ps.id == top_chunks[vj]["trace_id"]), None)
                        if ps_i and ps_j and ps_i.embedding and ps_j.embedding:
                            sim = _cosine_similarity(ps_i.embedding, ps_j.embedding)
                            edges.append({
                                "source": top_chunks[vi]["trace_id"],
                                "target": top_chunks[vj]["trace_id"],
                                "similarity": sim,
                            })

                step.metadata["retrieved_chunks"] = top_chunks
                step.metadata["vector_graph"] = {"points": vector_points, "edges": edges}
                used_count = sum(1 for c in top_chunks if c.get("used"))
                if used_count > 0:
                    scores = ", ".join(f"{c['relevance']:.2f}" for c in top_chunks[:used_count])
                    context.append(
                        f"[Memory Retrieval]: Found {len(top_chunks)} relevant past traces "
                        f"({used_count} incorporated into context). "
                        f"Semantic similarity scores (cosine similarity: 0=unrelated, 1=identical): {scores}"
                    )
                else:
                    context.append(
                        f"[Memory Retrieval]: Found {len(top_chunks)} candidate chunks but none used "
                        f"(best cosine similarity: {top_chunks[0]['relevance']:.3f}, below threshold)"
                        if top_chunks else "[Memory Retrieval]: No semantically similar memories found"
                    )
                emit_event("memory_retrieval", f"Retrieved {len(top_chunks)} chunks, {used_count} used", trace_id)
            else:
                await asyncio.sleep(0.05)

        elapsed_ms = int((perf_counter() - start) * 1000)
        cpu_after, mem_after = _snapshot_cpu_mem()
        cpu_samples.extend([cpu_before, cpu_after])
        mem_samples.extend([mem_before, mem_after])

        is_error = model and output.startswith("[") and "error:" in output
        if is_error:
            session.steps[i].status = "error"
        else:
            session.steps[i].status = "complete"
        session.steps[i].duration_ms = elapsed_ms
        session.steps[i].cpu_after = cpu_after
        session.steps[i].mem_after = mem_after
        session.steps[i].context_assembled = step.context_assembled

        emit_event("stage_complete", f"{label} {'error' if is_error else 'completed'}", trace_id, f"{elapsed_ms}ms")

    session.status = "error" if any(s.status == "error" for s in session.steps) else "complete"
    session.output = context[-1] if context else prompt
    session.completed_at = datetime.now(timezone.utc).isoformat()
    session.confidence = _compute_confidence(session)
    session.insight_tags = _detect_insights(session)

    peak_cpu = round(max(cpu_samples), 1) if cpu_samples else 0.0
    peak_mem = round(max(mem_samples), 1) if mem_samples else 0.0
    avg_cpu = round(sum(cpu_samples) / len(cpu_samples), 1) if cpu_samples else 0.0
    avg_mem = round(sum(mem_samples) / len(mem_samples), 1) if mem_samples else 0.0
    session.telemetry_impact = TelemetryImpact(
        peak_cpu=peak_cpu, peak_mem=peak_mem, avg_cpu=avg_cpu, avg_mem=avg_mem,
    )

    emit_event("session_complete", "Orchestration completed", trace_id,
               f"peak CPU: {peak_cpu}%, peak RAM: {peak_mem}%")

    _persist(session)

    # ══ Post-complete async insight generation ═══════════════════
    try:
        insights = await _generate_llm_insights(session)
        if insights:
            session.llm_insights = insights
            _persist(session)
            logger.info("LLM insights generated for %s: %d insights", trace_id, len(insights))
    except Exception as e:
        logger.warning("LLM insight step failed for %s: %s", trace_id, e)

    try:
        session.embedding = await _embed(session.prompt)
    except Exception as e:
        logger.warning("Embedding computation failed for %s: %s", trace_id, e)

    try:
        rationale = await _generate_response_rationale(session)
        if rationale:
            session.response_rationale = rationale
            logger.info("Response rationale generated for %s", trace_id)
    except Exception as e:
        logger.warning("Response rationale failed for %s: %s", trace_id, e)

    try:
        explanation = await _generate_trace_explanation(session)
        if explanation:
            session.trace_explanation = explanation
            logger.info("Trace explanation generated for %s", trace_id)
    except Exception as e:
        logger.warning("Trace explanation failed for %s: %s", trace_id, e)

    try:
        ddc = await classify_ddc(session.prompt, session.output)
        if ddc.prompt or ddc.response:
            ddc_alt = await classify_multi_ddc(session.prompt, top_n=3)
            if ddc.prompt:
                ddc.prompt_alternatives = [a for a in ddc_alt if a.code != ddc.prompt.code][:2]
            ddc_resp_alt = await classify_multi_ddc(session.output or "", is_empty=not session.output)
            if ddc.response and ddc_resp_alt:
                ddc.response_alternatives = [a for a in ddc_resp_alt if a.code != ddc.response.code][:2]
            session.ddc = ddc
            logger.info("DDC classification complete for %s", trace_id)
    except Exception as e:
        logger.warning("DDC classification failed for %s: %s", trace_id, e)

    try:
        lcc = await classify_lcc(session.prompt, session.output)
        if lcc.prompt or lcc.response:
            lcc_alt = await classify_multi_lcc(session.prompt, top_n=3)
            if lcc.prompt:
                lcc.prompt_alternatives = [a for a in lcc_alt if a.code != lcc.prompt.code][:2]
            lcc_resp_alt = await classify_multi_lcc(session.output or "", is_empty=not session.output)
            if lcc.response and lcc_resp_alt:
                lcc.response_alternatives = [a for a in lcc_resp_alt if a.code != lcc.response.code][:2]
            session.lcc = lcc
            logger.info("LCC classification complete for %s", trace_id)
    except Exception as e:
        logger.warning("LCC classification failed for %s: %s", trace_id, e)

    _persist(session)

    return session


def get_trace(trace_id: str) -> TraceSession | None:
    if trace_id in _store:
        return _store[trace_id]
    for session in load_history(limit=500):
        if session.id == trace_id:
            return session
    return None


def list_traces(limit: int = 50) -> list[TraceSession]:
    return load_history(limit)


def delete_trace(trace_id: str) -> bool:
    removed = False
    if trace_id in _store:
        del _store[trace_id]
        removed = True
    try:
        if os.path.exists(HISTORY_FILE):
            with open(HISTORY_FILE) as f:
                lines = f.readlines()
            kept = [l for l in lines if trace_id not in l]
            if len(kept) < len(lines):
                with open(HISTORY_FILE, "w") as f:
                    f.writelines(kept)
                removed = True
    except Exception as e:
        logger.error("Failed to delete trace %s from history: %s", trace_id, e)
    return removed


def bulk_delete_traces(trace_ids: list[str]) -> int:
    count = 0
    for tid in trace_ids:
        if tid in _store:
            del _store[tid]
            count += 1
    try:
        if os.path.exists(HISTORY_FILE):
            with open(HISTORY_FILE) as f:
                lines = f.readlines()
            id_set = set(trace_ids)
            kept = [l for l in lines if not any(tid in l for tid in id_set)]
            if len(kept) < len(lines):
                with open(HISTORY_FILE, "w") as f:
                    f.writelines(kept)
    except Exception as e:
        logger.error("Failed to bulk delete from history: %s", e)
    return count
