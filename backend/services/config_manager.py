import json
import logging
import os
from typing import Any

logger = logging.getLogger("conductor")

_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "network.json")

_config: dict[str, Any] | None = None


def _load() -> dict[str, Any]:
    global _config
    if _config is not None:
        return _config
    if not os.path.exists(_CONFIG_PATH):
        raise FileNotFoundError(f"Network config not found at {_CONFIG_PATH}")
    with open(_CONFIG_PATH) as f:
        _config = json.load(f)
    return _config


def get_all() -> dict[str, Any]:
    return _load()


def get_services() -> dict[str, Any]:
    return _load().get("services", {})


def get_machines_config() -> dict[str, Any]:
    return _load().get("machines", {})


def get_service(service_id: str) -> dict[str, Any] | None:
    return get_services().get(service_id)


def service_url(service_id: str, path: str = "") -> str:
    svc = get_service(service_id)
    if not svc or not svc.get("enabled", True):
        return ""
    host = svc["host"]
    port = svc["port"]
    return f"http://{host}:{port}{path}"


def get_ollama_url() -> str:
    return service_url("ollama")


def get_ollama_tags_url() -> str:
    return service_url("ollama", "/api/tags")


def get_openclaw_url() -> str:
    return service_url("openclaw")


def get_openclaw_health_url() -> str:
    return service_url("openclaw", "/health")


def get_backoffice_url() -> str:
    return service_url("backoffice_llm")


def get_backoffice_model() -> str:
    svc = get_service("backoffice_llm")
    return svc.get("model", "docker.io/ai/qwen3.5:9B-UD-Q4_K_XL") if svc else "docker.io/ai/qwen3.5:9B-UD-Q4_K_XL"


def get_prometheus_url() -> str:
    return service_url("prometheus")


def get_remote_targets() -> dict[str, str]:
    targets: dict[str, str] = {}
    for sid, svc in get_services().items():
        if sid in ("ollama", "openclaw", "backoffice_llm", "prometheus"):
            continue
        if svc.get("enabled", True):
            targets[sid] = service_url(sid, "/health")
    return targets


def save(cfg: dict[str, Any]) -> dict[str, Any]:
    global _config
    _config = cfg
    os.makedirs(os.path.dirname(_CONFIG_PATH), exist_ok=True)
    with open(_CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)
    logger.info("Network config saved")
    return _config
