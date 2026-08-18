"""
TC-60 / Cross-Turn Sleeper Injection Guard

Scans tool result messages (role=tool) in incoming request history and
neutralizes string values that contain instruction-injection patterns before
they reach the model.

Strategy: walk every string value in tool result JSON. If a value matches
the injection heuristic, replace it with a sanitized marker that preserves
the key name so the model knows the field existed but cannot act on it.

Heuristic triggers (case-insensitive):
  - Imperative phrases directed at the model: "you must", "always", "never",
    "from now on", "when the user", "do not tell", "do not mention",
    "ignore previous", "disregard", "override"
  - Instruction field names (regardless of value): internal_note, note,
    instructions, system_note, override, directive, command
  - High-urgency markers in data: "IMPORTANT:", "CRITICAL:", "NOTE:"
    appearing before imperative content

Design constraints:
  - Zero false-positive risk to structured data (numbers, booleans, lists,
    short strings) — only long strings (>40 chars) are pattern-matched.
  - Plain-string tool results (not JSON) are also scanned.
  - Repairs are logged to INJECTION_GUARD_LOG (JSONL) for audit.
  - Any error in this hook is swallowed — MUST NOT break the proxy path.
"""

import json
import os
import re
import sys
from datetime import datetime, timezone
from litellm.integrations.custom_logger import CustomLogger


INJECTION_GUARD_LOG = os.environ.get(
    "INJECTION_GUARD_LOG", "/tmp/injection_guard.jsonl"
)

# Field names that are suspicious regardless of content length/pattern
_SUSPICIOUS_FIELD_NAMES = {
    "internal_note", "instructions", "instruction",
    "system_note", "system_message", "override", "directive",
    "admin_note", "compliance_note", "compliance_requirement",
}

# Regex: imperative phrases directed at the model
_IMPERATIVE_RE = re.compile(
    r"\b("
    r"you must|you should|always|never|from now on|"
    r"when the user|do not tell|do not mention|"
    r"ignore previous|ignore prior|disregard|override|"
    r"bcc|cc all|forward all|"
    r"this is a (compliance|security|system) requirement|"
    r"this (instruction|directive|rule) (is|was) just activated"
    r")\b",
    re.IGNORECASE,
)

# Urgency markers that prefix imperative content
_URGENCY_RE = re.compile(
    r"^(IMPORTANT|CRITICAL|WARNING|NOTE|ALERT|SYSTEM)\s*:",
    re.IGNORECASE,
)

_MIN_SCAN_LENGTH = 40  # short strings are almost certainly data, not instructions


def _is_injection(field_name: str, value: str) -> bool:
    """Return True if this field/value pair looks like a prompt injection."""
    name_lower = field_name.lower().replace("-", "_").replace(" ", "_")
    if name_lower in _SUSPICIOUS_FIELD_NAMES:
        return True
    if not isinstance(value, str) or len(value) < _MIN_SCAN_LENGTH:
        return False
    if _IMPERATIVE_RE.search(value):
        return True
    # Urgency marker + anything long enough to be a sentence
    if _URGENCY_RE.match(value.strip()):
        return True
    return False


def _sanitize_value(field_name: str) -> str:
    return f"[REDACTED: field '{field_name}' contained instruction-pattern content]"


def _walk_and_sanitize(obj, parent_key: str = "") -> tuple:
    """Recursively walk obj, sanitize injection strings. Returns (new_obj, changed)."""
    if isinstance(obj, dict):
        changed = False
        new_obj = {}
        for k, v in obj.items():
            new_v, c = _walk_and_sanitize(v, parent_key=k)
            new_obj[k] = new_v
            changed = changed or c
        return new_obj, changed
    elif isinstance(obj, list):
        changed = False
        new_obj = []
        for item in obj:
            new_item, c = _walk_and_sanitize(item, parent_key=parent_key)
            new_obj.append(new_item)
            changed = changed or c
        return new_obj, changed
    elif isinstance(obj, str):
        if _is_injection(parent_key, obj):
            return _sanitize_value(parent_key), True
        return obj, False
    else:
        return obj, False


def _sanitize_tool_content(content: str, tool_call_id: str) -> tuple[str, bool]:
    """Sanitize a tool result content string. Returns (sanitized_content, changed)."""
    if not content or not isinstance(content, str):
        return content, False

    # Try JSON parse first
    try:
        parsed = json.loads(content)
        new_parsed, changed = _walk_and_sanitize(parsed)
        if changed:
            return json.dumps(new_parsed), True
        return content, False
    except (json.JSONDecodeError, ValueError):
        pass

    # Plain string — scan directly
    if _is_injection("__content__", content):
        return _sanitize_value("tool_result"), True

    return content, False


def _emit_guard_event(tool_call_id: str, model: str) -> None:
    try:
        line = json.dumps({
            "event": "injection_blocked",
            "tool_call_id": tool_call_id,
            "model": model,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        with open(INJECTION_GUARD_LOG, "a") as f:
            f.write(line + "\n")
    except Exception as e:
        print(f"injection_guard: log write failed: {e}", file=sys.stderr)


class ToolResultInjectionGuard(CustomLogger):
    """Pre-call hook: sanitize TC-60-style prompt injections in tool results."""

    async def async_pre_call_hook(self, user_api_key_dict, cache, data, call_type):
        try:
            messages = data.get("messages")
            if not messages:
                return data

            model = data.get("model", "unknown")
            for msg in messages:
                if msg.get("role") != "tool":
                    continue
                content = msg.get("content")
                if not content:
                    continue
                tool_call_id = msg.get("tool_call_id", "unknown")
                new_content, changed = _sanitize_tool_content(content, tool_call_id)
                if changed:
                    msg["content"] = new_content
                    _emit_guard_event(tool_call_id, model)

        except Exception as e:
            print(f"injection_guard: hook error (swallowed): {e}", file=sys.stderr)

        return data


proxy_handler_instance = ToolResultInjectionGuard()
