import json
import logging
import os
import uuid
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger("conductor")

SUITES_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "test_suites")
DIAGNOSTIC_PROBES_PATH = os.path.join(
    os.path.dirname(__file__), "..", "data", "diagnostic_probes.json"
)


def _ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def _suite_path(suite_id: str) -> str:
    return os.path.join(SUITES_DIR, f"{suite_id}.json")


def _runs_dir(suite_id: str) -> str:
    return os.path.join(SUITES_DIR, suite_id, "runs")


def _run_path(suite_id: str, run_id: str) -> str:
    return os.path.join(_runs_dir(suite_id), f"{run_id}.json")


def _load_suite(suite_id: str) -> dict[str, Any] | None:
    path = _suite_path(suite_id)
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)


def _save_suite(suite: dict[str, Any]) -> None:
    _ensure_dir(SUITES_DIR)
    path = _suite_path(suite["id"])
    with open(path, "w") as f:
        json.dump(suite, f, indent=2)


def _load_runs(suite_id: str) -> list[dict[str, Any]]:
    d = _runs_dir(suite_id)
    if not os.path.exists(d):
        return []
    runs = []
    for fname in sorted(os.listdir(d)):
        if not fname.endswith(".json"):
            continue
        try:
            with open(os.path.join(d, fname)) as f:
                runs.append(json.load(f))
        except Exception as e:
            logger.warning("Failed to read run %s/%s: %s", suite_id, fname, e)
    return runs


def _save_run(suite_id: str, run: dict[str, Any]) -> None:
    d = _runs_dir(suite_id)
    _ensure_dir(d)
    path = os.path.join(d, f"{run['run_id']}.json")
    with open(path, "w") as f:
        json.dump(run, f, indent=2)


def _delete_runs_dir(suite_id: str) -> None:
    d = _runs_dir(suite_id)
    if os.path.exists(d):
        import shutil
        shutil.rmtree(d)


def list_suites() -> list[dict[str, Any]]:
    _ensure_dir(SUITES_DIR)
    suites: list[dict[str, Any]] = []
    for fname in sorted(os.listdir(SUITES_DIR)):
        if not fname.endswith(".json"):
            continue
        try:
            with open(os.path.join(SUITES_DIR, fname)) as f:
                data = json.load(f)
            runs = _load_runs(data["id"])
            last_run = runs[-1] if runs else None
            suites.append({
                "id": data["id"],
                "name": data["name"],
                "description": data.get("description", ""),
                "tags": data.get("tags", []),
                "prompt_count": len(data.get("prompts", [])),
                "run_count": len(runs),
                "last_run": {
                    "run_id": last_run["run_id"],
                    "status": last_run["status"],
                    "completed_at": last_run.get("completed_at", ""),
                    "models": last_run.get("models", []),
                } if last_run else None,
                "created_at": data.get("created_at", ""),
                "updated_at": data.get("updated_at", ""),
            })
        except Exception as e:
            logger.warning("Failed to read suite %s: %s", fname, e)
    return suites


def get_suite(suite_id: str) -> dict[str, Any] | None:
    suite = _load_suite(suite_id)
    if not suite:
        return None
    suite["runs"] = _load_runs(suite_id)
    return suite


def create_suite(
    name: str,
    prompts: list[dict[str, str]],
    description: str = "",
    tags: list[str] | None = None,
) -> dict[str, Any]:
    now = datetime.now(UTC).isoformat()
    suite = {
        "id": uuid.uuid4().hex[:12],
        "name": name,
        "description": description,
        "tags": tags or [],
        "created_at": now,
        "updated_at": now,
        "prompts": [],
    }
    for p in prompts:
        suite["prompts"].append({
            "id": uuid.uuid4().hex[:8],
            "text": p.get("text", ""),
            "category": p.get("category", ""),
            "notes": p.get("notes", ""),
        })
    _save_suite(suite)
    return suite


def update_suite(
    suite_id: str,
    name: str | None = None,
    description: str | None = None,
    tags: list[str] | None = None,
    prompts: list[dict[str, str]] | None = None,
) -> dict[str, Any] | None:
    suite = _load_suite(suite_id)
    if not suite:
        return None
    if name is not None:
        suite["name"] = name
    if description is not None:
        suite["description"] = description
    if tags is not None:
        suite["tags"] = tags
    if prompts is not None:
        suite["prompts"] = []
        for p in prompts:
            suite["prompts"].append({
                "id": p.get("id") or uuid.uuid4().hex[:8],
                "text": p.get("text", ""),
                "category": p.get("category", ""),
                "notes": p.get("notes", ""),
            })
    suite["updated_at"] = datetime.now(UTC).isoformat()
    _save_suite(suite)
    return suite


def delete_suite(suite_id: str) -> bool:
    path = _suite_path(suite_id)
    if os.path.exists(path):
        os.remove(path)
        _delete_runs_dir(suite_id)
        return True
    return False


def create_run(suite_id: str, models: list[dict[str, str]], total: int) -> dict[str, Any] | None:
    suite = _load_suite(suite_id)
    if not suite:
        return None
    now = datetime.now(UTC).isoformat()
    run = {
        "run_id": uuid.uuid4().hex[:12],
        "models": models,
        "status": "running",
        "started_at": now,
        "completed_at": None,
        "total": total,
        "completed_count": 0,
        "failed_count": 0,
        "trace_ids": [],
    }
    _save_run(suite_id, run)
    return run


def update_run(suite_id: str, run_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
    path = _run_path(suite_id, run_id)
    if not os.path.exists(path):
        return None
    with open(path) as f:
        run = json.load(f)
    run.update(updates)
    _save_run(suite_id, run)
    return run


def get_run(suite_id: str, run_id: str) -> dict[str, Any] | None:
    path = _run_path(suite_id, run_id)
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)


def seed_from_diagnostics() -> dict[str, Any] | None:
    """Create a default suite from diagnostic_probes.json if no suites exist."""
    _ensure_dir(SUITES_DIR)
    existing = [f for f in os.listdir(SUITES_DIR) if f.endswith(".json")]
    if existing:
        return None
    if not os.path.exists(DIAGNOSTIC_PROBES_PATH):
        return None
    with open(DIAGNOSTIC_PROBES_PATH) as f:
        probes = json.load(f)
    prompts = [
        {"text": p["prompt"], "category": p["category"], "notes": p["description"]}
        for p in probes
    ]
    return create_suite(
        name="Behavioral Baseline",
        description="Core behavioral probes derived from the diagnostic suite. Tests tone, structure, constraint adherence, genre, ambiguity, reasoning, honesty, and persona defaults.",
        tags=["baseline", "behavioral", "diagnostic"],
        prompts=prompts,
    )
