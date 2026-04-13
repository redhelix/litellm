# Phase 3: Request Log + Trend Views - Research

**Researched:** 2026-04-13
**Domain:** FastAPI sidecar extension + DuckDB query patterns + Recharts sparklines + React user-triggered fetch
**Confidence:** HIGH

---

## Summary

Phase 3 extends two already-built systems: the FastAPI sidecar and the React dashboard. The DuckDB schema is fully known from db.py — both tables (`requests`, `latency_snapshots`) are defined and indexed. The `/api/requests` router already exists but serves a different shape than VIEW-03 needs. The `/api/latency/snapshots` router already serves bounded time-window queries per model, which is exactly the data shape VIEW-04's trend charts need.

The primary work is: (1) updating `/api/requests` to accept a `model` filter param and a hard `500`-row cap and return a `total` count for pagination; (2) adding a new `/api/trends` router that aggregates daily buckets from `requests` and `latency_snapshots`; (3) building two new React components (`RequestLogTable`, `TrendSection`) with user-triggered fetch hooks; (4) installing Recharts and wiring sparklines per the UI-SPEC.

All bounded query patterns are already established in the codebase. No new indexing is required — `idx_requests_model` (`model, startTime DESC`) and `idx_snapshots_model` (`model, scraped_at DESC`) cover every query Phase 3 needs.

**Primary recommendation:** Reuse and extend existing sidecar patterns exactly. Do not redesign the existing `/api/requests` route from scratch — add params to it. Add `/api/trends` as a new router file following the same pattern as latency.py.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VIEW-03 | Request log table — paginated, per-request: model, latency, context utilization %, tool call status, timestamp | Existing `/api/requests` route covers most columns; needs `model` filter param + `total` count response field. Pagination is server-side at 25 rows/page, bounded to 500 total. |
| VIEW-04 | Trend charts — 7-day and 30-day performance trends per model for latency, context utilization, error rate | New `/api/trends` endpoint needed — daily bucket aggregation from `requests` table plus p95 from `latency_snapshots`. Bounded WHERE clause already enforced by index + WINDOW_TO_SQL pattern. |
</phase_requirements>

---

## Standard Stack

### Core (all already installed)
| Library | Version | Purpose | Source |
|---------|---------|---------|--------|
| React | 19.2.4 | Component rendering | [VERIFIED: dashboard/package.json] |
| Vite | 8.0.4 | Build tool | [VERIFIED: dashboard/package.json] |
| TypeScript | 6.0.2 | Type safety | [VERIFIED: dashboard/package.json] |
| shadcn/ui | 4.2.0 | Component library (base-nova preset) | [VERIFIED: dashboard/package.json] |
| Tailwind CSS | 4.2.2 | Styling (CSS-first, no config file) | [VERIFIED: dashboard/package.json] |
| vitest | 4.1.4 | Unit test runner | [VERIFIED: dashboard/package.json] |
| FastAPI | (existing sidecar) | API routing | [VERIFIED: dashboard-sidecar/main.py] |
| DuckDB | (existing sidecar) | Analytics queries | [VERIFIED: dashboard-sidecar/db.py] |

### New for Phase 3
| Library | Version | Purpose | Source |
|---------|---------|---------|--------|
| recharts | latest (^2.x) | Sparkline LineChart components | [ASSUMED — install needed; UI-SPEC mandates it] |

**Installation:**
```bash
cd dashboard && npm install recharts
```

**Version note:** recharts 2.x is the stable major; the UI-SPEC does not specify a version. Verify with `npm view recharts version` before installing. [ASSUMED — not verified in registry this session]

### shadcn components to add (not yet installed)
The following shadcn components are required by UI-SPEC and not present in package.json:
- `Select`, `SelectTrigger`, `SelectContent`, `SelectItem` — model filter dropdown
- `Button` — pagination Prev/Next
- `ToggleGroup`, `ToggleGroupItem` — 7d/30d time range toggle

```bash
cd dashboard && npx shadcn add select button toggle-group
```

[VERIFIED: UI-SPEC component inventory; shadcn is initialized per 02-01-SUMMARY.md]

---

## Architecture Patterns

### Existing FastAPI Router Pattern (VERIFIED from codebase)

All routers follow this exact pattern — Phase 3 must match it:

```python
# Source: dashboard-sidecar/routers/latency.py (VERIFIED)
from fastapi import APIRouter, HTTPException, Query
from db import query

router = APIRouter(prefix="/api", tags=["..."])

WINDOW_TO_SQL = {
    "7d":  "startTime > NOW() - INTERVAL 7 DAY",
    "30d": "startTime > NOW() - INTERVAL 30 DAY",
}

@router.get("/endpoint")
def handler(model: str = Query(...), window: str = Query("7d")):
    if window not in WINDOW_TO_SQL:
        raise HTTPException(status_code=400, detail="invalid window")
    # bounded query using WINDOW_TO_SQL[window]
    ...
```

New routers are registered in `main.py` with:
```python
from routers.trends import router as trends_router
app.include_router(trends_router)
```
[VERIFIED: dashboard-sidecar/main.py lines 15-18, 87-90]

### DuckDB Schema (VERIFIED from db.py)

**`requests` table:**
```
request_id TEXT PRIMARY KEY
startTime  TIMESTAMPTZ NOT NULL   ← indexed: idx_requests_starttime, idx_requests_model
model      TEXT                   ← indexed: idx_requests_model (composite with startTime)
model_group TEXT
prompt_tokens INTEGER
completion_tokens INTEGER
total_tokens INTEGER
ttft_ms DOUBLE
total_latency_ms DOUBLE
status TEXT
tool_call_status TEXT             ← values: 'success', 'repaired', 'failed', NULL
context_utilization DOUBLE
api_key_alias TEXT
team_alias TEXT
```

**`latency_snapshots` table:**
```
id INTEGER PRIMARY KEY
scraped_at TIMESTAMPTZ NOT NULL  ← indexed: idx_snapshots_scraped, idx_snapshots_model
model TEXT                       ← indexed: idx_snapshots_model (composite with scraped_at)
ttft_p50 DOUBLE
ttft_p95 DOUBLE
total_latency_p50 DOUBLE
total_latency_p95 DOUBLE
llm_api_latency_p50 DOUBLE
llm_api_latency_p95 DOUBLE
tokens_per_sec DOUBLE
deployment_state INTEGER
```

[VERIFIED: dashboard-sidecar/db.py lines 19-57]

**Critical observation:** Both indexes needed for Phase 3 queries already exist:
- `idx_requests_model ON requests (model, startTime DESC)` — covers filtered paginated queries
- `idx_snapshots_model ON latency_snapshots (model, scraped_at DESC)` — covers trend queries

No new indexes required.

### Existing `/api/requests` Route — What Needs Changing

Current route signature: `GET /api/requests?window=5m&limit=100&offset=0`

VIEW-03 requires: `GET /api/requests?limit=25&offset=N&model=alias`

**Differences to resolve:**
1. `window` param must accept the UI-SPEC contract (`window` is not in the UI-SPEC URL — the frontend always queries "recent 500"). Best approach: keep `window` param but default to `30d` (instead of `5m`) to expose 500+ rows for the log view. The UI-SPEC endpoint shape is `GET /api/requests?limit=25&offset={N}&model={filter}` — no `window` in the frontend call. Solution: make `window` optional with a sensible default and allow `model` filter.
2. Add `model: str | None = Query(None)` filter → `AND model = ?` when set
3. Add `total` count to response so frontend can compute `Page N of M`
4. Hard cap: `limit` max stays at 1000 (existing), but the frontend only ever sends 25; backend should also enforce `offset < 500` to prevent scrolling past 500 rows (UI-SPEC: "Max rows to query: 500")

**Updated response shape needed:**
```json
{
  "rows": [...],
  "total": 247,
  "limit": 25,
  "offset": 0,
  "window": "30d"
}
```

The `total` field requires a COUNT query. Run it bounded:
```sql
SELECT COUNT(*) FROM requests WHERE startTime > NOW() - INTERVAL 30 DAY [AND model = ?]
```
With `idx_requests_model` this is an index scan, not a full table scan. [VERIFIED: index exists in db.py line 55]

### New `/api/trends` Endpoint

VIEW-04 needs: latency p95, context utilization, error/repair rate — per day per model — for 7d or 30d.

**Strategy A — single endpoint, daily buckets from `requests`:**
```sql
SELECT
    DATE_TRUNC('day', startTime) AS day,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_latency_ms) AS latency_p95,
    AVG(context_utilization) AS avg_ctx,
    SUM(CASE WHEN tool_call_status IN ('failed','repaired') THEN 1 ELSE 0 END)::DOUBLE
        / NULLIF(COUNT(*), 0) AS error_repair_rate
FROM requests
WHERE startTime > NOW() - INTERVAL 7 DAY
  AND model = ?
GROUP BY 1
ORDER BY 1 ASC
```
This uses the `idx_requests_model` index (model + startTime) — not a full scan. [VERIFIED: index exists]

**Note on latency p95:** The `requests` table stores per-request `total_latency_ms`. Percentile over daily buckets from the requests table is correct for trend purposes. The `latency_snapshots` table stores p95 computed from Prometheus histogram quantiles, which is a different (rolling) p95 — don't mix them. Use `requests` for daily trend p95.

**Endpoint signature:**
```
GET /api/trends?model={alias}&window=7d
```

Response shape:
```json
{
  "model": "gpt-4o",
  "window": "7d",
  "series": [
    {
      "day": "2026-04-06",
      "latency_p95": 380.5,
      "avg_context_utilization": 0.67,
      "error_repair_rate": 0.12
    },
    ...
  ]
}
```

Frontend calls this once per model (7 calls for 7 models) when the trend section mounts or time range changes.

### Frontend Hook Pattern

Phase 3 introduces user-triggered fetch (not polling). Pattern to follow from useDashboardData but simpler — no interval, no countdown:

```typescript
// New hook: useRequestLog(sidecarUrl, model, page)
// New hook: useTrends(sidecarUrl, window)
// Both: useState + useEffect with AbortController
// Both: fetch on mount + on param change (useEffect dep array)
// Both: loading/error states consistent with existing pattern
```

The `useDashboardData` AbortController pattern (ref + cleanup) must be replicated. [VERIFIED: dashboard/src/hooks/useDashboardData.ts lines 20-77]

### React Component Structure

```
dashboard/src/
├── hooks/
│   ├── useDashboardData.ts    (existing — do not modify)
│   ├── useRequestLog.ts       (new — Phase 3)
│   └── useTrends.ts           (new — Phase 3)
├── components/
│   ├── RequestLogTable.tsx    (new — VIEW-03)
│   └── TrendSection.tsx       (new — VIEW-04)
├── types/
│   └── api.ts                 (extend with new interfaces)
└── App.tsx                    (extend — append two sections)
```

### New TypeScript Types Required

```typescript
// Extend dashboard/src/types/api.ts

export interface RequestLogRow {
  request_id: string
  startTime: string
  model: string
  ttft_ms: number | null
  total_latency_ms: number | null
  context_utilization: number | null
  tool_call_status: 'success' | 'repaired' | 'failed' | null
}

export interface RequestLogResponse {
  rows: RequestLogRow[]
  total: number
  limit: number
  offset: number
  window: string
}

export interface TrendPoint {
  day: string
  latency_p95: number | null
  avg_context_utilization: number | null
  error_repair_rate: number | null
}

export interface TrendResponse {
  model: string
  window: string
  series: TrendPoint[]
}
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sparkline charts | Custom SVG path renderer | Recharts `<LineChart>` + `<ResponsiveContainer>` | Recharts handles null gaps, responsive sizing, tooltips — edge cases take 200+ lines to do right |
| Pagination state | Manual page arithmetic | Simple `page` + `pageSize` state, derive `offset = (page-1)*pageSize` | Trivial but correctly disabling buttons on boundaries is error-prone if done ad hoc |
| DuckDB percentile | Hand-rolled loop over sorted array | `PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY col)` | DuckDB native, correct, index-aware |
| Date bucketing | String manipulation on timestamps | `DATE_TRUNC('day', startTime)` | DuckDB native |
| Bounded queries | Post-fetch filtering in Python | `WHERE startTime > NOW() - INTERVAL N DAY` with existing index | Uses index, prevents full scan |

---

## Common Pitfalls

### Pitfall 1: `/api/requests` route collision
**What goes wrong:** Adding a new `trends` or modified `requests` endpoint duplicates the `GET /api/requests` path from the existing router, causing FastAPI to silently serve the first-registered route.
**Why it happens:** FastAPI does not error on duplicate routes — first match wins.
**How to avoid:** Modify the existing `routers/requests.py` in-place rather than creating a parallel route. Only create `routers/trends.py` as a new file.

### Pitfall 2: DuckDB single-writer threading
**What goes wrong:** Concurrent API calls to the sidecar hit DuckDB simultaneously; DuckDB's single-file connection throws `TransactionContext Error` or `IO Error`.
**Why it happens:** The existing `_lock = threading.Lock()` in db.py serialises all queries. Under concurrent HTTP requests this is correct but adds latency.
**How to avoid:** The `query()` function already acquires `_lock`. Do not bypass it. Do not open a second connection. [VERIFIED: db.py lines 60-64]

### Pitfall 3: recharts `connectNulls` vs gap rendering
**What goes wrong:** Days with no requests produce `null` in trend series. If `connectNulls` is left at default (false in recharts 2.x), the line breaks visually. UI-SPEC says "Skip point, gap in line" — so this is actually correct behaviour, but must be intentional.
**How to avoid:** Leave `connectNulls` at its default (false). Return `null` (not `0`) from the SQL for days with no data. [ASSUMED — recharts 2.x default not verified in this session]

### Pitfall 4: COUNT(*) for total is expensive at scale
**What goes wrong:** Running `SELECT COUNT(*) FROM requests WHERE ...` for every page request adds latency, especially as the table grows.
**How to avoid:** The `idx_requests_model` index covers the WHERE clause, so COUNT is an index scan. For Phase 3 scale (hundreds of thousands of rows max), this is acceptable. Cap the count: `SELECT MIN(COUNT(*), 500)` to avoid the frontend ever showing > 500 pages. [ASSUMED — DuckDB COUNT with partial index coverage not confirmed; assume same as most column-store engines]

### Pitfall 5: Recharts `ResponsiveContainer` in jsdom test environment
**What goes wrong:** Recharts `ResponsiveContainer` requires a real DOM with layout dimensions. In jsdom (vitest), it renders with 0x0 size and may throw or produce empty output.
**How to avoid:** Mock `ResponsiveContainer` in test files, or use `width={400} height={64}` static props in tests while keeping `width="100%"` in production. Pattern established in Phase 2 for SVG (RefreshRing). [ASSUMED — vitest/jsdom recharts incompatibility is a known community issue; exact workaround not verified this session]

### Pitfall 6: `base-ui` TooltipTrigger rejects `asChild`
**What goes wrong:** Phase 2 discovered that `@base-ui/react` Tooltip does not accept `asChild` on its Trigger — causes TS2322 + React prop-leak.
**How to avoid:** Do not use `asChild` on `TooltipTrigger` in Phase 3 components. Wrap trigger content in a `<span>` or `<div>` instead. [VERIFIED: 02-03-SUMMARY.md deviation record]

### Pitfall 7: DuckDB PERCENTILE_CONT syntax
**What goes wrong:** Using PostgreSQL or SQLite percentile syntax (`PERCENTILE_DISC`, `NTILE`) in DuckDB fails.
**How to avoid:** DuckDB supports `PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY col)` — use this exact form. [ASSUMED — DuckDB docs syntax; not queried via Context7 this session]

---

## Code Examples

### Existing bounded query pattern (to replicate)
```python
# Source: dashboard-sidecar/routers/requests.py (VERIFIED)
WINDOW_TO_SQL = {
    "7d":  "startTime > NOW() - INTERVAL 7 DAY",
    "30d": "startTime > NOW() - INTERVAL 30 DAY",
}
sql = f"""
    SELECT ... FROM requests
    WHERE {WINDOW_TO_SQL[window]}
    ORDER BY startTime DESC
    LIMIT ? OFFSET ?
"""
rows = query(sql, (limit, offset))
```

### Trends daily bucket query (new, to implement)
```python
# Target pattern for routers/trends.py
sql = f"""
    SELECT
        CAST(DATE_TRUNC('day', startTime) AS DATE) AS day,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_latency_ms) AS latency_p95,
        AVG(context_utilization)                                         AS avg_context_utilization,
        SUM(CASE WHEN tool_call_status IN ('failed','repaired') THEN 1 ELSE 0 END)::DOUBLE
            / NULLIF(COUNT(*), 0)                                        AS error_repair_rate
    FROM requests
    WHERE {WINDOW_TO_SQL[window]} AND model = ?
    GROUP BY 1
    ORDER BY 1 ASC
"""
rows = query(sql, (model,))
```

### Recharts sparkline pattern (per UI-SPEC)
```tsx
// Source: UI-SPEC section "Sparkline spec" (VERIFIED from 03-UI-SPEC.md)
import { LineChart, Line, ResponsiveContainer, Tooltip, YAxis, XAxis } from 'recharts'

<ResponsiveContainer width="100%" height={64}>
  <LineChart data={series}>
    <XAxis dataKey="day" hide />
    <YAxis hide />
    <Tooltip
      contentStyle={{
        background: 'oklch(0.205 0 0)',
        border: '1px solid oklch(1 0 0 / 10%)',
        color: 'oklch(0.985 0 0)',
        fontSize: 12,
      }}
    />
    <Line dataKey="latency_p95" stroke="#3b82f6" dot={false} strokeWidth={1.5} connectNulls={false} />
    <Line dataKey="avg_context_utilization" stroke="#f59e0b" dot={false} strokeWidth={1.5} connectNulls={false} />
    <Line dataKey="error_repair_rate" stroke="#ef4444" dot={false} strokeWidth={1.5} connectNulls={false} />
  </LineChart>
</ResponsiveContainer>
```

### User-triggered fetch hook pattern (to implement)
```typescript
// Pattern: no interval, just fetch on mount + dep changes
// Mirrors useDashboardData AbortController pattern
function useRequestLog(sidecarUrl: string, model: string | null, page: number) {
  const [data, setData] = useState<RequestLogResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    let mounted = true

    setLoading(true)
    const params = new URLSearchParams({
      limit: '25',
      offset: String((page - 1) * 25),
      window: '30d',
    })
    if (model) params.set('model', model)

    fetch(`${sidecarUrl}/api/requests?${params}`, { signal: controller.signal })
      .then(r => r.json())
      .then(d => { if (mounted) { setData(d); setLoading(false) } })
      .catch(err => {
        if (!mounted || err.name === 'AbortError') return
        setError('Could not load request log — check that dashboard-sidecar is running on docker-001:4001.')
        setLoading(false)
      })

    return () => { mounted = false; controller.abort() }
  }, [sidecarUrl, model, page])

  return { data, loading, error }
}
```

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.4 |
| Config file | `dashboard/vite.config.ts` (vitest/config defineConfig) |
| Quick run command | `cd dashboard && npm test` |
| Full suite command | `cd dashboard && npm test` (same — vitest run is single-pass) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VIEW-03 | RequestLogTable renders rows from mock data | unit | `cd dashboard && npm test -- RequestLogTable` | No — Wave 0 |
| VIEW-03 | Pagination prev/next buttons disable at boundaries | unit | `cd dashboard && npm test -- RequestLogTable` | No — Wave 0 |
| VIEW-03 | Model filter change resets to page 1 | unit | `cd dashboard && npm test -- RequestLogTable` | No — Wave 0 |
| VIEW-03 | Null numeric values render as em-dash | unit | `cd dashboard && npm test -- RequestLogTable` | No — Wave 0 |
| VIEW-04 | TrendSection renders sparklines per model | unit | `cd dashboard && npm test -- TrendSection` | No — Wave 0 |
| VIEW-04 | 7d/30d toggle triggers re-fetch | unit | `cd dashboard && npm test -- TrendSection` | No — Wave 0 |
| VIEW-04 | useRequestLog aborts on param change | unit | `cd dashboard && npm test -- useRequestLog` | No — Wave 0 |
| VIEW-04 | useTrends aborts on unmount | unit | `cd dashboard && npm test -- useTrends` | No — Wave 0 |

Backend validation: manual curl verification + `pytest` if sidecar has test suite.

### Wave 0 Gaps
- [ ] `dashboard/src/__tests__/RequestLogTable.test.tsx` — covers VIEW-03 (table render, pagination, filter, null display)
- [ ] `dashboard/src/__tests__/TrendSection.test.tsx` — covers VIEW-04 (sparkline render, toggle)
- [ ] `dashboard/src/__tests__/useRequestLog.test.tsx` — covers hook lifecycle (AbortController, loading states)
- [ ] `dashboard/src/__tests__/useTrends.test.tsx` — covers hook lifecycle
- [ ] Recharts must be mocked in test environment (jsdom dimension issue)

---

## Environment Availability

Phase 3 is primarily code changes to existing running services. No new external dependencies beyond `recharts` npm package.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| recharts | Trend sparklines | ✗ (not installed) | — | No fallback — install required |
| shadcn select | Model filter | ✗ (not installed) | — | Install via `npx shadcn add select` |
| shadcn button | Pagination | ✗ (not installed) | — | Install via `npx shadcn add button` |
| shadcn toggle-group | Time range toggle | ✗ (not installed) | — | Install via `npx shadcn add toggle-group` |
| DuckDB (sidecar) | Trend queries | ✓ | Running on docker-001:4001 | — |
| FastAPI (sidecar) | New endpoints | ✓ | Running on docker-001:4001 | — |

**Missing dependencies with no fallback:**
- `recharts` — must be installed before TrendSection can be implemented

**Missing dependencies with fallback via shadcn CLI:**
- `select`, `button`, `toggle-group` — all installable via `npx shadcn add`; shadcn is already initialized

---

## Security Domain

Security enforcement applies. Phase 3 is read-only data display — no new threat surface beyond Phase 2.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Local network only (SYS-03) |
| V3 Session Management | No | No sessions |
| V4 Access Control | No | No auth |
| V5 Input Validation | Yes | FastAPI Query param validation — `window` allowlist, `limit`/`offset` range checks, `model` passed as SQL parameter (not interpolated) |
| V6 Cryptography | No | No secrets in Phase 3 |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via `model` param | Tampering | Use parameterised query `query(sql, (model,))` — same pattern as existing routers. Never f-string the model value into SQL |
| XSS via model alias from API | Tampering | React JSX interpolation auto-escapes — same as Phase 2 (T-02-06 mitigated) |
| Unbounded query (missing WHERE) | DoS | WINDOW_TO_SQL allowlist enforces bounded WHERE. `offset` guard prevents scrolling past 500 rows |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | recharts 2.x is the current stable major | Standard Stack | Wrong version installed; may need `recharts@2` pin |
| A2 | DuckDB `PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY col)` is correct syntax | Code Examples | Trend query fails at runtime; syntax differs |
| A3 | recharts `connectNulls` defaults to false in 2.x | Common Pitfalls | Null gaps connect instead of breaking; visual mismatch with UI-SPEC |
| A4 | `ResponsiveContainer` renders 0x0 in jsdom and requires mocking | Common Pitfalls | Tests pass without mock but produce wrong assertions |
| A5 | COUNT(*) with idx_requests_model is an index scan in DuckDB | Common Pitfalls | COUNT adds unexpected latency for large tables |

---

## Open Questions

1. **Does the existing `/api/requests` endpoint need a breaking change or additive change?**
   - What we know: it currently accepts `window` (default 5m) + `limit` + `offset`. VIEW-03 needs `model` filter + `total` in response.
   - What's unclear: whether any existing frontend code (Phase 2) calls `/api/requests`. Searching the codebase — `useDashboardData` only calls `/api/models` and `/api/nodes`. So no existing frontend consumer.
   - Recommendation: modify the existing route additively (new optional params, new response field). No breaking change.

2. **Should model aliases come from `/api/models` or a separate `/api/requests/models` endpoint for the filter dropdown?**
   - What we know: `/api/models` already returns all model names from `latency_snapshots` + `requests` (last 1h). The filter dropdown needs unique model aliases from the request log.
   - Recommendation: populate the model filter select from the `useRequestLog` response data — extract unique model values from the first response, or add a `?distinct_models=1` query. Simpler: derive model list from the existing `useRequestLog` data client-side across all pages. Even simpler: reuse the `models` array already in `useDashboardData` (already loaded on page, no extra call needed).

---

## Sources

### Primary (HIGH confidence — verified from codebase)
- `dashboard-sidecar/db.py` — DuckDB schema, indexes, thread lock pattern
- `dashboard-sidecar/routers/requests.py` — existing request router shape
- `dashboard-sidecar/routers/latency.py` — WINDOW_TO_SQL pattern to replicate
- `dashboard-sidecar/main.py` — router registration pattern
- `dashboard/src/types/api.ts` — existing type contracts
- `dashboard/src/hooks/useDashboardData.ts` — AbortController fetch pattern
- `dashboard/package.json` — installed library versions
- `.planning/phases/03-request-log-trend-views/03-UI-SPEC.md` — endpoint shapes, component inventory, interaction contract

### Secondary (MEDIUM confidence)
- `02-01-SUMMARY.md`, `02-02-SUMMARY.md`, `02-03-SUMMARY.md` — Phase 2 decisions (TooltipTrigger asChild, vitest patterns)

### Tertiary (LOW confidence — training knowledge, unverified)
- recharts 2.x API (`LineChart`, `Line`, `ResponsiveContainer`, `connectNulls`) — [ASSUMED]
- DuckDB `PERCENTILE_CONT` syntax — [ASSUMED]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions read from package.json and db.py directly
- Architecture: HIGH — all patterns read from live codebase; no guessing
- DuckDB query patterns: MEDIUM — schema verified; PERCENTILE_CONT syntax assumed
- Recharts integration: MEDIUM — library confirmed in UI-SPEC; exact API assumed from training
- Pitfalls: HIGH — most derived from Phase 2 SUMMARYs and codebase inspection

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable stack; recharts API unlikely to change in 30 days)
