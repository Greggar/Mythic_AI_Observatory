import asyncio
import json
import logging
import os
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Any

import httpx
import psutil

logger = logging.getLogger("conductor")

from models.trace import TraceSession, TraceStep, TelemetryImpact


BACKOFFICE_URL = "http://198.51.100.100:12434"
FAST_MODEL = "docker.io/ai/qwen3.5:9B-UD-Q4_K_XL"

LOCAL_OLLAMA_URL = "http://127.0.0.1:11434"
LOCAL_MODEL = "qwen2.5:7b"

# Set to "local" to use Gingerlong's CPU, "backoffice" for GPU worker
MODEL_PROVIDER = os.environ.get("ORCHESTRATOR_MODEL", "backoffice").lower()

LLM_TIMEOUT = 180.0  # longer timeout for CPU-bound local inference

MAX_HISTORY = 500
HISTORY_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "traces.jsonl")


STAGES: list[dict[str, Any]] = [
    {"id": "step-1", "label": "Request Received", "model": None, "system": None},
    {"id": "step-2", "label": "Intent Classification", "model": FAST_MODEL,
     "system": "You are an intent classifier. Respond with one short sentence classifying the user request."},
    {"id": "step-3", "label": "Agent Selection", "model": None, "system": None},
    {"id": "step-4", "label": "Memory Retrieval", "model": None, "system": None},
    {"id": "step-5", "label": "Context Synthesis", "model": FAST_MODEL,
     "system": "You are a synthesizer. In one sentence, note the key context for responding to this request."},
    {"id": "step-6", "label": "Response Generation", "model": FAST_MODEL,
     "system": "You are a wise and knowledgeable AI oracle. Provide a thoughtful, clear response to the user."},
    {"id": "step-7", "label": "Final Response", "model": None, "system": None},
]


async def _call_model(model: str, prompt: str, system: str | None = None) -> str:
    if MODEL_PROVIDER == "local":
        base_url = LOCAL_OLLAMA_URL
        model = LOCAL_MODEL
        payload: dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {"num_ctx": 4096},
        }
    else:
        base_url = BACKOFFICE_URL
        payload = {
            "model": model,
            "prompt": prompt,
            "stream": False,
        }

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
            return result
        except Exception as e:
            logger.error("Model call failed: %s", e)
            return f"[{model} error: {e}]"


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


# ── Activity event bus ────────────────────────────────────────────
_activity_events: deque[dict[str, Any]] = deque(maxlen=200)


def emit_event(kind: str, label: str, session_id: str | None = None, detail: str | None = None) -> None:
    event = {
        "id": uuid.uuid4().hex[:8],
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
    except Exception as e:
        logger.error("Failed to load history: %s", e)
    return sessions[-limit:]


def _compute_similarity(a: str, b: str) -> float:
    words_a = set(a.lower().split()[:20])
    words_b = set(b.lower().split()[:20])
    if not words_a or not words_b:
        return 0.0
    intersection = words_a & words_b
    return round(len(intersection) / max(len(words_a | words_b), 1), 4)


async def orchestrate(prompt: str) -> TraceSession:
    trace_id = uuid.uuid4().hex[:12]
    session = TraceSession(id=trace_id, prompt=prompt)
    _store[trace_id] = session

    context: list[str] = []
    cpu_samples: list[float] = []
    mem_samples: list[float] = []

    emit_event("session_start", "Orchestration started", trace_id, prompt[:80])
    resolved_model = LOCAL_MODEL if MODEL_PROVIDER == "local" else FAST_MODEL
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

        start = asyncio.get_event_loop().time()

        if model:
            combined = "\n".join(context + [prompt])
            output = await _call_model(model, combined, system)
            context.append(f"[{label}]: {output}")
            step.metadata["output"] = output[:200]
            emit_event("inference", f"Inference: {label}", trace_id, resolved_model)
        else:
            await asyncio.sleep(0.05)

        elapsed_ms = int((asyncio.get_event_loop().time() - start) * 1000)
        cpu_after, mem_after = _snapshot_cpu_mem()
        cpu_samples.extend([cpu_before, cpu_after])
        mem_samples.extend([mem_before, mem_after])

        session.steps[i].status = "complete"
        session.steps[i].duration_ms = elapsed_ms
        session.steps[i].cpu_after = cpu_after
        session.steps[i].mem_after = mem_after

        emit_event("stage_complete", f"{label} completed", trace_id, f"{elapsed_ms}ms")

    session.status = "complete"
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
    return session


def get_trace(trace_id: str) -> TraceSession | None:
    if trace_id in _store:
        return _store[trace_id]
    return None


def list_traces(limit: int = 50) -> list[TraceSession]:
    return load_history(limit)
