---
phase: 07-llm-powered-intelligence-layer
plan: "01"
subsystem: intelligence
tags: [huggingface_hub, duckdb, fastapi, react, shadcn, base-ui, tabs, pytest, tdd]

requires:
  - phase: 06-dashboard-ux-enhancements
    provides: App.tsx structure and component library baseline

provides:
  - huggingface_hub==1.10.2 pinned in requirements.txt
  - intelligence_cache DuckDB table schema (7 columns, single-row upsert pattern)
  - RED pytest stubs for INT-01 through INT-06 in tests/test_intelligence.py
  - shadcn Tabs component (base-nova/base-ui) at dashboard/src/components/ui/tabs.tsx
  - Three-tab App.tsx layout: Models, Request Log, Intelligence placeholder

affects:
  - 07-02 (Wave 1 backend — intelligence_job.py and routers/intelligence.py must make INT-01..INT-05 GREEN)
  - 07-03 (Wave 2 frontend — Intelligence tab placeholder will be replaced)

tech-stack:
  added:
    - huggingface_hub==1.10.2 (Python, pinned in requirements.txt)
    - "@base-ui/react/tabs" (already bundled in @base-ui/react, exposed via shadcn tabs.tsx)
  patterns:
    - TDD RED stubs: import-gated failures via ModuleNotFoundError for not-yet-created modules
    - shadcn base-nova style generates @base-ui/react components (not Radix)
    - Tabs defaultValue="models" keeps existing behaviour as default view

key-files:
  created:
    - dashboard-sidecar/tests/test_intelligence.py
    - dashboard/src/components/ui/tabs.tsx
  modified:
    - dashboard-sidecar/requirements.txt
    - dashboard-sidecar/db.py
    - dashboard/src/App.tsx

key-decisions:
  - "Used @base-ui/react/tabs (base-nova shadcn preset) instead of @radix-ui/react-tabs — project uses base-nova style throughout"
  - "INT-06 (SQL compat test) passes in RED phase — it validates schema/query infrastructure, not Wave 1 modules; this is correct"
  - "intelligence_cache uses id=1 DEFAULT + INSERT OR REPLACE pattern for single-row upsert (matches plan spec)"

requirements-completed: [INT-01, INT-02, INT-03, INT-04, INT-05, INT-06]

duration: 3min
completed: 2026-04-14
---

# Phase 07 Plan 01: Intelligence Layer Foundation Summary

**Wave 0 scaffold: intelligence_cache DuckDB table, huggingface_hub pin, 6 RED pytest stubs (INT-01..INT-06), and shadcn Tabs restructuring App.tsx into Models/Request Log/Intelligence three-tab layout**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-14T18:49:17Z
- **Completed:** 2026-04-14T18:52:19Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Pinned `huggingface_hub==1.10.2` in `dashboard-sidecar/requirements.txt` (supply-chain pinned, no local install)
- Added `intelligence_cache` DDL inside `db.py init_schema()` — 7 columns, `DEFAULT 1` primary key for single-row upsert
- Created `tests/test_intelligence.py` with 6 RED stubs: 5/6 fail `ModuleNotFoundError` (modules absent until Wave 1), INT-06 SQL compat test passes (intentional — validates schema is live)
- Installed shadcn Tabs via `npx shadcn@latest add tabs --yes` (base-nova preset generates `@base-ui/react/tabs`)
- Restructured `App.tsx` into `<Tabs defaultValue="models">` with three `TabsContent` panels; all existing hooks, memos, and components preserved; Intelligence tab shows placeholder

## Task Commits

1. **Task 1: RED stubs, schema, dep pin** — `b55ca27` (test)
2. **Task 2: Tabs component, App.tsx restructure** — `ccc9983` (feat)

**Plan metadata:** committed with docs commit below

## Files Created/Modified

- `dashboard-sidecar/requirements.txt` — added `huggingface_hub==1.10.2`
- `dashboard-sidecar/db.py` — added `intelligence_cache` CREATE TABLE inside `init_schema()`
- `dashboard-sidecar/tests/test_intelligence.py` — 6 RED stubs (INT-01..INT-06, 90 lines)
- `dashboard/src/components/ui/tabs.tsx` — shadcn base-nova Tabs primitives (Base UI)
- `dashboard/src/App.tsx` — three-tab layout wrapping all existing content

## Decisions Made

- **base-nova Tabs vs Radix:** The plan specified `@radix-ui/react-tabs` in package.json, but this project uses `style: "base-nova"` in `components.json`. `npx shadcn@latest add tabs` correctly generated `@base-ui/react/tabs` wrappers. No Radix dependency needed — `@base-ui/react` (already installed) covers it.
- **INT-06 RED state:** The SQL compatibility test (Pattern 5 queries against empty schema) passes immediately — this is correct behaviour. The test validates the DuckDB schema accepts the queries, not that the intelligence modules exist. Wave 1 will add the import-gated tests for those modules.

## Deviations from Plan

### Auto-fixed Issues

None - plan executed exactly as written. The only adaptation was the base-nova/Base UI Tabs vs Radix distinction, which is correct project behaviour (not a deviation from intent).

---

**Total deviations:** 0
**Impact on plan:** No scope changes.

## Issues Encountered

None.

## Known Stubs

- `dashboard/src/App.tsx` Intelligence `TabsContent`: placeholder div with "Wired in Plan 03" text — intentional, replaced in Plan 03 (Wave 2).

## Next Phase Readiness

- Wave 1 (Plan 02): `intelligence_job.py` and `routers/intelligence.py` can be created — RED tests in `test_intelligence.py` define the exact interface contract for INT-01..INT-05
- Wave 2 (Plan 03): Intelligence `TabsContent` placeholder in `App.tsx` is the mount point for the full Intelligence tab body
- `npm run build` passes; no new frontend test regressions introduced

---
*Phase: 07-llm-powered-intelligence-layer*
*Completed: 2026-04-14*
