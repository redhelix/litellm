---
phase: 01-data-collection-layer
created: 2026-04-13
status: ready-for-research
---

# Phase 1 Context: Data Collection Layer

## Domain

A Python FastAPI sidecar that: (1) polls LiteLLM_SpendLogs from Postgres every 30s, (2) scrapes Prometheus metrics, (3) maintains a DuckDB file as the query layer, and (4) exposes an HTTP API on port 4001 for the frontend.

---

## Decisions

### Data Source: Direct Postgres (not REST API)

The ingestion poller reads from `LiteLLM_SpendLogs` via direct Postgres connection — **not** the `/spend/logs` REST API. The REST API returned 500 during scouting; direct DB access is proven and already works.

- Connection string: same `DATABASE_URL` already in docker-compose.yaml
- All queries MUST follow QUERY-CONVENTIONS.md: bounded `WHERE "startTime" > NOW() - INTERVAL '<window>'`
- Poll window: `INTERVAL '5 minutes'` for the live 30s ingestion cycle (per QUERY-CONVENTIONS.md)
- Table name: `LiteLLM_SpendLogs` (confirmed on docker-001 — note underscore, not camelCase)

### Tool Call 3-State Tracking: Sidecar Log File

`fix_json_tool_calls.py` must be instrumented to emit a repair signal. Method: append a JSON line to `/tmp/tool_repairs.jsonl` on each repair event.

Format per line:
```json
{"request_id": "<uuid>", "timestamp": "<iso8601>", "repaired": true}
```

The sidecar ingestion loop reads this file periodically and joins on `request_id` when writing DuckDB rows. This gives per-request repair tracking with zero DB coupling.

The three states for `tool_call_status` in DuckDB:
- `success` — status=success in LiteLLM_SpendLogs AND no repair event
- `repaired` — status=success AND request_id found in tool_repairs.jsonl
- `failed` — status=failure in LiteLLM_SpendLogs

### Sidecar Deployment: New Container in docker-compose.yaml

Service name: `dashboard-sidecar`
- Added to the existing `docker-compose.yaml` alongside litellm-proxy
- Shares `litellm-internal` network (for direct Postgres + LiteLLM access)
- Exposes port `4001` on the docker-001 host
- Language: Python + FastAPI (consistent with existing stack)
- DuckDB file: named Docker volume `dashboard-duckdb`, mounted at `/data/metrics.duckdb` inside container
- Tool repairs log: mount `/tmp/tool_repairs.jsonl` from the host (shared with litellm-proxy container)

### Context Window Utilization: Parse config.yaml at Startup

To compute `context_utilization = prompt_tokens / max_context`:
- At startup, parse the local `config.yaml` (bind-mounted into the sidecar container)
- Extract `model_info.max_input_tokens` per model entry
- Cache in memory; reload on SIGHUP
- If a model has no `max_input_tokens` defined (e.g., cloud API models): store `NULL` for `context_utilization` — do not guess or use a default
- `prompt_tokens` comes from `LiteLLM_SpendLogs.prompt_tokens` (always present)

---

## TTFT Derivation

TTFT is available directly from the DB:
```sql
EXTRACT(EPOCH FROM ("completionStartTime" - "startTime")) * 1000 AS ttft_ms
```
`completionStartTime` is nullable — store NULL when missing (streaming not started or failed before first token).

Separate latency fields to compute (DATA-05):
- `ttft_ms` = `completionStartTime - startTime` (ms)
- `llm_api_latency_ms` = from Prometheus `litellm_llm_api_latency_metric` (model backend time)
- `total_latency_ms` = `endTime - startTime` (ms)
- `overhead_ms` = `total_latency_ms - llm_api_latency_ms` (proxy overhead)

---

## DuckDB Schema (Guidance for Planner)

Tables to create:

**`requests`** — one row per LiteLLM_SpendLogs row
- `request_id`, `startTime`, `model`, `model_group`, `prompt_tokens`, `completion_tokens`, `total_tokens`
- `ttft_ms` (nullable), `total_latency_ms`, `status` (success/failure)
- `tool_call_status` (success/repaired/failed)
- `context_utilization` (nullable float 0–1)
- `api_key_alias`, `team_alias`

**`latency_snapshots`** — Prometheus scrapes, one row per scrape per model
- `scraped_at`, `model`, `ttft_p50`, `ttft_p95`, `total_latency_p50`, `total_latency_p95`
- `tokens_per_sec`, `deployment_state`

---

## API Surface (Guidance for Planner)

Minimum endpoints the frontend needs:
- `GET /api/requests?window=5m|7d|30d` — paginated request rows
- `GET /api/models` — per-model aggregates (p50/p95 latency, context util, tool call rates)
- `GET /api/nodes` — per-node health from `litellm_deployment_state` Prometheus metric
- `GET /api/latency/snapshots?model=X&window=7d|30d` — time series for trend charts

---

## Constraints Carried Forward

- **SYS-02**: Master key server-side only — never in any frontend bundle or HTTP response
- **DATA-03**: Context utilization ratio uses `prompt_tokens / max_input_tokens`, not total tokens
- **DATA-04**: Tool call 3-state is `success / repaired / failed` — binary pass/fail is not acceptable
- **DATA-05**: TTFT, LLM API latency, and total latency are separate stored fields — not collapsed

---

## Canonical Refs

- `.planning/phases/00-infrastructure-prep/QUERY-CONVENTIONS.md` — mandatory bounded-query rule for LiteLLM_SpendLogs
- `config.yaml` — model_info.max_input_tokens source for context utilization
- `fix_json_tool_calls.py` — file to instrument for tool repair signal
- `docker-compose.yaml` — where dashboard-sidecar service will be added
- `.planning/REQUIREMENTS.md` — DATA-01 through DATA-05, SYS-02 acceptance criteria

---

## Deferred Ideas

None raised during discussion.
