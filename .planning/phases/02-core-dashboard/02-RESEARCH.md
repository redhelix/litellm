# Phase 2: Core Dashboard - Research

**Researched:** 2026-04-13
**Domain:** React + Vite + shadcn/ui frontend, docker-compose static serving, Traefik routing, CORS
**Confidence:** HIGH (API shapes verified from source, infrastructure verified from live files, npm versions verified from registry)

---

## Summary

Phase 2 builds a single-page React dashboard that consumes four REST endpoints already live at `docker-001:4001`. The frontend tech stack is fully specified in the UI-SPEC: React + Vite (TypeScript), shadcn/ui components, TailwindCSS v3, dark theme. No routing, no authentication.

The infrastructure question with the most architectural impact is Traefik routing. Traefik in this project is configured entirely via file-based dynamic config (`/dynamic/services.yml`), NOT via docker-compose labels. The dashboard-sidecar in docker-compose has only `autoheal=true` as a label — no Traefik router/service labels. All routing entries live in the Traefik repo at `/home/rhx/projects/home-infra-backups/traefik/services.yml`. Adding `dashboard.thelaljis.com` requires editing that file, not docker-compose labels.

SYS-03 (no auth on local network) means the `dashboard` Traefik router should NOT include the `authentik` middleware, matching the pattern already used by `litellm`, `honcho`, `firecrawl`, `gitea`, `paperclip`, `hinton-claw`, and others that have no `middlewares:` block.

For CORS: the dashboard container (port 4002) makes browser requests to the sidecar (port 4001). In docker-compose, the dashboard's built JS runs in the user's browser, not in the container — so `http://docker-001:4001` is the correct sidecar URL from the browser's perspective. FastAPI must emit `Access-Control-Allow-Origin` for the dashboard origin. This is the only runtime CORS concern; container-to-container networking is irrelevant here.

**Primary recommendation:** Scaffold `dashboard/` with `npm create vite@latest -- --template react-ts`, run `npx shadcn@latest init`, serve the build via nginx:alpine in docker-compose on port 4002, add sidecar CORS middleware for `http://docker-001:4002`, add `dashboard` entry to `traefik/services.yml` without `authentik` middleware.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MET-01 | Per-model TTFT (p50, p95) displayed | `/api/models` returns `ttft_p50`, `ttft_p95` per model |
| MET-02 | Per-model total latency (p50, p95) displayed | `/api/models` returns `total_latency_p50`, `total_latency_p95` |
| MET-03 | Per-model tokens/sec throughput displayed | `/api/models` returns `tokens_per_sec` |
| MET-04 | Per-model context window utilization % displayed | `/api/models` returns `avg_context_utilization` (0–1 float, multiply × 100 for %) |
| MET-05 | Per-model tool call 3-state breakdown | `/api/models` returns `tool_call_rates.{success,repaired,failed}` as 0–1 floats |
| VIEW-01 | Overview panel aggregate stats across all 7 models | Aggregate by iterating `/api/models` response array; no dedicated aggregate endpoint exists — must compute in frontend |
| VIEW-02 | Per-node health grid (5 nodes) | `/api/nodes` returns `model`, `deployment_state`, `last_scrape`, `last_request_time` — no `availability_status` field; status must be derived in frontend from `deployment_state` + age of `last_scrape` |
| SYS-03 | Local network access only — no login/auth | Traefik router for dashboard must omit `authentik` middleware; same pattern as `litellm`, `honcho`, `firecrawl` entries in services.yml |
</phase_requirements>

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vite | 8.0.8 [VERIFIED: npm registry] | Build tool + dev server | Fastest cold start for single-page apps; official shadcn target |
| react | 19.2.5 [VERIFIED: npm registry] | UI framework | shadcn/ui requires React |
| react-dom | 19.2.5 [VERIFIED: npm registry] | React DOM renderer | Required alongside react |
| typescript | 6.0.2 [VERIFIED: npm registry] | Type safety | UI-SPEC specifies TypeScript |
| @vitejs/plugin-react | 6.0.1 [VERIFIED: npm registry] | Vite plugin for React JSX transform | Standard Vite+React pairing |
| tailwindcss | 4.2.2 [VERIFIED: npm registry] | Utility CSS | Required by shadcn |
| shadcn | 4.2.0 [VERIFIED: npm registry] | Component CLI | UI-SPEC specifies shadcn/ui |
| lucide-react | 1.8.0 [VERIFIED: npm registry] | Icon library | UI-SPEC specifies lucide-react |

> **Warning on Tailwind version:** shadcn currently targets Tailwind v3. The current npm latest is v4.x. The `npx shadcn@latest init` flow will install the correct Tailwind version it requires — do NOT pre-install tailwindcss before running `shadcn init`, or version conflicts can arise. Let shadcn drive the Tailwind installation. [ASSUMED — based on known shadcn/Tailwind coupling; verify with `npx shadcn@latest init` output during execution]

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| nginx:alpine (Docker image) | latest | Serve static build | Serving `dist/` via docker-compose; no Node runtime in production container |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| nginx:alpine for serving | Node + `vite preview` | vite preview is dev-only; nginx is correct for production containers |
| `setInterval` polling | WebSockets or SSE | Sidecar has REST-only endpoints; polling is correct given 30s refresh requirement and no push from backend |
| `setInterval` polling | React Query / TanStack Query | Adds a dependency for a simple use case; direct `fetch` in a `useEffect` with `setInterval` is sufficient for one page with two endpoints |

**Installation (scaffold + shadcn init):**
```bash
# From repo root
npm create vite@latest dashboard -- --template react-ts
cd dashboard
npx shadcn@latest init
# Accept: TypeScript=yes, style=default, baseColor=zinc, cssVariables=yes, RSC=No
npx shadcn@latest add card badge table separator tooltip progress
```

---

## API Shape Reference

These are the verified shapes from Phase 1 source code — the planner must use these exact field names.

### `GET /api/models`
```typescript
// Source: dashboard-sidecar/routers/models.py (verified)
interface ModelAggregate {
  model: string;                    // model alias string
  ttft_p50: number | null;          // milliseconds
  ttft_p95: number | null;
  total_latency_p50: number | null; // milliseconds
  total_latency_p95: number | null;
  llm_api_latency_p50: number | null;
  llm_api_latency_p95: number | null;
  overhead_ms_p50: number | null;
  tokens_per_sec: number | null;
  tool_call_rates: {
    success: number | null;   // 0.0–1.0 fraction
    repaired: number | null;
    failed: number | null;
  };
  avg_context_utilization: number | null;  // 0.0–1.0 fraction — multiply × 100 for %
}
// Response: { "models": ModelAggregate[] }
```

### `GET /api/nodes`
```typescript
// Source: dashboard-sidecar/routers/nodes.py (verified)
interface NodeRow {
  model: string;              // model alias — maps to node by alias naming convention
  deployment_state: string;   // raw Prometheus string; NOT a typed enum from the API
  last_scrape: string;        // ISO timestamp
  last_request_time: string | null;  // ISO timestamp or null
}
// Response: { "nodes": NodeRow[] }
// CRITICAL: No "availability_status" field. Frontend must derive status from:
//   - deployment_state value
//   - age of last_scrape (>90s → "unknown", per UI-SPEC)
```

### `GET /api/requests?window=5m|7d|30d&limit=N&offset=N`
```typescript
// Source: dashboard-sidecar/routers/requests.py (verified)
// Phase 2 does not use this endpoint — reserved for Phase 3 (VIEW-03)
```

### `GET /api/latency/snapshots?model=X&window=7d|30d`
```typescript
// Source: dashboard-sidecar/routers/latency.py (verified)
// Phase 2 does not use this endpoint — reserved for Phase 3 (VIEW-04 trend charts)
```

---

## Architecture Patterns

### Project Structure
```
dashboard/
├── index.html
├── vite.config.ts
├── tailwind.config.ts         # created by shadcn init
├── components.json            # created by shadcn init — must exist before any shadcn add
├── tsconfig.json
├── tsconfig.app.json
├── Dockerfile                 # nginx:alpine serving dist/
├── package.json
└── src/
    ├── main.tsx
    ├── App.tsx                # root: layout + polling orchestration
    ├── index.css              # Tailwind directives + CSS variables from shadcn
    ├── components/
    │   ├── ui/                # shadcn auto-generated components (do not hand-edit)
    │   │   ├── card.tsx
    │   │   ├── badge.tsx
    │   │   ├── table.tsx
    │   │   ├── separator.tsx
    │   │   ├── tooltip.tsx
    │   │   └── progress.tsx
    │   ├── OverviewPanel.tsx  # Section 1: aggregate stats row
    │   ├── ModelCard.tsx      # Section 2: per-model card (used 7×)
    │   ├── NodeGrid.tsx       # Section 3: node health table
    │   ├── ToolCallBar.tsx    # hand-rolled stacked bar (~30 lines, no dep)
    │   ├── StatusDot.tsx      # hand-rolled 8px status circle
    │   └── RefreshRing.tsx    # hand-rolled SVG countdown arc
    ├── hooks/
    │   └── useDashboardData.ts  # polling logic: setInterval + Promise.all
    ├── lib/
    │   └── utils.ts           # shadcn cn() helper (auto-generated)
    └── types/
        └── api.ts             # TypeScript interfaces matching API shapes above
```

### Pattern 1: Polling with setInterval
**What:** Single hook owns all fetch state. `setInterval` fires every 30s. Countdown counts down from 30 independently via a second `setInterval` ticking every 1s.
**When to use:** No push mechanism from backend; 30s refresh is the only requirement.

```typescript
// Source: UI-SPEC auto-refresh contract (verified from 02-UI-SPEC.md)
// Pseudocode pattern — exact implementation at executor discretion
function useDashboardData(sidecarUrl: string) {
  const [models, setModels] = useState<ModelAggregate[]>([]);
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(30);
  const [lastSuccess, setLastSuccess] = useState<Date | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [mRes, nRes] = await Promise.all([
        fetch(`${sidecarUrl}/api/models`),
        fetch(`${sidecarUrl}/api/nodes`),
      ]);
      const mData = await mRes.json();
      const nData = await nRes.json();
      setModels(mData.models);
      setNodes(nData.nodes);
      setError(null);
      setLastSuccess(new Date());
      setCountdown(30);
    } catch (e) {
      setError('Connection lost — retrying…');
    }
  }, [sidecarUrl]);

  useEffect(() => {
    fetchAll(); // immediate on mount
    const poll = setInterval(fetchAll, 30_000);
    const tick = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1_000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [fetchAll]);

  const isStale = lastSuccess && (Date.now() - lastSuccess.getTime()) > 60_000;
  return { models, nodes, error, countdown, isStale };
}
```

### Pattern 2: VIEW-02 Availability Status Derivation
**What:** The `/api/nodes` endpoint has no `availability_status` field. Frontend must derive it.
**When to use:** Always — the API will not be modified in Phase 2.

```typescript
// Source: UI-SPEC Node Status Rules (verified from 02-UI-SPEC.md)
type AvailabilityStatus = 'healthy' | 'slow' | 'unreachable' | 'unknown';

function deriveStatus(node: NodeRow): AvailabilityStatus {
  const scrapeAge = (Date.now() - new Date(node.last_scrape).getTime()) / 1000;
  if (scrapeAge > 90) return 'unknown';
  // deployment_state string from Prometheus — exact values to confirm at runtime
  // Treat as: non-empty string → map to status based on value
  const state = node.deployment_state?.toLowerCase() ?? '';
  if (state === 'healthy' || state === 'running') return 'healthy';
  if (state === 'slow') return 'slow';
  if (state === 'unreachable' || state === '' || state === 'down') return 'unreachable';
  return 'unknown';
}
```

> **Open question:** The exact string values emitted by Prometheus into `deployment_state` are not known from source code inspection. The Prometheus scraper stores them directly. This must be verified against live data in Wave 0 before finalising the derivation logic. [ASSUMED mapping above — treat as placeholder]

### Pattern 3: VIEW-01 Aggregate Computation
**What:** No `/api/overview` endpoint exists. Aggregates (p50/p95 across all models) must be computed from the `/api/models` array in the frontend.
**Approach:** Median-of-medians is acceptable for p50 display given small N (7 models). Filter out nulls before computing.

```typescript
// Weighted average tokens/sec; median p50/p95 across non-null values
function computeOverview(models: ModelAggregate[]) {
  const nonNull = <T>(arr: (T | null)[]): T[] => arr.filter((x): x is T => x !== null);
  const median = (vals: number[]) => {
    if (!vals.length) return null;
    const s = [...vals].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  return {
    ttft_p50: median(nonNull(models.map(m => m.ttft_p50))),
    ttft_p95: median(nonNull(models.map(m => m.ttft_p95))),
    total_latency_p50: median(nonNull(models.map(m => m.total_latency_p50))),
    total_latency_p95: median(nonNull(models.map(m => m.total_latency_p95))),
    tokens_per_sec: nonNull(models.map(m => m.tokens_per_sec)).reduce((a, b) => a + b, 0),
    avg_context_utilization: (() => {
      const vals = nonNull(models.map(m => m.avg_context_utilization));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    })(),
  };
}
```

### Anti-Patterns to Avoid

- **Installing tailwindcss before shadcn init:** shadcn init manages Tailwind version and config. Pre-installing tailwindcss can produce v3/v4 conflicts. Run `npx shadcn@latest init` first in a fresh Vite project.
- **Editing `src/components/ui/` files:** shadcn generates these. Any manual edits are overwritten by `npx shadcn@latest add`. Custom components go in `src/components/`, not `src/components/ui/`.
- **Using VITE_SIDECAR_URL env with hardcoded docker hostname at build time:** `VITE_SIDECAR_URL=http://dashboard-sidecar:4001` would be wrong — this is a container DNS name, not reachable from the browser. The correct value is `http://docker-001:4001`.
- **Calling the sidecar from the nginx container:** The sidecar URL is used in browser JavaScript, not server-side. No proxy configuration in nginx is needed for the API calls.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Card containers | Custom div-based cards | `shadcn Card` | Consistent spacing, dark theme tokens baked in |
| Status badge labels | Styled `<span>` | `shadcn Badge` with variant | Accessible, consistent with design system |
| Data table (node grid) | Custom `<table>` | `shadcn Table` | Correct border/spacing tokens, accessible headers |
| Tooltip on hover | `title` attribute or custom portal | `shadcn Tooltip` (Radix) | Keyboard accessible, correct z-index, aria-describedby handled |
| Context utilization bar | `<div>` with width% | `shadcn Progress` | Accessible aria-valuenow/valuemax, animation built in |
| Icon set | SVG inline or custom | `lucide-react` | Tree-shakeable, consistent stroke weight, typed |

Hand-rolled only (intentional, per UI-SPEC):
- `ToolCallBar.tsx` — stacked bar (3 coloured segments). ~30 lines. No suitable shadcn primitive.
- `StatusDot.tsx` — 8px circle. `aria-hidden="true"`.
- `RefreshRing.tsx` — SVG arc countdown ring. Uses `stroke-dashoffset` driven by countdown state.

---

## Docker and Serving Architecture

### Dashboard Container (Dockerfile)
```dockerfile
# dashboard/Dockerfile
# Build stage
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Serve stage
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

```nginx
# dashboard/nginx.conf
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;
    # SPA fallback — not strictly needed (no routing in Phase 2) but harmless
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### docker-compose.yaml Addition
```yaml
  dashboard:
    build: ./dashboard
    image: dashboard:local
    container_name: dashboard
    restart: unless-stopped
    ports:
      - "4002:80"
    networks:
      - traefik-net
    labels:
      - "autoheal=true"
    logging:
      driver: "json-file"
      options:
        max-size: "50m"
        max-file: "3"
```

> Note: The dashboard container does NOT need `litellm-internal` network. It serves static files. API calls go browser → docker-001:4001 (outside the container).
> Note: No `depends_on: dashboard-sidecar` needed — if sidecar is down, the dashboard shows connection-lost state; startup order is irrelevant.

---

## CORS Configuration

The dashboard JavaScript runs in the user's browser at `http://docker-001:4002`. It fetches `http://docker-001:4001/api/*`. These are different origins (different port = different origin). The sidecar must allow this origin.

Add `CORSMiddleware` to `dashboard-sidecar/main.py`:

```python
# Source: FastAPI CORS docs [ASSUMED pattern — standard FastAPI middleware]
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://docker-001:4002"],
    allow_methods=["GET"],
    allow_headers=["*"],
)
```

> Keep `allow_origins` specific, not `["*"]`. The dashboard is LAN-only; there is no need to open CORS to all origins.

---

## Traefik Routing

**Critical finding:** This Traefik deployment uses **file-based dynamic config only** — no docker labels provider is configured in `traefik.yml`. All routing is in `/home/rhx/projects/home-infra-backups/traefik/services.yml`. [VERIFIED from traefik.yml — providers block has `file:` only, no `docker:` provider]

To add `dashboard.thelaljis.com`, edit `traefik/services.yml`:

```yaml
# Add to http.routers:
    dashboard:
      entryPoints:
      - websecure
      # No middlewares: block — SYS-03 requires no auth
      rule: Host(`dashboard.thelaljis.com`)
      service: dashboard
      tls:
        certResolver: cloudflare

# Add to http.services:
    dashboard:
      loadBalancer:
        servers:
        - url: http://192.168.50.117:4002
```

**Pattern verified from:** `litellm`, `honcho`, `firecrawl`, `gitea`, `paperclip` entries — all omit `middlewares:` and thus have no Authentik prompt. [VERIFIED from services.yml]

The Traefik config file is watched live (`watch: true` in `traefik.yml`) — no Traefik restart needed after editing `services.yml`. [VERIFIED from traefik.yml]

---

## SYS-03: Authentication Decision

SYS-03 states "local network access only (no external auth required)." The implementation is: **omit the `authentik` middleware from the Traefik router** for the dashboard service. This is the same pattern as `litellm.thelaljis.com`, `honcho.thelaljis.com`, and others in `services.yml` that intentionally have no `middlewares:` block.

The Phase 1 summary states the sidecar is "behind Authentik SSO at sidecar.thelaljis.com" — this needs clarification. Inspection of docker-compose.yaml shows the sidecar service only has `autoheal=true` labels and no Traefik labels at all. The sidecar entry may not actually be in services.yml yet (grep found nothing). The sidecar is accessible directly at `http://docker-001:4001` without any auth. The dashboard can call it at that address. Traefik routing for sidecar.thelaljis.com may be planned but not yet added.

**Implication for Phase 2:** The dashboard calls `http://docker-001:4001` directly (no Traefik hop needed for the sidecar API calls from the browser on LAN).

---

## Common Pitfalls

### Pitfall 1: shadcn Tailwind Version Conflict
**What goes wrong:** `shadcn init` fails or produces broken styles when Tailwind v4 is already installed; shadcn expects v3 CSS variable conventions.
**Why it happens:** `npm create vite` does not install Tailwind. If Tailwind is installed manually first at v4, `shadcn init` may conflict.
**How to avoid:** Let `npx shadcn@latest init` install Tailwind as part of its flow. Do not `npm install tailwindcss` beforehand.
**Warning signs:** `shadcn init` output shows an error about tailwind config format; `@apply` directives fail in browser.

### Pitfall 2: VITE_SIDECAR_URL Baked as Container-Internal Name
**What goes wrong:** Developer sets `VITE_SIDECAR_URL=http://dashboard-sidecar:4001` — works in container networking tests but fails in browser because `dashboard-sidecar` is not a resolvable hostname on the user's machine.
**Why it happens:** Vite `VITE_*` env vars are inlined into the JS bundle at build time. The build runs in the container; the JS runs in the browser.
**How to avoid:** Use `http://docker-001:4001` as the sidecar URL. It must be a hostname the browser can resolve.

### Pitfall 3: availability_status Not in API
**What goes wrong:** Frontend code tries to read `node.availability_status` and gets `undefined`. Badges show "unknown" for all nodes.
**Why it happens:** `/api/nodes` returns `deployment_state`, not `availability_status`. Status must be derived.
**How to avoid:** Type `NodeRow` accurately from the actual API shape. Implement `deriveStatus()` in the types layer.

### Pitfall 4: Context Utilization as Fraction
**What goes wrong:** Context utilization displays as "0.67%" instead of "67%".
**Why it happens:** `/api/models` returns `avg_context_utilization` as a 0.0–1.0 fraction. Formatting function must multiply by 100 before appending "%".
**How to avoid:** Format function: `Math.round(value * 100)` → `"67%"`.

### Pitfall 5: components.json Missing Before shadcn add
**What goes wrong:** `npx shadcn@latest add card` fails with "components.json not found."
**Why it happens:** `shadcn add` requires `shadcn init` to have run first in the same directory.
**How to avoid:** `npx shadcn@latest init` must complete and `components.json` must exist before any `shadcn add` command.

### Pitfall 6: React 19 Strict Mode Double Fetch
**What goes wrong:** Dashboard makes two simultaneous fetches on mount in development; countdown resets unexpectedly.
**Why it happens:** React 19 Strict Mode double-invokes effects in development.
**How to avoid:** Cleanup function in `useEffect` clears both intervals. Fetch responses after unmount should be ignored (AbortController or `isMounted` flag). This is dev-only behaviour; production build is unaffected.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Vite scaffold, npm install | Yes | v22.22.2 | — |
| npm | Package management | Yes | 10.9.7 | — |
| npx | shadcn init | Yes | 10.9.7 | — |
| Docker | Container build | Yes | 29.3.0 | — |
| nginx (host) | Not required — runs in container | N/A | — | — |
| docker-001:4001 | Sidecar API | Assumed live (Phase 1 completed) | — | Error state in UI |

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (Vite-native, no config overhead) |
| Config file | `dashboard/vite.config.ts` — add `test:` block |
| Quick run command | `cd dashboard && npx vitest run` |
| Full suite command | `cd dashboard && npx vitest run --coverage` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MET-01 | ttft_p50/p95 formatted as integer ms with `—` for null | unit | `npx vitest run src/lib/format.test.ts` | No — Wave 0 |
| MET-02 | total_latency_p50/p95 formatted, comma sep ≥1000 | unit | `npx vitest run src/lib/format.test.ts` | No — Wave 0 |
| MET-03 | tokens_per_sec formatted to 1 decimal | unit | `npx vitest run src/lib/format.test.ts` | No — Wave 0 |
| MET-04 | avg_context_utilization × 100 → integer % | unit | `npx vitest run src/lib/format.test.ts` | No — Wave 0 |
| MET-05 | tool_call_rates rendered as stacked bar | unit | `npx vitest run src/components/ToolCallBar.test.tsx` | No — Wave 0 |
| VIEW-01 | computeOverview returns correct median/sum | unit | `npx vitest run src/lib/aggregate.test.ts` | No — Wave 0 |
| VIEW-02 | deriveStatus maps deployment_state + scrape age | unit | `npx vitest run src/lib/status.test.ts` | No — Wave 0 |
| SYS-03 | No auth prompt / no auth headers sent | smoke | manual browser check on `http://docker-001:4002` | Manual only |

### Sampling Rate
- **Per task commit:** `cd dashboard && npx vitest run`
- **Per wave merge:** `cd dashboard && npx vitest run --coverage`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `dashboard/src/lib/format.test.ts` — covers MET-01 through MET-04 formatting functions
- [ ] `dashboard/src/lib/aggregate.test.ts` — covers VIEW-01 computeOverview logic
- [ ] `dashboard/src/lib/status.test.ts` — covers VIEW-02 deriveStatus logic
- [ ] `dashboard/src/components/ToolCallBar.test.tsx` — covers MET-05 bar rendering
- [ ] Install Vitest: `npm install --save-dev vitest @testing-library/react @testing-library/user-event jsdom`
- [ ] Add to `vite.config.ts`: `test: { environment: 'jsdom' }`

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | shadcn@4.x targets Tailwind v3; pre-installing Tailwind v4 before `shadcn init` causes conflicts | Standard Stack (Tailwind warning) | Low — executor can resolve at init time by checking shadcn output |
| A2 | `deployment_state` Prometheus values are human-readable strings like "healthy"/"running"/"down" | Architecture Patterns (deriveStatus) | Medium — if values are numeric codes, status derivation logic is wrong; verify against live `/api/nodes` in Wave 0 |
| A3 | FastAPI CORSMiddleware is the correct approach (standard FastAPI pattern) | CORS section | Low — this is well-established FastAPI usage |
| A4 | sidecar.thelaljis.com is not yet active in traefik/services.yml | Traefik Routing / SYS-03 | Low — grep of services.yml confirmed no sidecar/dashboard entry exists |

---

## Open Questions

1. **What exact string values does `deployment_state` contain in live data?**
   - What we know: Column stored directly from Prometheus scrape in `latency_snapshots`
   - What's unclear: Whether values are "healthy"/"running"/"unreachable" or numeric codes or Prometheus metric label values
   - Recommendation: Wave 0 task must call `http://docker-001:4001/api/nodes` and log actual `deployment_state` values before writing `deriveStatus()`

2. **Does sidecar.thelaljis.com have Authentik middleware in the live Traefik config?**
   - What we know: Phase 1 summary says "Authentik SSO" but services.yml has no sidecar entry; docker-compose has no Traefik labels for sidecar
   - What's unclear: Whether there is an out-of-repo Traefik config entry for the sidecar
   - Recommendation: Wave 0 task should verify `http://docker-001:4001/api/models` is reachable from browser without auth prompt

3. **Does `avg_context_utilization` in /api/models represent a rolling average of what time window?**
   - What we know: SQL query in `models.py` is `WHERE startTime > NOW() - INTERVAL 1 HOUR`
   - What's unclear: Whether this is sufficient for the VIEW-01 "current context pressure" display
   - Recommendation: Use as-is; document the 1-hour window in the tooltip per UI-SPEC hover contract

---

## Sources

### Primary (HIGH confidence)
- `dashboard-sidecar/routers/models.py` — verified API response shape for `/api/models`
- `dashboard-sidecar/routers/nodes.py` — verified API response shape for `/api/nodes`
- `dashboard-sidecar/routers/requests.py` — verified `/api/requests` shape (Phase 3)
- `dashboard-sidecar/routers/latency.py` — verified `/api/latency/snapshots` shape (Phase 3)
- `docker-compose.yaml` — verified service topology, networks, ports
- `.planning/phases/02-core-dashboard/02-UI-SPEC.md` — locked design decisions
- `traefik/traefik.yml` — verified file-only provider (no docker labels provider)
- `traefik/services.yml` — verified routing patterns, Authentik middleware usage, absence of sidecar/dashboard entries
- npm registry — verified package versions for vite, react, typescript, shadcn, lucide-react

### Secondary (MEDIUM confidence)
- `.planning/phases/01-data-collection-layer/01-05-SUMMARY.md` — Phase 1 completion evidence

### Tertiary (LOW confidence)
- shadcn/Tailwind v3 coupling assumption — based on training knowledge, not verified via shadcn init dry-run

---

## Metadata

**Confidence breakdown:**
- API shapes: HIGH — read directly from source files
- Infrastructure topology: HIGH — read from docker-compose.yaml and traefik config
- Traefik routing pattern: HIGH — verified from services.yml and traefik.yml
- shadcn init commands: HIGH — verified shadcn version from npm registry; exact init flags from UI-SPEC
- Tailwind v3 vs v4 shadcn compatibility: LOW — assumed from training data
- deployment_state string values: LOW — not inspectable from source; requires live data

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable stack; npm versions may drift)
