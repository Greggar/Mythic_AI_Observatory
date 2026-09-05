import asyncio
import json
import logging
import os

from models.trace import SynesthClassification, TraceSession
from services import config_manager

logger = logging.getLogger("conductor")

CACHE_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "synesth_cache.json")

POLL_INTERVAL = float(
    os.environ.get("CLASSIFIER_POLL_INTERVAL") or config_manager.get_classifier_config().get("poll_interval", 45)
)
BATCH_SIZE = 5

_cache: dict[str, dict[str, list[float]]] = {}

def _load_cache() -> dict[str, dict[str, list[float]]]:
    if not os.path.exists(CACHE_PATH):
        return {}
    try:
        with open(CACHE_PATH) as f:
            return json.load(f)
    except Exception as e:
        logger.warning("Failed to load synesth cache: %s", e)
        return {}

def _save_cache(cache: dict[str, dict[str, list[float]]]) -> None:
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
                input_probs=entry["input_probs"],
                output_probs=entry["output_probs"],
            )
    return traces

async def classify_trace_to_cache(trace: TraceSession) -> bool:
    if trace.output is None:
        return False
    from services.synesth_classifier import classify_synesth
    result = await classify_synesth(trace.prompt, trace.output)
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
    from services.orchestrator import load_history
    all_traces = load_history(limit=500)
    pending = _unclassified_traces(all_traces)

    if not pending:
        logger.debug("Classifier agent: no unclassified traces")
        return

    batch = pending[:BATCH_SIZE]
    logger.info("Classifier agent: processing %d/%d unclassified traces", len(batch), len(pending))
    for t in batch:
        await classify_trace_to_cache(t)

async def classifier_loop() -> None:
    logger.info("Classifier agent started (poll every %.0fs)", POLL_INTERVAL)
    while True:
        try:
            await _classifier_cycle()
        except Exception as e:
            logger.warning("Classifier agent cycle failed: %s", e)
        await asyncio.sleep(POLL_INTERVAL)
