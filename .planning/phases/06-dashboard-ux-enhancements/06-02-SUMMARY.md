---
phase: 06-dashboard-ux-enhancements
plan: "02"
subsystem: dashboard-frontend
status: ready-for-human-verify
tags: [frontend, react, vitest, ux, tooltips, sorting, filtering]
dependency_graph:
  requires: [06-01]
  provides: [error-row-ui, sort-filter-ui, metric-tooltips]
  affects: [dashboard]
tech_stack:
  added: []
  patterns:
    - Radix Tooltip with userEvent.hover() for testable tooltip content
    - Functional useState updater for sort direction flip
    - snake_case URLSearchParams forwarded from camelCase React state
key_files:
  modified:
    - dashboard/src/types/api.ts
    - dashboard/src/hooks/useRequestLog.ts
    - dashboard/src/components/RequestLogTable.tsx
    - dashboard/src/components/OverviewPanel.tsx
    - dashboard/src/components/ModelCard.tsx
    - dashboard/src/__tests__/useRequestLog.test.tsx
    - dashboard/src/__tests__/RequestLogTable.test.tsx
    - dashboard/src/__tests__/OverviewPanel.test.tsx
    - dashboard/src/__tests__/ModelCard.test.tsx
decisions:
  - "aria-label on TooltipTrigger (not TooltipContent) used for error_message accessibility — Radix portal doesn't render content without hover in jsdom"
  - "userEvent.hover() + findByText used for tooltip content tests — Radix renders TooltipContent conditionally in portal"
  - "O5/M2 tests updated to accept '?' as valid null representation alongside '—' — ctx% now shows '?' when null"
  - "SortableHeader defined as inner function component in RequestLogTable — re-queried after render to avoid stale ref on second click"
metrics:
  duration_minutes: 68
  completed_date: "2026-04-14"
  tasks_completed: 3
  tasks_total: 4
  files_modified: 9
  tests_added: 18
  tests_total: 93
---

# Phase 6 Plan 02: Frontend UX Enhancements Summary

**One-liner:** React dashboard wired to Phase 6 backend — error rows red with aria-accessible error text, TTFT/Latency/Time sort toggle with arrow indicator, status dropdown filter, ctx '?' Tooltip for unknown aliases, and D-04 explanatory metric tooltips in OverviewPanel + ModelCard.

## Status: Ready for Human Verify

Tasks 1–3 complete and committed. Task 4 is a `checkpoint:human-verify` — awaiting deployment and visual verification on docker-001.

## Tooltip Copy Shipped (Verbatim)

| Location | Label | Tooltip Text |
|---|---|---|
| OverviewPanel | p50 TTFT | "p50 TTFT — 50th percentile (median) time to first token; latency before streaming begins for a typical request." |
| OverviewPanel | p95 total latency | "p95 total latency — 95th percentile end-to-end response time; worst-case for 1 in 20 requests." |
| OverviewPanel | Tokens/sec | "Throughput — tokens generated per second, averaged across models." |
| OverviewPanel | Context % | "Fraction of the model's context window used by this request's prompt." |
| OverviewPanel | Context % (null) | "Context window size unknown for this model alias" |
| ModelCard | p50 TTFT | "p50 TTFT — 50th percentile time to first token; latency before streaming begins." |
| ModelCard | p95 TTFT | "p95 TTFT — 95th percentile time to first token; worst-case for 1 in 20 requests." |
| ModelCard | p50 latency | "p50 total latency — 50th percentile end-to-end response time (median request)." |
| ModelCard | p95 latency | "p95 total latency — 95th percentile end-to-end response time; worst-case for 1 in 20." |
| ModelCard | tok/s | "Tokens per second — generation throughput for this model." |
| ModelCard | ctx % | "Context utilization — fraction of this model's context window used by the prompt." |
| ModelCard | ctx % (null) | "Context window size unknown for this model alias" |
| RequestLogTable | ctx cell (null) | "Context window size unknown for this model alias" |
| RequestLogTable | model cell (error row) | `row.error_message` text (e.g. "timeout", "rate_limit") |

## Commits

| Task | Commit | Description |
|---|---|---|
| 1 | `2403756` | `feat(06-02): add error_message to RequestLogRow, sort/filter params to useRequestLog` |
| 2 | `808d6e2` | `feat(06-02): RequestLogTable error rows, sort headers, status filter, ctx '?' tooltip` |
| 3 | `bf23b94` | `feat(06-02): explanatory metric tooltips in OverviewPanel + ModelCard, ctx '?' fallback` |

## Test Results

- **Before:** 75 baseline vitest tests
- **After:** 93 tests (18 new assertions)
- **TypeScript:** `npx tsc -b` exits 0

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `handleModelChange` type signature mismatch**
- **Found during:** Task 2 (TypeScript check)
- **Issue:** Ark/Radix Select `onValueChange` passes `string | null`, but handler was typed `string`
- **Fix:** Updated both `handleModelChange` and `handleStatusChange` to accept `string | null`
- **Files modified:** `dashboard/src/components/RequestLogTable.tsx`
- **Commit:** `bf23b94` (bundled with Task 3 TS fixes)

**2. [Rule 1 - Bug] `asChild` prop not on TooltipTrigger type**
- **Found during:** Task 3 (TypeScript check)
- **Issue:** `TooltipTrigger` component doesn't accept `asChild` in this shadcn version
- **Fix:** Removed `asChild` — wrapping `<p>` inside trigger directly works fine
- **Files modified:** `dashboard/src/components/OverviewPanel.tsx`
- **Commit:** `bf23b94`

**3. [Rule 2 - Accessibility] Added `aria-label` to error row TooltipTrigger**
- **Found during:** Task 2 (T2 test — tooltip content not in jsdom without hover)
- **Issue:** Radix `TooltipContent` only renders in portal after hover; jsdom can't test it without interaction. Plan said error text "must be reachable without opening devtools."
- **Fix:** Added `aria-label={row.error_message}` to the `TooltipTrigger` wrapping the model cell — error text now accessible to screen readers and testable via `getByLabelText`
- **Files modified:** `dashboard/src/components/RequestLogTable.tsx`
- **Commit:** `808d6e2`

**4. [Rule 1 - Test] O5/M2 tests updated for '?' null representation**
- **Found during:** Task 3
- **Issue:** O5 expected ≥4 em-dashes; M2 expected ≥6 em-dashes. ctx% now renders '?' when null, reducing em-dash count.
- **Fix:** Tests updated to count either '—' or '?' as valid null representations
- **Files modified:** `dashboard/src/__tests__/OverviewPanel.test.tsx`, `dashboard/src/__tests__/ModelCard.test.tsx`
- **Commit:** `bf23b94`

**5. [Rule 1 - Test] SortableHeader stale ref on second click (T4)**
- **Found during:** Task 2 (T4 test timing out)
- **Issue:** Button reference captured before first click became stale after re-render; second `fireEvent.click(ttftBtn)` was clicking the old element
- **Fix:** Re-query via `screen.getByRole('button', { name: /sort by ttft/i })` inside each `act()` call
- **Files modified:** `dashboard/src/__tests__/RequestLogTable.test.tsx`
- **Commit:** `808d6e2`

## Human Verification Script (Task 4 — 9 Steps)

Deploy to docker-001 first:
```
docker compose up -d --build dashboard-sidecar dashboard
```

Then verify:

1. **Deploy** the updated sidecar + dashboard to docker-001 (`docker compose up -d --build dashboard-sidecar dashboard`).
2. **Open** `http://docker-001:PORT` in a browser (per Phase 5 Traefik route).
3. **OverviewPanel tooltips:** hover each metric label (p50 TTFT, p95 total latency, Tokens/sec, Context %). Confirm explanatory tooltips appear (NOT just echoed numbers).
4. **ModelCard tooltips:** hover p50 TTFT, p95 TTFT, p50 latency, p95 latency, tok/s, ctx in any ModelCard. Confirm explanatory text.
5. **ModelCard ctx%:** confirm ctx% shows a percent (not null) for known aliases (spark-learner, gemma-4-31b, nemotron-cascade-2, etc.). For aliases still unknown, confirm '?' with "Context window size unknown" tooltip.
6. **Sort headers:** Click 'TTFT' header — rows re-sort (arrow indicator appears, asc/desc toggles on second click). Repeat for 'Latency' and 'Time' headers.
7. **Status filter:** Use the status dropdown — select 'failed'. Only failed rows remain. Any failed row should be tinted red; hover the model cell — the `error_message` (e.g., "timeout", "rate_limit") should appear in a tooltip.
8. **ctx '?' in table:** Clear status filter; hover any row with null ctx% — confirm '?' with unknown-tooltip.
9. **Network tab:** Confirm `/api/requests` calls carry `sort_by`, `sort_dir`, `status_filter` as snake_case query params.

## Known Stubs

None — all data paths are wired to live API.

## Ctx% Aliases Still Showing '?'

Unknown until human-verify step 5. Any aliases not in `MODEL_CTX_MAP` (from Plan 01) will show '?'. These should be recorded here after verification for Phase 7 follow-up.

## Self-Check: PASSED

- [x] `dashboard/src/types/api.ts` — exists, contains `error_message`
- [x] `dashboard/src/hooks/useRequestLog.ts` — exists, contains `sort_by`
- [x] `dashboard/src/components/RequestLogTable.tsx` — exists, contains `sort_by`
- [x] `dashboard/src/components/OverviewPanel.tsx` — exists, contains `Tooltip`
- [x] `dashboard/src/components/ModelCard.tsx` — exists, contains `95th percentile`
- [x] Commit `2403756` — verified in git log
- [x] Commit `808d6e2` — verified in git log
- [x] Commit `bf23b94` — verified in git log
- [x] 93 tests pass, 0 failures
- [x] `npx tsc -b` exits 0
