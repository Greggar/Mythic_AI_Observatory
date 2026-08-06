import asyncio
import csv
import io
import json
import logging
import os
import platform
import subprocess
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Load .env before any other imports that read env vars
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

import httpx
import requests
import psutil
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import Gauge, generate_latest, REGISTRY
from pydantic import BaseModel, Field

from models.trace import TraceSession
from services.profile import compute_profile, ModelProfile
from models.annotation import Annotation
from services.orchestrator import orchestrate, get_trace, list_traces, delete_trace, bulk_delete_traces, get_activity_events, get_model_provider, set_model_provider, get_local_model, set_local_model, get_analysis_model, set_analysis_model, get_analysis_provider, set_analysis_provider, warmup_model, next_exchange_index, _call_model, LOCAL_MODEL
from services import annotation_service
from services.vitals import collect_vitals
from services import config_manager
from services.classifier_agent import classifier_loop, merge_synesth
from services.classify_task import start_classify_task, cancel_classify_task, get_classify_status, ClassifyTaskStatus, ClassifyCellResult
from services.reasoning_probe import start_reasoning_probe, get_reasoning_probe, aggregate_reasoning_probe, ReasoningProbeStatus
from services.log_broadcaster import get_broadcaster, install_handler


def _log_task_exception(task: asyncio.Task) -> None:
    """Done-callback for fire-and-forget tasks that logs unhandled exceptions."""
    if task.cancelled():
        return
    exc = task.exception()
    if exc:
        logger.error("Background task %s failed: %s", task.get_name(), exc, exc_info=exc)

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
    install_handler()
    for coro in (_telemetry_loop(), warmup_model(), classifier_loop()):
        t = asyncio.create_task(coro)
        t.add_done_callback(_log_task_exception)
    # Pre-warm intent embeddings so first trace isn't slow (~25s)
    from services.intent_classifier import prewarm_intent_embeddings
    t = asyncio.create_task(prewarm_intent_embeddings())
    t.add_done_callback(_log_task_exception)

IDLE_SECONDS = 300  # 5 min before standby
STANDBY_INTERVAL = 60.0
ACTIVE_INTERVAL = 1.5


async def _telemetry_loop() -> None:
    global _last_activity, _latest_telemetry
    probe_counter = 0
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
            # Probe provider health every 30 iterations (~45s at 1.5s interval)
            probe_counter += 1
            if probe_counter >= 30:
                probe_counter = 0
                from services.vitals import probe_provider_health
                try:
                    health = await probe_provider_health()
                    telemetry["provider_health"] = health
                except Exception as exc:
                    logger.debug("Provider health probe failed: %s", exc)
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

# ── First-Run Setup ─────────────────────────────────────────────────
@app.get("/api/config/first-run")
async def get_first_run() -> dict[str, bool]:
    from services.config_manager import is_first_run
    return {"firstRun": is_first_run()}


class SetupBody(BaseModel):
    primary_name: str
    ollama_host: str = "127.0.0.1"
    ollama_port: int = 11434
    workers: list[dict[str, Any]] = []


@app.post("/api/config/setup")
async def post_setup(body: SetupBody) -> dict[str, Any]:
    from services.config_manager import save, get_all

    cfg = get_all()

    # Set primary machine name
    if "machines" not in cfg:
        cfg["machines"] = {}
    if "primary" not in cfg["machines"]:
        cfg["machines"]["primary"] = {}
    cfg["machines"]["primary"]["name"] = body.primary_name
    cfg["machines"]["primary"]["host"] = "127.0.0.1"

    # Set Ollama host/port
    if "services" not in cfg:
        cfg["services"] = {}
    if "ollama" not in cfg["services"]:
        cfg["services"]["ollama"] = {"label": "Ollama", "enabled": True}
    cfg["services"]["ollama"]["host"] = body.ollama_host
    cfg["services"]["ollama"]["port"] = body.ollama_port

    # Add worker machines
    for i, w in enumerate(body.workers):
        wid = w.get("id", f"worker{i+1}")
        cfg["machines"][wid] = {
            "name": w.get("name", f"Worker {i+1}"),
            "host": w.get("host", "0.0.0.0"),
            "desc": w.get("desc", ""),
            "insight": w.get("insight", ""),
            "services": w.get("services", []),
        }
        # Update worker_llm service with the worker's host so /api/models/network can reach it
        if "worker_llm" in w.get("services", []) and w.get("host", "0.0.0.0") not in ("", "0.0.0.0"):
            if "worker_llm" not in cfg.get("services", {}):
                cfg.setdefault("services", {})["worker_llm"] = {"label": "Worker LLM", "model": ""}
            cfg["services"]["worker_llm"]["host"] = w["host"]
            cfg["services"]["worker_llm"]["port"] = w.get("port", 12434)
            cfg["services"]["worker_llm"]["enabled"] = True
            if w.get("protocol"):
                cfg["services"]["worker_llm"]["protocol"] = w["protocol"]

    cfg["_configured"] = True
    return save(cfg)


# ── Network Config ───────────────────────────────────────────────────
@app.get("/api/network-config")
async def get_network_config() -> dict[str, Any]:
    return config_manager.get_all()

class NetworkConfigBody(BaseModel):
    config: dict[str, Any]

@app.put("/api/network-config")
async def put_network_config(body: NetworkConfigBody) -> dict[str, Any]:
    result = config_manager.save(body.config)
    # Sync the in-memory orchestrator model provider without re-writing disk
    if "model_provider" in body.config:
        mp = body.config["model_provider"]
        from services.orchestrator import _set_model_provider_internal
        _set_model_provider_internal(mp.get("provider", "local"))
        if mp.get("provider") == "worker" and mp.get("model"):
            config_manager.set_worker_model(mp["model"])
    return result

# ── Network scan ──────────────────────────────────────────────────
@app.post("/api/network/scan")
async def scan_network() -> dict[str, Any]:
    """Scan the local subnet for Ollama and Observatory instances."""
    import socket
    import ipaddress

    # Detect local subnet
    local_ip = None
    netmask = None
    for iface_addrs in psutil.net_if_addrs().values():
        for addr in iface_addrs:
            if addr.family == socket.AF_INET and not addr.address.startswith("127."):
                local_ip = addr.address
                netmask = addr.netmask
                break
        if local_ip:
            break

    if not local_ip or not netmask:
        return {"error": "Could not detect local network interface", "machines": []}

    try:
        network = ipaddress.IPv4Network(f"{local_ip}/{netmask}", strict=False)
    except ValueError:
        return {"error": f"Invalid network: {local_ip}/{netmask}", "machines": []}

    # Skip very large subnets (>512 hosts) to avoid long scans
    if network.num_addresses > 512:
        return {"error": f"Subnet too large ({network.num_addresses} hosts). Scan limited to /24.", "machines": []}

    OLLAMA_PORT = 11434
    DMR_PORT = 12434  # Docker Model Runner (Ollama-compatible)
    VLLM_PORT = 8000  # vLLM default (OpenAI-compatible)
    OBSERVATORY_PORT = 8001
    TIMEOUT = 1.0  # seconds per host

    discovered = []

    async def probe_host(ip_str: str):
        """Try connecting to Ollama and Observatory ports on this IP."""
        services = []

        # Probe Ollama
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(ip_str, OLLAMA_PORT), timeout=TIMEOUT
            )
            writer.close()
            await writer.wait_closed()

            # Try to get model list
            models = []
            try:
                async with httpx.AsyncClient(timeout=2.0) as client:
                    resp = await client.get(f"http://{ip_str}:{OLLAMA_PORT}/api/tags")
                    if resp.status_code == 200:
                        data = resp.json()
                        models = [m["name"] for m in data.get("models", [])]
            except Exception:
                pass

            services.append({
                "type": "ollama",
                "port": OLLAMA_PORT,
                "models": models,
            })
        except (asyncio.TimeoutError, ConnectionRefusedError, OSError):
            pass

        # Probe Docker Model Runner (Ollama-compatible API on port 12434)
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(ip_str, DMR_PORT), timeout=TIMEOUT
            )
            writer.close()
            await writer.wait_closed()

            models = []
            protocol = "ollama"
            try:
                async with httpx.AsyncClient(timeout=2.0) as client:
                    resp = await client.get(f"http://{ip_str}:{DMR_PORT}/api/tags")
                    if resp.status_code == 200:
                        data = resp.json()
                        models = [m["name"] for m in data.get("models", [])]
                    else:
                        # Fall back to OpenAI-compatible
                        resp2 = await client.get(f"http://{ip_str}:{DMR_PORT}/v1/models")
                        if resp2.status_code == 200:
                            data = resp2.json()
                            models = [m.get("id", "") for m in data.get("data", []) if m.get("id")]
                            protocol = "openai"
            except Exception:
                pass

            services.append({
                "type": "docker_model_runner",
                "port": DMR_PORT,
                "protocol": protocol,
                "models": models,
            })
        except (asyncio.TimeoutError, ConnectionRefusedError, OSError):
            pass

        # Probe vLLM / OpenAI-compatible server (port 8000)
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(ip_str, VLLM_PORT), timeout=TIMEOUT
            )
            writer.close()
            await writer.wait_closed()

            models = []
            try:
                async with httpx.AsyncClient(timeout=2.0) as client:
                    resp = await client.get(f"http://{ip_str}:{VLLM_PORT}/v1/models")
                    if resp.status_code == 200:
                        data = resp.json()
                        models = [m.get("id", "") for m in data.get("data", []) if m.get("id")]
            except Exception:
                pass

            if models:
                services.append({
                    "type": "vllm",
                    "port": VLLM_PORT,
                    "protocol": "openai",
                    "models": models,
                })
        except (asyncio.TimeoutError, ConnectionRefusedError, OSError):
            pass

        # Probe Observatory
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(ip_str, OBSERVATORY_PORT), timeout=TIMEOUT
            )
            writer.close()
            await writer.wait_closed()

            # Try to get health info
            info = {}
            try:
                async with httpx.AsyncClient(timeout=2.0) as client:
                    resp = await client.get(f"http://{ip_str}:{OBSERVATORY_PORT}/health")
                    if resp.status_code == 200:
                        info = resp.json()
            except Exception:
                pass

            services.append({
                "type": "observatory",
                "port": OBSERVATORY_PORT,
                "info": info,
            })
        except (asyncio.TimeoutError, ConnectionRefusedError, OSError):
            pass

        if services:
            # Try to get hostname via reverse DNS
            hostname = None
            try:
                hostname = socket.gethostbyaddr(ip_str)[0]
            except (socket.herror, socket.gaierror, OSError):
                pass

            discovered.append({
                "ip": ip_str,
                "hostname": hostname,
                "services": services,
            })

    # Scan all hosts in parallel (max 64 concurrent)
    hosts = [str(ip) for ip in network.hosts()]
    sem = asyncio.Semaphore(64)

    async def bounded_probe(ip_str):
        async with sem:
            await probe_host(ip_str)

    await asyncio.gather(*(bounded_probe(ip) for ip in hosts))

    # Sort by IP for consistent ordering
    discovered.sort(key=lambda m: tuple(int(p) for p in m["ip"].split(".")))

    return {
        "subnet": str(network),
        "local_ip": local_ip,
        "machines": discovered,
    }

class ModelConfigBody(BaseModel):
    provider: str  # "local" or "worker"
    model: str | None = None

# ── Model config ──────────────────────────────────────────────────
@app.get("/api/config/providers")
async def get_providers() -> list[dict[str, Any]]:
    return config_manager.get_available_providers()

class ServicesBody(BaseModel):
    services: dict[str, Any]

@app.post("/api/config/services")
async def post_services_config(body: ServicesBody) -> dict[str, str]:
    """Update service configurations (host, port, protocol, enabled, etc.)."""
    from services.config_manager import get_all, save
    cfg = get_all()
    if "services" not in cfg:
        cfg["services"] = {}
    for svc_id, svc_data in body.services.items():
        if svc_id in cfg["services"]:
            cfg["services"][svc_id].update(svc_data)
        else:
            cfg["services"][svc_id] = svc_data
    save(cfg)
    return {"status": "ok"}

@app.get("/api/config/model")
async def get_model_config() -> dict[str, str]:
    return config_manager.get_model_provider_config()

@app.post("/api/config/model")
async def post_model_config(body: ModelConfigBody) -> dict[str, str]:
    try:
        set_model_provider(body.provider)
        if body.model and body.provider == "worker":
            from services.config_manager import set_worker_model
            set_worker_model(body.model)
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
    """Discover models on network LLM services (services with a model field).

    Tries Ollama /api/tags first, then falls back to OpenAI-compatible /v1/models.
    """
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
        protocol = svc.get("protocol", "ollama")
        base = f"http://{host}:{port}"
        discovered: list[str] = []
        error: str | None = None
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                if protocol == "openai":
                    # OpenAI-compatible: GET /v1/models
                    resp = await client.get(f"{base}/v1/models")
                    if resp.status_code == 200:
                        data = resp.json()
                        discovered = sorted(m.get("id", "") for m in data.get("data", []) if m.get("id"))
                    else:
                        error = f"HTTP {resp.status_code}"
                else:
                    # Ollama: GET /api/tags
                    resp = await client.get(f"{base}/api/tags")
                    if resp.status_code == 200:
                        data = resp.json()
                        discovered = sorted(m["name"] for m in data.get("models", []))
                    else:
                        # Fall back to OpenAI-compatible endpoint
                        try:
                            resp2 = await client.get(f"{base}/v1/models")
                            if resp2.status_code == 200:
                                data = resp2.json()
                                discovered = sorted(m.get("id", "") for m in data.get("data", []) if m.get("id"))
                            else:
                                error = f"HTTP {resp.status_code}"
                        except Exception:
                            error = f"HTTP {resp.status_code}"
        except Exception as e:
            error = str(e)
        sources.append({
            "id": sid,
            "label": label,
            "host": host,
            "port": port,
            "protocol": protocol,
            "configured_model": model_field,
            "models": discovered,
            "error": error,
        })
    return {"sources": sources}

@app.get("/api/models/current")
async def get_current_model() -> dict[str, str]:
    from services.config_manager import get_worker_model
    if get_model_provider() == "worker":
        return {"model": get_worker_model(), "provider": "worker"}
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
    chat_id: str | None = None

class BatchRequest(BaseModel):
    prompts: list[str]
    model: str | None = None

class BatchError(BaseModel):
    trace_id: str
    line: int
    error: str

class BatchStatus(BaseModel):
    batch_id: str
    total: int
    completed: int = 0
    failed: int = 0
    status: str = "running"  # running | done
    trace_ids: list[str] = Field(default_factory=list)
    error_details: list[BatchError] = Field(default_factory=list)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

_BATCH_CONCURRENCY = int(os.environ.get("BATCH_CONCURRENCY", "2"))
_batch_semaphore = asyncio.Semaphore(_BATCH_CONCURRENCY)
_batch_store: dict[str, BatchStatus] = {}

_async_tasks: dict[str, asyncio.Task] = {}

# ── Orchestration endpoints ───────────────────────────────────────
@app.post("/api/orchestrate")
async def api_orchestrate(req: OrchestrateRequest) -> dict[str, str]:
    logger.info("Orchestration request: %s", req.prompt[:80])
    session = TraceSession(
        id=uuid.uuid4().hex[:12],
        prompt=req.prompt,
        chat_id=req.chat_id,
        exchange_index=next_exchange_index(req.chat_id) if req.chat_id else None,
    )
    from services.orchestrator import _store
    _store[session.id] = session
    task = asyncio.create_task(orchestrate(req.prompt, session.id))
    _async_tasks[session.id] = task
    task.add_done_callback(lambda _: _async_tasks.pop(session.id, None))
    task.add_done_callback(_log_task_exception)
    return {"trace_id": session.id, "status": "started"}


async def _process_batch(batch_id: str, prompts: list[str], trace_ids: list[str]) -> None:
    from services.orchestrator import orchestrate
    async def _run_one(prompt: str, tid: str, idx: int) -> None:
        async with _batch_semaphore:
            try:
                await orchestrate(prompt, tid, headless=True)
                _batch_store[batch_id].completed += 1
            except Exception as e:
                _batch_store[batch_id].failed += 1
                _batch_store[batch_id].error_details.append(
                    BatchError(trace_id=tid, line=idx + 1, error=str(e))
                )
                logger.error("Batch trace %s (line %d) failed: %s", tid, idx + 1, e)
    tasks = [_run_one(p, tid, i) for i, (p, tid) in enumerate(zip(prompts, trace_ids))]
    await asyncio.gather(*tasks, return_exceptions=True)
    _batch_store[batch_id].status = "done"


@app.post("/api/traces/batch")
async def api_batch_orchestrate(req: BatchRequest) -> dict:
    if not req.prompts:
        raise HTTPException(status_code=400, detail="No prompts provided")
    logger.info("Batch request: %d prompts", len(req.prompts))
    batch_id = uuid.uuid4().hex[:12]
    from services.orchestrator import _store
    trace_ids: list[str] = []
    for p in req.prompts:
        tid = uuid.uuid4().hex[:12]
        trace_ids.append(tid)
        session = TraceSession(id=tid, prompt=p, batch_id=batch_id)
        _store[session.id] = session
    _batch_store[batch_id] = BatchStatus(
        batch_id=batch_id, total=len(req.prompts), trace_ids=trace_ids,
    )
    task = asyncio.create_task(_process_batch(batch_id, req.prompts, trace_ids))
    _async_tasks[f"batch-{batch_id}"] = task
    task.add_done_callback(lambda _: _async_tasks.pop(f"batch-{batch_id}", None))
    task.add_done_callback(_log_task_exception)
    return {"batch_id": batch_id, "total": len(req.prompts), "status": "started"}


@app.get("/api/traces/batch/{batch_id}")
async def api_batch_status(batch_id: str) -> BatchStatus:
    status = _batch_store.get(batch_id)
    if not status:
        raise HTTPException(status_code=404, detail="Batch not found")
    return status


# ── Test run endpoints ──────────────────────────────────────────
class TestModelConfig(BaseModel):
    provider: str  # "local" or "worker"
    model: str

class TestRunRequest(BaseModel):
    prompt: str
    configs: list[TestModelConfig]

class TestRunResult(BaseModel):
    config: TestModelConfig
    trace_id: str
    status: str = "running"  # running | complete | error
    error: str | None = None

class TestRunStatus(BaseModel):
    test_batch_id: str
    total: int
    completed: int = 0
    failed: int = 0
    status: str = "running"  # running | done
    results: list[TestRunResult] = Field(default_factory=list)

_test_run_store: dict[str, TestRunStatus] = {}
_test_run_semaphore = asyncio.Semaphore(2)


async def _process_test_run(test_batch_id: str, prompt: str, configs: list[TestModelConfig]) -> None:
    from services.orchestrator import orchestrate
    async def _run_one(cfg: TestModelConfig, idx: int) -> None:
        tid = uuid.uuid4().hex[:12]
        _test_run_store[test_batch_id].results[idx].trace_id = tid
        session = TraceSession(id=tid, prompt=prompt, test_batch_id=test_batch_id)
        from services.orchestrator import _store
        _store[session.id] = session
        async with _test_run_semaphore:
            try:
                await orchestrate(prompt, tid, headless=True,
                                  model_override=cfg.model, provider_override=cfg.provider)
                _test_run_store[test_batch_id].results[idx].status = "complete"
                _test_run_store[test_batch_id].completed += 1
            except Exception as e:
                _test_run_store[test_batch_id].results[idx].status = "error"
                _test_run_store[test_batch_id].results[idx].error = str(e)
                _test_run_store[test_batch_id].failed += 1
                logger.error("Test run %s config %s failed: %s", test_batch_id, cfg.model, e)
    tasks = [_run_one(cfg, i) for i, cfg in enumerate(configs)]
    await asyncio.gather(*tasks, return_exceptions=True)
    _test_run_store[test_batch_id].status = "done"


@app.post("/api/tests/run")
async def api_test_run(req: TestRunRequest) -> dict:
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt is required")
    if not req.configs:
        raise HTTPException(status_code=400, detail="At least one model config is required")
    logger.info("Test run: %d configs for prompt %s", len(req.configs), req.prompt[:60])
    test_batch_id = uuid.uuid4().hex[:12]
    _test_run_store[test_batch_id] = TestRunStatus(
        test_batch_id=test_batch_id,
        total=len(req.configs),
        results=[TestRunResult(config=c, trace_id="") for c in req.configs],
    )
    task = asyncio.create_task(_process_test_run(test_batch_id, req.prompt, req.configs))
    _async_tasks[f"test-{test_batch_id}"] = task
    task.add_done_callback(lambda _: _async_tasks.pop(f"test-{test_batch_id}", None))
    task.add_done_callback(_log_task_exception)
    return {"test_batch_id": test_batch_id, "total": len(req.configs), "status": "started"}


@app.get("/api/tests/run/{test_batch_id}")
async def api_test_status(test_batch_id: str) -> TestRunStatus:
    status = _test_run_store.get(test_batch_id)
    if not status:
        raise HTTPException(status_code=404, detail="Test run not found")
    return status


# ── Classify (what-if analysis) endpoints ────────────────────

class ClassifyRequest(BaseModel):
    probes: list[dict[str, str]]
    models: list[TestModelConfig]
    max_traces: int = 20

@app.post("/api/tests/classify")
async def api_classify_start(req: ClassifyRequest) -> dict:
    if not req.probes:
        raise HTTPException(status_code=400, detail="At least one probe required")
    if not req.models:
        raise HTTPException(status_code=400, detail="At least one model required")
    traces = list_traces(req.max_traces)
    traces = [t for t in traces if t.model_used]
    if not traces:
        raise HTTPException(status_code=400, detail="No traces available for classification")
    task_id = await start_classify_task(
        req.probes,
        [{"model": m.model, "provider": m.provider} for m in req.models],
        traces,
    )
    return {"task_id": task_id, "total_cells": len(req.probes) * len(req.models) * len(traces), "traces_used": len(traces), "status": "started"}

@app.get("/api/tests/classify/{task_id}")
async def api_classify_status(task_id: str) -> ClassifyTaskStatus:
    status = get_classify_status(task_id)
    if not status:
        raise HTTPException(status_code=404, detail="Task not found")
    return status

@app.post("/api/tests/classify/{task_id}/cancel")
async def api_classify_cancel(task_id: str) -> dict:
    if not cancel_classify_task(task_id):
        raise HTTPException(status_code=404, detail="Task not found")
    return {"status": "cancelled"}


# ── Reasoning fragility probe (GSM-Symbolic) ─────────────────
class ReasoningProbeRequest(BaseModel):
    models: list[TestModelConfig]
    template_ids: list[str] | None = None
    seed: int | None = None


@app.post("/api/probe/reasoning")
async def api_reasoning_probe_start(req: ReasoningProbeRequest) -> dict:
    if not req.models:
        raise HTTPException(status_code=400, detail="At least one model config required")
    run = start_reasoning_probe(
        [{"model": m.model, "provider": m.provider} for m in req.models],
        template_ids=req.template_ids,
        seed=req.seed,
    )
    return {"run_id": run.run_id, "total": run.total, "status": run.status, "seed": run.seed}


@app.get("/api/probe/reasoning/{run_id}")
async def api_reasoning_probe_status(run_id: str) -> ReasoningProbeStatus:
    run = get_reasoning_probe(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Probe run not found")
    return run


@app.get("/api/probe/reasoning/{run_id}/summary")
async def api_reasoning_probe_summary(run_id: str) -> dict:
    agg = aggregate_reasoning_probe(run_id)
    if not agg:
        raise HTTPException(status_code=404, detail="Probe run not found")
    return agg


# ── Log streaming (SSE) ─────────────────────────────────────────

from fastapi.responses import StreamingResponse

@app.get("/api/logs/stream")
async def api_log_stream() -> StreamingResponse:
    broadcaster = get_broadcaster()
    queue = broadcaster.subscribe()

    async def event_gen():
        try:
            while True:
                entry = await queue.get()
                yield f"data: {json.dumps(entry)}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            broadcaster.unsubscribe(queue)

    return StreamingResponse(event_gen(), media_type="text/event-stream")


@app.get("/api/logs/recent")
async def api_logs_recent(
    limit: int = 100,
    level: str | None = None,
    since: float | None = None,
) -> dict[str, Any]:
    broadcaster = get_broadcaster()
    return {
        "entries": broadcaster.get_recent(limit=limit, level=level, since=since),
        "summary": broadcaster.get_summary(),
    }


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


# ── Chat sessions ────────────────────────────────────────────────

class ChatSummary(BaseModel):
    chat_id: str
    exchange_count: int
    first_prompt: str
    last_activity: str


def _chat_exchanges(chat_id: str) -> list[TraceSession]:
    from services.orchestrator import _store, load_history
    traces: dict[str, TraceSession] = {}
    for t in list(_store.values()) + load_history(limit=500):
        if t.chat_id == chat_id:
            traces[t.id] = t
    return sorted(
        traces.values(),
        key=lambda t: (t.exchange_index if t.exchange_index is not None else 2**31, t.created_at),
    )


@app.get("/api/chats")
async def api_list_chats() -> list[ChatSummary]:
    from services.orchestrator import _store, load_history
    by_chat: dict[str, dict[str, TraceSession]] = {}
    for t in list(_store.values()) + load_history(limit=500):
        if t.chat_id:
            by_chat.setdefault(t.chat_id, {})[t.id] = t
    summaries: list[ChatSummary] = []
    for cid, traces in by_chat.items():
        ordered = sorted(
            traces.values(),
            key=lambda t: (t.exchange_index if t.exchange_index is not None else 2**31, t.created_at),
        )
        summaries.append(ChatSummary(
            chat_id=cid,
            exchange_count=len(ordered),
            first_prompt=ordered[0].prompt[:80] if ordered else "",
            last_activity=max((t.created_at for t in ordered), default=""),
        ))
    summaries.sort(key=lambda s: s.last_activity, reverse=True)
    return summaries


@app.get("/api/chats/{chat_id}", response_model=list[TraceSession])
async def api_get_chat(chat_id: str) -> list[TraceSession]:
    exchanges = _chat_exchanges(chat_id)
    if not exchanges:
        raise HTTPException(status_code=404, detail="Chat not found")
    return exchanges


from services.classifier_agent import _classifier_cycle

@app.post("/api/traces/classify-synesth")
async def api_classify_synesth() -> dict:
    await _classifier_cycle()
    return {"status": "ok"}


# ── Synesthesia Schema ─────────────────────────────────────────

_SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "services", "synesthesia_schema.md")

class SchemaBody(BaseModel):
    content: str

@app.get("/api/schema")
async def get_schema() -> dict:
    try:
        with open(_SCHEMA_PATH, "r") as f:
            return {"content": f.read()}
    except FileNotFoundError:
        return {"content": ""}

@app.put("/api/schema")
async def put_schema(body: SchemaBody) -> dict:
    with open(_SCHEMA_PATH, "w") as f:
        f.write(body.content)
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
    entropy_summary: str | None = None  # per-trace token-entropy summary for uncertainty-aware analysis


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


def _build_analysis_prompt(rel_type: str, title: str, description: str, labels_in: str, labels_out: str, pairs: str, total: int, paths: str | None = None, samples: str | None = None, entropy_summary: str | None = None) -> str:
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
            "IMPORTANT — You MUST reference specific examples from these raw samples in your analysis. "
            "Quote or paraphrase actual prompts and responses. Do not rely solely on the aggregated "
            "category counts above — they can hide nuance that the raw text reveals.\n\n"
        )

    # Token-level uncertainty — the model's own generation entropy
    if entropy_summary:
        base += (
            "UNCERTAINTY DATA — per-response token entropy (bits) on OpenAI-protocol workers:\n"
            f"{entropy_summary}\n\n"
            "Treat high entropy (roughly H >= 0.5 bits) as the model generating with more "
            "competition between likely continuations — often where the relationship pattern is "
            "weakest, the classification was borderline, or the response pivoted mid-generation. "
            "Low entropy means the model produced near-canonical, self-assured text. "
            "Correlate entropy with the relationship patterns above: do high-uncertainty responses "
            "concentrate in particular input/output categories? If entropy data is absent for a "
            "trace, say so rather than assuming. Keep claims calibrated to the sample size.\n\n"
        )

    # Sentence-level confidence calibration
    base += (
        "CONFIDENCE RULES — Apply these throughout, not just in the opening:\n"
        f"- This dataset has {total} traces total. Any relationship with fewer than 3 instances "
        "is anecdotal and must be explicitly flagged as such.\n"
        f"- The aggregated counts show how OFTEN each pattern occurred, not why. "
        "Do not invent psychological explanations for the model's behavior — describe "
        "what the data show, not what you speculate the model is 'thinking'.\n"
        "- Use appropriately cautious language: 'suggests', 'tends to', 'may indicate' "
        "for patterns with 3+ instances. Use 'a single instance shows', 'one example suggests' "
        "for patterns with 1-2 instances. Never use 'always', 'proves', 'demonstrates'.\n"
        "- If a pattern is based on 1-2 data points, say so explicitly in the same sentence, "
        "not just in the opening caveat.\n\n"
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

        prompt = _build_analysis_prompt(body.rel_type, body.title, body.description, labels_in, labels_out, pairs, body.total_traces, body.paths, body.samples, body.entropy_summary)

        analysis_model = get_analysis_model()
        response, _, _, _ = await _call_model("worker", prompt, model_name_override=analysis_model)
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
    port = int(os.getenv("CONDUCTOR_PORT", "8001"))
    uvicorn.run("main:app", host=host, port=port, reload=True)
