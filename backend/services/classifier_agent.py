import asyncio
import json
import logging
import os
from typing import Any

import httpx

from models.trace import SynesthClassification, TraceSession
from services import config_manager

logger = logging.getLogger("conductor")

SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "synesthesia_schema.md")
CACHE_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "synesth_cache.json")

POLL_INTERVAL = 45.0
BATCH_SIZE = 5

_cache: dict[str, dict[str, int]] = {}

def _load_cache() -> dict[str, dict[str, int]]:
    if not os.path.exists(CACHE_PATH):
        return {}
    try:
        with open(CACHE_PATH) as f:
            return json.load(f)
    except Exception as e:
        logger.warning("Failed to load synesth cache: %s", e)
        return {}

def _save_cache(cache: dict[str, dict[str, int]]) -> None:
    try:
        data_dir = os.path.dirname(CACHE_PATH)
        os.makedirs(data_dir, exist_ok=True)
        with open(CACHE_PATH, "w") as f:
            json.dump(cache, f, indent=2)
    except Exception as e:
        logger.error("Failed to save synesth cache: %s", e)

def merge_synesth(traces: list[TraceSession]) -> list[TraceSession]:
    if not _cache:
        _cache.update(_load_cache())
    for t in traces:
        entry = _cache.get(t.id)
        if entry is not None:
            t.synesth = SynesthClassification(
                input_cat=entry["input_cat"],
                output_cat=entry["output_cat"],
            )
    return traces

def load_schema() -> str:
    if not os.path.exists(SCHEMA_PATH):
        logger.warning("Schema file not found at %s", SCHEMA_PATH)
        return ""
    with open(SCHEMA_PATH) as f:
        return f.read()

CLASSIFICATION_SYSTEM_PROMPT = (
    "You are a precise text classifier. Your job is to classify a user prompt "
    "and an AI response into predefined categories. "
    "Respond with ONLY a JSON object with two fields: "
    '"input_cat" (integer 0-4) and "output_cat" (integer 0-4). '
    "No other text, no explanation, no markdown formatting."
)

def _build_classification_prompt(schema: str, prompt: str, response: str | None) -> str:
    return (
        f"Using the schema below, classify this trace's input prompt and output response.\n\n"
        f"--- SCHEMA ---\n{schema}\n\n"
        f"--- INPUT PROMPT ---\n{prompt}\n\n"
        f"--- OUTPUT RESPONSE ---\n{response or '(empty)'}\n\n"
        "Return only a JSON object: {\"input_cat\": <0-4>, \"output_cat\": <0-4>}"
    )

async def classify_trace(
    prompt: str,
    response: str | None,
    schema: str,
    *,
    base_url: str | None = None,
    model_name: str = "qwen2.5:1.5b",
) -> dict[str, int] | None:
    if base_url is None:
        base_url = config_manager.get_ollama_url()
    if not base_url:
        logger.warning("No Ollama URL — skipping LLM classification")
        return None

    llm_prompt = _build_classification_prompt(schema, prompt, response)

    payload = {
        "model": model_name,
        "prompt": llm_prompt,
        "system": CLASSIFICATION_SYSTEM_PROMPT,
        "stream": False,
        "options": {"num_ctx": 4096, "temperature": 0.1},
    }

    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            resp = await client.post(f"{base_url}/api/generate", json=payload)
            resp.raise_for_status()
            data = resp.json()
            raw = data.get("response", "").strip()
            raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            result = json.loads(raw)
            if "input_cat" in result and "output_cat" in result:
                input_cat = int(result["input_cat"])
                output_cat = int(result["output_cat"])
                if 0 <= input_cat <= 4 and 0 <= output_cat <= 4:
                    logger.info("LLM classified: input=%d output=%d", input_cat, output_cat)
                    return {"input_cat": input_cat, "output_cat": output_cat}
            logger.warning("LLM returned invalid classification: %s", raw)
    except json.JSONDecodeError:
        logger.warning("LLM returned non-JSON for classification: %s", raw)
    except Exception as e:
        logger.warning("LLM classification failed: %s (%s)", e.__class__.__name__, e)
    return None


async def classify_trace_to_cache(
    trace: TraceSession, schema: str, *, base_url: str | None = None, model_name: str = "qwen2.5:1.5b"
) -> bool:
    if trace.output is None:
        return False
    result = await classify_trace(trace.prompt, trace.output, schema, base_url=base_url, model_name=model_name)
    if result is None:
        return False
    cache = _load_cache()
    cache[trace.id] = result
    _save_cache(cache)
    _cache.clear()
    _cache.update(cache)
    return True

def _unclassified_traces(traces: list[TraceSession]) -> list[TraceSession]:
    cache = _load_cache()
    return [t for t in traces if t.id not in cache and t.output is not None]

async def _classifier_cycle() -> None:
    schema = load_schema()
    if not schema:
        logger.warning("No synesthesia schema loaded — classifier agent idle")
        return

    from services.orchestrator import load_history
    all_traces = load_history(limit=500)
    pending = _unclassified_traces(all_traces)

    if not pending:
        return

    batch = pending[:BATCH_SIZE]
    logger.info("Classifier agent: processing %d unclassified traces", len(batch))

    for t in batch:
        await classify_trace_to_cache(t, schema)

async def classifier_loop() -> None:
    logger.info("Classifier agent started (poll every %.0fs)", POLL_INTERVAL)
    while True:
        try:
            await _classifier_cycle()
        except Exception as e:
            logger.warning("Classifier agent cycle failed: %s", e)
        await asyncio.sleep(POLL_INTERVAL)
