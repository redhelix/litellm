---
phase: 02-core-dashboard
reviewed: 2026-04-13T00:00:00Z
depth: standard
files_reviewed: 25
files_reviewed_list:
  - dashboard/Dockerfile
  - dashboard/.dockerignore
  - dashboard/.env
  - dashboard/.env.production
  - dashboard/nginx.conf
  - dashboard/src/App.tsx
  - dashboard/src/components/ModelCard.tsx
  - dashboard/src/components/NodeGrid.tsx
  - dashboard/src/components/OverviewPanel.tsx
  - dashboard/src/components/RefreshRing.tsx
  - dashboard/src/components/StatusDot.tsx
  - dashboard/src/components/ToolCallBar.tsx
  - dashboard/src/hooks/useDashboardData.ts
  - dashboard/src/lib/aggregate.ts
  - dashboard/src/lib/format.ts
  - dashboard/src/lib/status.ts
  - dashboard/src/setupTests.ts
  - dashboard/src/__tests__/aggregate.test.ts
  - dashboard/src/__tests__/format.test.ts
  - dashboard/src/__tests__/ModelCard.test.tsx
  - dashboard/src/__tests__/NodeGrid.test.tsx
  - dashboard/src/__tests__/OverviewPanel.test.tsx
  - dashboard/src/__tests__/status.test.ts
  - dashboard/src/__tests__/ToolCallBar.test.tsx
  - dashboard/src/__tests__/useDashboardData.test.tsx
findings:
  critical: 0
  warning: 4
  info: 5
  total: 9
status: issues_found
---

# Phase 02: Core Dashboard — Code Review Report

**Reviewed:** 2026-04-13
**Depth:** standard
**Files Reviewed:** 25
**Status:** issues_found

## Summary

The core dashboard implementation is well-structured and correctness-focused. The logic layer (`aggregate.ts`, `format.ts`, `status.ts`) is clean and well-tested. The hook (`useDashboardData.ts`) correctly handles abort controllers, stale detection, and error retention. No critical security vulnerabilities were found — the `.env` files contain only a LAN hostname, `.env` is excluded from Docker builds via `.dockerignore`, and no credentials are hardcoded.

Four warnings were found: two logic bugs (ToolCallBar width arithmetic can produce negative widths; `isStale` computed during render rather than at tick boundaries), one missing HTTP response status check, and one missing nginx security header. Five info-level items cover minor quality and robustness gaps.

## Warnings

### WR-01: ToolCallBar `fw` can be negative when rounding pushes `sw + rw > 100`

**File:** `dashboard/src/components/ToolCallBar.tsx:33`

**Issue:** `sw` and `rw` are each independently rounded to the nearest integer via `Math.round`. Their sum can exceed 100 (e.g., `s=0.335`, `r=0.335` → `sw=34`, `rw=34`, `fw=32` is fine, but `s=0.495`, `r=0.495` → `sw=50`, `rw=50`, `fw=0` — on the boundary). More concretely: `s=0.499`, `r=0.499`, `f=0.002` → `sw=50`, `rw=50`, `fw=0`; but `s=0.501`, `r=0.501`, `f=0` → `sw=50`, `rw=50`, `fw=0`. The actual danger case is `s=0.503`, `r=0.503`, `f=-0.006` → `sw=50`, `rw=50`, `fw=100-100=0`. However, consider `s=0.506`, `r=0.506` → `sw=51`, `rw=51`, `fw=-2`. While all three input rates are expected to sum to ≤1.0 in practice, the normalization step (`v / total`) can produce rounded intermediate values that sum past 100, yielding a negative `fw` and a visually broken bar (negative CSS width collapses, segment disappears silently).

**Fix:**
```typescript
const sw = normalize(s)
const rw = normalize(r)
const fw = Math.max(0, 100 - sw - rw)  // clamp to prevent negative width
```

---

### WR-02: `fetchAll` does not check HTTP response status before calling `.json()`

**File:** `dashboard/src/hooks/useDashboardData.ts:23-31`

**Issue:** `modelsRes.json()` and `nodesRes.json()` are called unconditionally. If the sidecar returns a 4xx or 5xx response, `fetch` resolves (it only rejects on network failure), and `.json()` may succeed but return an error payload (e.g., `{"error": "not found"}`). The subsequent array normalisation (`Array.isArray(modelsData) ? modelsData : (modelsData.models ?? [])`) silently swallows the error body and sets `models = []`, clearing the displayed data without setting `error`. The user sees the dashboard go blank with no error message.

**Fix:**
```typescript
async function fetchAll(signal: AbortSignal) {
  const [modelsRes, nodesRes] = await Promise.all([
    fetch(`${sidecarUrl}/api/models`, { signal }),
    fetch(`${sidecarUrl}/api/nodes`, { signal }),
  ])
  if (!modelsRes.ok) throw new Error(`/api/models ${modelsRes.status}`)
  if (!nodesRes.ok) throw new Error(`/api/nodes ${nodesRes.status}`)
  const [modelsData, nodesData] = await Promise.all([
    modelsRes.json(),
    nodesRes.json(),
  ])
  return { modelsData, nodesData }
}
```

---

### WR-03: `isStale` is computed once at render time, not at tick boundaries

**File:** `dashboard/src/hooks/useDashboardData.ts:18`

**Issue:** `const isStale = !!lastSuccess && Date.now() - lastSuccess.getTime() > 60_000` is computed during render. Because React only re-renders when state changes, and `lastSuccess` only changes on successful fetch, the `isStale` flag will not flip to `true` until the next state update — which is the next countdown tick (up to 1 second late). More critically, when fetch is failing continuously, the countdown tick every second does trigger re-renders, so `isStale` will eventually evaluate correctly. However, the value returned from the hook has snapshot-in-time semantics: a consumer that reads `isStale` between tick renders will see a stale-false when the data is actually stale. This is a timing edge case rather than a hard bug, but it means the stale banner could appear up to ~1s late.

The more significant issue: `isStale` is recalculated from `Date.now()` at render time but there is no dedicated timer driving its recomputation. If fetches fail and the countdown tick fires, `isStale` re-evaluates correctly. But if for any reason re-renders stop (edge case), the staleness indicator freezes. Moving staleness into a state variable driven by the tick interval makes the behaviour explicit and reliable.

**Fix:**
```typescript
// Replace the inline isStale computation with state driven by the tick interval
const [isStale, setIsStale] = useState(false)

// Inside the tick interval callback:
setCountdown((prev) => (prev > 0 ? prev - 1 : 0))
setIsStale(!!lastSuccessRef.current && Date.now() - lastSuccessRef.current.getTime() > 60_000)
```

---

### WR-04: nginx serves the dashboard with no security headers

**File:** `dashboard/nginx.conf`

**Issue:** The nginx configuration contains no HTTP security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Content-Security-Policy`, `Referrer-Policy`). While the dashboard is LAN-only and not internet-facing per the threat model, the absence of `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` means a compromised LAN host could iframe the dashboard or exploit MIME sniffing. This is a defence-in-depth gap rather than an exploitable vulnerability in the stated deployment context, but it is low-effort to fix.

**Fix:**
```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "no-referrer" always;

    location / { try_files $uri $uri/ /index.html; }
}
```

---

## Info

### IN-01: `pluck` in `aggregate.ts` casts through `as number | null` unsafely

**File:** `dashboard/src/lib/aggregate.ts:23-26`

**Issue:** The `pluck` helper casts `m[key]` as `number | null`. The `keyof ModelAggregate` type includes non-numeric fields like `model` (string) and `tool_call_rates` (object). If `pluck` is ever called with `'model'` or `'tool_call_rates'`, the cast succeeds at compile time but produces strings or objects in the numeric array, silently corrupting the median calculation. The function is currently only called with numeric keys, but the type signature does not enforce this.

**Fix:**
```typescript
type NumericKey = {
  [K in keyof ModelAggregate]: ModelAggregate[K] extends number | null ? K : never
}[keyof ModelAggregate]

const pluck = (key: NumericKey): number[] =>
  models
    .map((m) => m[key] as number | null)
    .filter((v): v is number => v !== null)
```

---

### IN-02: `formatRelativeTime` does not handle invalid ISO strings

**File:** `dashboard/src/lib/format.ts:17-25`

**Issue:** `new Date(iso).getTime()` returns `NaN` if `iso` is not a valid ISO string. `Date.now() - NaN` is `NaN`, and `Math.floor(NaN / 1000)` is `NaN`. The function then returns `` `${NaN}s ago` `` — a visible data error in the UI. The sidecar is expected to return valid ISO strings, but defensive handling costs nothing.

**Fix:**
```typescript
export function formatRelativeTime(iso: string | null): string {
  if (iso === null) return 'never'
  const ts = new Date(iso).getTime()
  if (isNaN(ts)) return '—'
  // ... rest unchanged
}
```

---

### IN-03: `RefreshRing` hard-codes `30` as the period denominator

**File:** `dashboard/src/components/RefreshRing.tsx:10`

**Issue:** `const progress = countdown / 30` hard-codes the 30-second refresh interval. The actual interval is defined in `useDashboardData.ts` (`30_000` ms). If the fetch interval is changed, the ring animation will be incorrect. A `period` prop (defaulting to 30) would decouple the visual from the constant.

**Fix:**
```typescript
interface RefreshRingProps {
  countdown: number
  period?: number   // defaults to 30
  error: string | null
  isStale: boolean
}

export function RefreshRing({ countdown, period = 30, error, isStale }: RefreshRingProps) {
  const progress = countdown / period
  // ...
}
```

---

### IN-04: `.env` is not excluded from version control

**File:** `dashboard/.env`

**Issue:** `dashboard/.dockerignore` correctly excludes `.env` from the Docker build context. However, there is no evidence of a `.gitignore` entry for `dashboard/.env`. The file currently contains only `VITE_SIDECAR_URL=http://docker-001:4001`, which is non-sensitive, but the `.env` convention implies it is the developer's local override file. If a future developer adds a secret to `.env` (e.g., a LiteLLM API key for local testing), it would be committed. `.env` should be in `.gitignore` while `.env.production` (which contains only the non-secret LAN hostname) remains tracked.

**Fix:** Add to the repo-root or `dashboard/.gitignore`:
```
dashboard/.env
dashboard/.env.local
```

---

### IN-05: `useDashboardData` test H5 relies on two failing fetch intervals to elapse 61s

**File:** `dashboard/src/__tests__/useDashboardData.test.tsx:147-169`

**Issue:** Test H5 advances fake timers by 61s and expects `isStale` to be true. This works because two 30s fetch intervals fire (at 30s and 60s), both fail, and the tick interval keeps re-rendering the hook so `isStale` (computed from `Date.now()`) flips. The test is correct but fragile: it depends on the render-time `isStale` computation being triggered by tick re-renders. If the staleness computation moves to state (as suggested in WR-03), this test would remain valid. No code change required — this is a documentation of the coupling between the test and the current implementation.

---

_Reviewed: 2026-04-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
