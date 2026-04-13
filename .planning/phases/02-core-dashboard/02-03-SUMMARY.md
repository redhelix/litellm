---
phase: 02-core-dashboard
plan: "03"
subsystem: dashboard-model-node-surfaces
tags: [react, vitest, tdd, shadcn, tailwind-v4, nodegrid, modelcard, statusdot]
dependency_graph:
  requires:
    - dashboard/src/types/api.ts (ModelAggregate, NodeRow, AvailabilityStatus)
    - dashboard/src/lib/status.ts (deriveStatus)
    - dashboard/src/lib/format.ts (formatMs, formatTokensPerSec, formatContextPct, formatRelativeTime)
    - dashboard/src/components/ToolCallBar.tsx
    - dashboard/src/hooks/useDashboardData.ts
    - dashboard/src/components/OverviewPanel.tsx
  provides:
    - dashboard/src/components/StatusDot.tsx (8px aria-hidden status circle)
    - dashboard/src/components/NodeGrid.tsx (VIEW-02 per-node health table)
    - dashboard/src/components/ModelCard.tsx (MET-01..05 per-model card)
    - dashboard/src/App.tsx (final wiring — all 3 sections live)
  affects:
    - Plan 02-04 (dashboard feature-complete; only containerisation remains)
tech_stack:
  added: []
  patterns:
    - TDD RED→GREEN cycle (D1-D4 dot tests, N1-N7 grid tests, M1-M5 card tests)
    - Status colour mapping via record lookup (StatusDot + NodeGrid badge)
    - Responsive CSS grid (grid-cols-1 md:grid-cols-2 xl:grid-cols-3) for ModelCard layout
key_files:
  created:
    - dashboard/src/components/StatusDot.tsx
    - dashboard/src/components/NodeGrid.tsx
    - dashboard/src/components/ModelCard.tsx
    - dashboard/src/__tests__/NodeGrid.test.tsx
    - dashboard/src/__tests__/ModelCard.test.tsx
  modified:
    - dashboard/src/App.tsx
decisions:
  - "base-ui TooltipTrigger does not accept asChild prop (unlike radix-ui); removed asChild from NodeGrid and ModelCard tooltip triggers — wrapping span/div still works as trigger target"
  - "Badge variant overriding uses className prop with custom bg/text/border classes rather than adding new CVA variants (avoids modifying shadcn source)"
  - "NodeGrid empty-state uses border+rounded container div rather than table with colspan to avoid table structure warnings in jsdom"
metrics:
  duration_minutes: 25
  completed_date: "2026-04-13"
  tasks_completed: 2
  tasks_total: 2
  files_created: 5
  files_modified: 1
---

# Phase 02 Plan 03: ModelCard + NodeGrid + App.tsx Final Wiring Summary

**One-liner:** StatusDot + NodeGrid (VIEW-02 per-node health table with 90s stale override) + ModelCard (MET-01..05 metric grid + Progress + ToolCallBar) wired into App.tsx responsive layout; 53 vitest specs green, production build exits 0.

## What Was Built

### Task 1: StatusDot + NodeGrid (VIEW-02) with tests (commit 75980f0)

- `StatusDot.tsx`: 8px `aria-hidden="true"` inline-block span; colour driven by `AvailabilityStatus` record lookup (green/amber/red/zinc)
- `NodeGrid.tsx`: shadcn Table with 4 columns (Node, Status, Last scrape, Last request); iterates nodes calling `deriveStatus(node)` per row; Badge with custom colour classes per status; Tooltip on Last scrape showing raw ISO; `formatRelativeTime` for both time columns (returns "never" for null); empty-state with UI-SPEC copy; `opacity-50` when `isStale`
- 11 vitest specs all GREEN (D1-D4 dot, N1-N7 grid)

### Task 2: ModelCard + App.tsx final wiring (commits 89a0d61, 9b1404b)

- `ModelCard.tsx`: `Card` with `aria-label="Model {name}"`; 6-value grid (p50/p95 TTFT, p50/p95 latency, tok/s, ctx%) using `formatMs`/`formatTokensPerSec`/`formatContextPct`; null → em-dash via formatters; shadcn `Progress` for context utilization; `ToolCallBar` reused from Plan 02; Tooltip on each metric value; `opacity-50` when `isStale`
- `App.tsx`: final layout — Header → OverviewPanel → Separator → Models section (responsive `grid-cols-1 md:grid-cols-2 xl:grid-cols-3`) → Separator → NodeGrid; Models empty-state copy per UI-SPEC; `nodes` destructured and passed to NodeGrid (was `_nodes` placeholder in Plan 02)
- 5 ModelCard vitest specs GREEN; 53 total across 8 test files
- `npm run build` exits 0 (190 modules, 320 kB JS bundle)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] base-ui TooltipTrigger rejects `asChild` prop**
- **Found during:** Task 2 `npm run build` (TS2322 + React DOM warning)
- **Issue:** The shadcn Tooltip in this project uses `@base-ui/react/tooltip` (not Radix), which does not expose an `asChild` prop on its Trigger component. Passing it caused TS2322 type error and a React prop-leak warning in jsdom
- **Fix:** Removed `asChild` from `TooltipTrigger` in both `ModelCard.tsx` and `NodeGrid.tsx`. The inner `<div>`/`<span>` still acts as the visual trigger element
- **Files modified:** `dashboard/src/components/ModelCard.tsx`, `dashboard/src/components/NodeGrid.tsx`
- **Commit:** 9b1404b

**2. [Rule 1 - Bug] Unused `within` import causes TS6133 build error**
- **Found during:** Task 2 `npm run build`
- **Issue:** Test files imported `within` from `@testing-library/react` but never used it; TypeScript strict mode reports TS6133
- **Fix:** Removed unused import from both test files
- **Files modified:** `dashboard/src/__tests__/ModelCard.test.tsx`, `dashboard/src/__tests__/NodeGrid.test.tsx`
- **Commit:** 9b1404b

## Known Stubs

None. All three sections (Overview, Models, Nodes) are fully wired with live data from `useDashboardData`. No placeholder text remains in App.tsx.

## Threat Flags

No new threat surface beyond the plan's threat model.
- T-02-10 mitigated: model alias and deployment_state strings rendered only via JSX interpolation (React auto-escaping). No `dangerouslySetInnerHTML` used anywhere.
- T-02-11 mitigated: Tooltip content is hand-picked formatted strings (e.g., "p50 TTFT — 142ms"), not raw API object stringification.

## Self-Check: PASSED

- `dashboard/src/components/StatusDot.tsx` — FOUND
- `dashboard/src/components/NodeGrid.tsx` — FOUND
- `dashboard/src/components/ModelCard.tsx` — FOUND
- `dashboard/src/__tests__/NodeGrid.test.tsx` — FOUND
- `dashboard/src/__tests__/ModelCard.test.tsx` — FOUND
- `dashboard/src/App.tsx` — FOUND (modified)
- Commit 75980f0 (Task 1) — FOUND in git log
- Commit 89a0d61 (Task 2) — FOUND in git log
- Commit 9b1404b (fixes) — FOUND in git log
- 53 vitest specs — ALL PASSED
- `npm run build` — EXIT 0
