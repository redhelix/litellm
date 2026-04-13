"""
TDD RED: Tests for main.py wiring (scheduler, routers, SYS-02 guard).
These tests MUST fail until main.py is updated.
"""
import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def test_main_has_background_scheduler():
    """main.py must import and use BackgroundScheduler."""
    with open(os.path.join(os.path.dirname(__file__), "../main.py")) as f:
        source = f.read()
    assert "BackgroundScheduler" in source


def test_main_has_poll_job_30s():
    with open(os.path.join(os.path.dirname(__file__), "../main.py")) as f:
        source = f.read()
    assert "scheduler.add_job(_poll_job" in source
    assert "seconds=30" in source


def test_main_has_scrape_job_60s():
    with open(os.path.join(os.path.dirname(__file__), "../main.py")) as f:
        source = f.read()
    assert "scheduler.add_job(_scrape_job" in source
    assert "seconds=60" in source


def test_main_includes_all_routers():
    with open(os.path.join(os.path.dirname(__file__), "../main.py")) as f:
        source = f.read()
    assert "include_router(requests_router)" in source
    assert "include_router(models_router)" in source
    assert "include_router(nodes_router)" in source
    assert "include_router(latency_router)" in source


def test_main_has_sys02_guard():
    with open(os.path.join(os.path.dirname(__file__), "../main.py")) as f:
        source = f.read()
    # SYS-02: must assert LITELLM_MASTER_KEY not in os.environ
    assert "LITELLM_MASTER_KEY" in source
    assert "not in os.environ" in source


def test_healthz_still_works():
    """TestClient should reach /healthz without triggering scheduler."""
    os.environ.setdefault("CONFIG_YAML_PATH", "/dev/null")
    os.environ.setdefault("DATABASE_URL", "postgresql://fake:fake@localhost/fake")
    # Patch scheduler so it doesn't actually try to connect
    import db as db_mod
    db_mod.DB_PATH = ":memory:"
    db_mod._conn = None

    # Import after setting env
    import importlib
    import main as main_mod
    importlib.reload(main_mod)

    from fastapi.testclient import TestClient
    client = TestClient(main_mod.app)
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
