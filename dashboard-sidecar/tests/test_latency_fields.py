import pytest

poller = pytest.importorskip("poller")


def test_ttft_from_timestamps():
    from datetime import datetime, timezone, timedelta
    start = datetime(2026, 4, 13, 0, 0, 0, tzinfo=timezone.utc)
    cstart = start + timedelta(milliseconds=250)
    assert poller.compute_ttft_ms(start, cstart) == pytest.approx(250.0)
    assert poller.compute_ttft_ms(start, None) is None


def test_latency_fields_stored_separately(in_memory_db):
    cols = [r[1] for r in in_memory_db.execute("PRAGMA table_info('requests')").fetchall()]
    assert "ttft_ms" in cols
    assert "total_latency_ms" in cols
    snapshots_cols = [r[1] for r in in_memory_db.execute("PRAGMA table_info('latency_snapshots')").fetchall()]
    assert "llm_api_latency_p50" in snapshots_cols
    assert "llm_api_latency_p95" in snapshots_cols
