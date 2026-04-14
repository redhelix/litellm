"""
RED test stubs for Phase 07 Intelligence Layer — INT-01 through INT-06.
These tests FAIL until Wave 1 (intelligence_job.py + routers/intelligence.py) lands.
"""
import sys
import json
import urllib.error
from unittest import mock
from types import SimpleNamespace

import pytest
import duckdb

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def in_memory_db(monkeypatch):
    """Session-scoped in-memory DuckDB with full schema applied."""
    import db as db_module
    conn = duckdb.connect(":memory:")
    db_module.init_schema(conn)
    # Patch module-level connection so db.query/execute use our in-memory conn
    monkeypatch.setattr(db_module, "_conn", conn)
    # Reset intelligence in-memory cache so GET endpoint returns empty state
    try:
        import intelligence_job
        monkeypatch.setattr(intelligence_job, "_cache", {})
    except ImportError:
        pass
    yield conn
    conn.close()


# ---------------------------------------------------------------------------
# INT-01: call_llm posts to LiteLLM proxy and returns content string
# ---------------------------------------------------------------------------

def test_call_llm():
    """INT-01 — call_llm sends POST to litellm-proxy and returns content."""
    fake_response_body = json.dumps({
        "choices": [{"message": {"content": "hello from llm"}}]
    }).encode()

    fake_resp = mock.MagicMock()
    fake_resp.__enter__ = mock.Mock(return_value=fake_resp)
    fake_resp.__exit__ = mock.Mock(return_value=False)
    fake_resp.read.return_value = fake_response_body

    with mock.patch("urllib.request.urlopen", return_value=fake_resp) as mock_open:
        import intelligence_job  # noqa: F401 — will raise ImportError until Wave 1
        result = intelligence_job.call_llm([{"role": "user", "content": "hi"}])

    assert result == "hello from llm"
    call_args = mock_open.call_args
    req = call_args[0][0]
    assert req.full_url == "http://litellm-proxy:4000/v1/chat/completions"
    assert "Authorization" in req.headers or "authorization" in {k.lower() for k in req.headers}


# ---------------------------------------------------------------------------
# INT-02: search_hf_models filters by NVFP4/FP8 tags
# ---------------------------------------------------------------------------

def test_search_hf_models():
    """INT-02 — search_hf_models returns only models with NVFP4 or FP8 tags."""
    fake_models = [
        SimpleNamespace(id="org/model-nvfp4", tags=["nvfp4", "text-generation"]),
        SimpleNamespace(id="org/model-fp8", tags=["fp8", "text-generation"]),
        SimpleNamespace(id="org/model-other", tags=["text-generation"]),
    ]

    with mock.patch("huggingface_hub.HfApi") as MockHfApi:
        MockHfApi.return_value.list_models.return_value = fake_models
        import intelligence_job  # noqa: F401 — will raise ImportError until Wave 1
        result = intelligence_job.search_hf_models()

    assert len(result) == 2
    ids = [m.id for m in result]
    assert "org/model-nvfp4" in ids
    assert "org/model-fp8" in ids
    assert "org/model-other" not in ids


# ---------------------------------------------------------------------------
# INT-03: run_intelligence_job writes a single row to intelligence_cache
# ---------------------------------------------------------------------------

def test_job_writes_cache(in_memory_db, monkeypatch):
    """INT-03 — run_intelligence_job inserts/replaces one row in intelligence_cache."""
    import intelligence_job  # noqa: F401 — will raise ImportError until Wave 1

    monkeypatch.setattr(intelligence_job, "call_llm", lambda msgs: "canned summary")
    monkeypatch.setattr(intelligence_job, "search_hf_models", lambda: [])

    intelligence_job.run_intelligence_job()

    rows = in_memory_db.execute("SELECT COUNT(*) FROM intelligence_cache").fetchone()
    assert rows[0] == 1

    generated_at = in_memory_db.execute(
        "SELECT generated_at FROM intelligence_cache WHERE id = 1"
    ).fetchone()
    assert generated_at is not None
    assert generated_at[0] is not None


# ---------------------------------------------------------------------------
# INT-04: GET /api/intelligence returns 200 with null generated_at before any job
# ---------------------------------------------------------------------------

def test_get_empty(in_memory_db):
    """INT-04 — GET /api/intelligence returns 200 with generated_at=null before any job run."""
    from fastapi.testclient import TestClient
    from main import app  # noqa: F401 — will raise ImportError if routers not wired

    client = TestClient(app)
    resp = client.get("/api/intelligence")
    assert resp.status_code == 200
    data = resp.json()
    assert data["generated_at"] is None
    assert data.get("anomalies", []) == [] or data.get("anomalies") is None


# ---------------------------------------------------------------------------
# INT-05: POST /api/intelligence/query returns 503 when call_llm raises URLError
# ---------------------------------------------------------------------------

def test_query_llm_error(in_memory_db, monkeypatch):
    """INT-05 — POST /api/intelligence/query returns 503 when LLM is unreachable."""
    from fastapi.testclient import TestClient
    from main import app  # noqa: F401 — will raise ImportError if routers not wired
    import routers.intelligence as intel_router  # noqa: F401 — will raise ImportError until Wave 1

    monkeypatch.setattr(
        intel_router,
        "call_llm",
        mock.Mock(side_effect=urllib.error.URLError("connection refused")),
    )

    client = TestClient(app)
    resp = client.post("/api/intelligence/query", json={"question": "x"})
    assert resp.status_code == 503


# ---------------------------------------------------------------------------
# INT-06: Pattern 5 SQL queries run against empty requests table without error
# ---------------------------------------------------------------------------

def test_metrics_context_sql(in_memory_db):
    """INT-06 — Pattern 5 SQL queries execute cleanly against an empty requests table."""
    conn = in_memory_db

    sql_model_aggregates = """
        SELECT model,
               COUNT(*) as request_count,
               AVG(ttft_ms) as avg_ttft_ms,
               PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ttft_ms) as p95_ttft_ms,
               AVG(total_latency_ms) as avg_latency_ms,
               AVG(context_utilization) as avg_ctx_util,
               SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as error_rate,
               SUM(CASE WHEN tool_call_status = 'repaired' THEN 1 ELSE 0 END) as tool_repairs
        FROM requests
        WHERE startTime > NOW() - INTERVAL 24 HOUR
        GROUP BY model
        ORDER BY request_count DESC
    """

    sql_recent_errors = """
        SELECT model, error_message, COUNT(*) as occurrences
        FROM requests
        WHERE startTime > NOW() - INTERVAL 6 HOUR
          AND status = 'failed'
          AND error_message IS NOT NULL
        GROUP BY model, error_message
        ORDER BY occurrences DESC
        LIMIT 10
    """

    sql_latency_trend = """
        SELECT DATE_TRUNC('day', startTime) as day,
               model,
               AVG(total_latency_ms) as avg_latency_ms
        FROM requests
        WHERE startTime > NOW() - INTERVAL 7 DAY
        GROUP BY day, model
        ORDER BY day DESC, model
    """

    result1 = conn.execute(sql_model_aggregates).fetchall()
    assert result1 == []

    result2 = conn.execute(sql_recent_errors).fetchall()
    assert result2 == []

    result3 = conn.execute(sql_latency_trend).fetchall()
    assert result3 == []
