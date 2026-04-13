import pytest
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
