# Phase 04 Plan 03: Frontend Components Summary

**Status:** Complete
**Wave:** 2

## One-liner
ConfigDriftView and BenchmarkRunner React components with shadcn Alert/AlertDialog/Table, wired into App.tsx below TrendSection.

## What was done
- Extended `dashboard/src/types/api.ts` with 5 new types: DriftItem, ConfigDiffResponse, BenchmarkResult, BenchmarkRun, BenchmarkHistoryResponse
- Installed shadcn `alert` and `alert-dialog` components (base-ui backed)
- Created `ConfigDriftView.tsx` — fetches /api/config/diff, renders security Alert first (orange-500 styling), then MISMATCH/MISSING rows with tooltip value previews
- Created `BenchmarkRunner.tsx` — AlertDialog confirmation gate before run, results table (TTFT/Latency/tok/s/Status columns), 5-second polling during active run, history list (last 10 runs)
- Created `ConfigDriftView.test.tsx` and `BenchmarkRunner.test.tsx` (GREEN, 5 tests each)
- Wired both components into `App.tsx` below the TrendSection with divider rules

## Tests
- All 75 vitest tests: GREEN (14 test files)
- ConfigDriftView: 5 tests passing (DRIFT-01..04)
- BenchmarkRunner: 5 tests passing (BENCH-01..03)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Duplicate text caused findByText failures**
- **Found during:** Test run after implementation
- **Issue:** ConfigDriftView rendered "No differences detected" in both header span and body paragraph; BenchmarkRunner rendered "No benchmark history" in both empty-state and history section
- **Fix:** Removed redundant header span for zero-count case in ConfigDriftView; renamed empty-state paragraph to "No results yet" in BenchmarkRunner
- **Files modified:** ConfigDriftView.tsx, BenchmarkRunner.tsx

**2. [Rule 1 - Bug] `asChild` not supported on base-ui TooltipTrigger/AlertDialogTrigger**
- **Found during:** TypeScript check (tsc -b)
- **Issue:** shadcn components use `@base-ui/react` which uses `render` prop pattern, not Radix `asChild`
- **Fix:** Removed `asChild` from all TooltipTrigger usages; switched AlertDialogTrigger to use `render` prop with Button
- **Files modified:** ConfigDriftView.tsx, BenchmarkRunner.tsx

**3. [Rule 1 - Bug] Type-only imports needed for verbatimModuleSyntax**
- **Found during:** TypeScript check (tsc -b)
- **Issue:** `import { ConfigDiffResponse, DriftItem }` and `import { BenchmarkRun, BenchmarkResult }` needed `import type`
- **Fix:** Changed to `import type { ... }` in both component files
- **Files modified:** ConfigDriftView.tsx, BenchmarkRunner.tsx

## Requirements satisfied
- DRIFT-01: Empty state "No differences detected" renders correctly
- DRIFT-02: Security alert for hardcoded master_key with orange styling
- DRIFT-03: MISMATCH badge rendered for value differences
- DRIFT-04: MISSING badge rendered for absent keys
- BENCH-01: "Run benchmark" button with AlertDialog confirmation gate
- BENCH-02: Results table with TTFT/Latency/tok/s/Status columns
- BENCH-03: History list and empty-state messaging

## Commits
- `b212d74`: feat(04-03): ConfigDriftView + BenchmarkRunner components, wire into App.tsx
