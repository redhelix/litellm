"""
Wave 0 RED stubs: /api/requests endpoint — model filter + total count.
These tests assert new behavior not yet implemented. Expected to FAIL (RED).
"""
import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


@pytest.fixture
def client():
    """Create a TestClient with in-memory DuckDB and the requests router."""
    os.environ.setdefault("CONFIG_YAML_PATH", "/dev/null")
    import db as db_mod
    db_mod.DB_PATH = ":memory:"
    db_mod._conn = None

    from routers.requests import router
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(router)
    db_mod.get_connection()  # ensure schema is initialised
    return TestClient(app)


def test_requests_returns_total_count(client):
    """GET /api/requests must return a 'total' field in the response."""
    resp = client.get("/api/requests?window=30d&limit=25&offset=0")
    assert resp.status_code == 200
    data = resp.json()
    assert "total" in data, "response must include 'total' count field"


def test_requests_model_filter_param(client):
    """GET /api/requests?model=gpt-4o must filter rows by model."""
    resp = client.get("/api/requests?window=30d&limit=25&offset=0&model=gpt-4o")
    assert resp.status_code == 200
    data = resp.json()
    for row in data.get("rows", []):
        assert row["model"] == "gpt-4o", "all rows must match the model filter"


def test_requests_offset_cap(client):
    """GET /api/requests with offset>=500 must return 400."""
    resp = client.get("/api/requests?window=30d&limit=25&offset=500")
    assert resp.status_code == 400
