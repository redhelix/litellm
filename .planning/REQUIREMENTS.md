# Requirements: LiteLLM Lab Dashboard

**Defined:** 2026-04-13
**Core Value:** Actionable visibility into which models are actually performing — so decisions about routing, context window sizing, and stack restructuring are data-driven rather than guesswork.

## v1 Requirements

### Infrastructure Prep

- [ ] **INFRA-01**: Spend log retention policy in place — automatic pruning or archival to prevent unbounded DB growth (currently 3.5 GiB, 76% disk used)
- [ ] **INFRA-02**: Weave callback RecursionErrors suppressed or isolated — 363 errors confirmed; must not pollute tool call metrics

### Data Collection

- [x] **DATA-01**: LiteLLM `/spend/logs` polled and stored in DuckDB every 30 seconds
- [x] **DATA-02**: Prometheus metrics scraped from `192.168.50.117:9090` — TTFT histogram, latency histogram, token counters, deployment state
- [x] **DATA-03**: Context window utilization ratio derived at ingestion: `prompt_tokens ÷ model_max_context` (requires `/v1/model/info` to resolve max context per model)
- [x] **DATA-04**: Tool call 3-state status tracked: `success` / `repaired` (patched by `fix_json_tool_calls.py`) / `failed` — requires instrumentation in the tool call repair path
- [x] **DATA-05**: TTFT, model latency, and LiteLLM overhead stored as separate fields — not collapsed into total latency

### Metrics

- [ ] **MET-01**: Per-model TTFT (p50, p95) displayed
- [ ] **MET-02**: Per-model total latency (p50, p95) displayed
- [ ] **MET-03**: Per-model tokens/sec throughput displayed
- [ ] **MET-04**: Per-model context window utilization % displayed (current request and rolling average)
- [ ] **MET-05**: Per-model tool call 3-state breakdown displayed (success / repaired / failed rates)

### Dashboard Views

- [ ] **VIEW-01**: Overview summary — aggregate stats across all 7 models: latency, error rate, context pressure, health status
- [ ] **VIEW-02**: Per-node health grid — 5 nodes (spark-001/002/003, hintonator, docker-gpu): model loaded, last request time, availability status
- [ ] **VIEW-03**: Request log table — paginated, per-request: model, latency, context utilization %, tool call status, timestamp
- [ ] **VIEW-04**: Trend charts — 7-day and 30-day performance trends per model (latency, context utilization, error rate)

### Config Drift

- [ ] **DRIFT-01**: Deployed `config.yaml` on docker-001 diffed against local repo version
- [ ] **DRIFT-02**: Hardcoded master key in deployed config flagged as a security warning
- [ ] **DRIFT-03**: Routing strategy differences surfaced (deployed: `simple-shuffle` vs local: `latency-based-routing`)
- [ ] **DRIFT-04**: Missing backends and `max_tokens` differences highlighted

### Benchmark Runner

- [ ] **BENCH-01**: On-demand benchmark trigger — fires a synthetic request at each model endpoint
- [ ] **BENCH-02**: Benchmark results displayed: TTFT, total latency, tokens/sec per model
- [ ] **BENCH-03**: Benchmark history stored for comparison across runs

### System

- [ ] **SYS-01**: Dashboard deployed as a Docker container alongside existing LiteLLM stack on docker-001
- [x] **SYS-02**: LiteLLM master key stored server-side only — never exposed to browser
- [ ] **SYS-03**: Local network access only (no external auth required)

## v2 Requirements

### Agentic Session Tracing

- **AGENT-01**: Per-session request grouping via `metadata.session_id` — requires Paperclip/Hermes/OpenClaw to instrument their LiteLLM calls
- **AGENT-02**: Multi-step agent workflow visualization — request chain, total context consumed, tool call sequence
- **AGENT-03**: Agent loop failure analysis — identify where context overflow or tool call failure broke a workflow

### Routing Intelligence

- **ROUTE-01**: Dashboard insights fed back as routing weight suggestions (manual apply, not automatic)
- **ROUTE-02**: Per-model quality score derived from tool call success + latency + context pressure

### Extended Observability

- **OBS-01**: Raw tool call JSON inspection per request (high complexity — wait for error rate data to identify where to look)
- **OBS-02**: Model warm/cold state tracking (detect inference cold-start penalty)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Automated routing adjustments | Need diagnostic baseline first; routing changes will be manual |
| External access / auth | Single user, local network only |
| Grafana / Prometheus stack | Custom web app preferred for control over design and data |
| OpenTelemetry SDK instrumentation | LiteLLM already exposes sufficient data via REST + Prometheus |
| Multi-user / team features | Not needed at this stage |
| Cost/spend tracking | LiteLLM UI already handles this well |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01, INFRA-02 | Phase 0 | Pending |
| DATA-01–05 | Phase 1 | Pending |
| SYS-01–03 | Phase 2 | Pending |
| MET-01–05 | Phase 2 | Pending |
| VIEW-01–02 | Phase 3 | Pending |
| VIEW-03–04 | Phase 4 | Pending |
| DRIFT-01–04 | Phase 5 | Pending |
| BENCH-01–03 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 26 total
- Mapped to phases: 26
- Unmapped: 0

---
*Requirements defined: 2026-04-13*
*Last updated: 2026-04-13 after initialization*
