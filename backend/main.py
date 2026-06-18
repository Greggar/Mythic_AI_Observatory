import asyncio
import csv
import io
import json
import logging
import platform
import subprocess
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any

import httpx
import requests
import psutil
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import Gauge, generate_latest, REGISTRY
from pydantic import BaseModel

from models.trace import TraceSession
from services.profile import compute_profile, ModelProfile
from models.annotation import Annotation
from services.orchestrator import orchestrate, get_trace, list_traces, delete_trace, bulk_delete_traces, get_activity_events, get_model_provider, set_model_provider, get_local_model, set_local_model, get_analysis_model, set_analysis_model, get_analysis_provider, set_analysis_provider, warmup_model, _call_model, LOCAL_MODEL
from services import annotation_service
from services.vitals import collect_vitals
from services import config_manager
from services.classifier_agent import classifier_loop, merge_synesth

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("conductor")

app = FastAPI(title="Mythic AI Observatory — Conductor API")

_last_activity: float = time.time()


@app.middleware("http")
async def track_activity(request: Request, call_next):
    global _last_activity
    _last_activity = time.time()
    return await call_next(request)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Prometheus metrics ──────────────────────────────────────────
cpu_gauge = Gauge("system_cpu_percent", "CPU usage %")
mem_gauge = Gauge("system_memory_percent", "Memory usage %")
gpu_mem_gauge = Gauge("gpu_memory_percent", "GPU memory usage %")
gpu_util_gauge = Gauge("gpu_util_percent", "GPU compute utilization %")
ollama_models_gauge = Gauge("ollama_models_count", "Number of Ollama models available")
openclaw_uptime_gauge = Gauge("openclaw_uptime_seconds", "OpenClaw gateway uptime")

# ── WebSocket connection manager ─────────────────────────────────
class ConnectionManager:
    def __init__(self) -> None:
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, data: str) -> None:
        dead: list[WebSocket] = []
        for ws in self.active:
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

manager = ConnectionManager()

executor = ThreadPoolExecutor(max_workers=4)

# ── Helpers ──────────────────────────────────────────────────────

def _get_cpu_load() -> float:
    return psutil.cpu_percent(interval=0)

def _get_memory_load() -> float:
    return psutil.virtual_memory().percent

def _get_gpu_stats() -> dict[str, float]:
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total",
             "--format=csv,noheader,nounits"],
            timeout=5, text=True,
        ).strip()
        parts = out.split(",")
        util = float(parts[0].strip())
        mem_used = float(parts[1].strip())
        mem_total = float(parts[2].strip())
        mem_pct = round((mem_used / mem_total) * 100, 1) if mem_total else 0.0
        return {"gpu_util": util, "gpu_mem_pct": mem_pct}
    except Exception:
        return {"gpu_util": 0.0, "gpu_mem_pct": 0.0}

def _fetch_json(url: str, timeout: float = 4.0) -> dict[str, Any] | None:
    try:
        r = requests.get(url, timeout=timeout)
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        logger.debug("Poll %s failed: %s", url, exc)
        return None

def _poll_ollama() -> dict[str, Any]:
    url = config_manager.get_ollama_tags_url()
    if not url:
        return {"status": "disabled", "models": [], "count": 0}
    data = _fetch_json(url)
    if data and "models" in data:
        return {"status": "ok", "models": data["models"], "count": len(data["models"])}
    return {"status": "error", "models": [], "count": 0}

def _poll_openclaw() -> dict[str, Any]:
    url = config_manager.get_openclaw_health_url()
    if not url:
        return {"status": "disabled"}
    data = _fetch_json(url)
    if data:
        return {"status": "ok", **data}
    return {"status": "error"}

def _poll_remote(name: str, url: str) -> dict[str, Any]:
    try:
        r = requests.get(url, timeout=3.0)
        r.raise_for_status()
        return {"status": "ok", "target": name, "url": url}
    except requests.ConnectionError:
        return {"status": "error", "target": name, "url": url, "detail": "connection_refused"}
    except requests.Timeout:
        return {"status": "error", "target": name, "url": url, "detail": "timeout"}
    except Exception:
        return {"status": "error", "target": name, "url": url, "detail": "unreachable"}

# ── Telemetry collector ─────────────────────────────────────────
async def collect_telemetry() -> dict[str, Any]:
    loop = asyncio.get_event_loop()

    cpu_pct = await loop.run_in_executor(executor, _get_cpu_load)
    mem_pct = await loop.run_in_executor(executor, _get_memory_load)
    gpu = await loop.run_in_executor(executor, _get_gpu_stats)
    ollama = await loop.run_in_executor(executor, _poll_ollama)
    oc = await loop.run_in_executor(executor, _poll_openclaw)

    remotes: list[dict[str, Any]] = []
    service_to_machine: dict[str, str] = {}
    for mid, mc in config_manager.get_machines_config().items():
        for sid in mc.get("services", []):
            service_to_machine[sid] = mc.get("name", mid)
    for name, url in config_manager.get_remote_targets().items():
        res = await loop.run_in_executor(executor, _poll_remote, name, url)
        res["machine"] = service_to_machine.get(name, "")
        remotes.append(res)

    # Update prometheus gauges
    cpu_gauge.set(cpu_pct)
    mem_gauge.set(mem_pct)
    gpu_mem_gauge.set(gpu["gpu_mem_pct"])
    gpu_util_gauge.set(gpu["gpu_util"])
    ollama_models_gauge.set(ollama.get("count", 0))

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "hostname": platform.node(),
        "cpu": {"percent": cpu_pct},
        "memory": {"percent": mem_pct},
        "gpu": gpu,
        "ollama": ollama,
        "openclaw": oc,
        "remotes": remotes,
        "prometheus": generate_latest(REGISTRY).decode(),
    }

_latest_telemetry: dict[str, Any] | None = None

# ── Background broadcast loop ────────────────────────────────────
@app.on_event("startup")
async def start_background_tasks() -> None:
    asyncio.create_task(_telemetry_loop())
    asyncio.create_task(warmup_model())
    asyncio.create_task(classifier_loop())

IDLE_SECONDS = 300  # 5 min before standby
STANDBY_INTERVAL = 60.0
ACTIVE_INTERVAL = 1.5


async def _telemetry_loop() -> None:
    global _last_activity, _latest_telemetry
    while True:
        now = time.time()
        idle = now - _last_activity
        is_standby = idle > IDLE_SECONDS
        if is_standby:
            if not getattr(_telemetry_loop, "_was_standby", False):
                logger.info("No activity for %.0fs — entering standby (60s poll)", idle)
                _telemetry_loop._was_standby = True
            await asyncio.sleep(STANDBY_INTERVAL)
            continue
        if getattr(_telemetry_loop, "_was_standby", False):
            logger.info("Activity detected — resuming live telemetry")
            _telemetry_loop._was_standby = False
        try:
            telemetry = await collect_telemetry()
            _latest_telemetry = telemetry
            payload = json.dumps(telemetry, default=str)
            await manager.broadcast(payload)
        except Exception as exc:
            logger.error("Telemetry loop error: %s", exc)
        await asyncio.sleep(ACTIVE_INTERVAL)

# ── Endpoints ────────────────────────────────────────────────────
@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "conductor-api"}

@app.get("/metrics")
async def metrics() -> str:
    return generate_latest(REGISTRY).decode()

@app.websocket("/ws/telemetry")
async def ws_telemetry(ws: WebSocket) -> None:
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws)
    except Exception:
        manager.disconnect(ws)

# ── Telemetry HTTP endpoint ──────────────────────────────────────────
@app.get("/api/telemetry")
async def api_telemetry() -> dict[str, Any]:
    if _latest_telemetry is None:
        return {"status": "initializing"}
    return _latest_telemetry

# ── Multi-machine Vitals ─────────────────────────────────────────
@app.get("/api/vitals")
async def api_vitals() -> dict:
    return await collect_vitals()

# ── Network Config ───────────────────────────────────────────────────
@app.get("/api/network-config")
async def get_network_config() -> dict[str, Any]:
    return config_manager.get_all()

class NetworkConfigBody(BaseModel):
    config: dict[str, Any]

@app.put("/api/network-config")
async def put_network_config(body: NetworkConfigBody) -> dict[str, Any]:
    return config_manager.save(body.config)

class ModelConfigBody(BaseModel):
    provider: str  # "local" or "backoffice"
    model: str | None = None

# ── Model config ──────────────────────────────────────────────────
@app.get("/api/config/model")
async def get_model_config() -> dict[str, str]:
    return {"provider": get_model_provider()}

@app.post("/api/config/model")
async def post_model_config(body: ModelConfigBody) -> dict[str, str]:
    try:
        set_model_provider(body.provider)
        if body.model and body.provider == "backoffice":
            from services.config_manager import set_backoffice_model
            set_backoffice_model(body.model)
        return {"provider": get_model_provider(), "status": "ok"}
    except ValueError as e:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=400, content={"error": str(e)})

class AnalysisModelBody(BaseModel):
    model: str
    provider: str | None = None

@app.get("/api/config/analysis-model")
async def get_analysis_model_config() -> dict[str, str]:
    from services.config_manager import get_analysis_config
    return get_analysis_config()

@app.post("/api/config/analysis-model")
async def post_analysis_model(body: AnalysisModelBody) -> dict[str, str]:
    try:
        set_analysis_model(body.model)
        if body.provider:
            set_analysis_provider(body.provider)
        return {"model": get_analysis_model(), "provider": get_analysis_provider(), "status": "ok"}
    except ValueError as e:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=400, content={"error": str(e)})

# ── Ollama model selection ─────────────────────────────────────────
class ModelSelectBody(BaseModel):
    model: str

@app.get("/api/models")
async def list_ollama_models() -> dict[str, list[str]]:
    """List available models from the local Ollama instance."""
    from services.config_manager import get_ollama_url
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{get_ollama_url()}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            models = [m["name"] for m in data.get("models", [])]
            return {"models": sorted(models)}
    except Exception as e:
        return {"models": [], "error": str(e)}


@app.get("/api/models/network")
async def list_network_models() -> dict[str, list[dict[str, Any]]]:
    """Discover models on network LLM services (services with a model field)."""
    from services.config_manager import get_services
    sources: list[dict[str, Any]] = []
    for sid, svc in get_services().items():
        if not svc.get("enabled", True):
            continue
        model_field = svc.get("model")
        if not model_field:
            continue
        host = svc.get("host", "")
        port = svc.get("port", 0)
        label = svc.get("label", sid)
        base = f"http://{host}:{port}"
        discovered: list[str] = []
        error: str | None = None
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{base}/api/tags")
                if resp.status_code == 200:
                    data = resp.json()
                    discovered = sorted(m["name"] for m in data.get("models", []))
                else:
                    error = f"HTTP {resp.status_code}"
        except Exception as e:
            error = str(e)
        sources.append({
            "id": sid,
            "label": label,
            "host": host,
            "port": port,
            "configured_model": model_field,
            "models": discovered,
            "error": error,
        })
    return {"sources": sources}

@app.get("/api/models/current")
async def get_current_model() -> dict[str, str]:
    from services.config_manager import get_backoffice_model
    if get_model_provider() == "backoffice":
        return {"model": get_backoffice_model(), "provider": "backoffice"}
    return {"model": get_local_model(), "provider": "local"}

@app.post("/api/models/select")
async def select_model(body: ModelSelectBody) -> dict[str, str]:
    try:
        set_local_model(body.model)
        return {"model": get_local_model(), "status": "ok"}
    except ValueError as e:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=400, content={"error": str(e)})

# ── Orchestration models ──────────────────────────────────────────
class OrchestrateRequest(BaseModel):
    prompt: str

_async_tasks: dict[str, asyncio.Task] = {}

# ── Orchestration endpoints ───────────────────────────────────────
@app.post("/api/orchestrate")
async def api_orchestrate(req: OrchestrateRequest) -> dict[str, str]:
    logger.info("Orchestration request: %s", req.prompt[:80])
    session = TraceSession(id=uuid.uuid4().hex[:12], prompt=req.prompt)
    from services.orchestrator import _store
    _store[session.id] = session
    task = asyncio.create_task(orchestrate(req.prompt, session.id))
    _async_tasks[session.id] = task
    task.add_done_callback(lambda _: _async_tasks.pop(session.id, None))
    return {"trace_id": session.id, "status": "started"}


@app.get("/api/traces/profile", response_model=list[ModelProfile])
async def api_trace_profiles() -> list[ModelProfile]:
    return compute_profile()


@app.get("/api/traces", response_model=list[TraceSession])
async def api_list_traces(limit: int = 50) -> list[TraceSession]:
    traces = list_traces(limit)
    return merge_synesth(traces)


from fastapi import HTTPException

@app.get("/api/traces/{trace_id}", response_model=TraceSession | None)
async def api_get_trace(trace_id: str) -> TraceSession | None:
    t = get_trace(trace_id)
    if t is None:
        raise HTTPException(status_code=404, detail="Trace not found")
    return t


@app.delete("/api/traces/{trace_id}")
async def api_delete_trace(trace_id: str) -> dict:
    ok = delete_trace(trace_id)
    return {"deleted": ok}


class BulkDeleteRequest(BaseModel):
    ids: list[str]


@app.post("/api/traces/bulk-delete")
async def api_bulk_delete_traces(req: BulkDeleteRequest) -> dict:
    count = bulk_delete_traces(req.ids)
    return {"deleted": count}


from services.classifier_agent import _classifier_cycle

@app.post("/api/traces/classify-synesth")
async def api_classify_synesth() -> dict:
    await _classifier_cycle()
    return {"status": "ok"}


# ── CSV Exports ──────────────────────────────────────────────────
from fastapi.responses import StreamingResponse


def _csv_response(rows: list[dict[str, Any]], filename: str) -> StreamingResponse:
    out = io.StringIO()
    if rows:
        writer = csv.DictWriter(out, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    else:
        out.write("(no data)\n")
    out.seek(0)
    return StreamingResponse(
        iter([out.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/export/traces.csv")
async def export_traces_csv(limit: int = 500):
    from services.orchestrator import load_history

    traces = load_history(limit=limit)
    rows = []
    for t in traces:
        dur = sum(s.duration_ms or 0 for s in t.steps)
        pd = t.ddc.prompt if t.ddc and t.ddc.prompt else None
        rd = t.ddc.response if t.ddc and t.ddc.response else None
        pl = t.lcc.prompt if t.lcc and t.lcc.prompt else None
        rl = t.lcc.response if t.lcc and t.lcc.response else None
        rows.append({
            "trace_id": t.id,
            "prompt": t.prompt,
            "model": t.model_used or "",
            "status": t.status,
            "confidence": t.confidence if t.confidence is not None else "",
            "output_length_chars": len(t.output) if t.output else 0,
            "total_duration_ms": dur,
            "step_count": len(t.steps),
            "created_at": t.created_at or "",
            "completed_at": t.completed_at or "",
            "ddc_prompt_code": pd.code if pd else "",
            "ddc_prompt_label": pd.label if pd else "",
            "ddc_prompt_action": pd.action if pd and pd.action else "",
            "ddc_prompt_domain": pd.domain if pd and pd.domain else "",
            "ddc_response_code": rd.code if rd else "",
            "ddc_response_label": rd.label if rd else "",
            "ddc_response_action": rd.action if rd and rd.action else "",
            "ddc_response_domain": rd.domain if rd and rd.domain else "",
            "lcc_prompt_code": pl.code if pl else "",
            "lcc_prompt_label": pl.label if pl else "",
            "lcc_prompt_action": pl.action if pl and pl.action else "",
            "lcc_prompt_domain": pl.domain if pl and pl.domain else "",
            "lcc_response_code": rl.code if rl else "",
            "lcc_response_label": rl.label if rl else "",
            "lcc_response_action": rl.action if rl and rl.action else "",
            "lcc_response_domain": rl.domain if rl and rl.domain else "",
        })
    return _csv_response(rows, "traces.csv")


@app.get("/api/export/profiles.csv")
async def export_profiles_csv():
    profiles = compute_profile()
    rows = []
    for p in profiles:
        rows.append({
            "model": p.model,
            "trace_count": p.trace_count,
            "avg_latency_ms": p.avg_latency_ms,
            "p50_latency_ms": p.p50_latency_ms,
            "p95_latency_ms": p.p95_latency_ms,
            "p99_latency_ms": p.p99_latency_ms,
            "failure_rate": p.failure_rate,
            "avg_confidence": p.avg_confidence if p.avg_confidence is not None else "",
            "verbosity_score": p.verbosity_score,
            "avg_output_tokens": p.avg_output_tokens,
            "formatting_bullet_pct": p.formatting_bullet_pct,
            "formatting_prose_pct": p.formatting_prose_pct,
            "formatting_table_pct": p.formatting_table_pct,
            "formatting_code_pct": p.formatting_code_pct,
            "hedging_freq": p.hedging_freq,
            "lexical_diversity": p.lexical_diversity,
            "directness_score": p.directness_score,
        })
    return _csv_response(rows, "profiles.csv")


@app.get("/api/export/stages.csv")
async def export_stages_csv(limit: int = 500):
    from services.orchestrator import load_history

    traces = load_history(limit=limit)
    rows = []
    for t in traces:
        for s in t.steps:
            rows.append({
                "trace_id": t.id,
                "model": t.model_used or "",
                "prompt_preview": t.prompt[:80] if t.prompt else "",
                "stage_id": s.id,
                "stage_label": s.label,
                "status": s.status,
                "duration_ms": s.duration_ms if s.duration_ms is not None else "",
                "model_used": s.model_used or "",
                "eval_count": s.eval_count if s.eval_count is not None else "",
                "eval_duration_ns": s.eval_duration_ns if s.eval_duration_ns is not None else "",
                "cpu_before": s.cpu_before if s.cpu_before is not None else "",
                "mem_before": s.mem_before if s.mem_before is not None else "",
                "timestamp": s.timestamp or "",
            })
    return _csv_response(rows, "stages.csv")


@app.get("/api/export/traces_with_steps.csv")
async def export_traces_with_steps_csv(limit: int = 500):
    from services.orchestrator import load_history

    traces = load_history(limit=limit)
    if not traces:
        return _csv_response([], "traces_with_steps.csv")

    all_labels: list[str] = []
    seen_labels: set[str] = set()
    for t in traces:
        for s in t.steps:
            if s.label not in seen_labels:
                all_labels.append(s.label)
                seen_labels.add(s.label)

    rows = []
    for t in traces:
        dur = sum(s.duration_ms or 0 for s in t.steps)
        row: dict[str, Any] = {
            "trace_id": t.id,
            "prompt": t.prompt,
            "model": t.model_used or "",
            "status": t.status,
            "confidence": t.confidence if t.confidence is not None else "",
            "total_duration_ms": dur,
            "created_at": t.created_at or "",
        }
        step_map = {s.label: s.duration_ms for s in t.steps}
        for lbl in all_labels:
            ms = step_map.get(lbl)
            col = lbl.lower().replace(" ", "_") + "_ms"
            row[col] = ms if ms is not None else ""
        rows.append(row)
    return _csv_response(rows, "traces_with_steps.csv")


# ── Services ──────────────────────────────────────────────────────
@app.get("/api/services")
async def api_get_services() -> dict:
    import os
    fp = os.path.join(os.path.dirname(__file__), "data", "services.json")
    try:
        with open(fp) as f:
            return json.load(f)
    except Exception:
        return {}


# ── Annotations ───────────────────────────────────────────────────
@app.get("/api/traces/{trace_id}/annotations", response_model=list[Annotation])
async def api_get_annotations(trace_id: str) -> list[Annotation]:
    return annotation_service.get_annotations(trace_id)


class CreateAnnotationBody(BaseModel):
    content: str
    tags: list[str] = []
    rating: int | None = None
    author: str = "human"


@app.post("/api/traces/{trace_id}/annotations", response_model=Annotation)
async def api_create_annotation(trace_id: str, body: CreateAnnotationBody) -> Annotation:
    return annotation_service.create_annotation(
        trace_id=trace_id,
        content=body.content,
        tags=body.tags,
        rating=body.rating,
        author=body.author,
    )


@app.delete("/api/traces/{trace_id}/annotations/{annotation_id}")
async def api_delete_annotation(trace_id: str, annotation_id: str) -> dict:
    ok = annotation_service.delete_annotation(annotation_id)
    return {"deleted": ok}


# ── Relationship analysis ────────────────────────────────────────
SAMPLE_SIZE_THRESHOLD = 30


class RelationshipAnalysisRequest(BaseModel):
    rel_type: str
    title: str
    description: str
    input_labels: list[str]
    output_labels: list[str]
    top_relationships: list[dict]
    total_traces: int
    paths: str | None = None  # for grammar: pre-formatted 6-ring path lines
    samples: str | None = None  # raw prompt/response pairs for LLM to analyze directly


def _sample_size_caveat(total: int) -> str:
    if total < 10:
        return (
            f"SAMPLE SIZE NOTICE: This analysis is based on only {total} trace(s). "
            f"This is an anecdotal sample — patterns observed here are not statistically "
            f"significant or reliable. Your analysis MUST begin by stating: "
            f"\"This analysis is based on only {total} traces, which is an anecdotal sample. "
            f"Results should be treated as exploratory, not indicative of a trend.\" "
            f"Use appropriately cautious language throughout (\"may suggest\", \"could indicate\", "
            f"\"one possible interpretation\") rather than definitive claims."
        )
    elif total < SAMPLE_SIZE_THRESHOLD:
        return (
            f"SAMPLE SIZE NOTICE: This analysis is based on {total} traces. "
            f"This is below the conventional threshold (N≥{SAMPLE_SIZE_THRESHOLD}) for basic "
            f"statistical reliability. Your analysis MUST begin by stating: "
            f"\"This analysis is based on {total} traces, which is below the conventional "
            f"threshold for statistical significance. Patterns are directional, not conclusive.\" "
            f"Avoid definitive language; use \"tends to\", \"often\", \"suggests\" rather than \"always\", "
            f"\"proves\", \"demonstrates\"."
        )
    else:
        return (
            f"SAMPLE SIZE NOTICE: This analysis is based on {total} traces, which meets the "
            f"conventional threshold (N≥{SAMPLE_SIZE_THRESHOLD}) for basic statistical reliability. "
            f"Your analysis MUST begin by stating the sample size: "
            f"\"This analysis is based on {total} traces, providing a moderate sample for identifying "
            f"patterns.\" "
            f"Patterns can be discussed with moderate confidence, but acknowledge that all observational "
            f"analysis has limitations."
        )


def _build_analysis_prompt(rel_type: str, title: str, description: str, labels_in: str, labels_out: str, pairs: str, total: int, paths: str | None = None, samples: str | None = None) -> str:
    base = _sample_size_caveat(total) + "\n\n"
    base += (
        f"Title: {title}\n"
        f"Description: {description}\n\n"
        f"Input categories: {labels_in}\n"
        f"Output categories: {labels_out}\n\n"
        f"Based on {total} traces, the top relationships are:\n{pairs}\n\n"
    )
    if paths:
        base += f"The most common 6-ring pipelines (Depth → Mood → Syntax → Action → Tone → Form) are:\n{paths}\n\n"
    if samples:
        base += (
            "Below are up to 10 raw prompt/response pairs from the traces. "
            "Read them directly to form your own understanding of the input–output "
            "relationships, rather than relying solely on the pre-computed categories above. "
            "Note any patterns or insights that the category labels miss.\n\n"
            f"{samples}\n\n"
        )

    if rel_type == "cross":
        return base + (
            "You are analyzing a semantic drift map — how prompt topics shift into response domains.\n\n"
            "Provide a concise analysis (3-5 paragraphs) covering:\n"
            "1. Semantic inertia — which domains stay stable (prompt and response align) and what that reveals about the model's conceptual containers\n"
            "2. Semantic drift — which domains are porous and leak into others; identify the wildcard domain that drifts most\n"
            "3. Conceptual attractors — which response domains act as gravitational wells that pull in prompts from multiple source domains\n"
            "4. Practical prompt engineering insights — how to keep the model in-domain vs. trigger cross-domain synthesis\n\n"
            "Use plain paragraphs, not markdown or bullet lists."
        )
    elif rel_type == "synesthesia":
        return base + (
            "You are analyzing a grammar-to-structure map — how the model's input grammar (depth, mood, syntax)\n"
            "relates to its output structure (action type, pragmatic tone, output form).\n\n"
            "Provide a concise analysis (3-5 paragraphs) covering:\n"
            "1. Dominant grammar-to-structure pathways and what they reveal about the model's compositional defaults\n"
            "2. Any surprising pairings (e.g., imperative mood producing creative tone instead of instructional)\n"
            "3. How grammatical features constrain or liberate the model's output style\n"
            "4. Practical prompt engineering insights for controlling tone and structure\n\n"
            "Use plain paragraphs, not markdown or bullet lists."
        )
    elif rel_type == "mood-intent":
        return base + (
            "You are analyzing a mood-to-intent map — how the user's prompt mood (imperative, interrogative, conditional, etc.)\n"
            "correlates with the model's classified intent (information seeking, creative, casual, technical, etc.).\n\n"
            "Provide a concise analysis (3-5 paragraphs) covering:\n"
            "1. Which moods most reliably produce which intents — the model's default mood-intent wiring\n"
            "2. Any mismatches where mood and intent are at odds (e.g., imperative mood producing creative intent)\n"
            "3. How the model adapts its interpretation based on the user's framing\n"
            "4. Practical insights for phrasing prompts to trigger specific intent categories\n\n"
            "Use plain paragraphs, not markdown or bullet lists."
        )
    elif rel_type == "intonation":
        return base + (
            "You are analyzing a prompt intonation map — how the user's tone (Socratic, Imperative, Ambiguous, Hypothetical)\n"
            "correlates with the model's output length (Very Low, Low, Medium, High token counts).\n\n"
            "This is a map of cognitive load triggers. Socratic tone signals open-ended exploration and increases cognitive\n"
            "load, producing longer responses. Imperative tone signals bounded tasks and focuses cognitive load, producing\n"
            "variable output. Ambiguous tone diffuses cognitive load. Hypothetical tone redirects it.\n\n"
            "Provide a concise analysis (3-5 paragraphs) covering:\n"
            "1. Which tone is the strongest amplifier of output length and why — identify the single most powerful lever\n"
            "2. Semantic activation: which tones reliably produce long responses across ALL length tiers vs. only spiking in one\n"
            "3. Cognitive compression vs. expansion: which tones are interpreted as tasks (bounded, efficient) vs. dialogue (open-ended, exploratory)\n"
            "4. Practical prompt engineering insights for deliberately shaping verbosity through tone choice\n\n"
            "Use plain paragraphs, not markdown or bullet lists."
        )
    elif rel_type == "grammar":
        return base + (
            "You are analyzing a concentric grammar schema — a 6-ring visualization of the model's prompt-to-response pipeline.\n"
            "Inner rings (Depth, Mood, Syntax) characterize the prompt; outer rings (Action, Tone, Form) characterize the response.\n\n"
            "Provide a concise analysis (3-5 paragraphs) covering:\n"
            "1. The most common pipeline paths through all 6 rings — what does the model's typical compositional flow look like\n"
            "2. Any unusual or rare paths that indicate special-case behavior\n"
            "3. How the inner prompt grammar constrains or enables outer response characteristics\n"
            "4. Practical insights for designing prompts that produce specific output forms\n\n"
            "Use plain paragraphs, not markdown or bullet lists."
        )
    else:
        return base + (
            "You are analyzing a chord diagram that visualizes how an AI assistant's behavior changes based on input characteristics.\n\n"
            "Provide a concise analysis (3-5 paragraphs) covering:\n"
            "1. What the dominant pattern reveals about the model's default behavior\n"
            "2. Any surprising or notable relationships\n"
            "3. Practical prompt engineering insights\n"
            "4. What this says about how the model adapts its persona\n\n"
            "Use plain paragraphs, not markdown or bullet lists."
        )


@app.post("/api/analyze/relationships")
async def api_analyze_relationships(body: RelationshipAnalysisRequest) -> dict:
    try:
        labels_in = ", ".join(body.input_labels)
        labels_out = ", ".join(body.output_labels)
        pairs = "\n".join(
            f"  {p['count']}×  {p['src']} → {p['tgt']}"
            for p in body.top_relationships
        )

        prompt = _build_analysis_prompt(body.rel_type, body.title, body.description, labels_in, labels_out, pairs, body.total_traces, body.paths, body.samples)

        analysis_model = get_analysis_model()
        response, _, _ = await _call_model("backoffice", prompt, model_name_override=analysis_model)
        return {"response": response, "model": analysis_model}
    except Exception as e:
        logger.error("Relationship analysis failed: %s", e)
        return {"response": f"Analysis failed: {e}", "model": get_analysis_model()}

# ── Activity feed ─────────────────────────────────────────────────
@app.get("/api/activity")
async def api_activity(since: str | None = None, limit: int = 50) -> list[dict]:
    return get_activity_events(since, limit)

# ── Run ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    import os
    host = os.getenv("CONDUCTOR_HOST", "127.0.0.1")
    uvicorn.run("main:app", host=host, port=8001, reload=True)
