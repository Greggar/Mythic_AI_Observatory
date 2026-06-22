import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("conductor")

PROFILES_DIR = os.path.join(
    os.path.dirname(__file__), "..", "data", "model_profiles"
)

DEFAULT_PROFILES_DIR = PROFILES_DIR


def get_profiles_dir() -> str:
    return os.environ.get("MODEL_PROFILES_DIR", DEFAULT_PROFILES_DIR)


def _ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def get_model_slug(model_name: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]", "_", model_name)
    slug = re.sub(r"_+", "_", slug).strip("_")
    return slug or "unknown"


def get_profile_path(model_name: str) -> str:
    slug = get_model_slug(model_name)
    return os.path.join(get_profiles_dir(), f"{slug}.json")


def _default_profile(model_name: str, provider: str = "") -> dict[str, Any]:
    slug = get_model_slug(model_name)
    now = datetime.now(timezone.utc).isoformat()
    return {
        "model": model_name,
        "model_slug": slug,
        "provider": provider,
        "created_at": now,
        "updated_at": now,
        "probes": {},
        "summary": {
            "total_probes": 0,
            "completed": 0,
            "errors": 0,
            "timeouts": 0,
            "by_category": {},
        },
    }


def load_profile(model_name: str) -> dict[str, Any]:
    path = get_profile_path(model_name)
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        return json.load(f)


def load_or_create_profile(model_name: str, provider: str = "") -> dict[str, Any]:
    profile = load_profile(model_name)
    if profile:
        return profile
    profile = _default_profile(model_name, provider)
    return profile


def save_profile(profile: dict[str, Any]) -> None:
    _ensure_dir(get_profiles_dir())
    path = get_profile_path(profile["model"])
    with open(path, "w") as f:
        json.dump(profile, f, indent=2)
    logger.info("Model profile saved: %s", path)


def _update_summary(profile: dict[str, Any]) -> None:
    probes = profile.get("probes", {})
    total = len(probes)
    completed = sum(1 for p in probes.values() if p.get("response") and not p.get("error"))
    errors = sum(1 for p in probes.values() if p.get("error") and p["error"] not in ("timeout", None))
    timeouts = sum(1 for p in probes.values() if p.get("error") == "timeout")
    by_category: dict[str, dict[str, int]] = {}
    for p in probes.values():
        cat = p.get("category", "unknown")
        if cat not in by_category:
            by_category[cat] = {"total": 0, "completed": 0}
        by_category[cat]["total"] += 1
        if p.get("response") and not p.get("error"):
            by_category[cat]["completed"] += 1
    profile["summary"] = {
        "total_probes": total,
        "completed": completed,
        "errors": errors,
        "timeouts": timeouts,
        "by_category": by_category,
    }


def save_probe_result(
    model_name: str,
    provider: str,
    probe_id: str,
    category: str,
    prompt: str,
    description: str,
    trace_id: str,
    response: str | None = None,
    response_summary: str | None = None,
    duration_seconds: float | None = None,
    steps_count: int | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    profile = load_or_create_profile(model_name, provider)
    now = datetime.now(timezone.utc).isoformat()
    probe_result = {
        "category": category,
        "prompt": prompt,
        "description": description,
        "trace_id": trace_id,
        "completed_at": now,
    }
    if response is not None:
        probe_result["response"] = response
        probe_result["response_summary"] = (response_summary or response)[:300]
    if duration_seconds is not None:
        probe_result["duration_seconds"] = round(duration_seconds, 1)
    if steps_count is not None:
        probe_result["steps_count"] = steps_count
    if error is not None:
        probe_result["error"] = error
    profile["probes"][probe_id] = probe_result
    profile["updated_at"] = now
    profile["provider"] = provider or profile.get("provider", "")
    _update_summary(profile)
    save_profile(profile)
    return profile


def list_profiles() -> list[dict[str, Any]]:
    _ensure_dir(get_profiles_dir())
    profiles: list[dict[str, Any]] = []
    for fname in sorted(os.listdir(get_profiles_dir())):
        if not fname.endswith(".json"):
            continue
        path = os.path.join(get_profiles_dir(), fname)
        try:
            with open(path) as f:
                data = json.load(f)
            profiles.append({
                "model": data.get("model", ""),
                "model_slug": data.get("model_slug", ""),
                "provider": data.get("provider", ""),
                "updated_at": data.get("updated_at", ""),
                "summary": data.get("summary", {}),
            })
        except Exception as e:
            logger.warning("Failed to read profile %s: %s", fname, e)
    return profiles


def get_profile(model_name: str) -> dict[str, Any] | None:
    profile = load_profile(model_name)
    return profile if profile else None
