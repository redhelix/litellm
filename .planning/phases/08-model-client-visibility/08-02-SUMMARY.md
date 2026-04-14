---
phase: 08-model-client-visibility
plan: "02"
subsystem: dashboard (frontend)
tags: [frontend, react, typescript, hooks, modelMeta, collapsible, connectivity]
dependency_graph:
  requires:
    - 08-01 (sidecar endpoints: /api/clients, /api/model-info, /api/model-health)
  provides:
    - api_key_alias + requester_ip_address columns in RequestLogTable
    - useModelHealth polling hook
    - useClients fetch hook
    - modelMeta.ts pure utility (extractSize, isHfPath, hfUrl, resolveServer, resolveRuntime, resolveUrlPort)
    - OverviewPanel collapsible sections + Top Clients section
    - ModelCard enrichment (connectivity ball, backend model, HF link, server, runtime, URL:port, size)
  affects:
    - dashboard/src/types/api.ts
    - dashboard/src/hooks/useModelHealth.ts
    - dashboard/src/hooks/useClients.ts
    - dashboard/src/utils/modelMeta.ts
    - dashboard/src/components/RequestLogTable.tsx
    - dashboard/src/components/OverviewPanel.tsx
    - dashboard/src/components/ModelCard.tsx
    - dashboard/src/App.tsx
    - dashboard/src/hooks/useDashboardData.ts
tech_stack:
  added: []
  patterns:
    - setInterval polling hook with mountedRef cleanup
    - AbortController one-shot fetch hook
    - CollapsibleSection local component with chevron rotate
    - Pure utility module with static maps (no side effects)
    - Conditional meta row rendering to avoid spurious test failures
key_files:
  created:
    - dashboard/src/hooks/useModelHealth.ts
    - dashboard/src/hooks/useClients.ts
    - dashboard/src/utils/modelMeta.ts
    - dashboard/src/utils/modelMeta.test.ts
  modified:
    - dashboard/src/types/api.ts
    - dashboard/src/components/RequestLogTable.tsx
    - dashboard/src/components/OverviewPanel.tsx
    - dashboard/src/components/ModelCard.tsx
    - dashboard/src/App.tsx
    - dashboard/src/hooks/useDashboardData.ts
decisions:
  - "ModelCard meta row gated on modelInfo presence to avoid rendering ? size when no backend data"
  - "useDashboardData modelInfoMap keying fixed to use alias keys (Record<alias,ModelInfo>) not backend_model"
  - "OverviewPanel CollapsibleSection is a local inner component, not a separate file"
  - "useModelHealth uses setInterval not AbortController — polling semantics differ from one-shot fetch"
metrics:
  duration: ~35 min
  completed: "2026-04-14"
  tasks_completed: 3
  files_changed: 10
---

# Phase 8 Plan 02: Model & Client Visibility — Frontend Summary

One-liner: React hooks + modelMeta utility + collapsible OverviewPanel + enriched ModelCard with live connectivity ball, wiring all Phase 8 sidecar endpoints into the dashboard UI.

## What Was Built

### Task 1: api.ts types + modelMeta.ts utility + tests

- `types/api.ts`: Added `api_key_alias: string | null` and `requester_ip_address: string | null` to `RequestLogRow`. Added `ClientRow`, `ModelInfo`, `ModelHealth` export types.
- `utils/modelMeta.ts`: New pure utility with six exported functions — `extractSize` (regex on model slug), `isHfPath` (strip provider prefix, check for remaining `/`), `hfUrl` (construct HF link), `resolveServer` (static IP/hostname → friendly name map), `resolveRuntime` (provider + api_base → runtime label), `resolveUrlPort` (host:port for local, null for cloud).
- `utils/modelMeta.test.ts`: 23 vitest tests covering all functions and edge cases — all passing.

### Task 2: useModelHealth + useClients hooks + RequestLogTable Key/IP columns

- `hooks/useModelHealth.ts`: Polls `/api/model-health` every 30 s using `setInterval` with `mountedRef` cleanup. Returns `{ health, loading, error }`.
- `hooks/useClients.ts`: One-shot fetch of `/api/clients?window=24h` following the `AbortController` pattern from `useRequestLog`. Returns `{ data, loading, error }`.
- `components/RequestLogTable.tsx`: Added `Key` and `IP` column headers after Model. Added corresponding `TableCell` rows showing `api_key_alias ?? '—'` and `requester_ip_address ?? '—'`.

### Task 3: OverviewPanel collapsible sections + Top Clients; ModelCard enrichment

- `components/OverviewPanel.tsx`: Full rewrite preserving all existing metrics logic. Added local `CollapsibleSection` component with chevron SVG (rotates -90° when collapsed, default expanded). Existing metrics wrapped in "Metrics" section, tool calls in "Tool Calls" section. New "Top Clients" section at bottom using `useClients`. Added `sidecarUrl?: string` prop.
- `components/ModelCard.tsx`: Added `modelInfo?: ModelInfo` and `healthStatus?: 'up' | 'down' | 'unknown'` props. When `modelInfo` is present, renders: backend model text (with HF link if `isHfPath`), connectivity ball (green/red/grey), server name, runtime, URL:port (local only), model size. Meta row is fully suppressed when `modelInfo` is absent to avoid test conflicts.
- `App.tsx`: Added `useModelHealth` call, passes `health[model.model]` and `modelInfoMap[model.model]` to each `ModelCard`. Passes `sidecarUrl` to `OverviewPanel`.
- `hooks/useDashboardData.ts`: Fixed `modelInfoMap` key assignment — `/api/model-info` returns `Record<alias, ModelInfo>` directly; old code incorrectly iterated as array and keyed by `backend_model`.

## Test Results

```
Test Files  15 passed (15)
Tests  116 passed (116)
```

All tests pass including the 23 new modelMeta unit tests. No regressions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed modelInfoMap keying in useDashboardData**
- **Found during:** Task 3 — reviewing useDashboardData before threading props
- **Issue:** Existing code treated `/api/model-info` response as an array and keyed the map by `backend_model`. The sidecar returns `Record<alias, ModelInfo>`, so the map was always empty and modelInfo would never reach ModelCard.
- **Fix:** Replaced array iteration with direct object assignment: `modelInfoMap = modelInfoData as Record<string, ModelInfo>`
- **Files modified:** `dashboard/src/hooks/useDashboardData.ts`
- **Commit:** 74a0e96

**2. [Rule 1 - Bug] Gated ModelCard meta row on modelInfo presence**
- **Found during:** Task 3 vitest run — test M8 failed because `screen.getByText('?')` found two matches (size `?` from missing modelInfo + ctx `?` from null context)
- **Issue:** Meta row always rendered even without modelInfo, showing `?` for size unconditionally
- **Fix:** Wrapped entire meta row in `{modelInfo && (...)}`
- **Files modified:** `dashboard/src/components/ModelCard.tsx`
- **Commit:** 74a0e96

## Known Stubs

None — all new UI sections wire to live sidecar endpoints. ModelCard gracefully degrades (no meta row) when `modelInfo` is absent rather than showing placeholder data.

## Threat Flags

No new threat surface beyond what is documented in the plan's threat model.

- T-08-07 mitigated: `hfUrl()` only appends to hardcoded `https://huggingface.co/` base; link rendered with `rel="noopener noreferrer"`.
- T-08-08 accepted: `useModelHealth` polls internal sidecar only at 30 s; `clearInterval` cleanup on unmount prevents accumulation.

## Self-Check: PASSED
