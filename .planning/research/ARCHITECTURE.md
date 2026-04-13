# Architecture Research

**Domain:** LLM observability dashboard (read-only, single-user, local network)
**Researched:** 2026-04-13
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      FRONTEND LAYER                              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Next.js App (React, Recharts/Tremor, SWR polling)       │   │
│  └──────────────────────────┬───────────────────────────────┘   │
└─────────────────────────────┼───────────────────────────────────┘
                              │ HTTP (local network)
┌─────────────────────────────┼───────────────────────────────────┐
│                      API LAYER                                   │
│  ┌──────────────────────────▼───────────────────────────────┐   │
│  │  FastAPI (Python)                                        │   │
│  │  /api/metrics  /api/models  /api/nodes  /api/benchmark   │   │
│  └──────┬─────────────────────────────────┬─────────────────┘   │
└─────────┼─────────────────────────────────┼─────────────────────┘
          │                                 │
┌─────────┼─────────────────────────────────┼─────────────────────┐
│   COLLECTION LAYER                        │                      │
│  ┌──────▼──────────┐           ┌──────────▼──────────────────┐  │
│  │ LiteLLM API     │           │ Prometheus Scraper          │  │
│  │ Poller          │           │ (192.168.50.117:9090)        │  │
│  │                 │           │                             │  │
│  │ /spend/logs     │           │ /metrics endpoint           │  │
│  │ /metrics        │           │ litellm_*_latency           │  │
│  │ /model/info     │           │ litellm_*_tokens            │  │
│  │ (REST, cron)    │           │ litellm_deployment_state    │  │
│  └──────┬──────────┘           └──────────┬──────────────────┘  │
└─────────┼────────────────────────────────┼──────────────────────┘
          │                                │
┌─────────┼────────────────────────────────┼──────────────────────┐
│   STORAGE LAYER                          │                      │
│  ┌──────▼──────────────────────────────▼─┴──────────────────┐  │
│  │  DuckDB (embedded, single file)                           │  │
│  │  metrics.duckdb                                           │  │
│  │                                                           │  │
│  │  tables: requests, latency_snapshots, node_health,        │  │
│  │          benchmark_results                                │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
          │ read-only pass-through (no storage)
┌─────────▼─────────────────────────────────────────────────────┐
│                    EXISTING INFRASTRUCTURE                      │
│  LiteLLM Proxy :4000   PostgreSQL (litellm-db)                 │
│  Prometheus :9090       Redis (litellm-redis)                  │
│  5 GPU Nodes (Ollama/vLLM endpoints)                           │
└───────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| Frontend | Visualize metrics, auto-refresh, user interaction | Next.js + Recharts or Tremor + SWR |
| API Layer | Serve aggregated metrics to frontend, route queries to storage | FastAPI (Python) |
| LiteLLM API Poller | Pull spend logs, model info, request history from LiteLLM REST API | Python asyncio scheduler (APScheduler) |
| Prometheus Scraper | Pull real-time latency/token/health metrics from existing Prometheus | prometheus_client or httpx query against PromQL |
| DuckDB | Store and query time-series metrics locally; analytical queries | DuckDB embedded (no separate process) |
| Benchmark Runner | On-demand inference latency tests against model endpoints | httpx async, triggered via API |

## Data Collection Layer — Decision

**Use LiteLLM REST API polling + Prometheus scraping. Do not use a custom callback.**

Three options were evaluated:

**Option A: Custom callback hook (Python CustomLogger)**
- Requires bind-mounting a new `.py` file and updating `config.yaml` callbacks
- Fires synchronously in the proxy hot path — any bug crashes the proxy
- Gives raw per-request data in real time
- Violates the "must not require changes to LiteLLM proxy internals" constraint if config.yaml changes are treated as internals

**Option B: PostgreSQL direct polling**
- LiteLLM's `litellm-db` PostgreSQL stores spend logs including prompts, tokens, costs per request
- Works without any proxy changes
- Schema is LiteLLM-internal and may change between versions (fragile coupling)
- Direct DB access bypasses LiteLLM's auth layer (acceptable on local network but ugly)

**Option C: LiteLLM REST API polling + Prometheus (RECOMMENDED)**
- `/spend/logs` — per-request spend, token counts, model name, latency, timestamps
- `/model/info` — deployed model list, health status
- Prometheus `/metrics` at existing server — TTFT histogram, latency histogram, deployment state gauge
- No changes to LiteLLM config or container
- Well-documented stable API surface
- Prometheus already running at `192.168.50.117:9090` — can be queried via PromQL over HTTP

Use a 30-second polling interval for live metrics, 5-minute interval for spend log backfill. Store in DuckDB for aggregation queries.

## Storage Layer — Decision

**Use DuckDB. Not SQLite, not InfluxDB.**

| Criterion | SQLite | InfluxDB | DuckDB |
|-----------|--------|----------|--------|
| Time-series aggregation (AVG latency over 24h) | Slow (row scan) | Fast (native) | Fast (columnar) |
| Embedded, no daemon | Yes | No (separate server) | Yes |
| Python integration | Simple | Requires client lib | Simple |
| Complex analytical queries (P95, rollups, joins) | Painful | Limited SQL | Excellent |
| Write throughput | ~30k/s | High | ~4k/s naive (sufficient for polling workload) |
| Operational overhead | None | High | None |

Write throughput is not a concern here — the collection pattern is polling, not event stream ingestion. At 30s intervals, the dashboard writes at most ~120 rows/hour per model. DuckDB's analytical query performance is the win that matters.

A single `metrics.duckdb` file can be volume-mounted alongside the dashboard container.

## Recommended Project Structure

```
dashboard/
├── docker-compose.yaml        # dashboard service, volume for duckdb
├── Dockerfile                 # Python + Node build
├── backend/
│   ├── main.py                # FastAPI app, router registration
│   ├── config.py              # LiteLLM URL, Prometheus URL, poll intervals
│   ├── database.py            # DuckDB connection + schema init
│   ├── collectors/
│   │   ├── litellm_poller.py  # Polls /spend/logs, /model/info
│   │   └── prometheus_scraper.py  # PromQL queries for latency/token metrics
│   ├── scheduler.py           # APScheduler job registration
│   └── routers/
│       ├── metrics.py         # GET /api/metrics (latency, tokens, throughput)
│       ├── models.py          # GET /api/models (health, config)
│       ├── nodes.py           # GET /api/nodes (per-node status)
│       └── benchmark.py       # POST /api/benchmark/run, GET /api/benchmark/results
├── frontend/
│   ├── app/                   # Next.js App Router
│   │   ├── page.tsx           # Overview dashboard
│   │   ├── models/page.tsx    # Per-model detail
│   │   └── config-drift/page.tsx  # Deployed vs local diff
│   ├── components/
│   │   ├── charts/            # Recharts wrappers
│   │   └── tables/
│   └── lib/
│       └── api.ts             # SWR hooks, fetch helpers
└── data/
    └── metrics.duckdb         # Persistent storage (gitignored)
```

### Structure Rationale

- **backend/collectors/:** Isolated from API layer — can be tested and replaced independently. New data sources = new file here, no API changes.
- **backend/routers/:** One router per dashboard section. Each router queries DuckDB directly — no service layer needed at this scale.
- **frontend/app/:** Next.js App Router with page-level code splitting. Dashboard sections are independent pages — natural navigation boundaries.
- **data/:** DuckDB file lives outside the build context, persists across redeploys.

## Architectural Patterns

### Pattern 1: Pull-based Collection with Local Cache

**What:** Dashboard pulls from LiteLLM API on a schedule and caches results in DuckDB. Frontend never hits LiteLLM directly.
**When to use:** When the data source (LiteLLM) is not owned by the dashboard and may not support concurrent query load.
**Trade-offs:** Data is 30-60 seconds stale on the live view; historical queries are instant from DuckDB.

### Pattern 2: PromQL Pass-through for Live Metrics

**What:** For current deployment health (node up/down, in-flight requests), query the existing Prometheus server directly via PromQL HTTP API rather than caching in DuckDB.
**When to use:** For metrics that are already well-served by Prometheus and don't need historical aggregation beyond what Prometheus retains.
**Trade-offs:** Dashboard has a runtime dependency on Prometheus being reachable; but Prometheus is already running on the same host.

**Example:**
```python
# Query Prometheus for deployment state
resp = await httpx.get(
    "http://192.168.50.117:9090/api/v1/query",
    params={"query": "litellm_deployment_state"}
)
data = resp.json()["data"]["result"]
```

### Pattern 3: Config Drift Surface via File Diff

**What:** Compare local `config.yaml` (repo) against deployed config fetched via SSH or stored as a known snapshot. Present structured diff in the dashboard.
**When to use:** For the "deployed vs local config drift" requirement.
**Trade-offs:** Requires either SSH access from the container or a snapshot committed to the repo. SSH is simpler — `paramiko` or `subprocess ssh` with a key.

## Data Flow

### Live Metrics Flow (30s poll)

```
APScheduler (30s) → litellm_poller.py
    → GET http://docker-001:4000/spend/logs?start_date=<now-30s>
    → parse: model, latency_ms, input_tokens, output_tokens, cost, success
    → INSERT INTO duckdb: requests table

APScheduler (30s) → prometheus_scraper.py
    → PromQL: litellm_llm_api_time_to_first_token_metric
    → PromQL: litellm_request_total_latency_metric
    → PromQL: litellm_deployment_state
    → INSERT INTO duckdb: latency_snapshots, node_health tables

Browser (SWR, 30s revalidate) → GET /api/metrics?window=1h
    → FastAPI router → DuckDB query (aggregation)
    → JSON response → Recharts render
```

### On-Demand Benchmark Flow

```
User clicks "Run benchmark" → POST /api/benchmark/run
    → FastAPI enqueues async task
    → Task: POST to each model endpoint with standard prompt
    → Measure TTFT, total latency, token count
    → INSERT results into duckdb: benchmark_results table
    → GET /api/benchmark/results → frontend polls until complete
```

### Config Drift Flow (on page load)

```
GET /api/config/drift
    → FastAPI: read local config.yaml (bind-mounted into container)
    → SSH: fetch /opt/litellm/config.yaml from docker-001
    → Diff key fields: routing_strategy, max_tokens, model_list, master_key pattern
    → Return structured diff JSON
    → Frontend renders diff table
```

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| LiteLLM Proxy `:4000` | REST polling, `Authorization: Bearer $LITELLM_MASTER_KEY` | Poll `/spend/logs`, `/model/info`, `/health` |
| Prometheus `:9090` | PromQL HTTP API (`/api/v1/query`, `/api/v1/query_range`) | Already running; no additional config needed |
| GPU Nodes (Ollama/vLLM) | Direct HTTP for benchmark runner only | `hintonator:11434`, `spark-002:11434`, etc. |
| docker-001 (SSH) | paramiko for config drift fetch | Read-only, one key in dashboard container |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Frontend ↔ API Layer | HTTP/JSON, SWR polling | No WebSocket needed; 30s refresh is sufficient |
| API Layer ↔ DuckDB | In-process function call (embedded) | DuckDB runs in FastAPI process — no network hop |
| API Layer ↔ Collectors | APScheduler jobs run in same FastAPI process | Use `startup` event to register scheduler |
| Collectors ↔ LiteLLM | HTTP (httpx async) | LiteLLM master key in env var, not hardcoded |

## Build Order (Phase Dependencies)

```
Phase 1: Storage + Collection foundation
  → DuckDB schema + database.py
  → LiteLLM API poller (spend/logs)
  → APScheduler wiring in FastAPI startup
  (nothing else can work without data flowing)

Phase 2: Core API endpoints
  → /api/metrics (latency, tokens, throughput aggregations)
  → /api/models (health, deployment state)
  (frontend is unblockable once these exist)

Phase 3: Frontend — overview dashboard
  → SWR polling hooks
  → Latency chart, token usage chart, model health table
  (delivers the primary value proposition)

Phase 4: Prometheus integration
  → prometheus_scraper.py
  → TTFT histogram, in-flight requests
  (enriches existing data with real-time signal)

Phase 5: Benchmark runner
  → POST /api/benchmark/run (async task)
  → Benchmark results page
  (standalone feature, no blockers from other phases)

Phase 6: Config drift surface
  → SSH fetch + structured diff
  → Config drift page
  (independent, low-risk addition)
```

## Anti-Patterns

### Anti-Pattern 1: Custom Callback as Primary Collection

**What people do:** Write a CustomLogger that calls a local HTTP endpoint on every LiteLLM request, sending metrics to the dashboard in real-time.
**Why it's wrong:** The callback runs in the proxy hot path. A network failure, timeout, or bug in the callback can delay or drop requests through the LiteLLM proxy. This is exactly the risk that makes callback-based collection unsuitable when a polling alternative exists.
**Do this instead:** Poll `/spend/logs` every 30 seconds. Latency is acceptable for a diagnostic dashboard. If real-time streaming is later required, use LiteLLM's Prometheus callback (already active) and query Prometheus — that path is fire-and-forget.

### Anti-Pattern 2: Direct PostgreSQL Access

**What people do:** Connect directly to `litellm-db` PostgreSQL to read the `litellm_verificationtoken` and `litellm_spendlogs` tables.
**Why it's wrong:** The schema is an internal LiteLLM implementation detail not covered by semver stability. Any LiteLLM upgrade can silently break the dashboard. The admin API (`/spend/logs`) is the stable contract.
**Do this instead:** Use the `/spend/logs` REST endpoint with `Authorization: Bearer` header.

### Anti-Pattern 3: Frontend Hitting LiteLLM Directly

**What people do:** Call `http://docker-001:4000/spend/logs` from the browser to avoid building a backend.
**Why it's wrong:** Exposes the LiteLLM master key in browser requests (visible in DevTools). Also embeds CORS and cross-origin complexity. The master key is already a known security gap — don't widen it.
**Do this instead:** All LiteLLM requests go through the FastAPI backend. The key stays server-side.

### Anti-Pattern 4: InfluxDB for This Scale

**What people do:** Stand up InfluxDB (separate daemon, separate port, separate config) to handle time-series metrics.
**Why it's wrong:** At polling-based collection rates (~120 rows/hour per model), InfluxDB's operational overhead — separate process, separate auth, InfluxQL/Flux learning curve — is not justified. The existing host already runs ~15 Docker services.
**Do this instead:** DuckDB embedded in the FastAPI process. One file, zero daemons, full SQL, P95 and window functions out of the box.

## Scaling Considerations

This is a single-user local dashboard. Scaling is not a concern. The architecture is deliberately sized for the problem.

| Concern | Current (1 user, 5 nodes) | If this were multi-tenant |
|---------|---------------------------|---------------------------|
| Read throughput | DuckDB in-process is sufficient | Add read replicas or migrate to ClickHouse |
| Write throughput | 30s polling, trivial | Switch to streaming callback → message queue |
| Storage growth | ~1MB/day at 7 models, 30s poll | Partition DuckDB by month or migrate to Parquet |

Data retention: keep 90 days in DuckDB, drop older rows on a weekly cron. At current volume, `metrics.duckdb` stays under 100MB.

## Sources

- [LiteLLM Custom Callbacks](https://docs.litellm.ai/docs/observability/custom_callback) — callback hook API, CustomLogger interface
- [LiteLLM Prometheus Metrics](https://docs.litellm.ai/docs/proxy/prometheus) — metric names, label dimensions, /metrics endpoint
- [LiteLLM Spend Tracking](https://docs.litellm.ai/docs/proxy/cost_tracking) — /spend/logs endpoint, query parameters
- [LiteLLM Endpoint Activity](https://docs.litellm.ai/docs/proxy/endpoint_activity) — activity API surface
- [DuckDB vs SQLite comparison (Analytics Vidhya, 2026)](https://www.analyticsvidhya.com/blog/2026/01/duckdb-vs-sqlite/) — columnar storage for analytics workloads
- [DuckDB vs SQLite (Better Stack)](https://betterstack.com/community/guides/scaling-python/duckdb-vs-sqlite/) — write throughput, query performance
- [Next.js FastAPI realtime dashboard pattern (Jaehyeon Kim, 2025)](https://jaehyeon.me/blog/2025-03-04-realtime-dashboard-3/) — polling + SWR architecture

---
*Architecture research for: LiteLLM metrics dashboard*
*Researched: 2026-04-13*
