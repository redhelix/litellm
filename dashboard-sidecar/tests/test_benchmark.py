"""
Tests for benchmark router — schema, model list, and history endpoints.
RED phase: written before implementation.
"""
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# RED: import will fail until routers/benchmark.py exists
from routers.benchmark import _fetch_run_results, BENCH_MODELS


def test_bench_models_list_not_empty():
    assert len(BENCH_MODELS) > 0


def test_fetch_run_results_returns_list():
    """Should return empty list for a non-existent run_id (no crash)."""
    try:
        result = _fetch_run_results("nonexistent-run-id-00000000")
        assert isinstance(result, list)
    except PermissionError:
        pytest.skip("No /data directory in CI — requires Docker volume mount")


def test_bench_models_are_strings():
    for m in BENCH_MODELS:
        assert isinstance(m, str)
        assert len(m) > 0


@pytest.mark.skip(reason="requires live docker-001 proxy at 192.168.50.117:4000")
def test_post_benchmark_run_returns_202():
    """POST /api/benchmark/run returns 202 with run_id."""
    from fastapi.testclient import TestClient
    import main
    client = TestClient(main.app)
    resp = client.post("/api/benchmark/run")
    assert resp.status_code == 202
    data = resp.json()
    assert "run_id" in data
    assert data["status"] == "running"


@pytest.mark.skip(reason="requires live docker-001 proxy at 192.168.50.117:4000")
def test_get_benchmark_latest_returns_correct_shape():
    from fastapi.testclient import TestClient
    import main
    client = TestClient(main.app)
    resp = client.get("/api/benchmark/latest")
    assert resp.status_code == 200
    data = resp.json()
    assert "run" in data


@pytest.mark.skip(reason="requires live docker-001 proxy at 192.168.50.117:4000")
def test_get_benchmark_history_returns_correct_shape():
    from fastapi.testclient import TestClient
    import main
    client = TestClient(main.app)
    resp = client.get("/api/benchmark/history?limit=10")
    assert resp.status_code == 200
    data = resp.json()
    assert "runs" in data
    assert isinstance(data["runs"], list)
