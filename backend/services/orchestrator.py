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

from models.trace import TraceSession, TraceStep, TelemetryImpact, LlmInsight
from services import config_manager

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
     "system": "You are an intent classifier. Respond with one short sentence classifying the user request."},
    {"id": "step-3", "label": "Agent Selection", "model": None, "system": None},
    {"id": "step-4", "label": "Memory Retrieval", "model": None, "system": None},
    {"id": "step-5", "label": "Context Synthesis", "model": "backoffice",
     "system": "You are a synthesizer. In one sentence, note the key context for responding to this request."},
    {"id": "step-6", "label": "Response Generation", "model": "backoffice",
     "system": "You are a wise and knowledgeable AI oracle. Provide a thoughtful, clear response to the user."},
    {"id": "step-7", "label": "Final Response", "model": None, "system": None},
]

LOCAL_MODEL = "qwen2.5:3b"


def _resolve_model_url(model_key: str) -> tuple[str, str]:
    if _MODEL_PROVIDER == "local":
        base_url = config_manager.get_ollama_url()
        model_name = LOCAL_MODEL
    else:
        base_url = config_manager.get_backoffice_url()
        model_name = config_manager.get_backoffice_model()
    return base_url, model_name


async def _call_model(model: str, prompt: str, system: str | None = None) -> str:
    base_url, model_name = _resolve_model_url(model)

    payload: dict[str, Any] = {
        "model": model_name,
        "prompt": prompt,
        "stream": False,
    }

    if _MODEL_PROVIDER == "local":
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
            label = svc.get("label", sid)
            model = svc.get("model", "")
            if model:
                label = f"{label} ({model})"
            svc_names.append(label)

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
        f"model: {session.model_used or 'unknown'}\n"
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

        start = asyncio.get_event_loop().time()

        if model:
            combined = "\n".join(context + [prompt])
            step.context_assembled = combined
            output = await _call_model(model, combined, system)
            context.append(f"[{label}]: {output}")
            step.metadata["output"] = output[:200]
            emit_event("inference", f"Inference: {label}", trace_id, resolved_model)
        else:
            step.context_assembled = f"[non-model stage — no context assembly]"
            await asyncio.sleep(0.05)

        elapsed_ms = int((asyncio.get_event_loop().time() - start) * 1000)
        cpu_after, mem_after = _snapshot_cpu_mem()
        cpu_samples.extend([cpu_before, cpu_after])
        mem_samples.extend([mem_before, mem_after])

        session.steps[i].status = "complete"
        session.steps[i].duration_ms = elapsed_ms
        session.steps[i].cpu_after = cpu_after
        session.steps[i].mem_after = mem_after
        session.steps[i].context_assembled = step.context_assembled

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

    # ══ Post-complete async insight generation ═══════════════════
    try:
        insights = await _generate_llm_insights(session)
        if insights:
            session.llm_insights = insights
            _persist(session)
            logger.info("LLM insights generated for %s: %d insights", trace_id, len(insights))
    except Exception as e:
        logger.warning("LLM insight step failed for %s: %s", trace_id, e)

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
