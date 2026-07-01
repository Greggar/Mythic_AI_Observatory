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


_PROVIDER_SERVICE_MAP: dict[str, str] = {
    "worker": "worker_llm",
}

def _machine_for_service(sid: str) -> dict[str, Any] | None:
    """Return the machine config that lists *sid* in its services array."""
    for _mid, mc in get_machines_config().items():
        if sid in mc.get("services", []):
            return mc
    return None


def get_available_providers() -> list[dict[str, Any]]:
    """Return all known provider IDs with labels and reachability.

    'local' always exists and is always reachable. Other providers
    (e.g. 'worker') pull their label from the owning machine's
    name so the dropdown says "Worker Node" rather than "Worker LLM".
    """
    providers = [{"id": "local", "label": "Local CPU", "icon": "cpu", "reachable": True}]
    for pid, sid in _PROVIDER_SERVICE_MAP.items():
        svc = get_service(sid)
        machine = _machine_for_service(sid)
        label = machine.get("name", pid.capitalize()) if machine else pid.capitalize()
        icon = "server"
        reachable = bool(svc and svc.get("enabled", False) and svc.get("host", "") not in ("", "0.0.0.0"))
        providers.append({"id": pid, "label": label, "icon": icon, "reachable": reachable})
    return providers


def get_ollama_url() -> str:
    return service_url("ollama")


def get_ollama_tags_url() -> str:
    return service_url("ollama", "/api/tags")


def get_openclaw_url() -> str:
    return service_url("openclaw")


def get_openclaw_health_url() -> str:
    return service_url("openclaw", "/health")


def get_worker_url() -> str:
    return service_url("worker_llm")


def get_worker_model() -> str:
    svc = get_service("worker_llm")
    return svc.get("model", "") if svc else ""


def set_worker_model(model: str) -> None:
    """Update the worker LLM model name in network.json."""
    cfg = _load()
    if "worker_llm" in cfg.get("services", {}):
        cfg["services"]["worker_llm"]["model"] = model
        save(cfg)
    else:
        raise ValueError("worker_llm service not found in config")


def get_analysis_config() -> dict[str, str]:
    cfg = _load()
    ac = cfg.get("analysis", {})
    return {
        "model": ac.get("model", "qwen2.5:3b"),
        "provider": ac.get("provider", "local"),
    }

def set_analysis_config(model: str, provider: str) -> None:
    cfg = _load()
    cfg["analysis"] = {"model": model, "provider": provider}
    save(cfg)


def get_classifier_config() -> dict[str, Any]:
    cfg = _load()
    cc = cfg.get("classifier", {})
    return {
        "model": cc.get("model", "qwen2.5:1.5b"),
        "poll_interval": cc.get("poll_interval", 45),
    }

def get_embeddings_config() -> dict[str, Any]:
    cfg = _load()
    ec = cfg.get("embeddings", {})
    return {
        "model": ec.get("model", "all-minilm:22m"),
        "cache_dir": ec.get("cache_dir", "/tmp"),
    }

def get_model_provider_config() -> dict[str, str]:
    cfg = _load()
    mc = cfg.get("model_provider", {})
    return {
        "provider": mc.get("provider", "local"),
        "model": mc.get("model", ""),
    }

def set_model_provider_config(provider: str, model: str = "") -> None:
    cfg = _load()
    cfg["model_provider"] = {"provider": provider, "model": model}
    save(cfg)


def get_prometheus_url() -> str:
    return service_url("prometheus")


def get_remote_targets() -> dict[str, str]:
    # Internal services are skipped — they have dedicated endpoints
    targets: dict[str, str] = {}
    for sid, svc in get_services().items():
        if sid in ("ollama", "openclaw", "worker_llm", "prometheus"):
            continue
        if svc.get("enabled", True):
            targets[sid] = service_url(sid, "/health")
    return targets


def is_first_run() -> bool:
    cfg = _load()
    return not cfg.get("_configured", False)


def mark_configured() -> None:
    cfg = _load()
    cfg["_configured"] = True
    save(cfg)


def save(cfg: dict[str, Any]) -> dict[str, Any]:
    global _config
    _config = cfg
    os.makedirs(os.path.dirname(_CONFIG_PATH), exist_ok=True)
    with open(_CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)
    logger.info("Network config saved")
    return _config
