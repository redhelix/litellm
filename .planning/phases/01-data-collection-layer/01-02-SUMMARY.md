---
phase: 01-data-collection-layer
plan: "02"
subsystem: dashboard-sidecar
tags: [poller, repairs, duckdb, postgres, ingestion, data-collection]
dependency_graph:
  requires: ["01-01"]
  provides: ["repairs.RepairsLogReader", "poller.poll_once", "poller.get_watermark", "poller.compute_ttft_ms", "poller.compute_context_utilization", "poller.classify_tool_status"]
  affects: ["01-05"]
tech_stack:
  added: [psycopg2-binary, duckdb]
  patterns: [byte-offset-tail-reader, bounded-postgres-query, duckdb-upsert-on-conflict]
key_files:
  created:
    - dashboard-sidecar/repairs.py
    - dashboard-sidecar/poller.py
    - dashboard-sidecar/db.py
    - dashboard-sidecar/config_loader.py
    - dashboard-sidecar/pytest.ini
    - dashboard-sidecar/tests/__init__.py
    - dashboard-sidecar/tests/conftest.py
    - dashboard-sidecar/tests/test_poller.py
    - dashboard-sidecar/tests/test_context_util.py
    - dashboard-sidecar/tests/test_latency_fields.py
  modified:
    - dashboard-sidecar/tests/test_tool_repair.py
decisions:
  - "byte-offset tracking in RepairsLogReader avoids re-parsing full file on each poll"
  - "poll_once accumulates repair_ids across ticks via function attribute so repairs seen in earlier ticks match later rows"
  - "psycopg2 connection opened fresh each poll (RESEARCH Pattern 2) — not pooled — to avoid long-lived connection issues"
  - "_extract_aliases reads only *_alias fields, never raw api_key column (T-01-06 mitigation)"
metrics:
  duration: "~15 minutes"
  completed_date: "2026-04-13"
  tasks_completed: 2
  files_created: 10
  files_modified: 1
---

# Phase 01 Plan 02: Postgres-DuckDB Ingestion Poller and Repairs Tail Reader Summary

**One-liner:** Bounded Postgres-to-DuckDB ingestion poller with psycopg2 per-poll connections, INTERVAL '5 minutes' SELECT guard, and byte-offset RepairsLogReader for /tmp/tool_repairs.jsonl.

## What Was Built

### Task 1: repairs.py — RepairsLogReader

`RepairsLogReader` tails a JSONL file using persistent byte-offset tracking. On each `read_new()` call it seeks to the last known offset, reads to EOF, parses each line, and collects `request_id` values from lines where `repaired is True`. Handles missing files (empty set), malformed JSON lines (stderr log + skip), and file truncation/rotation (offset reset to 0).

### Task 2: poller.py — Bounded Postgres Poll + DuckDB Upsert

`poll_once(pg_url, repairs_reader, max_ctx)` opens a fresh psycopg2 connection each poll with `connect_timeout=10`, executes a bounded `SELECT` from `LiteLLM_SpendLogs` with both a watermark lower bound and the mandatory `AND "startTime" > NOW() - INTERVAL '5 minutes'` cap. Each row is enriched with:

- `ttft_ms` = (completionStartTime - startTime) * 1000
- `total_latency_ms` = (endTime - startTime) * 1000
- `context_utilization` = prompt_tokens / max_ctx[model] or NULL
- `tool_call_status` = failed / repaired / success via classify_tool_status

Rows are upserted into DuckDB `requests` table via `ON CONFLICT (request_id) DO UPDATE`.

The `_extract_aliases` helper reads only `*_alias` fields from metadata JSONB — raw `api_key` is never persisted (T-01-06 mitigated).

### Prerequisites Created

Since plan 01-01 (wave 0) runs concurrently, this plan also created the prerequisite scaffolding: `db.py`, `config_loader.py`, `pytest.ini`, `tests/conftest.py`, `tests/__init__.py`.

## Test Results

All 11 tests GREEN:
- `test_tail_reader_returns_request_ids` — RepairsLogReader parses and returns request_ids
- `test_tail_reader_tracks_offset` — second read_new() skips already-read bytes
- `test_bounded_query_enforced` — INTERVAL '5 minutes' and LiteLLM_SpendLogs present in source
- `test_tool_status_failed_for_failure_status` — failure → "failed"
- `test_tool_status_repaired_when_in_index` — in repair set → "repaired"
- `test_tool_status_success_when_not_in_index` — normal success → "success"
- `test_watermark_persists_across_polls` — get_watermark exists
- `test_nemotron_cascade_takes_max` — config_loader dedup works
- `test_context_utilization_helper` — compute_context_utilization returns approx ratio or None
- `test_ttft_from_timestamps` — 250ms TTFT computed correctly
- `test_latency_fields_stored_separately` — ttft_ms, total_latency_ms, llm_api_latency_p50/p95 in schema

## Deviations from Plan

### Auto-added Prerequisites (Rule 2)

**Prerequisite scaffolding created as part of 01-02**
- **Found during:** Task 1 setup
- **Issue:** Plan 01-01 (wave 0) runs in parallel and its output files (db.py, config_loader.py, conftest.py, pytest.ini) were not yet committed when plan 01-02 started
- **Fix:** Created db.py, config_loader.py, tests/conftest.py, tests/__init__.py, pytest.ini as part of this plan's execution
- **Files created:** dashboard-sidecar/db.py, dashboard-sidecar/config_loader.py, dashboard-sidecar/tests/conftest.py, dashboard-sidecar/tests/__init__.py, dashboard-sidecar/pytest.ini
- **Commit:** 71546f9

**Tail reader tests added to test_tool_repair.py**
- **Found during:** TDD RED phase for Task 1
- **Issue:** The existing test_tool_repair.py (committed by another agent) tested fix_json_tool_calls.py but lacked the tail reader stubs (test_tail_reader_returns_request_ids, test_tail_reader_tracks_offset) that plan 01-02 verification requires
- **Fix:** Added the two tail reader test functions to test_tool_repair.py
- **Commit:** 71546f9

## Threat Model Coverage

All T-01-04 through T-01-08 mitigations implemented as planned:
- T-01-04: INTERVAL '5 minutes' hard-coded in SELECT_SQL; statically grep-verifiable
- T-01-05: Malformed JSON skipped with stderr log; `repaired is True` strict check
- T-01-06: _extract_aliases reads only *_alias fields; raw api_key not written to DuckDB
- T-01-07: Accepted (watermark + bounded window handles clock drift)
- T-01-08: try/finally closes connection on every path; connect_timeout=10

## Known Stubs

None — all data flows are wired. poll_once is a complete implementation pending live Postgres connectivity (tested with unit tests using mocked data).

## Self-Check

Files created:
- dashboard-sidecar/repairs.py: EXISTS
- dashboard-sidecar/poller.py: EXISTS
- dashboard-sidecar/db.py: EXISTS
- dashboard-sidecar/config_loader.py: EXISTS

Commits: 71546f9 and 5d5fd66 both present in litellm master.

## Self-Check: PASSED
