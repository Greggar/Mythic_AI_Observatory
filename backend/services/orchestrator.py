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

# Set to "local" to use the primary server's CPU, "worker" for a remote GPU machine
# Use set_model_provider() to change at runtime
_model_provider_cfg = config_manager.get_model_provider_config()
_MODEL_PROVIDER: str = os.environ.get("ORCHESTRATOR_MODEL", _model_provider_cfg.get("provider", "local")).lower()

def get_model_provider() -> str:
    return _MODEL_PROVIDER

def _set_model_provider_internal(value: str) -> None:
    """Update the in-memory provider global without writing to disk."""
    global _MODEL_PROVIDER
    value = value.lower()
    if value not in ("local", "worker"):
        raise ValueError(f"Invalid model provider: {value!r}. Must be 'local' or 'worker'.")
    _MODEL_PROVIDER = value

def set_model_provider(value: str) -> None:
    global _MODEL_PROVIDER
    value = value.lower()
    if value not in ("local", "worker"):
        raise ValueError(f"Invalid model provider: {value!r}. Must be 'local' or 'worker'.")
    _MODEL_PROVIDER = value
    config_manager.set_model_provider_config(value)
    logger.info("Model provider switched to: %s", value)

LLM_TIMEOUT = 120.0  # reduced from 300s; model-too-large hangs surface in ~60s

MAX_HISTORY = 500
HISTORY_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "traces.jsonl")


STAGES: list[dict[str, Any]] = [
    {"id": "step-1", "label": "Request Received", "model": None, "system": None},
    {"id": "step-2", "label": "Intent Classification", "model": "worker", "system": None},
    {"id": "step-3", "label": "Model Routing", "model": None, "system": None},
    {"id": "step-4", "label": "Memory Retrieval", "model": None, "system": None},
    {"id": "step-5", "label": "Context Assembly", "model": None, "system": None},
    {"id": "step-6", "label": "Response Generation", "model": "worker",
     "system": "You are a wise and knowledgeable AI oracle. Provide a thoughtful, clear response to the user."},
    {"id": "step-7", "label": "Output Packaging", "model": None, "system": None},
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

def _sync_analysis_from_config() -> None:
    global ANALYSIS_MODEL, ANALYSIS_PROVIDER
    try:
        ac = config_manager.get_analysis_config()
        ANALYSIS_MODEL = ac["model"]
        ANALYSIS_PROVIDER = ac["provider"]
    except Exception:
        pass

def get_analysis_model() -> str:
    _sync_analysis_from_config()
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
    _sync_analysis_from_config()
    return ANALYSIS_PROVIDER

def set_analysis_provider(value: str) -> None:
    global ANALYSIS_PROVIDER
    value = value.lower()
    if value not in ("local", "worker"):
        raise ValueError(f"Invalid analysis provider: {value!r}. Must be 'local' or 'worker'.")
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

    # Warm up analysis model if different from execution model
    if ANALYSIS_MODEL and ANALYSIS_MODEL != model_name:
        an_url = config_manager.get_worker_url() if ANALYSIS_PROVIDER == "worker" else base_url
        if an_url:
            an_payload = {
                "model": ANALYSIS_MODEL,
                "prompt": "hello",
                "stream": False,
                "options": {"num_ctx": 4096},
            }
            try:
                async with httpx.AsyncClient(timeout=60.0) as client:
                    resp = await client.post(f"{an_url}/api/generate", json=an_payload)
                    resp.raise_for_status()
                    logger.info("Analysis model warm-up complete: %s (%s)", ANALYSIS_MODEL, resp.status_code)
            except Exception as e:
                logger.warning("Analysis model warm-up failed (non-fatal): %s", e)


def _resolve_model_url(model_key: str) -> tuple[str, str]:
    if _MODEL_PROVIDER == "local":
        base_url = config_manager.get_ollama_url()
        model_name = LOCAL_MODEL
    else:
        base_url = config_manager.get_worker_url()
        model_name = config_manager.get_worker_model()
    return base_url, model_name


async def _call_model(model: str, prompt: str, system: str | None = None, *, model_name_override: str | None = None, provider_override: str | None = None) -> tuple[str, int | None, int | None]:
    if model_name_override:
        provider = provider_override or ANALYSIS_PROVIDER
        if provider == "local":
            base_url = config_manager.get_ollama_url()
        else:
            base_url = config_manager.get_worker_url()
        model_name = model_name_override
    else:
        base_url, model_name = _resolve_model_url(model)

    # Strip Docker registry prefix — the runner API expects the short name
    if "/" in model_name:
        model_name = model_name.split("/")[-1]

    payload: dict[str, Any] = {
        "model": model_name,
        "prompt": prompt,
        "stream": False,
    }

    provider_for_ctx = provider_override or (ANALYSIS_PROVIDER if model_name_override else _MODEL_PROVIDER)
    if provider_for_ctx == "local":
        payload["options"] = {"num_ctx": 4096}
    else:
        payload["options"] = {"num_ctx": 16384}

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
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                msg = f"Model '{model_name}' not found on {base_url}. Use 'ollama pull {model_name}' to download it."
            else:
                msg = f"{model_name} error: {e}"
            logger.error("Model call failed: %s", msg)
            return f"[{model_name} error: {msg}]", None, None
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
def _fmt_ms(ms: int | float) -> str:
    if ms < 1000:
        return f"{int(ms)}ms"
    return f"{ms / 1000:.1f}s"

async def _generate_llm_insights(session: TraceSession) -> list[LlmInsight]:
    if not session.steps:
        return []

    step_map = {s.label: s.duration_ms for s in session.steps if s.label and s.duration_ms}
    total_ms = sum(step_map.values())

    insights: list[LlmInsight] = []
    model_label = session.model_used or LOCAL_MODEL or "unknown"

    # Slowest stage
    if step_map:
        slowest_label, slowest_ms = max(step_map.items(), key=lambda x: x[1] or 0)
        pct = f"{(slowest_ms / total_ms * 100):.0f}" if total_ms > 0 else "?"
        if slowest_ms and slowest_ms > 5000:
            insights.append(LlmInsight(
                type="info",
                title=f"{slowest_label} dominates",
                body=f"{slowest_label} took {_fmt_ms(slowest_ms)} ({pct}% of run). "
                     f"This is the primary bottleneck."
            ))

    # Error detection
    for s in session.steps:
        if s.status == "error":
            err_out = (s.metadata.get("output") or "")[:120] if s.metadata else ""
            insights.append(LlmInsight(
                type="recommendation",
                title=f"{s.label} failed",
                body=f"Stage errored: {err_out or 'unknown reason'}. Review pipeline logs."
            ))

    # Total pipeline time
    if total_ms > 120000:
        insights.append(LlmInsight(
            type="info",
            title="Slow pipeline",
            body=f"Total time {_fmt_ms(total_ms)}. Consider using a GPU-backed model or reducing retrieval depth."
        ))
    elif total_ms < 5000:
        insights.append(LlmInsight(
            type="info",
            title="Fast pipeline",
            body=f"Completed in {_fmt_ms(total_ms)} — likely prompt caching or warm model."
        ))

    # Cold start heuristic: if first stage is much slower than the rest
    steps_with_time = [s for s in session.steps if s.duration_ms]
    if len(steps_with_time) >= 3:
        first_ms = steps_with_time[0].duration_ms or 0
        median_of_rest = sorted([s.duration_ms or 0 for s in steps_with_time[1:]])
        rest_med = median_of_rest[len(median_of_rest) // 2] if median_of_rest else 0
        if first_ms > rest_med * 3 and first_ms > 5000:
            insights.append(LlmInsight(
                type="info",
                title="Cold start detected",
                body=f"First stage ({steps_with_time[0].label}) took {_fmt_ms(first_ms)} — "
                     f"{int(first_ms / (rest_med or 1))}x the median of subsequent stages. "
                     f"Model was likely paged out of RAM."
            ))

    # Network architecture context
    arch = await _build_architecture_context()
    unreachable = [line for line in arch.split("\n") if "unreachable" in line.lower()]
    if unreachable:
        service_names = [u.split(":")[0].strip() for u in unreachable if ":" in u]
        if service_names:
            insights.append(LlmInsight(
                type="recommendation",
                title="Unreachable services",
                body=f"Could not reach: {', '.join(service_names)}. Check network connectivity."
            ))

    return insights[:6]


async def _generate_response_rationale(session: TraceSession) -> str | None:
    if not session.output or not session.steps:
        return None

    intent_step = next((s for s in session.steps if s.label == "Intent Classification"), None)
    intent_info = ""
    if intent_step and intent_step.metadata:
        intent_info = intent_step.metadata.get("output", "") or ""

    mem_step = next((s for s in session.steps if s.label == "Memory Retrieval"), None)
    mem_info = ""
    if mem_step and mem_step.metadata:
        chunks = mem_step.metadata.get("retrieved_chunks", [])
        used = sum(1 for c in chunks if c.get("used"))
        if chunks:
            mem_info = f"Based on {len(chunks)} past trace(s), {used} directly relevant. "

    model_name = session.model_used or LOCAL_MODEL or "the AI model"
    out_len = len(session.output)
    if out_len < 100:
        style = "concise"
    elif out_len < 500:
        style = "moderate-length"
    else:
        style = "detailed"

    prompt_first_line = (session.prompt or "").split("\n")[0][:80]

    parts = [
        f"The user asked: \"{prompt_first_line}\".",
    ]
    if intent_info:
        parts.append(f"The system classified this request under '{intent_info}'.")
    if mem_info:
        parts.append(mem_info)
    parts.append(
        f"The model ({model_name}) produced a {style} response ({out_len} characters), "
        f"tailored to the user's request as interpreted through the orchestration pipeline."
    )

    return " ".join(parts)


async def _generate_trace_explanation(session: TraceSession) -> str | None:
    if not session.steps:
        return None
    parts: list[str] = []

    # Step 1: what user asked
    parts.append(f"The user asked: \"{session.prompt}\"")

    # Intent classification
    intent_step = next((s for s in session.steps if s.label == "Intent Classification"), None)
    if intent_step and intent_step.metadata:
        intent_out = intent_step.metadata.get("output", "")
        if intent_out:
            parts.append(f"The system classified this as: {intent_out}")

    # Memory retrieval
    mem_step = next((s for s in session.steps if s.label == "Memory Retrieval"), None)
    if mem_step and mem_step.metadata:
        chunks = mem_step.metadata.get("retrieved_chunks", [])
        used = sum(1 for c in chunks if c.get("used"))
        if chunks:
            top_rel = max((c.get("relevance", 0) for c in chunks), default=0)
            parts.append(
                f"Memory Retrieval found {len(chunks)} relevant past trace(s) "
                f"(top relevance: {top_rel:.2f}), of which {used} were used to inform the response."
            )
        else:
            parts.append("Memory Retrieval found no relevant past traces.")
    else:
        parts.append("Memory Retrieval was not invoked.")

    # Context synthesis
    ctx_step = next((s for s in session.steps if s.label == "Context Assembly"), None)
    if ctx_step and ctx_step.context_assembled:
        ctx_len = len(ctx_step.context_assembled)
        parts.append(f"Context Assembly built a {ctx_len}-character context from retrieved data and system instructions.")
    elif ctx_step:
        parts.append("Context Assembly passed through the primary intent without additional context.")

    # Response generation
    gen_step = next((s for s in session.steps if s.label == "Response Generation"), None)
    model_used = (gen_step.model_used or session.model_used or LOCAL_MODEL) if gen_step else (session.model_used or LOCAL_MODEL)
    if session.output:
        out_len = len(session.output)
        parts.append(f"The model ({model_used}) generated a {out_len}-character response.")
    elif session.status == "error":
        parts.append(f"The pipeline errored before producing a final response.")
    else:
        parts.append(f"No output was generated.")

    # Stage timing summary
    timed_steps = [(s.label, s.duration_ms) for s in session.steps if s.label and s.duration_ms]
    if timed_steps:
        total = sum(ms for _, ms in timed_steps)
        timing = ", ".join(f"{label}: {_fmt_ms(ms)}" for label, ms in timed_steps)
        parts.append(f"Pipeline completed in {_fmt_ms(total)}: {timing}.")

    # Error summary
    errors = [s for s in session.steps if s.status == "error"]
    if errors:
        err_detail = "; ".join(f"{s.label}: {(s.metadata.get('output') or '')[:100]}" for s in errors)
        parts.append(f"Errors occurred: {err_detail}.")

    return "\n\n".join(parts)


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
    "step-3": "Model Router",
    "step-4": "Memory Retriever",
    "step-5": "Context Assembler",
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
def _get_embed_model() -> str:
    return config_manager.get_embedding_model()


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
    base_url = config_manager.get_embedding_url()
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{base_url}/api/embeddings",
            json={"model": _get_embed_model(), "prompt": text},
            timeout=30,
        )
        data = resp.json()
        emb = data["embedding"]
        _embed_cache[text] = emb
        return emb


async def orchestrate(prompt: str, trace_id: str | None = None, headless: bool = False,
                       model_override: str | None = None, provider_override: str | None = None) -> TraceSession:
    trace_id = trace_id or uuid.uuid4().hex[:12]
    session = _store.get(trace_id) or TraceSession(id=trace_id, prompt=prompt)
    _store[trace_id] = session

    context: list[str] = []
    cpu_samples: list[float] = []
    mem_samples: list[float] = []

    if not headless:
        emit_event("session_start", "Orchestration started", trace_id, prompt[:80])
    if model_override:
        resolved_model = model_override
    else:
        _, resolved_model = _resolve_model_url("worker")
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

        if not headless:
            emit_event("stage_start", f"{label} started", trace_id, agent_name)

        start = perf_counter()

        if model:
            combined = "\n".join(context + [prompt])
            step.context_assembled = combined

            # Step 2: use embedding-based intent classifier instead of LLM
            if stage_id == "step-2":
                from services.intent_classifier import classify_intent
                intent_result = await classify_intent(prompt)
                output = json.dumps(intent_result)
                eval_count = None
                eval_duration_ns = None
            else:
                if stage_id == "step-6" and not headless:
                    step.metadata["gen_started_at"] = datetime.now(timezone.utc).isoformat()
                output, eval_count, eval_duration_ns = await _call_model(
                    model, combined, system,
                    model_name_override=model_override if model_override else None,
                    provider_override=provider_override if provider_override else None,
                )

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
            if not headless:
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
                if stage_id == "step-5":
                    output = f"[{label}]: Primary intent is {next((c for c in context if c.startswith('[Intent')), 'unknown')}"
                    step.metadata["output"] = output[:2000]
                    context.append(output)
                elif stage_id == "step-7":
                    step.metadata["output"] = ""
                else:
                    step.metadata["output"] = ""

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


STALE_THRESHOLD_S = 60  # steps running longer than this are flagged as potentially stuck

def _annotate_staleness(session: TraceSession) -> None:
    """Mark steps that have been 'processing' for >STALE_THRESHOLD_S as stale."""
    now = datetime.now(timezone.utc)
    for step in session.steps:
        if step.status != "processing":
            step.metadata.pop("stale", None)
            continue
        try:
            started = datetime.fromisoformat(step.timestamp)
            elapsed = (now - started).total_seconds()
            if elapsed > STALE_THRESHOLD_S:
                step.metadata["stale"] = True
                step.metadata["stale_seconds"] = round(elapsed)
            else:
                step.metadata.pop("stale", None)
                step.metadata.pop("stale_seconds", None)
        except (ValueError, TypeError):
            pass


def get_trace(trace_id: str) -> TraceSession | None:
    if trace_id in _store:
        _annotate_staleness(_store[trace_id])
        return _store[trace_id]
    for session in load_history(limit=500):
        if session.id == trace_id:
            return session
    return None


def list_traces(limit: int = 50) -> list[TraceSession]:
    traces = load_history(limit)
    for t in traces:
        _annotate_staleness(t)
    return traces


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
