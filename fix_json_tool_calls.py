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

    @staticmethod
    def _parse_dsml_tool_calls(content: str):
        """Convert DeepSeek native DSML tool_calls format to OpenAI tool_calls list.

        vLLM's --tool-call-parser deepseek_v4 fails in some cases and leaks raw
        DSML tokens to the client. This catches and converts them as a fallback.
        Returns (tool_calls_list, cleaned_content) or (None, content) if no DSML found.
        """
        # DeepSeek DSML sentinel — U+FF5C fullwidth vertical bar wrapping "DSML"
        _D = "｜DSML｜"
        marker = f"<{_D}tool_calls>"
        if not content or marker not in content:
            return None, content

        invoke_pattern = re.compile(
            rf"<{re.escape(_D)}invoke name=\"([^\"]+)\">(.*?)</{re.escape(_D)}invoke>",
            re.DOTALL,
        )
        param_pattern = re.compile(
            rf"<{re.escape(_D)}parameter name=\"([^\"]+)\"[^>]*>(.*?)</{re.escape(_D)}parameter>",
            re.DOTALL,
        )
        tool_calls = []
        for i, m in enumerate(invoke_pattern.finditer(content)):
            func_name = m.group(1).strip()
            params = {}
            for pm in param_pattern.finditer(m.group(2)):
                params[pm.group(1).strip()] = pm.group(2).strip()
            tool_calls.append({
                "id": f"call_{i}_{func_name[:16]}",
                "type": "function",
                "function": {"name": func_name, "arguments": json.dumps(params)},
            })

        if not tool_calls:
            return None, content

        block_pattern = re.compile(
            rf"<{re.escape(_D)}tool_calls>.*?</{re.escape(_D)}tool_calls>",
            re.DOTALL,
        )
        cleaned = block_pattern.sub("", content).strip() or None
        return tool_calls, cleaned

    @staticmethod
    def _parse_xml_tool_calls(content: str):
        """Convert Hermes-format <tool_call> XML in content to OpenAI tool_calls list.

        LiteLLM 1.83.x regression: when a model returns finish_reason=tool_calls,
        LiteLLM re-serializes structured tool_calls back to the model's raw XML format
        instead of passing through the OpenAI-format tool_calls from vLLM.
        Returns (tool_calls_list, cleaned_content) or (None, content) if no XML found.
        """
        if not content or "<tool_call>" not in content:
            return None, content

        tool_calls = []
        tc_pattern = re.compile(
            r"<tool_call>\s*<function=([^>]+)>(.*?)</function>\s*</tool_call>",
            re.DOTALL,
        )
        param_pattern = re.compile(
            r"<parameter=([^>]+)>\s*(.*?)\s*</parameter>",
            re.DOTALL,
        )
        for i, m in enumerate(tc_pattern.finditer(content)):
            func_name = m.group(1).strip()
            params = {}
            for pm in param_pattern.finditer(m.group(2)):
                params[pm.group(1).strip()] = pm.group(2).strip()
            tool_calls.append({
                "id": f"call_{i}_{func_name[:16]}",
                "type": "function",
                "function": {"name": func_name, "arguments": json.dumps(params)},
            })

        if not tool_calls:
            return None, content

        cleaned = tc_pattern.sub("", content).strip() or None
        return tool_calls, cleaned

    async def async_post_call_success_hook(self, data, user_api_key_dict, response):
        """Fix JSON in model response tool calls. Emit repair signal when payload changed.

        Recovers tool_calls from two raw-token leak formats:
        - DeepSeek DSML (<｜DSML｜tool_calls>) — vLLM deepseek_v4 parser misses some cases
        - Hermes XML (<tool_call>) — LiteLLM 1.83.x regression re-serializing to XML

        Join key: response.id maps to LiteLLM_SpendLogs.request_id.
        """
        if not hasattr(response, "choices"):
            return response
        repaired = False
        for choice in response.choices:
            msg = getattr(choice, "message", None)
            if not msg:
                continue

            # Recover tool_calls from raw content (two known leak formats)
            content = getattr(msg, "content", None)
            if content and not getattr(msg, "tool_calls", None):
                # Try DeepSeek DSML format first, then Hermes XML
                parsed_tool_calls, cleaned_content = self._parse_dsml_tool_calls(content)
                if parsed_tool_calls is None:
                    parsed_tool_calls, cleaned_content = self._parse_xml_tool_calls(content)
                if parsed_tool_calls:
                    try:
                        from litellm.types.utils import ChatCompletionMessageToolCall, Function
                        msg.tool_calls = [
                            ChatCompletionMessageToolCall(
                                id=tc["id"],
                                type="function",
                                function=Function(
                                    name=tc["function"]["name"],
                                    arguments=tc["function"]["arguments"],
                                ),
                            )
                            for tc in parsed_tool_calls
                        ]
                        msg.content = cleaned_content
                        choice.finish_reason = "tool_calls"
                        repaired = True
                    except Exception as e:
                        print(f"fix_json: tool_call recovery failed: {e}", file=sys.stderr)

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

    # Substrings in the content/reasoning channel that signal a raw tool-call leak.
    _LEAK_MARKERS = ("｜DSML｜", "<tool_call>")

    @staticmethod
    def _iter_deltas(chunk):
        for ch in getattr(chunk, "choices", None) or []:
            d = getattr(ch, "delta", None)
            if d is not None:
                yield d

    @classmethod
    def _chunk_has_tool_calls(cls, chunk):
        for d in cls._iter_deltas(chunk):
            if getattr(d, "tool_calls", None):
                return True
        return False

    @staticmethod
    def _normalize_native_tool_calls(chunks):
        """Normalize native streaming tool_call deltas so every delta carries a
        valid id + function.name.

        Some models (via vLLM) stream the first tool_call delta for an index
        without an id, or with function.name arriving only in a later delta.
        Strict OpenAI-compatible clients (e.g. opencode's @ai-sdk/openai-compatible)
        throw "Expected 'function.name' to be a string." on the first nameless
        delta and abort the whole stream. Since this hook already fully buffers
        tool-bearing streams, we pre-resolve id/name per index and stamp them onto
        every delta before replay. Content/reasoning deltas are untouched.
        """
        # Pass 1: resolve first non-null id/name per tool_call index.
        resolved = {}
        for chunk in chunks:
            for ch in getattr(chunk, "choices", None) or []:
                delta = getattr(ch, "delta", None)
                tcs = getattr(delta, "tool_calls", None) if delta is not None else None
                if not tcs:
                    continue
                for tc in tcs:
                    idx = getattr(tc, "index", None)
                    if idx is None:
                        continue
                    r = resolved.setdefault(idx, {"id": None, "name": None})
                    if r["id"] is None and getattr(tc, "id", None):
                        r["id"] = tc.id
                    fn = getattr(tc, "function", None)
                    if r["name"] is None and fn is not None and getattr(fn, "name", None):
                        r["name"] = fn.name

        if not resolved:
            for chunk in chunks:
                yield chunk
            return

        # OC-DROP-NAMELESS: a tool_call whose name never streamed cannot be
        # turned into a valid call. Synthesizing a positional name ("tool_4")
        # made strict clients (opencode/@ai-sdk) reject it with "Model tried to
        # call unavailable tool 'tool_4'" and abort the whole turn. Dropping the
        # nameless call is strictly safer. Named calls still get an id synth.
        drop = set()
        for idx, r in resolved.items():
            if not r["name"]:
                drop.add(idx)
                print(f"fix_json: tool_call index {idx} had no name in stream; "
                      f"dropping call (cannot synthesize a valid tool name)",
                      file=sys.stderr)
                continue
            if not r["id"]:
                r["id"] = f"call_{idx}_{r['name'][:16]}"

        # Re-index survivors to a contiguous 0..N-1 range so a dropped middle
        # index doesn't leave a gap that confuses index-keyed clients.
        survivors = sorted(i for i in resolved if i not in drop)
        remap = {old: new for new, old in enumerate(survivors)}

        # Pass 2: drop nameless tool_calls, re-index + stamp id/name on the rest.
        for chunk in chunks:
            for ch in getattr(chunk, "choices", None) or []:
                delta = getattr(ch, "delta", None)
                tcs = getattr(delta, "tool_calls", None) if delta is not None else None
                if not tcs:
                    continue
                kept = []
                for tc in tcs:
                    idx = getattr(tc, "index", None)
                    if idx in drop:
                        continue
                    if idx is not None and idx in remap:
                        try: tc.index = remap[idx]
                        except Exception: pass
                        r = resolved[idx]
                        if not getattr(tc, "id", None):
                            try: tc.id = r["id"]
                            except Exception: pass
                        if getattr(tc, "type", None) is None:
                            try: tc.type = "function"
                            except Exception: pass
                        fn = getattr(tc, "function", None)
                        if fn is not None and not getattr(fn, "name", None):
                            try: fn.name = r["name"]
                            except Exception: pass
                    kept.append(tc)
                if len(kept) != len(tcs):
                    try: delta.tool_calls = kept if kept else None
                    except Exception: pass
            yield chunk

    async def async_post_call_streaming_iterator_hook(
        self, user_api_key_dict, response, request_data
    ):
        """Repair tool_calls in a streamed response with minimal latency cost.

        Plain (non-tool) requests stream through untouched. For tool-bearing
        requests we stream prose/reasoning deltas LIVE and only start buffering
        once we see the first native tool_call delta OR a raw-leak marker
        (DSML/XML) in the content channel. The buffered tail is then either:
          - reconstructed from a DSML/XML content leak, or
          - normalized so every native tool_call delta carries a valid id+name
            (strict clients like opencode's @ai-sdk/openai-compatible otherwise
            throw "Expected 'function.name' to be a string." and abort).
        Any failure falls back to verbatim replay of the buffered tail.
        """
        has_tools = bool((request_data or {}).get("tools"))
        if not has_tools:
            async for chunk in response:
                yield chunk
            return

        buffering = False
        buffered = []
        content_acc = []
        reasoning_acc = []

        def note(chunk):
            for d in self._iter_deltas(chunk):
                c = getattr(d, "content", None)
                if c:
                    content_acc.append(c)
                r = getattr(d, "reasoning_content", None)
                if r:
                    reasoning_acc.append(r)

        async for chunk in response:
            if buffering:
                buffered.append(chunk)
                continue
            note(chunk)
            joined_c = "".join(content_acc)
            joined_r = "".join(reasoning_acc)
            hit = self._chunk_has_tool_calls(chunk) or any(
                m in joined_c or m in joined_r for m in self._LEAK_MARKERS
            )
            if hit:
                buffering = True
                buffered.append(chunk)
                continue
            yield chunk

        if not buffered:
            return

        # Content seen only within the buffered tail (pre-trigger content already
        # streamed live) — used for DSML/XML reconstruction to avoid re-emitting.
        buf_content = "".join(
            getattr(d, "content", None) or ""
            for chunk in buffered
            for d in self._iter_deltas(chunk)
        )
        parsed_tool_calls, cleaned = self._parse_dsml_tool_calls(buf_content)
        if parsed_tool_calls is None:
            parsed_tool_calls, cleaned = self._parse_xml_tool_calls(buf_content)

        if not parsed_tool_calls:
            # No content leak — normalize native tool_call deltas and replay tail.
            for chunk in self._normalize_native_tool_calls(buffered):
                yield chunk
            return

        template = buffered[-1]
        try:
            from litellm.types.utils import (
                ModelResponseStream, StreamingChoices, Delta,
                ChatCompletionDeltaToolCall, Function,
            )
            base = {
                "id": getattr(template, "id", None),
                "created": getattr(template, "created", None),
                "model": getattr(template, "model", None),
            }
            sysfp = getattr(template, "system_fingerprint", None)
            if sysfp is not None:
                base["system_fingerprint"] = sysfp

            if cleaned:
                yield ModelResponseStream(
                    choices=[StreamingChoices(index=0, delta=Delta(content=cleaned))],
                    **base,
                )

            delta_tcs = [
                ChatCompletionDeltaToolCall(
                    index=i,
                    id=tc["id"],
                    type="function",
                    function=Function(
                        name=tc["function"]["name"],
                        arguments=tc["function"]["arguments"],
                    ),
                )
                for i, tc in enumerate(parsed_tool_calls)
            ]
            yield ModelResponseStream(
                choices=[StreamingChoices(index=0, delta=Delta(tool_calls=delta_tcs))],
                **base,
            )

            finish_kwargs = dict(base)
            usage = getattr(template, "usage", None)
            if usage is not None:
                finish_kwargs["usage"] = usage
            yield ModelResponseStream(
                choices=[StreamingChoices(index=0, finish_reason="tool_calls", delta=Delta())],
                **finish_kwargs,
            )

            request_id = base.get("id")
            if request_id:
                self._emit_repair_event(request_id)
        except Exception as e:
            print(f"fix_json: streaming tool_call recovery failed: {e}", file=sys.stderr)
            for chunk in self._normalize_native_tool_calls(buffered):
                yield chunk

proxy_handler_instance = FixJsonToolCallsCallback()
