---
phase: 01-data-collection-layer
plan: "04"
subsystem: fix_json_tool_calls
tags: [instrumentation, repair-signal, tool-calls, data-collection, tdd]
dependency_graph:
  requires: ["01-01"]
  provides: ["repair-signal-emitter"]
  affects: ["dashboard-sidecar/repairs.py"]
tech_stack:
  added: []
  patterns: ["append-only JSONL event log", "try/except swallow on I/O", "response.id join key"]
key_files:
  created:
    - fix_json_tool_calls.py
    - dashboard-sidecar/tests/test_tool_repair.py
  modified: []
decisions:
  - "Use response.id (not litellm_call_id) as request_id per RESEARCH pitfall 3 — litellm writes LiteLLM_SpendLogs.request_id = response_obj.get('id') or litellm_call_id"
  - "Pre-call repairs not logged — no response.id available at pre-call time"
  - "I/O errors in _emit_repair_event are swallowed with stderr print to never break proxy response (T-01-13)"
metrics:
  duration: "~10 minutes"
  completed: "2026-04-13"
  tasks_completed: 1
  tasks_total: 1
  files_created: 2
  files_modified: 0
---

# Phase 01 Plan 04: Repair Signal Instrumentation Summary

**One-liner:** Added append-only JSONL repair-event emission to `fix_json_tool_calls.py` keyed on `response.id` so dashboard-sidecar can join against `LiteLLM_SpendLogs.request_id` for 3-state tool-call status.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing test for repair signal (TDD) | d3f3770 | dashboard-sidecar/tests/test_tool_repair.py |
| 1 (GREEN) | Implement repair signal emission | 941b517 | fix_json_tool_calls.py |

## What Was Built

`fix_json_tool_calls.py` now:
- Defines `REPAIRS_LOG = os.environ.get("TOOL_REPAIRS_LOG", "/tmp/tool_repairs.jsonl")`
- Adds `_emit_repair_event(request_id)` static method that appends `{"request_id": ..., "timestamp": ..., "repaired": true}` lines
- In `async_post_call_success_hook`: captures `original = fn.arguments` before repair, sets `repaired = True` if value changed, calls `_emit_repair_event(response.id)` when repaired
- Wraps all I/O in try/except that prints to stderr and returns — response path is never broken
- Does NOT log `litellm_call_id` anywhere — `response.id` is the exclusive join key

All existing behavior (`fix_json`, `_fix_messages`, `async_pre_call_hook`, `proxy_handler_instance` export) is preserved unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed "litellm_call_id" from docstring comment**
- **Found during:** Acceptance criteria static grep gate check
- **Issue:** Docstring explaining why NOT to use litellm_call_id contained the forbidden string, causing `! grep -q "litellm_call_id"` to fail
- **Fix:** Rewrote comment to say "internal UUID call identifier" instead
- **Files modified:** fix_json_tool_calls.py
- **Commit:** 941b517

## Known Stubs

None — repair signal is fully wired. The consumer (`dashboard-sidecar/repairs.py`) reads from the same JSONL path and is implemented in Plan 02.

## Threat Surface Scan

No new network endpoints or auth paths introduced. File I/O is append-only to a local path. Threat mitigations T-01-13 through T-01-16 are all implemented:
- T-01-13: try/except around file write
- T-01-14: consumer skips malformed lines (repairs.py Plan 02)
- T-01-15: only request_id + timestamp + repaired:true logged, never arguments payload
- T-01-16: static grep confirmed no litellm_call_id usage; test asserts response.id

## Self-Check: PASSED

- fix_json_tool_calls.py: FOUND
- dashboard-sidecar/tests/test_tool_repair.py: FOUND
- Commit d3f3770: FOUND (RED test)
- Commit 941b517: FOUND (GREEN implementation)
- All 3 pytest tests: PASSED
- Inline verify script: ok
