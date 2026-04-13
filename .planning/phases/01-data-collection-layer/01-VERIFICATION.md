---
phase: 01-data-collection-layer
verified: 2026-04-13T22:00:00Z
status: passed
score: 10/10 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 9/10
  gaps_closed:
    - "APScheduler running on docker-001 — confirmed via docker logs: INFO:main:scheduler started: poll=30s, scrape=60s"
    - "/api/requests returns live data — 2 rows returned, model=openai/spark-learner"
    - "/api/models latency fields present — llm_api_latency_p50=150.0, overhead_ms_p50=0.0"
    - "/tmp/tool_repairs.jsonl exists as a regular file on docker-001 host (-rw-rw-r-- 1 root root 0)"
  gaps_remaining: []
  regressions: []
---

# Phase 1: Data Collection Layer Verification Report

**Phase Goal:** The dashboard has a live, structured data pipeline — all five metric categories (latency, tokens, throughput, tool call state, context utilization) are flowing into DuckDB and queryable by the API layer.
**Verified:** 2026-04-13T22:00:00Z
**Status:** passed
**Re-verification:** Yes — after human runtime checks confirmed on docker-001

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `/spend/logs` polled every 30s, rows written to DuckDB with ≤60s lag | ✓ VERIFIED | `main.py` L62: `add_job(_poll_job, "interval", seconds=30)`; `poller.poll_once` upserts into DuckDB requests table |
| 2 | Prometheus metrics scraped — TTFT, total_latency, llm_api_latency, tokens_per_sec, deployment_state stored as separate fields in `latency_snapshots` | ✓ VERIFIED | `prometheus_scraper.py` QUERIES dict has all 8 keys with [1h] window; INSERT_SQL maps to distinct columns; test_prometheus.py 3 passed |
| 3 | Context window utilization ratio computed at ingestion via config.yaml max_input_tokens | ✓ VERIFIED | `config_loader.py` loads model_list, max() dedup; `poller.compute_context_utilization()` divides prompt_tokens/max_ctx[model]; test_context_util.py passes |
| 4 | Tool call 3-state (success/repaired/failed) tracked in stored schema | ✓ VERIFIED | `fix_json_tool_calls.py` emits repair events keyed on response.id; `repairs.RepairsLogReader` reads JSONL; `poller.classify_tool_status` resolves 3 states; DuckDB `requests.tool_call_status` column present |
| 5 | LiteLLM master key absent from sidecar container environment | ✓ VERIFIED | `docker-compose.yaml` dashboard-sidecar env block has no LITELLM_MASTER_KEY; `main.py` L28-29 asserts at startup; no LITELLM_MASTER_KEY in any non-test sidecar source file |
| 6 | APScheduler runs poll_once every 30s and scrape_once every 60s via FastAPI lifespan | ✓ VERIFIED | `main.py` L54-65: lifespan creates BackgroundScheduler, adds poll job (30s) and scrape job (60s), starts scheduler. Runtime confirmed: `INFO:main:scheduler started: poll=30s, scrape=60s` on docker-001 |
| 7 | GET /api/requests returns paginated DuckDB rows with all DATA-05 latency fields | ✓ VERIFIED | `routers/requests.py` queries requests table, returns ttft_ms, total_latency_ms, tool_call_status, context_utilization. Runtime confirmed: 2 rows returned, model=openai/spark-learner |
| 8 | GET /api/models returns per-model aggregates including llm_api_latency_p50/p95 and overhead_ms_p50 | ✓ VERIFIED | `routers/models.py` L40-42: overhead_p50 = total_p50 - llm_p50; llm_api_latency_p50/p95 from latency_snapshots. Runtime confirmed: llm_api_latency_p50=150.0, overhead_ms_p50=0.0 |
| 9 | GET /api/nodes returns deployment_state per model from latest scrape | ✓ VERIFIED | `routers/nodes.py` queries latency_snapshots for latest row per model, returns deployment_state |
| 10 | GET /api/latency/snapshots?model=X&window=7d|30d returns time series | ✓ VERIFIED | `routers/latency.py` window enum validated, queries latency_snapshots with scraped_at time filter |

**Score:** 10/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `dashboard-sidecar/Dockerfile` | Python 3.13-slim image | ✓ VERIFIED | EXISTS, contains FROM python:3.13-slim |
| `dashboard-sidecar/db.py` | get_connection(), query(), execute(), threading.Lock | ✓ VERIFIED | threading.Lock present; all functions implemented; schema correct |
| `dashboard-sidecar/config_loader.py` | load_config, get_max_ctx, max() dedup | ✓ VERIFIED | max() dedup for duplicate model names; get_max_ctx returns copy |
| `dashboard-sidecar/poller.py` | poll_once, get_watermark, compute_ttft_ms, classify_tool_status | ✓ VERIFIED | All functions present; INTERVAL '5 minutes' bound in SELECT_SQL |
| `dashboard-sidecar/repairs.py` | RepairsLogReader with byte-offset tracking | ✓ VERIFIED | class RepairsLogReader; self._offset; truncation reset |
| `dashboard-sidecar/prometheus_scraper.py` | scrape_once(), QUERIES dict, parse_value() | ✓ VERIFIED | 8 QUERIES keys; [1h] window; NaN→None |
| `fix_json_tool_calls.py` | Repair-signal-emitting CustomLogger using response.id | ✓ VERIFIED | REPAIRS_LOG; response.id via getattr; _emit_repair_event; no litellm_call_id |
| `dashboard-sidecar/main.py` | FastAPI app with lifespan scheduler, router mounts | ✓ VERIFIED | BackgroundScheduler; all 4 routers included |
| `dashboard-sidecar/routers/requests.py` | GET /api/requests with window enum | ✓ VERIFIED | window validation; paginated; ttft_ms, total_latency_ms, tool_call_status present |
| `dashboard-sidecar/routers/models.py` | GET /api/models with llm_api_latency and overhead | ✓ VERIFIED | llm_api_latency_p50/p95 queried; overhead_ms_p50 computed |
| `dashboard-sidecar/routers/nodes.py` | GET /api/nodes with deployment_state | ✓ VERIFIED | deployment_state from latest latency_snapshots row per model |
| `dashboard-sidecar/routers/latency.py` | GET /api/latency/snapshots trend series | ✓ VERIFIED | scraped_at; window enum 7d/30d; model filter |
| `docker-compose.yaml` | dashboard-sidecar service, dashboard-duckdb volume, tool_repairs bind mount | ✓ VERIFIED | Service present on port 4001; dashboard-duckdb volume; /tmp/tool_repairs.jsonl bind mount |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `main.lifespan` | `poller.poll_once + prometheus_scraper.scrape_once` | APScheduler BackgroundScheduler add_job | ✓ WIRED | main.py L62-63 add_job calls; _poll_job and _scrape_job wrappers |
| `routers/*.py` | `db.query` | `from db import query` | ✓ WIRED | All 4 routers import and call db.query |
| `docker-compose.yaml dashboard-sidecar.volumes` | `/tmp/tool_repairs.jsonl` | host bind mount | ✓ WIRED | L117: `- /tmp/tool_repairs.jsonl:/tmp/tool_repairs.jsonl:ro` |
| `poller.poll_once` | `db.execute + config_loader.get_max_ctx + repairs.RepairsLogReader.read_new` | per-poll invocation | ✓ WIRED | poller.py L113 repairs_reader.read_new(); main.py L41 get_max_ctx() passed each tick |
| `fix_json_tool_calls.async_post_call_success_hook` | `/tmp/tool_repairs.jsonl` | append-only JSON line on repair | ✓ WIRED | L138-140: repaired detected, response.id extracted, _emit_repair_event called |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `routers/requests.py` | rows from DuckDB requests table | db.query() → SELECT FROM requests WHERE window | DuckDB populated by poller.poll_once via psycopg2 → Postgres LiteLLM_SpendLogs | ✓ FLOWING |
| `routers/models.py` | snaps + aggs from two DuckDB queries | latency_snapshots (latest per model) + requests (1h agg) | latency_snapshots populated by prometheus_scraper; requests by poller | ✓ FLOWING |
| `routers/nodes.py` | states from latency_snapshots | ROW_NUMBER() OVER (PARTITION BY model ORDER BY scraped_at DESC) | prometheus_scraper.scrape_once inserts one row per model | ✓ FLOWING |
| `routers/latency.py` | series from latency_snapshots | WHERE scraped_at > window AND model = ? | prometheus_scraper.scrape_once inserts timestamped rows | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 35 tests pass | `cd dashboard-sidecar && python -m pytest tests/ -q` | 35 passed, 2 warnings in 0.38s | ✓ PASS |
| fix_json emits repair event with response.id | inline verify in test_tool_repair.py | PASSED (included in 35 tests) | ✓ PASS |
| NaN parses to None | test_prometheus.py::test_nan_parsed_to_none | PASSED | ✓ PASS |
| DuckDB schema has ttft_ms and llm_api_latency_p50/p95 columns | test_latency_fields.py | PASSED | ✓ PASS |
| APScheduler started on docker-001 | `docker logs dashboard-sidecar \| grep scheduler` | INFO:main:scheduler started: poll=30s, scrape=60s | ✓ PASS |
| /api/requests returns live data | `curl http://docker-001:4001/api/requests` | 2 rows, model=openai/spark-learner | ✓ PASS |
| /api/models latency fields present | `curl http://docker-001:4001/api/models` | llm_api_latency_p50=150.0, overhead_ms_p50=0.0 | ✓ PASS |
| /tmp/tool_repairs.jsonl is a regular file on host | `ls -la /tmp/tool_repairs.jsonl` on docker-001 | -rw-rw-r-- 1 root root 0 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| DATA-01 | 01-02 | Postgres SpendLogs polled with bounded window, rows upserted | ✓ SATISFIED | poller.py SELECT_SQL with `INTERVAL '5 minutes'`; ON CONFLICT upsert |
| DATA-02 | 01-03 | 5 Prometheus metric categories as distinct DB fields | ✓ SATISFIED | prometheus_scraper.py QUERIES has all 8 keys; latency_snapshots schema has distinct columns |
| DATA-03 | 01-01, 01-02 | Context utilization computed at ingestion from config.yaml | ✓ SATISFIED | config_loader.get_max_ctx; poller.compute_context_utilization; context_utilization column |
| DATA-04 | 01-04 | Tool call 3-state via fix_json instrumentation and repairs reader | ✓ SATISFIED | fix_json → JSONL → RepairsLogReader → classify_tool_status → tool_call_status column |
| DATA-05 | 01-02, 01-03 | TTFT, total_latency, llm_api_latency as separate fields | ✓ SATISFIED | ttft_ms, total_latency_ms in requests; ttft_p50/95, total_latency_p50/95, llm_api_latency_p50/95 in latency_snapshots |
| SYS-02 | 01-05 | Master key not in sidecar env; not in any API response | ✓ SATISFIED | docker-compose omits LITELLM_MASTER_KEY from sidecar; main.py asserts absence at startup |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `prometheus_scraper.py` | 30-31, 99 | QUERIES keys are `llm_latency_p50/p95` but test_prometheus.py expects `llm_latency_p50/p95` — consistent internally but diverges from schema column name `llm_api_latency_p50/p95` | ℹ️ Info | No functional impact — vals.get("llm_latency_p50") correctly reads from QUERIES dict; column mapping is correct in INSERT_SQL |

No blockers found. The internal QUERIES key naming (`llm_latency_p50`) differs from the DB column name (`llm_api_latency_p50`) but the mapping in `scrape_once` at L99 is correct — it reads from QUERIES then writes to the correct INSERT_SQL column position.

### Gaps Summary

No gaps. All 10 truths verified — 9 by static analysis and automated tests, 1 (live runtime) confirmed by human checks on docker-001. The full Postgres → poller → DuckDB → API pipeline is operational. Phase goal achieved.

---

_Verified: 2026-04-13T22:00:00Z_
_Verifier: Claude (gsd-verifier)_
