"""Probe history endpoint tests — /api/probes/history reads probe_history.jsonl.

The file is written by tools/run_probe_baseline.py (weekly cadence). This suite
pins the read contract: newest-first ordering, the ``probe`` filter, the limit,
and graceful empty handling (missing/corrupt lines skipped).
"""

import json
import os
import sys

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from main import app

client = TestClient(app)


def _write_history(tmp_path, records):
    path = tmp_path / "probe_history.jsonl"
    with path.open("w") as fh:
        for rec in records:
            fh.write(json.dumps(rec) + "\n")
    return str(path)


def test_history_orders_newest_first(monkeypatch, tmp_path):
    path = _write_history(tmp_path, [
        {"type": "reasoning", "run_at": "2026-09-01T00:00:00", "model": "a", "summary": {"rows": []}},
        {"type": "complexity", "run_at": "2026-09-07T00:00:00", "model": "a", "summary": {}},
    ])
    monkeypatch.setattr("main.PROBE_HISTORY_FILE", path)
    resp = client.get("/api/probes/history")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert data[0]["type"] == "complexity"
    assert data[1]["type"] == "reasoning"


def test_history_probe_filter(monkeypatch, tmp_path):
    path = _write_history(tmp_path, [
        {"type": "reasoning", "run_at": "2026-09-01T00:00:00", "model": "a"},
        {"type": "complexity", "run_at": "2026-09-02T00:00:00", "model": "a"},
    ])
    monkeypatch.setattr("main.PROBE_HISTORY_FILE", path)
    data = client.get("/api/probes/history?probe=reasoning").json()
    assert len(data) == 1
    assert data[0]["type"] == "reasoning"


def test_history_limit(monkeypatch, tmp_path):
    path = _write_history(tmp_path, [
        {"type": "complexity", "run_at": f"2026-09-{i:02d}T00:00:00", "model": "a"}
        for i in range(1, 8)
    ])
    monkeypatch.setattr("main.PROBE_HISTORY_FILE", path)
    data = client.get("/api/probes/history?limit=3").json()
    assert len(data) == 3
    assert data[0]["run_at"] == "2026-09-07T00:00:00"


def test_history_missing_file_returns_empty(monkeypatch, tmp_path):
    monkeypatch.setattr("main.PROBE_HISTORY_FILE", str(tmp_path / "absent.jsonl"))
    assert client.get("/api/probes/history").json() == []


def test_history_skips_corrupt_lines(monkeypatch, tmp_path):
    path = tmp_path / "probe_history.jsonl"
    path.write_text('{"type": "complexity", "run_at": "2026-09-02T00:00:00"}\nnot json\n\n')
    monkeypatch.setattr("main.PROBE_HISTORY_FILE", str(path))
    data = client.get("/api/probes/history").json()
    assert len(data) == 1
    assert data[0]["type"] == "complexity"