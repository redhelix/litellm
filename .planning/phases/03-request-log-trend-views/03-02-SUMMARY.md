---
phase: 03-request-log-trend-views
plan: 02
subsystem: dashboard-sidecar
tags: [api, fastapi, duckdb, sql, trends, requests]
dependency_graph:
  requires: [03-01]
  provides: [/api/requests model filter + total, /api/trends endpoint]
  affects: [03-03, 03-04]
tech_stack:
  added: []
  patterns: [WINDOW_TO_SQL allowlist, parameterised DuckDB queries, COUNT subquery cap]
key_files:
  created:
    - dashboard-sidecar/routers/trends.py
  modified:
    - dashboard-sidecar/routers/requests.py
    - dashboard-sidecar/main.py
decisions:
  - "Used subquery `SELECT MIN(cnt, 500) FROM (SELECT COUNT(*) AS cnt ...)` instead of `MIN(COUNT(*), 500)` — DuckDB does not allow nested aggregate functions"
  - "Default window changed from 5m to 30d to match UI-SPEC requirement for recent 500 rows"
metrics:
  duration: ~10m
  completed: 2026-04-13
  tasks_completed: 2
  files_changed: 3
---

# Phase 03 Plan 02: Sidecar API — Request Filter + Trends Endpoint Summary

**One-liner:** Added model filter + capped total count to /api/requests and created /api/trends with PERCENTILE_CONT daily bucketing, both parameterised against SQL injection.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Update /api/requests — model filter + total + offset cap | ea0fc87 | dashboard-sidecar/routers/requests.py |
| 2 | Create /api/trends router and register in main.py | 9fc12fc | dashboard-sidecar/routers/trends.py, dashboard-sidecar/main.py |

## What Was Built

**Task 1 — /api/requests changes:**
- Added `model: str | None = Query(None)` parameter; value passed as SQL tuple param (never interpolated)
- Added `offset >= 500` guard returning 400 (DoS mitigation T-03-02-04)
- Added COUNT subquery capped at 500: `SELECT MIN(cnt, 500) FROM (SELECT COUNT(*) AS cnt FROM requests WHERE ...)`
- Added `total` field to response dict
- Default window changed from `5m` to `30d`

**Task 2 — /api/trends (new):**
- `WINDOW_TO_SQL` allowlist with only `7d` and `30d` — window value never reaches SQL (T-03-02-02)
- `model` required Query param passed as `(model,)` tuple (T-03-02-03)
- PERCENTILE_CONT(0.95) daily buckets for `latency_p95`
- AVG `context_utilization` and `error_repair_rate` (tool_call_status failed/repaired ratio) per day
- Date serialised to ISO string for JSON
- Router registered in main.py via `app.include_router(trends_router)`

## Verification

All 6 pytest tests GREEN:
- `tests/test_requests.py` — 3/3 passed
- `tests/test_trends.py` — 3/3 passed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] DuckDB nested aggregate in COUNT query**
- **Found during:** Task 1 verification
- **Issue:** `SELECT MIN(COUNT(*), 500)` raises `BinderException: aggregate function calls cannot be nested` in DuckDB
- **Fix:** Rewrote as `SELECT MIN(cnt, 500) FROM (SELECT COUNT(*) AS cnt FROM requests WHERE ...)` using a subquery
- **Files modified:** dashboard-sidecar/routers/requests.py
- **Commit:** ea0fc87

## Known Stubs

None — both endpoints return real query results from DuckDB.

## Threat Flags

No new threat surface beyond what is documented in the plan's threat model. All T-03-02-0x mitigations applied as required.
