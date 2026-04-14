---
phase: 03-request-log-trend-views
reviewed: 2026-04-13T00:00:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - dashboard/package.json
  - dashboard-sidecar/main.py
  - dashboard-sidecar/routers/requests.py
  - dashboard-sidecar/routers/trends.py
  - dashboard-sidecar/tests/test_requests.py
  - dashboard-sidecar/tests/test_trends.py
  - dashboard/src/App.tsx
  - dashboard/src/components/RequestLogTable.tsx
  - dashboard/src/components/TrendSection.tsx
  - dashboard/src/components/ui/select.tsx
  - dashboard/src/hooks/useRequestLog.ts
  - dashboard/src/hooks/useTrends.ts
  - dashboard/src/__tests__/RequestLogTable.test.tsx
  - dashboard/src/__tests__/TrendSection.test.tsx
  - dashboard/src/__tests__/useRequestLog.test.tsx
  - dashboard/src/__tests__/useTrends.test.tsx
  - dashboard/src/types/api.ts
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-04-13
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

The request-log and trend-view implementation is structurally sound. The Python routers use
parameterised queries with a whitelist-only approach to dynamic SQL fragments (preventing
injection), abort handling in the hooks is present, and the type system is coherent. Three
warnings are raised: the most impactful is that `useTrends` constructs `AbortController`
instances but never passes their signals to `fetch`, making abort a no-op. The other two are
test data mismatches that mean the chart rendering path is not actually exercised by the test
suite. Three info items cover a duplicate DOM `id`, a global-shadow variable name, and a loose
`window` parameter type in the hook interface.

---

## Warnings

### WR-01: `useTrends` — AbortController signal never passed to fetch

**File:** `dashboard/src/hooks/useTrends.ts:59`

**Issue:** A new `AbortController` is created for each model and pushed to `abortRefs`, but the
`fetch()` call does not include `{ signal: controller.signal }`. As a result, calling
`controller.abort()` (on unmount or dependency change) has no effect on in-flight network
requests. Stale responses from a previous render cycle can still overwrite state via the
`setResults` call — the `mounted` guard prevents the state write only after the component
unmounts, not when params change mid-flight.

**Fix:**
```typescript
// line 59 — add signal option
fetch(
  `${sidecarUrl}/api/trends?model=${encodeURIComponent(model)}&window=${window}`,
  { signal: controller.signal }   // <-- add this
)
```

---

### WR-02: Test mock series shape does not match `TrendPoint` type — `TrendSection` and `useTrends` tests

**Files:**
- `dashboard/src/__tests__/TrendSection.test.tsx:17-20`
- `dashboard/src/__tests__/useTrends.test.tsx:6-8`

**Issue:** Both test files use mock series objects with keys `date`, `avg_latency_ms`,
`p95_latency_ms`, `avg_context_util`, `error_rate`. The canonical `TrendPoint` type (and the
backend response) uses `day`, `latency_p95`, `avg_context_utilization`, `error_repair_rate`.
The `Line` components in `TrendSection` bind to the correct keys (`latency_p95`, etc.), so with
the current mock data every `Line` would receive `undefined` values and render nothing. The tests
do not assert on chart data content, so this mismatch passes silently and gives false confidence
that the chart renders real data.

**Fix:** Update mock series objects in both test files to use the correct field names:
```typescript
const mockTrendData = {
  model: 'gpt-4o',
  window: '7d',
  series: [
    {
      day: '2026-04-06',
      latency_p95: 600,
      avg_context_utilization: 0.4,
      error_repair_rate: 0.01,
    },
    {
      day: '2026-04-07',
      latency_p95: 620,
      avg_context_utilization: 0.42,
      error_repair_rate: 0.02,
    },
  ],
}
```

---

### WR-03: Test mock row shape uses wrong field names for `RequestLogTable`

**File:** `dashboard/src/__tests__/RequestLogTable.test.tsx:5-23`

**Issue:** Mock rows use `id` and `timestamp` instead of the canonical `request_id` and
`startTime` defined in `RequestLogRow`. The component has a fallback (`row.id ?? String(i)` and
`row.timestamp ?? ''`) specifically to cope with this, but this pattern means the tests are
validating the fallback path rather than the production path. A regression that drops `request_id`
or `startTime` from the API response would not be caught.

**Fix:** Use canonical field names in the mock so tests exercise the primary code path:
```typescript
const mockRows = [
  {
    request_id: 'req-1',
    startTime: '2026-04-13T10:00:00Z',
    model: 'gpt-4o',
    ttft_ms: 123,
    total_latency_ms: 456,
    context_utilization: 0.42,
    tool_call_status: 'success' as const,
  },
  {
    request_id: 'req-2',
    startTime: '2026-04-13T11:00:00Z',
    model: 'gpt-4o',
    ttft_ms: null,
    total_latency_ms: 200,
    context_utilization: 0.1,
    tool_call_status: null,
  },
]
```

The fallback in `RequestLogTable` (`row.id ?? String(i)`, `row.timestamp ?? ''`) can be removed
once the mock is aligned, keeping the component typed cleanly against `RequestLogRow`.

---

## Info

### IN-01: Duplicate `id="request-log"` in DOM

**File:** `dashboard/src/App.tsx:56` and `dashboard/src/components/RequestLogTable.tsx:115`

**Issue:** `App.tsx` wraps `RequestLogTable` in `<section id="request-log">`, and
`RequestLogTable` also renders a `<div id="request-log">` at its root. The DOM will contain two
elements with the same `id`, which is invalid HTML. `document.getElementById('request-log')` in
`handlePrev`/`handleNext` (lines 101, 108 of `RequestLogTable.tsx`) will find the outermost
`section`, which is the intended scroll target — but the inner duplicate `id` may cause confusion
and will fail accessibility audits.

**Fix:** Remove the `id="request-log"` from the `<div>` root in `RequestLogTable.tsx` (line
115). The scroll target is already provided by the `section` in `App.tsx`.

---

### IN-02: Local variable `window` shadows global `window` object

**Files:**
- `dashboard/src/components/TrendSection.tsx:12`
- `dashboard/src/hooks/useTrends.ts:26`

**Issue:** `const [window, setWindow] = useState<'7d' | '30d'>('7d')` and
`const { models, window = '7d', sidecarUrl = '' } = params` shadow the browser `window` global.
Not a runtime bug in these specific contexts (neither accesses `window.*` globals locally), but
it suppresses ESLint's `no-shadow` rule matches and is a footgun for future edits.

**Fix:** Rename to `timeRange` or `timeWindow`:
```typescript
const [timeRange, setTimeRange] = useState<'7d' | '30d'>('7d')
```

---

### IN-03: `useRequestLog` `window` parameter typed as `string` instead of a union

**File:** `dashboard/src/hooks/useRequestLog.ts:5`

**Issue:** `window?: string` in `UseRequestLogParams` accepts any string. The backend
`/api/requests` accepts only `"5m" | "7d" | "30d"` and returns HTTP 400 for anything else. A
mistyped caller would receive a runtime error rather than a compile-time error.

**Fix:**
```typescript
interface UseRequestLogParams {
  window?: '5m' | '7d' | '30d'
  // ...
}
```

---

_Reviewed: 2026-04-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
