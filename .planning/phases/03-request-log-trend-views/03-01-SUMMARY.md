---
phase: 03-request-log-trend-views
plan: "01"
subsystem: dashboard-frontend + dashboard-sidecar
tags: [tdd, red-stubs, vitest, pytest, wave-0]
dependency_graph:
  requires: []
  provides:
    - dashboard/src/__tests__/RequestLogTable.test.tsx
    - dashboard/src/__tests__/TrendSection.test.tsx
    - dashboard/src/__tests__/useRequestLog.test.tsx
    - dashboard/src/__tests__/useTrends.test.tsx
    - dashboard-sidecar/tests/test_requests.py
    - dashboard-sidecar/tests/test_trends.py
  affects:
    - dashboard/src/components/RequestLogTable.tsx (Wave 2 GREEN target)
    - dashboard/src/components/TrendSection.tsx (Wave 2 GREEN target)
    - dashboard/src/hooks/useRequestLog.ts (Wave 2 GREEN target)
    - dashboard/src/hooks/useTrends.ts (Wave 2 GREEN target)
    - dashboard-sidecar/routers/requests.py (Wave 2 update target)
    - dashboard-sidecar/routers/trends.py (Wave 2 create target)
tech_stack:
  added: []
  patterns:
    - vitest globals with vi.stubGlobal for fetch mocking
    - recharts vi.mock stub to avoid jsdom ResponsiveContainer issue
    - pytest fixture with in-memory DuckDB + FastAPI TestClient (no main import)
key_files:
  created:
    - dashboard/src/__tests__/RequestLogTable.test.tsx
    - dashboard/src/__tests__/TrendSection.test.tsx
    - dashboard/src/__tests__/useRequestLog.test.tsx
    - dashboard/src/__tests__/useTrends.test.tsx
    - dashboard-sidecar/tests/test_requests.py
    - dashboard-sidecar/tests/test_trends.py
  modified: []
decisions:
  - "Used fixture-based TestClient (not from main import app) to match codebase convention — main.py sys.exit(2) on missing DATABASE_URL makes direct import impossible"
  - "test_trends.py uses try/except ImportError for trends router — route 404s until router exists, giving correct RED failure"
metrics:
  duration: "~4 minutes"
  completed: "2026-04-13T23:10:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 6
  files_modified: 0
requirements:
  - VIEW-03
  - VIEW-04
---

# Phase 03 Plan 01: Wave 0 RED Test Stubs Summary

**One-liner:** Six RED test stubs — four vitest (frontend) and two pytest (sidecar) — defining the full contract for RequestLogTable, TrendSection, useRequestLog, useTrends, /api/requests extensions, and the new /api/trends endpoint.

## What Was Built

Six test files establishing the Wave 0 RED state for Phase 3 components and endpoints. All six files are importable and run without collection errors. The failing assertions define exact behavioral contracts for Wave 2 implementation.

### Frontend (vitest) — 4 files

| File | Tests | Status |
|------|-------|--------|
| RequestLogTable.test.tsx | 4 | FAIL — module not found |
| TrendSection.test.tsx | 2 | FAIL — module not found |
| useRequestLog.test.tsx | 3 | FAIL — module not found |
| useTrends.test.tsx | 3 | FAIL — module not found |

`npm run test -- --run` output: **4 files failed, 8 files passed** (53 existing tests unaffected).

### Sidecar (pytest) — 2 files

| File | Tests | Status |
|------|-------|--------|
| test_requests.py | 3 | 2 FAIL (total field, offset cap), 1 PASS |
| test_trends.py | 3 | 3 FAIL (route 404) |

`pytest tests/test_requests.py tests/test_trends.py -v`: **5 failed, 1 passed**, zero collection errors.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | `a235381c` | test(03-01): add Wave 0 RED vitest stubs for Phase 3 frontend |
| Task 2 | `432ca8b4` | test(03-01): add Wave 0 RED pytest stubs for sidecar endpoints |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Replaced `from main import app` with fixture-based TestClient**
- **Found during:** Task 2
- **Issue:** `main.py` calls `sys.exit(2)` at module level when `DATABASE_URL` is unset, making `from main import app` an INTERNALERROR in pytest
- **Fix:** Applied the established codebase pattern from `test_routers.py` — fixture creates a minimal FastAPI app directly from router modules using in-memory DuckDB
- **Files modified:** `dashboard-sidecar/tests/test_requests.py`, `dashboard-sidecar/tests/test_trends.py`
- **Commit:** `432ca8b4`

**2. [Rule 2 - Pattern] test_trends.py uses try/except ImportError for trends router**
- **Found during:** Task 2
- **Issue:** `routers/trends.py` doesn't exist yet — hard import would cause collection error, not RED test failure
- **Fix:** Wrapped trends router import in try/except; missing router causes 404 responses which correctly fail the assertions

## Known Stubs

None — all six test files contain complete test bodies. No placeholder text.

## Threat Flags

None — test files introduce no new network endpoints, auth paths, or schema changes.

## Self-Check: PASSED

All 6 test files found on disk. Both commits (a235381c, 432ca8b4) verified in git log.
