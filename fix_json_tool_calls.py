import json
import os
import re
import sys
from datetime import datetime, timezone
from litellm.integrations.custom_logger import CustomLogger


REPAIRS_LOG = os.environ.get("TOOL_REPAIRS_LOG", "/tmp/tool_repairs.jsonl")


class FixJsonToolCallsCallback(CustomLogger):
    """Repair common JSON errors in model-generated tool call arguments.

    Hooks into both:
    - Response (post_call): Fix JSON before returning to client AND
      emit a repair signal to REPAIRS_LOG when a fix actually changed the payload.
      The signal uses response.id (model-returned chat completion ID) as request_id
      so dashboard-sidecar can join it against LiteLLM_SpendLogs.request_id.
    - Request (pre_call): Fix JSON in assistant messages from conversation history.
      Pre-call repairs are NOT logged — no response.id is available at pre-call time.
    """

    @staticmethod
    def fix_json(s):
        if not s or not isinstance(s, str):
            return s
        try:
            json.loads(s)
            return s
        except json.JSONDecodeError:
            pass

        fixed = s
        # Fix 1: Trailing commas
        fixed = re.sub(r",\s*}", "}", fixed)
        fixed = re.sub(r",\s*]", "]", fixed)
        try:
            json.loads(fixed)
            return fixed
        except json.JSONDecodeError:
            pass

        # Fix 2: Unterminated strings and missing braces
        in_string = False
        escaped = False
        brace_depth = 0
        bracket_depth = 0
        for ch in fixed:
            if escaped:
                escaped = False
                continue
            if ch == '\\':
                escaped = True
                continue
            if ch == '"':
                in_string = not in_string
            elif not in_string:
                if ch == '{': brace_depth += 1
                elif ch == '}': brace_depth -= 1
                elif ch == '[': bracket_depth += 1
                elif ch == ']': bracket_depth -= 1

        if in_string:
            fixed += '"'
        fixed += ']' * max(0, bracket_depth)
        fixed += '}' * max(0, brace_depth)

        try:
            json.loads(fixed)
            return fixed
        except json.JSONDecodeError:
            pass

        # Fix 3: Invalid escape sequences inside strings (e.g. \. \, \= from truncation)
        # Re-scan and escape any backslash not followed by a valid JSON escape char.
        valid_escapes = set('"' + '\\' + '/bfnrtu')
        result = []
        in_string = False
        i = 0
        while i < len(fixed):
            ch = fixed[i]
            if in_string:
                if ch == '\\':
                    next_ch = fixed[i + 1] if i + 1 < len(fixed) else ''
                    if next_ch in valid_escapes:
                        # Valid escape — consume both chars
                        result.append(ch)
                        result.append(next_ch)
                        i += 2
                        continue
                    else:
                        # Invalid escape — double the backslash
                        result.append('\\\\')
                        i += 1
                        continue
                elif ch == '"':
                    in_string = False
            else:
                if ch == '"':
                    in_string = True
            result.append(ch)
            i += 1

        fixed = ''.join(result)
        try:
            json.loads(fixed)
            return fixed
        except json.JSONDecodeError:
            return s

    def _fix_messages(self, messages):
        """Fix tool call arguments in message history (pre-call). Not logged."""
        if not messages:
            return
        for msg in messages:
            tool_calls = msg.get("tool_calls")
            if not tool_calls:
                continue
            for tc in tool_calls:
                fn = tc.get("function", {})
                if "arguments" in fn and isinstance(fn["arguments"], str):
                    fn["arguments"] = self.fix_json(fn["arguments"])

    @staticmethod
    def _emit_repair_event(request_id: str) -> None:
        """Append a repair event. Any I/O error is swallowed — logging MUST NOT
        break the proxy response path."""
        try:
            line = json.dumps({
                "request_id": request_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "repaired": True,
            })
            with open(REPAIRS_LOG, "a") as f:
                f.write(line + "\n")
        except Exception as e:
            print(f"fix_json: repair log write failed: {e}", file=sys.stderr)

    async def async_pre_call_hook(self, user_api_key_dict, cache, data, call_type):
        """Fix JSON in request messages (conversation history with prior tool calls).
        No response.id available at pre-call — repairs are NOT logged."""
        messages = data.get("messages")
        if messages:
            self._fix_messages(messages)
        return data

    async def async_post_call_success_hook(self, data, user_api_key_dict, response):
        """Fix JSON in model response tool calls. Emit repair signal when payload changed.

        Join key (RESEARCH pitfall 3): response.id is the model-returned chat completion
        ID that LiteLLM stores as LiteLLM_SpendLogs.request_id. The internal UUID call
        identifier would produce zero-match joins against SpendLogs — use response.id.
        """
        if not hasattr(response, "choices"):
            return response
        repaired = False
        for choice in response.choices:
            msg = getattr(choice, "message", None)
            if not msg:
                continue
            tool_calls = getattr(msg, "tool_calls", None)
            if not tool_calls:
                continue
            for tc in tool_calls:
                fn = getattr(tc, "function", None)
                if fn and fn.arguments:
                    original = fn.arguments
                    fixed = self.fix_json(fn.arguments)
                    fn.arguments = fixed
                    if fixed != original:
                        repaired = True

        if repaired:
            request_id = getattr(response, "id", None)
            if request_id:
                self._emit_repair_event(request_id)

        return response


proxy_handler_instance = FixJsonToolCallsCallback()
