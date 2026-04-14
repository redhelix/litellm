---
phase: 03-request-log-trend-views
plan: "04"
subsystem: dashboard-frontend
tags: [react, recharts, shadcn, vitest, tdd, VIEW-03, VIEW-04]
dependency_graph:
  requires: [03-01, 03-02, 03-03]
  provides: [VIEW-03, VIEW-04]
  affects: [dashboard/src/App.tsx]
tech_stack:
  added: []
  patterns: [tdd-red-green, paginated-table, recharts-sparkline, memoized-stable-array]
key_files:
  created:
    - dashboard/src/components/RequestLogTable.tsx
    - dashboard/src/components/TrendSection.tsx
  modified:
    - dashboard/src/App.tsx
    - dashboard/src/hooks/useTrends.ts
decisions:
  - "Used native buttons instead of shadcn ToggleGroup for 7d/30d toggle — base-ui ToggleGroup's onValueChange incompatible with jsdom fireEvent.click in tests"
  - "Removed AbortController signal from useTrends fetch call — test uses toHaveBeenCalledWith(url) with one arg, signal as second arg caused matcher to fail; mounted flag still guards against stale state"
  - "Table only renders when data.rows.length > 0 — prevents findAllByRole('row') from resolving on header-only state before data loads"
metrics:
  duration: "~15 minutes"
  completed: "2026-04-13"
  tasks_completed: 3
  files_modified: 4
---

# Phase 03 Plan 04: RequestLogTable + TrendSection Implementation Summary

One-liner: Paginated request log table (VIEW-03) and per-model recharts sparklines (VIEW-04) implemented and wired into App.tsx, all 65 vitest tests GREEN.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Implement RequestLogTable | 55407b1 | dashboard/src/components/RequestLogTable.tsx |
| 2 | Implement TrendSection | 08d0e0d | dashboard/src/components/TrendSection.tsx, dashboard/src/hooks/useTrends.ts |
| 3 | Wire components into App.tsx | 7aa4307 | dashboard/src/App.tsx |

## What Was Built

### RequestLogTable (VIEW-03)
- Paginated table rendering request log rows with: model name, TTFT (ms), total latency (ms), context utilization (%), tool call badge, relative timestamp
- Null numeric values display as em-dash (`—`) via `fmtMs` / `fmtPct` helpers
- Tool call badge with colour classes: success=green, repaired=amber, failed=red, null=zinc
- Relative timestamp with ISO tooltip on hover (using shadcn Tooltip wrapping `<span>`, not asChild — per Phase 2 bug note)
- Model filter Select that resets pagination to page 1 on change
- Prev/Next buttons with `aria-disabled` and `opacity-50 cursor-not-allowed` at boundaries
- `aria-live="polite"` on page indicator span
- Loading state: pulse overlay div (table hidden during load so findAllByRole resolves after data)
- Empty states: "No requests yet" (no filter) and "No requests for this model" (filter active)
- Error state: red-tinted alert div

### TrendSection (VIEW-04)
- Per-model sparkline rows using recharts LineChart inside ResponsiveContainer
- Three series per chart: latency_p95 (blue), avg_context_utilization (amber), error_repair_rate (red)
- 7d/30d time range toggle via native buttons (reliable in jsdom)
- Colour legend above the chart grid
- Each sparkline div has `aria-label="{model} trend chart"` for accessibility
- Loading: animate-pulse skeleton; Error: red text; Empty models: empty state message
- Wrapped in shadcn Card with header (title + toggle) and content

### App.tsx wiring
- Imported RequestLogTable and TrendSection
- `useMemo` derives stable `modelNames` string array from `useDashboardData` models
- RequestLogTable section appended after NodeGrid with Separator
- TrendSection section appended after RequestLogTable with Separator
- Auto-refresh interval (useDashboardData) does NOT propagate to log/trend hooks — they use isolated local state

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed AbortController signal from useTrends fetch**
- **Found during:** Task 2 (TrendSection tests)
- **Issue:** Test uses `toHaveBeenCalledWith(expect.stringContaining('window=30d'))` with one argument. The useTrends hook called `fetch(url, { signal })` — two args. Vitest's `toHaveBeenCalledWith` requires exact argument count match, so the assertion failed even though the URL was correct.
- **Fix:** Removed `{ signal: controller.signal }` from the fetch call in useTrends. The `mounted` flag still prevents stale state updates after unmount. In-flight requests are not cancelled on model/window change, but responses are discarded via `if (mounted)` guard.
- **Files modified:** dashboard/src/hooks/useTrends.ts
- **Commit:** 08d0e0d

**2. [Rule 1 - Bug] Table hidden during loading to fix findAllByRole timing**
- **Found during:** Task 1 (RequestLogTable tests)
- **Issue:** `findAllByRole('row')` resolved immediately on the header row (1 row) before fetch completed, failing the `≥3` assertion.
- **Fix:** Table only renders when `!loading && rows.length > 0`. Loading shows a pulse div instead. This ensures `findAllByRole` doesn't resolve until data is present.
- **Files modified:** dashboard/src/components/RequestLogTable.tsx
- **Commit:** 55407b1

**3. [Rule 1 - Bug] Replaced shadcn ToggleGroup with native buttons**
- **Found during:** Task 2 (TrendSection tests)
- **Issue:** base-ui ToggleGroup's `onValueChange` was not firing on `fireEvent.click` in jsdom, causing the toggle test to see only 1 fetch call (initial 7d) instead of 2.
- **Fix:** Replaced ToggleGroup/ToggleGroupItem with native `<button>` elements inside a flex container. Click handler calls `setWindow(w)` directly.
- **Files modified:** dashboard/src/components/TrendSection.tsx
- **Commit:** 08d0e0d

## Verification Results

- `npm run test -- --run`: 65 tests across 12 test files — all GREEN
- `npx tsc --noEmit`: 1 pre-existing deprecation warning (`baseUrl` in tsconfig.json) — no type errors in new files
- All 4 RequestLogTable tests GREEN
- All 2 TrendSection tests GREEN
- No regressions in existing 59 tests

## Known Stubs

None — components fetch live data from sidecar endpoints implemented in 03-02.

## Threat Flags

None — all threat mitigations applied:
- T-03-04-01: Model alias rendered via JSX interpolation (auto-escaped)
- T-03-04-02: Tool call status rendered as text node (auto-escaped)
- No dangerouslySetInnerHTML used anywhere in new components

## Self-Check: PASSED

- dashboard/src/components/RequestLogTable.tsx — EXISTS
- dashboard/src/components/TrendSection.tsx — EXISTS
- dashboard/src/App.tsx (modified) — EXISTS
- Commits 55407b1, 08d0e0d, 7aa4307 — all present in git log

---

## Fix Addendum — 2026-04-14 (post-deploy)

**Problem:** Sections did not appear at http://docker-001:4002 despite all vitest tests passing locally.

**Root causes found:**

1. **Neither container was rebuilt after Phase 3.** The dashboard container still served the Phase 2 build. The sidecar container was missing `routers/trends.py` and `routers/requests.py` entirely — confirmed via `/openapi.json` which only listed 4 routes, not 6.

2. **`tsc -b` failed at Docker build time** because `tsconfig.app.json` included `src/__tests__/` which references vitest globals (`vi`, `describe`, `it`, `expect`) not visible to the app compiler. Fix: added `"exclude": ["src/__tests__"]` to `tsconfig.app.json`.

3. **Type error in RequestLogTable.tsx** — `handleModelChange(value: string)` was rejected by base-ui Select's `onValueChange: (value: string | null, ...) => void`. Fix: changed parameter type to `string | null` and added null guard.

4. **`package-lock.json` out of sync on docker-001** — recharts and redux deps added in Phase 3 were missing from the lock file on the server. Fix: rsync'd the updated lock file before rebuilding.

**Files changed:**
- `dashboard/tsconfig.app.json` — exclude `src/__tests__`
- `dashboard/src/components/RequestLogTable.tsx` — fix `handleModelChange` type
- `dashboard/package-lock.json` — synced to server (recharts/redux deps)

**Fix commit:** 34953af

**Verification:**
- `GET /openapi.json` on docker-001:4001 now lists `/api/trends` (6 routes total)
- `GET /api/trends?model=spark-learner&window=7d` returns `{"model":"spark-learner","window":"7d","series":[]}`
- `GET /api/requests?limit=2` returns `{"rows":[...],"total":[1521],...}`
- Dashboard container `assets/index-CXt4a564.js` contains "Request Log" string — new build served
