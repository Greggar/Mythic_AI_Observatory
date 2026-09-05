"""Chat trace contract tests — Phase 1 (chat_id / exchange_index + endpoints).

- POST /api/orchestrate with chat_id assigns chat_id + increments exchange_index.
- GET /api/chats lists only chat-linked traces (standalone traces excluded).
- GET /api/chats/{id} returns exchanges in exchange_index order.
- Old-format jsonl entries (no chat fields) parse cleanly with chat_id=None.
"""

import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import main
from services import orchestrator
from services.orchestrator import _store


@pytest.fixture(autouse=True)
def clean_env(tmp_path, monkeypatch):
    monkeypatch.setattr(orchestrator, "HISTORY_FILE", str(tmp_path / "traces.jsonl"))
    _store.clear()
    yield


async def _fake_orchestrate(prompt, trace_id, headless=False, model_override=None,
                            provider_override=None):
    """Stand-in for the real orchestrator: completes the trace without LLM calls."""
    s = _store.get(trace_id)
    if s is not None:
        s.status = "complete"
        s.output = f"response to: {prompt}"
        s.confidence = 0.9
        orchestrator._update_persist(s)


@pytest.fixture(autouse=True)
def fake_orchestrator(monkeypatch):
    monkeypatch.setattr(main, "orchestrate", _fake_orchestrate)
    yield


@pytest.fixture()
def client():
    with TestClient(main.app) as c:
        yield c


def _post(client, prompt, chat_id=None):
    body = {"prompt": prompt}
    if chat_id is not None:
        body["chat_id"] = chat_id
    return client.post("/api/orchestrate", json=body)


def test_standalone_trace_defaults_to_no_chat(client):
    resp = _post(client, "hello alone")
    assert resp.status_code == 200
    tid = resp.json()["trace_id"]
    trace = client.get(f"/api/traces/{tid}").json()
    assert trace["chat_id"] is None
    assert trace["exchange_index"] is None


def test_chat_trace_gets_id_and_incremented_exchange_index(client):
    _post(client, "first", chat_id="chat-abc")
    _post(client, "second", chat_id="chat-abc")
    _post(client, "third", chat_id="chat-abc")

    exchanges = client.get("/api/chats/chat-abc").json()
    assert [e["prompt"] for e in exchanges] == ["first", "second", "third"]
    assert [e["exchange_index"] for e in exchanges] == [0, 1, 2]
    assert all(e["chat_id"] == "chat-abc" for e in exchanges)


def test_chats_listing_excludes_standalone_traces(client):
    _post(client, "standalone")
    _post(client, "chat one", chat_id="chat-xyz")
    _post(client, "chat two", chat_id="chat-xyz")

    chats = client.get("/api/chats").json()
    chat_ids = {c["chat_id"] for c in chats}
    assert chat_ids == {"chat-xyz"}
    summary = next(c for c in chats if c["chat_id"] == "chat-xyz")
    assert summary["exchange_count"] == 2
    assert summary["first_prompt"] == "chat one"


def test_chat_summary_orders_by_most_recent_activity(client):
    _post(client, "older", chat_id="chat-a")
    _post(client, "newer", chat_id="chat-b")

    chats = client.get("/api/chats").json()
    assert [c["chat_id"] for c in chats] == ["chat-b", "chat-a"]


def test_get_missing_chat_returns_404(client):
    resp = client.get("/api/chats/does-not-exist")
    assert resp.status_code == 404


def test_old_format_jsonl_loads_cleanly(client, tmp_path):
    path = tmp_path / "traces.jsonl"
    path.write_text(
        '{"id": "old1", "prompt": "legacy", "status": "complete"}\n',
        encoding="utf-8",
    )
    sessions = orchestrator.load_history(limit=50)
    assert len(sessions) == 1
    assert sessions[0].chat_id is None
    assert sessions[0].exchange_index is None

    chats = client.get("/api/chats").json()
    assert chats == []
