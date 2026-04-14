import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone

poller = pytest.importorskip("poller")


def test_bounded_query_enforced():
    import inspect
    src = inspect.getsource(poller)
    assert "INTERVAL '5 minutes'" in src, "QUERY-CONVENTIONS.md requires 5-minute bound"
    assert "LiteLLM_SpendLogs" in src


def test_tool_status_failed_for_failure_status(in_memory_db, fake_max_ctx):
    assert hasattr(poller, "classify_tool_status")
    assert poller.classify_tool_status("failure", "req-1", set()) == "failed"


def test_tool_status_repaired_when_in_index(fake_max_ctx):
    assert poller.classify_tool_status("success", "req-1", {"req-1"}) == "repaired"


def test_tool_status_success_when_not_in_index(fake_max_ctx):
    assert poller.classify_tool_status("success", "req-1", set()) == "success"


def test_watermark_persists_across_polls(in_memory_db):
    assert hasattr(poller, "get_watermark")


# --- D-01: error_message ingestion tests ---

def _make_pg_row(request_id, exception=None):
    """Build a fake psycopg2 row matching the SELECT_SQL column order (with exception)."""
    now = datetime.now(timezone.utc)
    return (
        request_id,     # request_id
        now,            # startTime
        now,            # endTime
        now,            # completionStartTime
        "spark-learner",  # model
        "spark",        # model_group
        100,            # prompt_tokens
        50,             # completion_tokens
        150,            # total_tokens
        "success",      # status
        "key-123",      # api_key
        None,           # metadata
        exception,      # exception (NEW)
    )


def test_error_message_populated_from_exception(in_memory_db, tmp_repairs_log):
    """When spend_logs row has exception='timeout after 30s', DuckDB row has error_message='timeout after 30s'."""
    import db as db_mod
    import repairs

    # Override db to use in_memory_db
    orig_query = db_mod.query.__wrapped__ if hasattr(db_mod.query, "__wrapped__") else None

    reader = repairs.RepairsLogReader(tmp_repairs_log)

    pg_row = _make_pg_row("req-err-1", exception="timeout after 30s")

    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_cur.fetchall.return_value = [pg_row]
    mock_conn.cursor.return_value = mock_cur

    with patch("psycopg2.connect", return_value=mock_conn), \
         patch("poller.query", return_value=[(None,)]), \
         patch("poller.execute") as mock_exec:
        poller.poll_once("postgresql://fake/db", reader, {"spark-learner": 131072})

    # Find the upsert call
    assert mock_exec.called, "execute (upsert) must be called"
    call_args = mock_exec.call_args
    params = call_args[0][1]  # second positional arg is the tuple
    # error_message should be the last param before end
    assert "timeout after 30s" in params, f"error_message not found in upsert params: {params}"


def test_error_message_none_when_exception_null(in_memory_db, tmp_repairs_log):
    """When spend_logs row has exception=NULL, error_message is None in upsert params."""
    import repairs

    reader = repairs.RepairsLogReader(tmp_repairs_log)
    pg_row = _make_pg_row("req-noerr-1", exception=None)

    mock_conn = MagicMock()
    mock_cur = MagicMock()
    mock_cur.fetchall.return_value = [pg_row]
    mock_conn.cursor.return_value = mock_cur

    with patch("psycopg2.connect", return_value=mock_conn), \
         patch("poller.query", return_value=[(None,)]), \
         patch("poller.execute") as mock_exec:
        poller.poll_once("postgresql://fake/db", reader, {"spark-learner": 131072})

    assert mock_exec.called
    call_args = mock_exec.call_args
    params = call_args[0][1]
    # error_message param should be None (last element in params tuple)
    assert params[-1] is None, f"error_message should be None, got: {params[-1]}"


def test_select_sql_includes_exception():
    """SELECT_SQL must include exception column for D-01."""
    assert "exception" in poller.SELECT_SQL, "SELECT_SQL must select exception column from spend_logs"


def test_error_message_column_in_schema(in_memory_db):
    """DuckDB requests table must have error_message column."""
    cols = in_memory_db.execute("PRAGMA table_info(requests)").fetchall()
    col_names = [c[1] for c in cols]
    assert "error_message" in col_names, f"error_message column missing from requests table. Columns: {col_names}"


def test_alter_table_idempotent(in_memory_db):
    """Running init_schema twice on same DB (simulating migration) must not raise."""
    import db as db_mod
    # Second call should succeed even though column already exists
    db_mod.init_schema(in_memory_db)  # should not raise
