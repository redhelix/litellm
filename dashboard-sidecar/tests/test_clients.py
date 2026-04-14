"""
Tests for GET /api/clients endpoint.
"""
import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


@pytest.fixture
def clients_app():
    import db as db_mod
    db_mod.DB_PATH = ":memory:"
    db_mod._conn = None

    from routers.clients import router
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(router)
    conn = db_mod.get_connection()

    # Seed rows: alice (success), unknown IP failure, another IP success
    conn.execute("""
        INSERT INTO requests (request_id, startTime, model, status, tool_call_status,
                              api_key_alias, requester_ip_address)
        VALUES
            ('r1', NOW() - INTERVAL 1 HOUR,  'm', 'success', 'success', 'alice',  '1.2.3.4'),
            ('r2', NOW() - INTERVAL 2 HOUR,  'm', 'failure', 'failed',  NULL,     '1.2.3.4'),
            ('r3', NOW() - INTERVAL 3 HOUR,  'm', 'success', 'success', NULL,     '5.6.7.8')
    """)

    return TestClient(app)


def test_clients_24h_returns_expected_rows(clients_app):
    resp = clients_app.get("/api/clients?window=24h")
    assert resp.status_code == 200
    data = resp.json()
    # Should have 3 clients: alice (requests=1), 1.2.3.4 (requests=1), 5.6.7.8 (requests=1)
    clients = {r["client"]: r for r in data}
    assert "alice" in clients
    assert "1.2.3.4" in clients
    assert "5.6.7.8" in clients

    assert clients["alice"]["requests"] == 1
    assert clients["alice"]["errors"] == 0
    assert clients["alice"]["error_rate"] == 0.0

    assert clients["1.2.3.4"]["requests"] == 1
    assert clients["1.2.3.4"]["errors"] == 1
    assert clients["1.2.3.4"]["error_rate"] == 1.0

    assert clients["5.6.7.8"]["requests"] == 1
    assert clients["5.6.7.8"]["errors"] == 0
    assert clients["5.6.7.8"]["error_rate"] == 0.0


def test_clients_sorted_by_requests_desc(clients_app):
    resp = clients_app.get("/api/clients?window=24h")
    assert resp.status_code == 200
    data = resp.json()
    counts = [r["requests"] for r in data]
    assert counts == sorted(counts, reverse=True)


def test_clients_invalid_window_returns_400(clients_app):
    resp = clients_app.get("/api/clients?window=forever")
    assert resp.status_code == 400
