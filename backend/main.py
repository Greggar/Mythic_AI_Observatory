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

import requests
import psutil
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import Gauge, generate_latest, REGISTRY
from pydantic import BaseModel

from models.trace import TraceSession
from services.profile import compute_profile, ModelProfile
from models.annotation import Annotation
from services.orchestrator import orchestrate, get_trace, list_traces, delete_trace, get_activity_events, get_model_provider, set_model_provider, warmup_model
from services import annotation_service
from services.vitals import collect_vitals
from services import config_manager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("conductor")

app = FastAPI(title="Mythic AI Observatory — Conductor API")

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
async def start_telemetry_broadcaster() -> None:
    asyncio.create_task(_telemetry_loop())
    asyncio.create_task(warmup_model())

async def _telemetry_loop() -> None:
    global _latest_telemetry
    while True:
        try:
            telemetry = await collect_telemetry()
            _latest_telemetry = telemetry
            payload = json.dumps(telemetry, default=str)
            await manager.broadcast(payload)
        except Exception as exc:
            logger.error("Telemetry loop error: %s", exc)
        await asyncio.sleep(1.5)

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

# ── Model config ──────────────────────────────────────────────────
@app.get("/api/config/model")
async def get_model_config() -> dict[str, str]:
    return {"provider": get_model_provider()}

@app.post("/api/config/model")
async def post_model_config(body: ModelConfigBody) -> dict[str, str]:
    try:
        set_model_provider(body.provider)
        return {"provider": get_model_provider(), "status": "ok"}
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
    return list_traces(limit)


@app.get("/api/traces/{trace_id}", response_model=TraceSession | None)
async def api_get_trace(trace_id: str) -> TraceSession | None:
    return get_trace(trace_id)


@app.delete("/api/traces/{trace_id}")
async def api_delete_trace(trace_id: str) -> dict:
    ok = delete_trace(trace_id)
    return {"deleted": ok}


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
