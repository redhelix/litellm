"""
Tests for /api/requests endpoint — model filter, total count, sort, status_filter, error_message.
"""
import sys
import os
import pytest
from datetime import datetime, timezone, timedelta

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


@pytest.fixture
def seeded_client():
    """Client with rows seeded for sort/filter/error_message tests."""
    import db as db_mod
    db_mod.DB_PATH = ":memory:"
    db_mod._conn = None

    from routers.requests import router
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(router)
    conn = db_mod.get_connection()

    # Use SQL-native timestamps to avoid pytz dependency in test env
    conn.execute("""
        INSERT INTO requests (request_id, startTime, model, model_group,
            prompt_tokens, completion_tokens, total_tokens,
            ttft_ms, total_latency_ms, status, tool_call_status,
            context_utilization, api_key_alias, team_alias, error_message)
        VALUES
            ('req-1', NOW() - INTERVAL 1 MINUTE,  'model-a', NULL, 100, 50,  150, 10.0, 200.0, 'success', 'success',  0.1, NULL, NULL, NULL),
            ('req-2', NOW() - INTERVAL 2 MINUTE,  'model-a', NULL, 200, 80,  280, 30.0, 400.0, 'success', 'repaired', 0.2, NULL, NULL, NULL),
            ('req-3', NOW() - INTERVAL 3 MINUTE,  'model-b', NULL, 300, 100, 400, 50.0, 600.0, 'failure', 'failed',   0.3, NULL, NULL, 'connection refused'),
            ('req-4', NOW() - INTERVAL 4 MINUTE,  'model-b', NULL, 400, 120, 520, NULL, NULL,   'success', 'success',  NULL, NULL, NULL, NULL)
    """)

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


# --- D-01: error_message in response ---

def test_error_message_in_response_keys(seeded_client):
    """Every row in /api/requests response must include error_message key."""
    resp = seeded_client.get("/api/requests?window=30d&limit=100")
    assert resp.status_code == 200
    rows = resp.json()["rows"]
    assert len(rows) > 0
    for row in rows:
        assert "error_message" in row, f"error_message missing from row: {row}"


def test_error_message_populated_for_failed_row(seeded_client):
    """Rows with error_message set must surface the value."""
    resp = seeded_client.get("/api/requests?window=30d&limit=100")
    assert resp.status_code == 200
    rows = resp.json()["rows"]
    failed = [r for r in rows if r["tool_call_status"] == "failed"]
    assert len(failed) > 0
    assert failed[0]["error_message"] == "connection refused"


# --- D-03: sort params ---

def test_sort_by_ttft_ms_asc(seeded_client):
    """sort_by=ttft_ms&sort_dir=asc must order rows by ttft_ms ASC NULLS LAST."""
    resp = seeded_client.get("/api/requests?window=30d&limit=100&sort_by=ttft_ms&sort_dir=asc")
    assert resp.status_code == 200
    rows = resp.json()["rows"]
    non_null = [r["ttft_ms"] for r in rows if r["ttft_ms"] is not None]
    assert non_null == sorted(non_null), f"rows not sorted ASC by ttft_ms: {non_null}"
    # NULLs must be last
    if any(r["ttft_ms"] is None for r in rows):
        null_indices = [i for i, r in enumerate(rows) if r["ttft_ms"] is None]
        non_null_indices = [i for i, r in enumerate(rows) if r["ttft_ms"] is not None]
        assert max(non_null_indices) < min(null_indices), "NULLs must come after non-null values (NULLS LAST)"


def test_sort_by_total_latency_desc(seeded_client):
    """sort_by=total_latency_ms&sort_dir=desc must order rows by total_latency_ms DESC."""
    resp = seeded_client.get("/api/requests?window=30d&limit=100&sort_by=total_latency_ms&sort_dir=desc")
    assert resp.status_code == 200
    rows = resp.json()["rows"]
    non_null = [r["total_latency_ms"] for r in rows if r["total_latency_ms"] is not None]
    assert non_null == sorted(non_null, reverse=True), f"rows not sorted DESC by total_latency_ms: {non_null}"


def test_default_sort_is_starttime_desc(seeded_client):
    """Default (no sort params) must order by startTime DESC."""
    resp = seeded_client.get("/api/requests?window=30d&limit=100")
    assert resp.status_code == 200
    rows = resp.json()["rows"]
    times = [r["startTime"] for r in rows]
    assert times == sorted(times, reverse=True), "default sort must be startTime DESC"


# --- D-03: status_filter ---

def test_status_filter_failed(seeded_client):
    """status_filter=failed must return only rows with tool_call_status='failed'."""
    resp = seeded_client.get("/api/requests?window=30d&limit=100&status_filter=failed")
    assert resp.status_code == 200
    rows = resp.json()["rows"]
    assert len(rows) > 0
    for row in rows:
        assert row["tool_call_status"] == "failed", f"unexpected status: {row['tool_call_status']}"


def test_status_filter_and_model_combine(seeded_client):
    """status_filter and model filter must both apply."""
    resp = seeded_client.get("/api/requests?window=30d&limit=100&model=model-b&status_filter=failed")
    assert resp.status_code == 200
    rows = resp.json()["rows"]
    for row in rows:
        assert row["model"] == "model-b"
        assert row["tool_call_status"] == "failed"


# --- Validation: 400 on invalid params ---

def test_invalid_sort_by_returns_400(client):
    resp = client.get("/api/requests?sort_by=invalid")
    assert resp.status_code == 400


def test_invalid_sort_dir_returns_400(client):
    resp = client.get("/api/requests?sort_dir=sideways")
    assert resp.status_code == 400


def test_invalid_status_filter_returns_400(client):
    resp = client.get("/api/requests?status_filter=exploded")
    assert resp.status_code == 400


# --- D-01 Phase 8: api_key_alias + requester_ip_address in response ---

def test_api_key_alias_and_requester_ip_in_response_keys(seeded_client):
    """Every row in /api/requests must include api_key_alias and requester_ip_address keys."""
    resp = seeded_client.get("/api/requests?window=30d&limit=100")
    assert resp.status_code == 200
    rows = resp.json()["rows"]
    assert len(rows) > 0
    for row in rows:
        assert "api_key_alias" in row, f"api_key_alias missing from row: {row}"
        assert "requester_ip_address" in row, f"requester_ip_address missing from row: {row}"
