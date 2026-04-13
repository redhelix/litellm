"""
Wave 0 RED stubs: /api/trends endpoint (doesn't exist yet).
These tests assert new behavior not yet implemented. Expected to FAIL (RED).
"""
import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


@pytest.fixture
def client():
    """Create a TestClient with in-memory DuckDB including the trends router (not yet registered)."""
    os.environ.setdefault("CONFIG_YAML_PATH", "/dev/null")
    import db as db_mod
    db_mod.DB_PATH = ":memory:"
    db_mod._conn = None

    from routers.requests import router as requests_router
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(requests_router)

    # Attempt to include trends router — will succeed only once it exists
    try:
        from routers.trends import router as trends_router
        app.include_router(trends_router)
    except ImportError:
        pass  # trends router doesn't exist yet — route will 404 (RED)

    db_mod.get_connection()
    return TestClient(app)


def test_trends_requires_model_param(client):
    """GET /api/trends without model param must return 422."""
    resp = client.get("/api/trends?window=7d")
    assert resp.status_code == 422


def test_trends_invalid_window_rejected(client):
    """GET /api/trends with window=all must return 400."""
    resp = client.get("/api/trends?model=gpt-4o&window=all")
    assert resp.status_code == 400


def test_trends_valid_request_returns_series(client):
    """GET /api/trends?model=gpt-4o&window=7d must return series array."""
    resp = client.get("/api/trends?model=gpt-4o&window=7d")
    assert resp.status_code == 200
    data = resp.json()
    assert "model" in data
    assert "series" in data
    assert isinstance(data["series"], list)
