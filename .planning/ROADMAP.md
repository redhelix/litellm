# ROADMAP: LiteLLM Lab Dashboard

**Project:** LiteLLM Lab Dashboard
**Milestone:** v1
**Granularity:** Coarse (6 phases maximum)
**Created:** 2026-04-13
**Coverage:** 26/26 v1 requirements mapped

---

## Phases

- [ ] **Phase 0: Infrastructure Prep** — Retention policy + Weave error isolation before any data work begins
- [ ] **Phase 1: Data Collection Layer** — Backend collectors, DuckDB schema, API sidecar serving all metrics to frontend
- [ ] **Phase 2: Core Dashboard** — Overview panel + per-node health grid deployed and accessible on docker-001
- [ ] **Phase 3: Request Log + Trend Views** — Paginated request log table and 7/30-day trend charts
- [ ] **Phase 4: Config Drift + Benchmark Runner** — Config diff surface and on-demand benchmark trigger
- [ ] **Phase 5: Containerized Deployment** — Production container on docker-001, master key server-side only, local network access
- [ ] **Phase 6: Dashboard UX Enhancements** — Error display, sorting/filtering, context utilization fix, tooltips, model metadata
- [ ] **Phase 7: LLM-Powered Intelligence Layer** — Anomaly detection, automated diagnosis, HF model monitoring, NL Q&A

---

## Phase Details

### Phase 0: Infrastructure Prep
**Goal**: The existing LiteLLM stack is stable and safe for the dashboard to query — spend log growth is bounded, Weave errors are isolated, and disk pressure is not a deployment blocker.
**Depends on**: Nothing — this is a hard prerequisite for all other phases.
**Requirements**: INFRA-01, INFRA-02
**Success Criteria** (what must be TRUE):
  1. PostgreSQL spend log retention policy is active — rows older than 30 days are pruned automatically or on a documented schedule, and the volume is not growing unboundedly.
  2. Docker log rotation is configured on `litellm-proxy` — the "Proxy initialized" log spam (currently 5,546+ lines) is capped and cannot fill the remaining 52 GiB free disk.
  3. `weave_callback.py` is wrapped in try/except — a Weave `RecursionError` no longer pollutes logs or causes trace data loss for error-case requests; the 363 RecursionErrors stop appearing.
  4. Dashboard queries against `spend_logs` use bounded `WHERE startTime > NOW() - INTERVAL` clauses by design — unbounded table scans are architecturally excluded before any query is written.
**Plans**: TBD

### Phase 1: Data Collection Layer
**Goal**: The dashboard has a live, structured data pipeline — all five metric categories (latency, tokens, throughput, tool call state, context utilization) are flowing into DuckDB and queryable by the API layer.
**Depends on**: Phase 0 (spend log retention must be in place before any ingestion pipeline is built)
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, SYS-02
**Success Criteria** (what must be TRUE):
  1. `/spend/logs` is polled every 30 seconds and rows are written to DuckDB — the `requests` table has live data with no more than 60-second lag.
  2. Prometheus metrics are scraped from `192.168.50.117:9090` — TTFT histogram, total latency, model latency, LiteLLM overhead, and deployment state are all stored as separate fields in `latency_snapshots` (not collapsed into a single latency number).
  3. Context window utilization ratio (`prompt_tokens / max_context_window`) is computed at ingestion by cross-referencing `/v1/model/info` — every request row has a `context_utilization` float between 0 and 1.
  4. Tool call 3-state classification is tracked — `success` / `repaired` (from `fix_json_tool_calls.py` instrumentation) / `failed` appear as distinct values in the stored schema, not just binary pass/fail.
  5. The LiteLLM master key is consumed only by the backend sidecar via environment variable — no key material is present in any frontend bundle, environment, or browser request.
**Plans**: 5 plans
- [x] 01-01-PLAN.md — Project skeleton, DuckDB single-writer layer, config_loader (max dedup), Wave 0 pytest RED stubs
- [x] 01-02-PLAN.md — Postgres poller (bounded 5m) + repairs tail reader (DATA-01, DATA-03, DATA-05 storage)
- [x] 01-03-PLAN.md — Prometheus scraper with [1h] quantile queries (DATA-02, DATA-05 llm_api_latency)
- [x] 01-04-PLAN.md — Instrument fix_json_tool_calls.py to emit repair events keyed on response.id (DATA-04)
- [x] 01-05-PLAN.md — APScheduler wiring, four /api routers, docker-compose dashboard-sidecar service (SYS-02)
**UI hint**: no

### Phase 2: Core Dashboard
**Goal**: Users can see the state of their lab at a glance — aggregate performance across all 7 models and per-node availability for all 5 nodes are visible on a single screen that auto-refreshes.
**Depends on**: Phase 1 (API layer must have live data before any frontend panel is built)
**Requirements**: MET-01, MET-02, MET-03, MET-04, MET-05, VIEW-01, VIEW-02, SYS-03
**Success Criteria** (what must be TRUE):
  1. The overview panel shows aggregate stats across all 7 models: p50 and p95 TTFT, p50 and p95 total latency, tokens/sec throughput, context utilization %, and tool call 3-state breakdown — all updating every 30 seconds without a page reload.
  2. The per-node health grid shows all 5 nodes (spark-001, spark-002, spark-003, hintonator, docker-gpu) with: model loaded, last request timestamp, and availability status — distinguishing unreachable from slow from healthy.
  3. The dashboard is accessible at a local network URL (e.g., `http://docker-001:PORT`) without any login or authentication prompt.
  4. Per-model metrics panels surface p50/p95 for TTFT and total latency, tokens/sec, context utilization %, and the tool call success/repaired/failed rate for each of the 7 deployed model aliases.
**Plans**: 4 plans
- [x] 02-01-PLAN.md — Scaffold dashboard (Vite+React+TS+shadcn+vitest), CORS to sidecar, Wave 0 RED tests, live deployment_state probe (Wave 1)
- [x] 02-02-PLAN.md — useDashboardData polling hook + RefreshRing + ToolCallBar + OverviewPanel wired into App.tsx (Wave 2)
- [x] 02-03-PLAN.md — NodeGrid (VIEW-02) + ModelCard (MET-01..05) + final App.tsx layout (Wave 3)
- [x] 02-04-PLAN.md — Dockerfile+nginx, docker-compose dashboard service, Traefik route (no authentik), human-verify checkpoint (Wave 4)
**UI hint**: yes

### Phase 3: Request Log + Trend Views
**Goal**: Users can drill into individual requests and detect performance degradation over time — the dashboard is a diagnostic tool, not just a live status board.
**Depends on**: Phase 2 (core metrics infrastructure must exist; charts are extensions of it)
**Requirements**: VIEW-03, VIEW-04
**Success Criteria** (what must be TRUE):
  1. The request log table shows the last 500+ requests, paginated, with columns for model, TTFT, total latency, context utilization %, tool call status (3-state), and timestamp — and can be filtered by model.
  2. Trend charts show 7-day and 30-day performance history per model for latency (p95), context utilization, and error/repair rate — rendered as separate sparklines per model alias, not a single overlapping multi-series chart.
  3. All trend queries are bounded — a 30-day query does not full-scan the `requests` table and returns within 2 seconds.
**Plans**: 4 plans
- [x] 03-01-PLAN.md — Wave 0 RED stubs: vitest stubs for RequestLogTable, TrendSection, useRequestLog, useTrends + pytest stubs for /api/requests and /api/trends (Wave 1)
- [x] 03-02-PLAN.md — Sidecar: update /api/requests (model filter + total count + offset cap) + new /api/trends router (VIEW-03, VIEW-04 backend) (Wave 1)
- [x] 03-03-PLAN.md — Frontend: recharts + shadcn installs, api.ts type extensions, useRequestLog + useTrends hooks (Wave 2)
- [x] 03-04-PLAN.md — Frontend: RequestLogTable component (VIEW-03), TrendSection component (VIEW-04), App.tsx wiring, human-verify checkpoint (Wave 2)
**UI hint**: yes

### Phase 4: Config Drift + Benchmark Runner
**Goal**: Users can see exactly where the deployed LiteLLM config diverges from the local repo and can fire an on-demand latency benchmark against any model — both independently of the live traffic pipeline.
**Depends on**: Phase 1 (API sidecar must exist to serve benchmark results and config diff endpoint)
**Requirements**: DRIFT-01, DRIFT-02, DRIFT-03, DRIFT-04, BENCH-01, BENCH-02, BENCH-03
**Success Criteria** (what must be TRUE):
  1. The config drift view diffs the deployed `config.yaml` on docker-001 against the local repo version and shows structured differences: routing strategy mismatch (`simple-shuffle` vs `latency-based-routing`), `max_tokens` differences per model, missing backends, and context window fallback format divergence.
  2. The hardcoded master key in the deployed config is flagged as a security warning — distinct from other drift items, visually prominent.
  3. The benchmark runner fires a synthetic request at each model endpoint on demand, measures TTFT and total latency, and displays results within the dashboard view.
  4. Benchmark history is stored — at least the last 10 benchmark runs are viewable for comparison, showing whether a model has gotten faster or slower across runs.
**Plans**: 4 plans
Plans:
- [x] 04-01-PLAN.md — Wave 0 RED stubs: vitest stubs for ConfigDriftView, BenchmarkRunner + pytest stubs for /api/config/diff and /api/benchmark/*
- [x] 04-02-PLAN.md — Sidecar: config_diff router (DRIFT-01..04), benchmark router (BENCH-01..03), DuckDB tables, CORS POST fix
- [x] 04-03-PLAN.md — Frontend: ConfigDriftView + BenchmarkRunner components, api.ts types, GREEN tests, App.tsx wiring
- [x] 04-04-PLAN.md — Human-verify checkpoint: end-to-end verification on docker-001
**UI hint**: yes

### Phase 5: Containerized Deployment
**Goal**: The dashboard runs as a production Docker container on docker-001 alongside the existing LiteLLM stack — reproducibly buildable, persisting data across restarts, and requiring no manual setup after `docker compose up`.
**Depends on**: Phase 4 (all application features must be complete before hardening deployment)
**Requirements**: SYS-01, SYS-03
**Success Criteria** (what must be TRUE):
  1. `docker compose up` on docker-001 starts the dashboard container and it is accessible on the local network within 60 seconds — no manual steps required.
  2. The `metrics.duckdb` file is volume-mounted and survives a container restart — historical data is not lost on redeploy.
  3. The dashboard container is on the `litellm-internal` network and can reach `litellm-proxy:4000` and `litellm-db` without exposing any port to external networks beyond the intended dashboard port.
  4. The master key and all secrets are sourced from environment variables in `.env` — no secret is hardcoded in any `Dockerfile`, `docker-compose.yaml`, or application config file committed to the repo.
**Plans**: 2 plans
Plans:
- [x] 05-01-PLAN.md — Secrets audit: replace hardcoded DATABASE_URL/POSTGRES_PASSWORD in docker-compose.yaml, complete .env.template (SYS-01)
- [ ] 05-02-PLAN.md — Live verification on docker-001: cold-start timing, DuckDB persistence, network isolation, human-verify checkpoint (SYS-01, SYS-03)
**UI hint**: no

### Phase 6: Dashboard UX Enhancements
**Goal:** Polish the request log and dashboard views with richer data, better UX, and inline help — specifically: error display with colour-coded failed rows, context utilization fix for the 7 deployed aliases, server-side sort + status filter on the request log, and explanatory hover tooltips for p50/p95/TTFT/ctx% metrics.
**Depends on:** Phase 5 (all features deployed before UX polish)
**Requirements:** D-01, D-02, D-03, D-04 (from 06-CONTEXT.md — no new v1 requirement IDs; this phase realises user-driven UX decisions)
**Plans:** 1/2 plans executed
- [x] 06-01-PLAN.md — Sidecar backend: error_message column + poller exception ingestion, /api/requests sort+status filter, MODEL_CTX_MAP fix for 7 aliases (D-01, D-02, D-03)
- [ ] 06-02-PLAN.md — Frontend: RequestLogTable error rows + sort headers + status dropdown + ctx '?' tooltip, OverviewPanel + ModelCard metric tooltips, human-verify on docker-001 (D-01, D-02, D-03, D-04)

Items deferred to Phase 6 backlog (NOT planned this round):
- Fix "last request" timestamp accuracy
- Show server names of deployed models
- Show model metadata per model card

### Phase 7: LLM-Powered Intelligence Layer
**Goal:** Use LLMs to autonomously monitor lab health, diagnose anomalies, recommend config/model changes, and surface ideal new model releases from Hugging Face.
**Depends on:** Phase 6 (UX foundation must be stable)
**Requirements:** TBD
**Plans:** TBD

Items captured:
- LLM-based anomaly detection on metrics (latency spikes, error rate increases, context utilization trends)
- Automated diagnosis: root cause suggestions when a model degrades
- Config change recommendations (routing strategy, max_tokens, context window settings)
- Model swap recommendations based on benchmark results vs. alternatives
- HuggingFace monitoring: surface new model releases that fit the current deployment profile
- Natural language Q&A interface over collected metrics

---

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Infrastructure Prep | 0/? | Not started | - |
| 1. Data Collection Layer | 0/? | Not started | - |
| 2. Core Dashboard | 0/? | Not started | - |
| 3. Request Log + Trend Views | 0/4 | Planned | - |
| 4. Config Drift + Benchmark Runner | 0/? | Not started | - |
| 5. Containerized Deployment | 0/2 | Planned | - |

---

## Coverage Map

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 0 | Pending |
| INFRA-02 | Phase 0 | Pending |
| DATA-01 | Phase 1 | Pending |
| DATA-02 | Phase 1 | Pending |
| DATA-03 | Phase 1 | Pending |
| DATA-04 | Phase 1 | Pending |
| DATA-05 | Phase 1 | Pending |
| SYS-02 | Phase 1 | Pending |
| MET-01 | Phase 2 | Pending |
| MET-02 | Phase 2 | Pending |
| MET-03 | Phase 2 | Pending |
| MET-04 | Phase 2 | Pending |
| MET-05 | Phase 2 | Pending |
| VIEW-01 | Phase 2 | Pending |
| VIEW-02 | Phase 2 | Pending |
| SYS-03 | Phase 2 | Pending |
| VIEW-03 | Phase 3 | Pending |
| VIEW-04 | Phase 3 | Pending |
| DRIFT-01 | Phase 4 | Pending |
| DRIFT-02 | Phase 4 | Pending |
| DRIFT-03 | Phase 4 | Pending |
| DRIFT-04 | Phase 4 | Pending |
| BENCH-01 | Phase 4 | Pending |
| BENCH-02 | Phase 4 | Pending |
| BENCH-03 | Phase 4 | Pending |
| SYS-01 | Phase 5 | Pending |

**v1 requirements: 26/26 mapped. No orphans.**

---

## Key Decisions Reflected

| Decision | Rationale |
|----------|-----------|
| Phase 0 is infra-only, no code | Disk at 76%, Weave errors active — these block reliable data collection if not fixed first |
| Data layer (Phase 1) before any UI | Anti-pattern from research: frontend before API layer produces nothing verifiable |
| SYS-02 (master key server-side) in Phase 1 | Security constraint must be baked into the collection architecture, not retrofitted |
| SYS-03 (local-only access) in Phase 2 | Verified at first deployment of frontend, not deferred to a "hardening" phase |
| Config drift + benchmarks together (Phase 4) | Both are independent of live traffic pipeline; both serve the same "compare against baseline" user goal |
| SYS-01 container deployment last (Phase 5) | All features must be working before production packaging; avoids building infra around incomplete features |
| DuckDB over PostgreSQL direct access | Architectural decision from research: LiteLLM DB schema is internal; REST API + Prometheus is the stable contract |
| FastAPI sidecar (Python) | Consistent with existing Python stack; avoids Node runtime just for the sidecar |

---

---

*Roadmap created: 2026-04-13*
*Last updated: 2026-04-13 after Phase 5 planning*
