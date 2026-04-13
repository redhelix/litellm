# Stack Research

**Domain:** LLM observability/metrics dashboard (local, single-user, reads from LiteLLM proxy)
**Researched:** 2026-04-13
**Confidence:** MEDIUM-HIGH (core framework choices are HIGH; some library version pins are MEDIUM based on npm + official changelog cross-check)

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| React | 19.x | UI rendering | Current stable; required for React 19 concurrent features and Server Components if needed later. Recharts 3.x explicitly supports it. |
| Vite | 6.x | Build tool / dev server | Instant HMR, minimal config, purpose-built for SPA dashboards. No SSR or routing overhead. Next.js is overkill for a local single-user tool with no SEO or auth requirements. |
| TypeScript | 5.x | Type safety | Standard in 2025 React ecosystem; catches data-shape mismatches from LiteLLM API responses early. |
| Tailwind CSS | 4.x | Styling | CSS-first config (no `tailwind.config.js`), smallest output, co-located style without context switching. v4 is stable and shadcn/ui has full v4 support as of Feb 2025. |
| shadcn/ui | latest (canary) | Component library | Copy-paste components, not a dependency — you own the code. Built on Radix UI primitives. Full Tailwind v4 + React 19 compatibility confirmed. Avoids vendor lock-in for a custom dashboard. |
| Recharts | 3.x (latest: 3.8.1) | Charting | Used directly by shadcn/ui charts. v3 rewrote state management for performance, supports React 19 natively. Recharts is the pragmatic choice: well-documented, component-driven, SVG-based. |

### Data Fetching & State

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| TanStack Query (React Query) | v5 | Server state, polling, caching | Primary data-fetching layer. `refetchInterval` handles 15-30s polling of LiteLLM REST endpoints cleanly. Built-in deduplication, stale-while-revalidate, and background refetch — avoids hand-rolling polling logic. |
| Zustand | v5 | UI/client state | Selected time range, active model filter, panel layout preferences. Use for state that is not a server response. Simpler than Jotai for a dashboard with clear, non-atomic state boundaries. |

### Backend / Data Collection

| Technology | Version | Purpose | Notes |
|------------|---------|---------|-------|
| LiteLLM REST API | — | Primary data source | `/v1/model/info`, `/spend/logs`, `/user/daily/activity`, `/health`, `/metrics`. All available on port 4000 with `Bearer LITELLM_MASTER_KEY`. No proxy changes needed — read-only. Confidence: HIGH (verified against docs.litellm.ai). |
| LiteLLM Prometheus `/metrics` | — | Real-time counters | LiteLLM already exposes Prometheus metrics at `http://docker-001:4000/metrics` (unauthenticated by default on local). Contains latency histograms, token counts, error rates. Scrape this directly from the dashboard backend or poll it from the frontend via a thin proxy. |
| PostgreSQL (existing `litellm-db`) | 16 | Historical spend/log queries | The `LiteLLMSpendLogs` table contains per-request records: model, tokens, latency, spend, start/end time. Query directly via SQL for aggregations that LiteLLM's API doesn't expose (e.g., p95 latency per model over 7 days). Use `pg` or `postgres.js` in a lightweight Express/Fastify backend sidecar. |

### Backend Sidecar (thin API layer)

A minimal Node.js or Python sidecar is needed to:
1. Query PostgreSQL directly for aggregated metrics the LiteLLM API doesn't expose
2. Proxy Prometheus `/metrics` scrapes (avoids CORS from browser)
3. Optionally stream SSE to frontend for live updates

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Hono | 4.x | Sidecar HTTP framework | Minimal, fast, runs on Node 20+. Excellent TypeScript DX. Purpose-built for thin API layers. Alternatively use Fastify if you want heavier middleware ecosystem. |
| `postgres` (porsager/postgres) | 3.x | PostgreSQL client | Tag-template SQL syntax, connection pooling, type-safe results. Lighter than Prisma for this use case (no ORM needed, just raw queries). |
| `prom-client` | 15.x | Parse Prometheus text | If you want to transform `/metrics` scrape into JSON for the frontend, prom-client can parse the text format. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Vite dev server proxy | Forward `/api/*` to sidecar during development | Avoids CORS issues in dev. Configure in `vite.config.ts` under `server.proxy`. |
| `date-fns` or `dayjs` | Date manipulation for time-range selectors | `dayjs` is 2KB; `date-fns` is more tree-shakeable. Either works. Avoid Moment.js (deprecated). |
| `clsx` + `tailwind-merge` | Conditional class composition | Already included with shadcn/ui setup. |

---

## Installation

```bash
# Scaffold with Vite + React + TypeScript
npm create vite@latest litellm-dashboard -- --template react-ts
cd litellm-dashboard

# Tailwind CSS v4
npm install tailwindcss @tailwindcss/vite

# shadcn/ui (follow CLI init for v4)
npx shadcn@latest init

# Core
npm install recharts @tanstack/react-query zustand

# Sidecar
npm install hono postgres

# Utilities
npm install dayjs clsx tailwind-merge

# Dev
npm install -D @types/node
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Vite | Next.js 15 | If you later need SSR, API routes co-located with frontend, or public-facing pages. For a local dashboard, the overhead is unjustified. |
| Recharts 3.x | Nivo | Nivo has better out-of-box aesthetics but poor documentation and smaller community. Debugging issues mid-build is painful. Recharts wins for maintainability. |
| Recharts 3.x | Victory | Victory is fine but less actively maintained. Recharts has stronger 2025 momentum (v3 release, shadcn integration). |
| TanStack Query polling | SSE or WebSockets | SSE/WS add infra complexity (streaming connection management, reconnection). For LLM metrics, 15-30s polling is perfectly adequate — inference requests are not sub-second events. Use SSE only if you add live log streaming later. |
| Hono sidecar | Python/FastAPI sidecar | FastAPI is fine but adds a Python runtime. If the existing LiteLLM container is available, a thin Node sidecar keeps the stack homogeneous with the frontend. If you prefer Python, FastAPI with `asyncpg` is a clean alternative. |
| Zustand | Jotai | Jotai excels at fine-grained atomic reactivity. For this dashboard, state is simple (selected model, time window, polling toggle) — Zustand's store model is cleaner and less ceremonial. |
| `postgres` (porsager) | Prisma | Prisma ORM is overkill. The dashboard needs 5-10 read-only SQL queries. Raw tagged-template SQL with `postgres` is faster to write and debug. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Grafana + Prometheus | PROJECT.md explicitly rules this out. Also: Grafana requires a separate running service, config files, and panel DSL — slower iteration than a custom React chart. | Custom React app with Recharts |
| Tremor (chart library) | Built on top of Recharts but hides the underlying API, making deep customizations (custom tooltips, mixed chart types) difficult. Adds abstraction without payoff for a custom dashboard. | Recharts 3.x directly via shadcn/ui chart primitives |
| Chart.js / react-chartjs-2 | Canvas-based rendering. Harder to style with Tailwind, no SVG composability, weaker React integration than Recharts. | Recharts |
| Moment.js | Deprecated since 2020, 300KB+. | `dayjs` (2KB) or `date-fns` |
| Redux Toolkit | Heavyweight for a single-user local tool. Zustand provides the same pattern with 90% less boilerplate. | Zustand |
| OpenTelemetry SDK (frontend) | LiteLLM already exports OpenTelemetry-compatible data via its Prometheus endpoint and W&B Weave integration. Adding an OTel SDK to the dashboard frontend duplicates instrumentation that already exists. Read from LiteLLM's existing outputs instead. | LiteLLM REST API + `/metrics` endpoint |
| Direct browser-to-PostgreSQL | Browsers cannot speak the PostgreSQL wire protocol. Always proxy through the sidecar. | Hono sidecar with `postgres` client |

---

## Stack Patterns by Variant

**If you add live log streaming later (tail -f equivalent):**
- Add a `GET /stream/logs` SSE endpoint to the Hono sidecar
- Use `EventSource` or the `@microsoft/fetch-event-source` library on the frontend
- Do not replace TanStack Query polling — use SSE alongside it for the log viewer only

**If the sidecar adds too much complexity:**
- Skip the sidecar initially; poll only the LiteLLM REST API (`/spend/logs`, `/model/info`, `/health`) from TanStack Query
- Add direct PostgreSQL access in a second iteration when you hit aggregation limits in the LiteLLM API
- The Prometheus `/metrics` endpoint can be fetched as raw text via a CORS proxy header or by running the dashboard on the same Docker network

**If you want to containerize the dashboard:**
- Add a `dashboard` service to the existing `docker-compose.yaml` on `litellm-internal` network
- Build with `vite build`, serve static output with `nginx:alpine` or `serve` (npx)
- Sidecar runs as a separate container on the same internal network for PostgreSQL access

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| recharts@3.x | react@19.x | Explicitly supported per recharts releases page (Apr 2026: v3.8.1) |
| shadcn/ui (canary) | tailwindcss@4.x + react@19 | Full v4 compatibility confirmed in Feb 2025 changelog |
| @tanstack/react-query@5 | react@18 and react@19 | v5 is stable and React 19 compatible |
| zustand@5 | react@18 and react@19 | v5 released 2024, React 19 compatible |
| tailwindcss@4 | vite@6 | Use `@tailwindcss/vite` plugin (replaces PostCSS config) |
| tailwindcss@4 | tailwindcss-animate | **Incompatible** — tailwindcss-animate is deprecated for v4; use `tw-animate-css` instead |

---

## LiteLLM Data Sources Reference

These endpoints are confirmed available in LiteLLM v1.83.6 (your deployed version):

| Endpoint | Method | Data | Auth |
|----------|--------|------|------|
| `/v1/model/info` | GET | Model list, max_tokens, deployment config | Bearer master key |
| `/health` | GET | Per-model health/availability | Bearer master key |
| `/spend/logs` | GET | Per-request logs with latency, tokens, spend | Bearer master key |
| `/user/daily/activity` | GET | Aggregated daily stats by model/provider | Bearer master key |
| `/metrics` | GET | Prometheus text format: latency histograms, error rates, token counts | Unauthenticated by default |
| PostgreSQL `LiteLLMSpendLogs` | SQL | Full request log with `startTime`, `endTime`, `model`, `completionTokens`, `promptTokens`, `response_time` | Internal network only |

---

## Sources

- [LiteLLM Prometheus docs](https://docs.litellm.ai/docs/proxy/prometheus) — verified endpoint, metrics list, auth behavior — MEDIUM confidence (version drift possible)
- [LiteLLM Spend Tracking docs](https://docs.litellm.ai/docs/proxy/cost_tracking) — confirmed `/spend/logs`, `/user/daily/activity` — MEDIUM confidence
- [LiteLLM Model Management docs](https://docs.litellm.ai/docs/proxy/model_management) — confirmed `/v1/model/info` — MEDIUM confidence
- [Recharts npm](https://www.npmjs.com/package/recharts) — v3.8.1 current, React 19 support — HIGH confidence
- [Recharts 3.0 migration guide](https://github.com/recharts/recharts/wiki/3.0-migration-guide) — v3 state rewrite, removed dependencies — HIGH confidence
- [shadcn/ui Tailwind v4 changelog](https://ui.shadcn.com/docs/changelog/2025-02-tailwind-v4) — full v4 + React 19 compat — HIGH confidence
- [TanStack Query polling docs](https://tanstack.com/query/latest/docs/framework/react/guides/polling) — `refetchInterval` pattern — HIGH confidence
- [Vite vs Next.js comparison (Strapi)](https://strapi.io/blog/vite-vs-nextjs-2025-developer-framework-comparison) — SPA dashboard → Vite recommendation — MEDIUM confidence (editorial, not official)
- [Zustand vs Jotai (2025)](https://dev.to/hijazi313/state-management-in-2025-when-to-use-context-redux-zustand-or-jotai-2d2k) — dashboard use case → Zustand — MEDIUM confidence (community post)

---

*Stack research for: LiteLLM Lab Dashboard (local LLM observability)*
*Researched: 2026-04-13*
