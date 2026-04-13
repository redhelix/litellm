"""Tests for fix_json_tool_calls.py repair signal emission (DATA-04)
and RepairsLogReader tail reader (01-02).
"""
import asyncio
import importlib.util
import json
import os
import sys
import tempfile
import types
import pytest

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


def load_fix_json_module(repairs_log_path):
    """Load fix_json_tool_calls.py with a stub litellm environment."""
    # Stub litellm imports
    litellm_mod = types.ModuleType("litellm")
    integrations_mod = types.ModuleType("litellm.integrations")
    custom_logger_mod = types.ModuleType("litellm.integrations.custom_logger")

    class CustomLogger:
        pass

    custom_logger_mod.CustomLogger = CustomLogger
    sys.modules.setdefault("litellm", litellm_mod)
    sys.modules.setdefault("litellm.integrations", integrations_mod)
    sys.modules["litellm.integrations.custom_logger"] = custom_logger_mod

    os.environ["TOOL_REPAIRS_LOG"] = repairs_log_path

    spec = importlib.util.spec_from_file_location(
        "fix_json_tool_calls",
        os.path.join(os.path.dirname(__file__), "..", "..", "fix_json_tool_calls.py"),
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class _Fn:
    def __init__(self, arguments):
        self.arguments = arguments


class _TC:
    def __init__(self, arguments):
        self.function = _Fn(arguments)


class _Msg:
    def __init__(self, tool_calls):
        self.tool_calls = tool_calls


class _Choice:
    def __init__(self, arguments):
        self.message = _Msg([_TC(arguments)])


class _Response:
    def __init__(self, response_id, arguments):
        self.id = response_id
        self.choices = [_Choice(arguments)]


def test_fix_json_tool_calls_writes_response_id():
    """When tool arguments are repaired, a JSON line with response.id is written."""
    with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False) as f:
        log_path = f.name

    try:
        mod = load_fix_json_module(log_path)
        handler = mod.proxy_handler_instance
        resp = _Response("chatcmpl-test-123", '{"a": 1,}')  # trailing comma — bad JSON

        asyncio.get_event_loop().run_until_complete(
            handler.async_post_call_success_hook({}, None, resp)
        )

        with open(log_path) as f:
            lines = [l.strip() for l in f if l.strip()]

        assert len(lines) == 1, f"Expected 1 repair line, got {len(lines)}: {lines}"
        obj = json.loads(lines[0])
        assert obj["request_id"] == "chatcmpl-test-123"
        assert obj["repaired"] is True
        assert "timestamp" in obj
    finally:
        os.unlink(log_path)


def test_no_event_when_arguments_valid():
    """Valid JSON arguments — no repair event should be emitted."""
    with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False) as f:
        log_path = f.name

    try:
        mod = load_fix_json_module(log_path)
        handler = mod.proxy_handler_instance
        resp = _Response("chatcmpl-no-repair", '{"a": 1}')  # valid JSON

        asyncio.get_event_loop().run_until_complete(
            handler.async_post_call_success_hook({}, None, resp)
        )

        with open(log_path) as f:
            lines = [l.strip() for l in f if l.strip()]

        assert len(lines) == 0, f"Expected no lines, got: {lines}"
    finally:
        os.unlink(log_path)


def test_log_failure_does_not_raise():
    """I/O failure in repair log write must not propagate (T-01-13)."""
    mod = load_fix_json_module("/nonexistent-dir/repairs.jsonl")
    handler = mod.proxy_handler_instance
    resp = _Response("chatcmpl-io-err", '{"x":}')  # bad JSON

    # Should not raise
    asyncio.get_event_loop().run_until_complete(
        handler.async_post_call_success_hook({}, None, resp)
    )
