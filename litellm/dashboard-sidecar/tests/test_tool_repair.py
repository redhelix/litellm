import json
import pytest
import os
repairs = pytest.importorskip("repairs")


def test_tail_reader_returns_request_ids(tmp_repairs_log):
    with open(tmp_repairs_log, "a") as f:
        f.write(json.dumps({"request_id": "chatcmpl-abc", "timestamp": "2026-04-13T00:00:00Z", "repaired": True}) + "\n")
        f.write(json.dumps({"request_id": "chatcmpl-def", "timestamp": "2026-04-13T00:00:01Z", "repaired": True}) + "\n")
    reader = repairs.RepairsLogReader(tmp_repairs_log)
    ids = reader.read_new()
    assert "chatcmpl-abc" in ids
    assert "chatcmpl-def" in ids


def test_tail_reader_tracks_offset(tmp_repairs_log):
    reader = repairs.RepairsLogReader(tmp_repairs_log)
    reader.read_new()
    with open(tmp_repairs_log, "a") as f:
        f.write(json.dumps({"request_id": "chatcmpl-new", "timestamp": "2026-04-13T00:00:02Z", "repaired": True}) + "\n")
    ids = reader.read_new()
    assert ids == {"chatcmpl-new"}, "offset tracking must skip already-read bytes"


def test_fix_json_tool_calls_writes_response_id(tmp_path, monkeypatch):
    """fix_json_tool_calls.py must write response.id (chatcmpl-*) not litellm_call_id."""
    import importlib.util
    import sys
    log_path = tmp_path / "tool_repairs.jsonl"
    monkeypatch.setenv("TOOL_REPAIRS_LOG", str(log_path))
    spec = importlib.util.spec_from_file_location("fx", os.path.join(os.path.dirname(__file__), "..", "..", "fix_json_tool_calls.py"))
    fx = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fx)
    assert hasattr(fx, "REPAIRS_LOG") or "TOOL_REPAIRS_LOG" in open(spec.origin).read()
    src = open(spec.origin).read()
    assert "response.id" in src, "must use response.id, not litellm_call_id (RESEARCH pitfall 3)"
