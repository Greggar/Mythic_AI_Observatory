"""Smoke tests — verify the backend boots and responds to basic requests."""

from fastapi.testclient import TestClient
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from main import app

client = TestClient(app)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "service": "conductor-api"}


def test_api_traces_exists():
    resp = client.get("/api/traces")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
