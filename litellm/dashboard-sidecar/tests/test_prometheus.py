import pytest
prom = pytest.importorskip("prometheus_scraper")


def test_uses_1h_rate_window():
    import inspect
    src = inspect.getsource(prom)
    assert "[1h]" in src, "RESEARCH pitfall 2: must use [1h] rate window, not [5m]"


def test_queries_include_all_required_metrics():
    assert "ttft_p50" in prom.QUERIES
    assert "ttft_p95" in prom.QUERIES
    assert "total_latency_p50" in prom.QUERIES
    assert "total_latency_p95" in prom.QUERIES
    assert "llm_latency_p50" in prom.QUERIES
    assert "llm_latency_p95" in prom.QUERIES
    assert "tokens_per_sec_p50" in prom.QUERIES
    assert "deployment_state" in prom.QUERIES


def test_nan_parsed_to_none():
    assert prom.parse_value("NaN") is None
    assert prom.parse_value("0.42") == 0.42
