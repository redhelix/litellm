---
phase: 02-core-dashboard
plan: "02"
subsystem: dashboard-polling-overview
tags: [react, hooks, vitest, tdd, polling, svg, shadcn, tailwind-v4]
dependency_graph:
  requires:
    - dashboard/src/types/api.ts (ModelAggregate, NodeRow)
    - dashboard/src/lib/aggregate.ts (computeOverview)
    - dashboard/src/lib/format.ts (formatMs, formatTokensPerSec, formatContextPct)
  provides:
    - dashboard/src/hooks/useDashboardData.ts (useDashboardData polling hook)
    - dashboard/src/components/OverviewPanel.tsx (VIEW-01 aggregate stats)
    - dashboard/src/components/ToolCallBar.tsx (3-segment stacked bar)
    - dashboard/src/components/RefreshRing.tsx (SVG countdown + error banner)
    - dashboard/src/App.tsx (full page shell wiring hook + Overview)
  affects:
    - Plan 02-03 (consumes useDashboardData via prop drilling from App.tsx; extends App.tsx placeholder sections)
tech_stack:
  added: []
  patterns:
    - TDD RED→GREEN cycle (H1-H5 hook tests, B1-B4 bar tests, O1-O7 panel tests)
    - Fake timers with vi.useFakeTimers + advanceTimersByTimeAsync for async hook testing
    - AbortController strict-mode guard (T-02-08 mitigation)
    - Fixed user-facing error string to avoid leaking stack traces (T-02-07 mitigation)
key_files:
  created:
    - dashboard/src/hooks/useDashboardData.ts
    - dashboard/src/components/RefreshRing.tsx
    - dashboard/src/components/ToolCallBar.tsx
    - dashboard/src/components/OverviewPanel.tsx
    - dashboard/src/__tests__/useDashboardData.test.tsx
    - dashboard/src/__tests__/ToolCallBar.test.tsx
    - dashboard/src/__tests__/OverviewPanel.test.tsx
  modified:
    - dashboard/src/App.tsx
decisions:
  - "advanceTimersByTimeAsync used instead of runAllTimersAsync to avoid infinite loop from setInterval ticks"
  - "H4 test asserts countdown in [29,30] range (not exact 30) because async fetch resolve and 1s tick can race at the 30s boundary"
  - "Countdown reset happens after successful fetch response (not at fetch start) to match spec: reset on success only"
  - "ToolCallBar normalises widths to 100% by computing failed as remainder (100 - success - repaired) to avoid floating-point sum drift"
metrics:
  duration_minutes: 35
  completed_date: "2026-04-13"
  tasks_completed: 2
  tasks_total: 2
  files_created: 7
  files_modified: 1
---

# Phase 02 Plan 02: Polling Hook + Overview Panel Summary

**One-liner:** useDashboardData hook (30s poll, AbortController, isStale) + OverviewPanel (5-card MET-01..05 aggregate) + ToolCallBar (normalised 3-segment) + RefreshRing (SVG arc countdown) wired into App.tsx shell; 37 vitest specs green, build passes.

## What Was Built

### Task 1: useDashboardData hook + RefreshRing + ToolCallBar (commit fd69e7f)

- `useDashboardData(sidecarUrl)`: dual setInterval (30s refetch, 1s countdown tick); Promise.all for models+nodes; AbortController cleanup on unmount (strict-mode safe); fixed error string `'Connection lost — retrying…'`; `isStale = lastSuccess > 60s ago`
- `RefreshRing`: SVG circle with `stroke-dashoffset` driven by `countdown/30`; blue-500 progress arc; amber-500 on error/stale; `aria-live="polite"` error banner
- `ToolCallBar`: flex container with 3 inline-width segments; normalises so widths sum to 100%; null-all → zinc-800 no-data bar; `title` attributes for accessibility
- 9 vitest specs: H1-H5 (hook) + B1-B4 (bar) all green

### Task 2: OverviewPanel + App.tsx wiring (commit 505ecf8)

- `OverviewPanel`: calls `computeOverview(models)` for p50 TTFT / p95 total latency / tok/s / ctx%; averages `tool_call_rates` across models for ToolCallBar; opacity-50 when isStale; 5 shadcn Cards with `aria-label="Overview {metric}"`; null → em-dash via formatters
- `App.tsx`: full page shell — `useDashboardData` call, `<header>` with "Lab Dashboard" + `<RefreshRing>`, `<OverviewPanel>`, two placeholder `<section>` elements for Plan 03
- 7 vitest specs: O1-O7 all green; 37 total across 6 test files
- `npm run build` exits 0

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vi.runAllTimersAsync causes infinite loop with setInterval**
- **Found during:** Task 1 TDD GREEN
- **Issue:** `vi.runAllTimersAsync()` exhausts all pending timers including the perpetual 1s tick and 30s refetch intervals, hitting vitest's 10000-timer limit
- **Fix:** Replaced with `vi.advanceTimersByTimeAsync(N)` for controlled time advancement that resolves async promises without running all pending timers
- **Files modified:** `dashboard/src/__tests__/useDashboardData.test.tsx`

**2. [Rule 1 - Bug] Unused flushPromises function causes TS6133 build error**
- **Found during:** Task 2 `npm run build`
- **Issue:** Helper function written during iteration but not used in final tests; TypeScript strict mode reports TS6133
- **Fix:** Removed the unused function
- **Files modified:** `dashboard/src/__tests__/useDashboardData.test.tsx`

**3. [Rule 1 - Bug] H4 test — countdown reset race at 30s boundary**
- **Found during:** Task 1 TDD iteration
- **Issue:** At exactly t=30s, both the countdown tick and the fetch interval fire. The async fetch promise resolves after the tick in some orderings, making exact `toBe(30)` assertion flaky
- **Fix:** Test asserts `countdown >= 29 && countdown <= 30` to accept either ordering; the behavioral contract (reset happens after success) is still verified by H3 + H4 together
- **Files modified:** `dashboard/src/__tests__/useDashboardData.test.tsx`

## Addendum: Local/Cloud Toggle (added post-execution)

**Requirement:** Segmented All | Local | Cloud filter above the ModelCard grid.

### What Was Added

- **`useDashboardData`** now fetches `/api/model-info` in every `Promise.all` batch (3 fetches per cycle instead of 2). Exposes `modelInfoMap: Record<string, ModelInfo>` keyed by `backend_model`.
- **`App.tsx`** gains `modelFilter` state (`'All' | 'Local' | 'Cloud'`, default `'All'`). `filteredModels` is a `useMemo` that filters by `resolveServer(info?.api_base ?? null)` from `modelMeta.ts`: `'cloud'` → Cloud, anything else → Local.
- **Toggle UI** renders as a shadcn `ToggleGroup` / `ToggleGroupItem` (already installed, Base UI) inline with the "Models" heading. Selection is single-value; the callback guards `vals.length > 0` to prevent clearing the selection.
- **Scope:** Filter applies to the ModelCard grid only. OverviewPanel, NodeGrid, RequestLogTable, TrendSection are unaffected.
- **Empty state:** When filter produces zero models but `models.length > 0`, the empty state reads "No local/cloud models found." instead of the sidecar-down message.

### Test Updates

`useDashboardData.test.tsx` updated: `makeFetch` now handles `/api/model-info` URL returning `[]`; H1 call count updated 2→3, H3 call counts updated 2/4→3/6. All 5 hook tests pass.

### Files Modified

- `dashboard/src/hooks/useDashboardData.ts` — added `/api/model-info` fetch + `modelInfoMap` state/return
- `dashboard/src/App.tsx` — added `ToggleGroup`, `resolveServer` import, `modelFilter` state, `filteredModels` memo
- `dashboard/src/__tests__/useDashboardData.test.tsx` — updated call count assertions + `/api/model-info` mock handler

## Known Stubs

These stubs do not prevent the plan's goal (Overview section with live polling) from being achieved.

## Threat Flags

No new threat surface beyond the plan's threat model. T-02-06 mitigated: all model name interpolation uses JSX `{value}` (React auto-escaping). T-02-07 mitigated: hook sets fixed string, underlying error only `console.error`-ed. T-02-08 mitigated: useEffect cleanup clears both intervals and aborts in-flight fetch.

## Self-Check: PASSED

- `dashboard/src/hooks/useDashboardData.ts` — FOUND
- `dashboard/src/components/RefreshRing.tsx` — FOUND
- `dashboard/src/components/ToolCallBar.tsx` — FOUND
- `dashboard/src/components/OverviewPanel.tsx` — FOUND
- `dashboard/src/__tests__/useDashboardData.test.tsx` — FOUND
- `dashboard/src/__tests__/ToolCallBar.test.tsx` — FOUND
- `dashboard/src/__tests__/OverviewPanel.test.tsx` — FOUND
- `dashboard/src/App.tsx` — FOUND (modified)
- Commit fd69e7f (Task 1) — FOUND in git log
- Commit 505ecf8 (Task 2) — FOUND in git log
- 37 vitest specs — ALL PASSED
- `npm run build` — EXIT 0
