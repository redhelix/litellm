---
phase: "06"
plan: "01"
subsystem: dashboard-sidecar
tags: [backend, duckdb, poller, api, context-window, sort, filter]
dependency_graph:
  requires: []
  provides:
    - error_message column on DuckDB requests table (backward-compat migration)
    - exception ingestion from spend_logs through poller
    - /api/requests sort_by + sort_dir + status_filter params with whitelist validation
    - error_message field in /api/requests response
    - MODEL_CTX_MAP fallback covering all 7 deployed aliases
  affects:
    - dashboard-sidecar/db.py
    - dashboard-sidecar/poller.py
    - dashboard-sidecar/routers/requests.py
    - dashboard-sidecar/config_loader.py
tech_stack:
  added: [pytz (runtime dep for DuckDB TIMESTAMPTZ fetchall)]
  patterns:
    - TDD (RED→GREEN per task)
    - SQL whitelist map (SORT_COLUMNS/SORT_DIRS/STATUS_VALUES) — no raw user input in SQL
    - ALTER TABLE fallback pattern for backward-compat DB migration
    - Fallback constant map with YAML-parsed values winning via max() merge
key_files:
  created: []
  modified:
    - dashboard-sidecar/db.py
    - dashboard-sidecar/poller.py
    - dashboard-sidecar/routers/requests.py
    - dashboard-sidecar/config_loader.py
    - dashboard-sidecar/tests/test_poller.py
    - dashboard-sidecar/tests/test_requests.py
    - dashboard-sidecar/tests/test_context_util.py
decisions:
  - "Whitelist maps (SORT_COLUMNS/SORT_DIRS/STATUS_VALUES) in requests.py ensure no raw user strings reach SQL ORDER BY or WHERE clauses"
  - "FALLBACK_CTX_MAP in config_loader.py fills alias gaps; YAML-parsed values take precedence via max() merge"
  - "ALTER TABLE IF NOT EXISTS pattern for error_message backward-compat (catch duckdb.Error, pass)"
  - "pytz installed as runtime dep — DuckDB TIMESTAMPTZ fetchall requires it in test env"
metrics:
  duration_minutes: 35
  completed: "2026-04-14T04:51:09Z"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 7
  tests_added: 31
  tests_baseline: 51
  tests_final: 82
---

# Phase 6 Plan 01: Backend UX Enhancements Summary

**One-liner:** DuckDB error_message column + poller exception ingestion + whitelist-validated sort/filter API params + 7-alias FALLBACK_CTX_MAP, all TDD with 31 new tests.

## Tasks Completed

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | DuckDB error_message column + poller exception ingestion (D-01) | f3506fa | done |
| 2 | /api/requests sort + status_filter + error_message (D-03, D-01 surfacing) | e42d4e1 | done |
| 3 | MODEL_CTX_MAP covers all 7 deployed dashboard aliases (D-02) | 9043e3b | done |

## What Was Built

### Task 1 — error_message data flow (D-01)

- `db.py`: Added `error_message TEXT` to `CREATE TABLE requests`. Added ALTER TABLE fallback immediately after CREATE to migrate existing volume-mounted `metrics.duckdb` files on docker-001 without data loss.
- `poller.py`: Extended `SELECT_SQL` to include `exception` column from `LiteLLM_SpendLogs`. Updated row unpacking tuple to 13 elements. Updated `UPSERT_SQL` column list, VALUES placeholders, and `ON CONFLICT DO UPDATE SET` to include `error_message = EXCLUDED.error_message`.
- Tests added: exception populated → error_message in upsert params; NULL exception → None; schema column check; idempotent ALTER TABLE; SELECT_SQL contains `exception`.

### Task 2 — sort + status_filter + error_message surface (D-03 + D-01)

- `routers/requests.py`: Added `sort_by`, `sort_dir`, `status_filter` Query params. Added `SORT_COLUMNS`, `SORT_DIRS`, `STATUS_VALUES` whitelists at module top. Validation raises `HTTPException(400)` on unknown values. WHERE clause extended with `AND tool_call_status = ?` when `status_filter` is set. ORDER BY uses `{SORT_COLUMNS[sort_by]} {SORT_DIRS[sort_dir]} NULLS LAST, startTime DESC` (tiebreaker). Added `error_message` to SELECT and `cols` list.
- Tests added: error_message in all response rows; populated error_message for failed row; sort asc/desc with NULLS LAST assertion; default sort is startTime DESC; status_filter=failed; model+status_filter combined; 400 on invalid sort_by/sort_dir/status_filter.

### Task 3 — MODEL_CTX_MAP 7-alias coverage (D-02)

- `config_loader.py`: Added `FALLBACK_CTX_MAP` constant with all 7 constraint-listed aliases. Extended loader to also check `litellm_params.model_info.max_input_tokens` nesting (alternate YAML shape). Merge strategy: start from FALLBACK_CTX_MAP, then overlay YAML-parsed values using `max()` — so YAML always wins or ties.
- FALLBACK_CTX_MAP values (with sources):
  - `gemma-4-31b`: 131072 (Gemma 4 31B spec)
  - `nemotron-cascade-2`: 65536 (max of two config entries per RESEARCH pitfall 4)
  - `spark-learner`: 131072 (deployed config.yaml)
  - `nomic-embed-text`: 8192 (Nomic Embed v1 embedding input cap)
  - `google/gemini-2.5-flash`: 1048576 (Gemini 2.5 Flash, Google AI docs)
  - `openai/nemotron-cascade-2`: 65536 (proxy alias, same as underlying model)
  - `openai/spark-learner`: 131072 (proxy alias, same as underlying model)
- Tests added: parametrize 7 aliases → positive int from empty-config; parametrize 7 aliases → float in (0,1) from compute_context_utilization; unknown alias → None; YAML value wins over fallback.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] pytz not installed in venv**
- **Found during:** Task 2 (seeded_client fixture with DuckDB TIMESTAMPTZ rows)
- **Issue:** DuckDB requires `pytz` to convert TIMESTAMPTZ columns in fetchall(). Missing from venv caused `InvalidInputException` in tests that seed rows. Existing tests passed only because they returned 0 rows.
- **Fix:** `pip install pytz` in the active venv. No code change required — DuckDB auto-imports it.
- **Files modified:** none (venv only)

**2. [Rule 2 - Missing] seeded_client fixture used Python datetime with TZ**
- **Found during:** Task 2 RED phase
- **Issue:** Inserting Python `datetime.now(timezone.utc)` objects via DuckDB parameter binding triggered pytz before pytz was installed, and also would have triggered the TZ issue on any machine without pytz.
- **Fix:** Changed fixture to use DuckDB SQL `NOW() - INTERVAL N MINUTE` literals in the INSERT statement, removing the Python datetime dependency from the fixture entirely. After pytz was installed this became moot, but the SQL-native approach is more robust.

## ALTER TABLE Migration Path

ALTER TABLE fallback was implemented in code but **not exercised against a real DB** during this plan — defer to docker-001 deployment. The pattern is: `try: conn.execute("ALTER TABLE requests ADD COLUMN error_message TEXT") except duckdb.Error: pass`. This is idempotent and safe.

## Test Suite Results

```
82 passed, 4 skipped (benchmark tests require docker-001 live proxy)
Baseline: 51 passing
New: 31 tests added across test_poller.py, test_requests.py, test_context_util.py
```

## Known Stubs

None — all data paths are wired end-to-end. The fallback values in FALLBACK_CTX_MAP are research-confirmed constants, not placeholders.

## Self-Check: PASSED

Files exist:
- dashboard-sidecar/db.py: FOUND
- dashboard-sidecar/poller.py: FOUND
- dashboard-sidecar/routers/requests.py: FOUND
- dashboard-sidecar/config_loader.py: FOUND

Commits exist:
- f3506fa: FOUND
- e42d4e1: FOUND
- 9043e3b: FOUND
