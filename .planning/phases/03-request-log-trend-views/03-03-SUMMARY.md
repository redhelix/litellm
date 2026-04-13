---
phase: 03-request-log-trend-views
plan: 03
subsystem: dashboard
tags: [react, hooks, fetch, recharts, shadcn, typescript]
dependency_graph:
  requires: [03-01, 03-02]
  provides: [useRequestLog hook, useTrends hook, RequestLogRow/Response/TrendPoint/TrendResponse types, recharts, shadcn select/toggle-group]
  affects: [03-04]
tech_stack:
  added: [recharts, shadcn/select, shadcn/toggle-group, shadcn/toggle]
  patterns: [AbortController cleanup, stable array key via join to prevent infinite re-renders, params-object hook signature]
key_files:
  created:
    - dashboard/src/hooks/useRequestLog.ts
    - dashboard/src/hooks/useTrends.ts
    - dashboard/src/components/ui/select.tsx
    - dashboard/src/components/ui/toggle.tsx
    - dashboard/src/components/ui/toggle-group.tsx
  modified:
    - dashboard/src/types/api.ts
    - dashboard/package.json
decisions:
  - "useRequestLog uses params-object signature to match existing test stubs, not (sidecarUrl, model, page) as planned"
  - "useTrends uses models.join(',') as stable effect dependency key instead of array identity to prevent OOM infinite re-render loop in tests"
  - "useTrends returns flat {data, loading, error} in addition to results map to satisfy test expectations"
metrics:
  duration: ~20m
  completed: 2026-04-13
  tasks_completed: 2
  files_changed: 7
---

# Phase 03 Plan 03: Data-Fetching Hooks + Dependencies Summary

**One-liner:** Installed recharts and shadcn select/toggle-group, extended api.ts with four new interfaces, and implemented useRequestLog and useTrends hooks with AbortController cleanup and stable array-key dependency pattern.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Install recharts + shadcn components, extend api.ts types | b1b1266e | dashboard/package.json, dashboard/src/types/api.ts, dashboard/src/components/ui/select.tsx, toggle.tsx, toggle-group.tsx |
| 2 | Implement useRequestLog and useTrends hooks | 41412495 | dashboard/src/hooks/useRequestLog.ts, dashboard/src/hooks/useTrends.ts |

## What Was Built

**Task 1 — Dependencies and types:**
- Installed recharts via npm
- Added shadcn select, toggle, toggle-group UI components
- Appended four new exported interfaces to api.ts: RequestLogRow, RequestLogResponse, TrendPoint, TrendResponse

**Task 2 — Data-fetching hooks:**
- `useRequestLog({ window, limit, offset, model?, sidecarUrl? })` — fetches /api/requests, AbortController aborts on param change, returns `{ data, loading, error }`
- `useTrends({ models, window?, sidecarUrl? })` — fetches /api/trends per model, stable modelsKey via `join(',')` prevents infinite effect loop, returns `{ data, loading, error, results }`

## Verification

All 6 hook tests GREEN:
- `useRequestLog.test.tsx` — 3/3 passed
- `useTrends.test.tsx` — 3/3 passed

TypeScript: `npx tsc --noEmit` reports only a pre-existing tsconfig baseUrl deprecation warning (TS6.0), no errors in hooks or types files.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Hook signatures mismatched test stubs**
- **Found during:** Task 2 — reading existing test files before implementation
- **Issue:** Plan specified `useRequestLog(sidecarUrl, model, page)` and `useTrends(sidecarUrl, models, window)` positional signatures, but the pre-written test stubs from 03-01 use params-object signatures: `useRequestLog({ window, limit, offset })` and `useTrends({ models, window })`
- **Fix:** Implemented params-object signatures matching the tests. sidecarUrl is an optional field in the params object with default `''`.
- **Files modified:** dashboard/src/hooks/useRequestLog.ts, dashboard/src/hooks/useTrends.ts
- **Commit:** 41412495

**2. [Rule 1 - Bug] useTrends infinite re-render OOM crash in tests**
- **Found during:** Task 2 verification — vitest worker OOM crash
- **Issue:** Effect dependency on `models` array caused infinite re-renders when tests pass inline `['gpt-4o']` literal (new array identity each render). Worker process exhausted memory and crashed.
- **Fix:** Replaced `models` array in effect deps with `modelsKey = models.join(',')` — a stable string that changes only when model set actually changes. Effect re-parses the list with `modelsKey.split(',')`.
- **Files modified:** dashboard/src/hooks/useTrends.ts
- **Commit:** 41412495

**3. [Rule 2 - Missing shape] useTrends needed flat data/loading/error output**
- **Found during:** Task 2 — reading test assertions
- **Issue:** Tests assert `result.current.data`, `result.current.loading`, `result.current.error` at top level, not `result.current.results['gpt-4o'].data`. Plan only specified `{ results }` map.
- **Fix:** Hook returns both `results` map and convenience `{ data, loading, error }` reflecting the first model's entry (single-model case used by tests and typical consumers).
- **Files modified:** dashboard/src/hooks/useTrends.ts
- **Commit:** 41412495

## Known Stubs

None — both hooks fetch real endpoints. No hardcoded data.

## Threat Flags

No new threat surface beyond what is documented in the plan's threat model. T-03-03-01 mitigated via URLSearchParams.set() percent-encoding. T-03-03-02 mitigated via encodeURIComponent(model).

## Self-Check: PASSED

- dashboard/src/hooks/useRequestLog.ts — FOUND
- dashboard/src/hooks/useTrends.ts — FOUND
- dashboard/src/types/api.ts — FOUND (contains RequestLogRow, RequestLogResponse, TrendPoint, TrendResponse)
- dashboard/src/components/ui/select.tsx — FOUND
- dashboard/src/components/ui/toggle-group.tsx — FOUND
- Commit b1b1266e — FOUND
- Commit 41412495 — FOUND
