"""
TDD RED: Tests for the four FastAPI routers (requests, models, nodes, latency).
These tests MUST fail until the router modules are implemented.
"""
import sys
import os

import pytest

# Ensure sidecar package root is on path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


@pytest.fixture
def client():
    """Create a TestClient with in-memory DuckDB and all four routers."""
    os.environ.setdefault("CONFIG_YAML_PATH", "/dev/null")
    # Patch db to use in-memory
    import db as db_mod
    db_mod.DB_PATH = ":memory:"
    db_mod._conn = None

    from routers.requests import router as r1
    from routers.models import router as r2
    from routers.nodes import router as r3
    from routers.latency import router as r4
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    for r in (r1, r2, r3, r4):
        app.include_router(r)

    # Ensure schema exists
    conn = db_mod.get_connection()

    return TestClient(app)


def test_requests_invalid_window_returns_400(client):
    resp = client.get("/api/requests?window=bad")
    assert resp.status_code == 400
    assert resp.json()["detail"] == "invalid window"


def test_requests_valid_window_returns_200(client):
    resp = client.get("/api/requests?window=5m")
    assert resp.status_code == 200
    body = resp.json()
    assert "rows" in body
    assert "limit" in body
    assert "offset" in body


def test_requests_all_windows(client):
    for window in ("5m", "7d", "30d"):
        resp = client.get(f"/api/requests?window={window}")
        assert resp.status_code == 200, f"window={window} failed"


def test_models_returns_200(client):
    resp = client.get("/api/models")
    assert resp.status_code == 200
    assert "models" in resp.json()


def test_nodes_returns_200(client):
    resp = client.get("/api/nodes")
    assert resp.status_code == 200
    assert "nodes" in resp.json()


def test_latency_snapshots_valid(client):
    resp = client.get("/api/latency/snapshots?model=foo&window=7d")
    assert resp.status_code == 200
    body = resp.json()
    assert "series" in body
    assert body["model"] == "foo"
    assert body["window"] == "7d"


def test_latency_snapshots_invalid_window(client):
    resp = client.get("/api/latency/snapshots?model=foo&window=bad")
    assert resp.status_code == 400


def test_no_master_key_in_responses(client):
    urls = [
        "/api/requests?window=5m",
        "/api/models",
        "/api/nodes",
        "/api/latency/snapshots?model=foo&window=7d",
    ]
    for url in urls:
        body = client.get(url).text
        assert "sk-" not in body, f"sk-* leak in {url}"
        assert "LITELLM_MASTER_KEY" not in body, f"master key leak in {url}"


def test_requests_limit_bounds(client):
    # limit=0 invalid
    resp = client.get("/api/requests?window=5m&limit=0")
    assert resp.status_code == 400
    # limit=1001 invalid
    resp = client.get("/api/requests?window=5m&limit=1001")
    assert resp.status_code == 400
    # limit=1 valid
    resp = client.get("/api/requests?window=5m&limit=1")
    assert resp.status_code == 200
