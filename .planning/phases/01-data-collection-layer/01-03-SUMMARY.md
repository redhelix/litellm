---
phase: 01-data-collection-layer
plan: "03"
subsystem: dashboard-sidecar
tags: [prometheus, scraper, quantile, duckdb, data-collection]
dependency_graph:
  requires: ["01-01"]
  provides: ["prometheus_scraper.scrape_once", "prometheus_scraper.QUERIES", "prometheus_scraper.parse_value"]
  affects: ["01-05"]
tech_stack:
  added: []
  patterns: ["urllib HTTP GET /api/v1/query", "histogram_quantile [1h] rate window", "NaN->None parse_value"]
key_files:
  created:
    - litellm/dashboard-sidecar/prometheus_scraper.py
  modified: []
decisions:
  - "Used [1h] rate window per RESEARCH pitfall 2 — shorter windows return NaN for infrequent models"
  - "deployment_state queried as raw gauge (not histogram_quantile) — it is an integer state flag"
  - "tokens_per_sec computed as 1/quantile of latency_per_output_token"
  - "Per-query try/except ensures one failed fetch does not abort the full scrape cycle"
metrics:
  duration_minutes: 8
  completed_date: "2026-04-13"
  tasks_completed: 1
  files_created: 5
  files_modified: 0
---

# Phase 01 Plan 03: Prometheus Scraper Summary

**One-liner:** Prometheus HTTP API scraper pulling histogram_quantile [1h] quantiles for TTFT, total_latency, llm_api_latency, tokens_per_sec, and deployment_state — writing one latency_snapshots row per model per scrape cycle.

## What Was Built

`dashboard-sidecar/prometheus_scraper.py` with:

- `QUERIES` dict (8 keys): all five DATA-02 metric categories mapped to PromQL expressions with `[1h]` rate window
- `parse_value()`: returns `None` for `"NaN"` strings and non-numeric values, `float` otherwise
- `scrape_once(prom_base)`: fetches all queries, aggregates results by model label (`model` OR `litellm_model_name`), inserts one row per model into `latency_snapshots`
- `HTTP_TIMEOUT_SEC = 10` per-request timeout; per-query error logging without aborting the scrape

Supporting files created for test infrastructure (plan 01-01 dependency not yet committed on this branch):
- `db.py`: DuckDB single-writer layer with threading.Lock
- `tests/__init__.py`, `tests/conftest.py`, `tests/test_prometheus.py`: pytest scaffolding

## Tasks Completed

| Task | Description | Commit | Status |
|------|-------------|--------|--------|
| RED  | Failing test for prometheus_scraper | d861bf7b | Done |
| GREEN | Implement prometheus_scraper.py | b1a28c15 | Done |

## Verification

All acceptance criteria passed:
- `[1h]` rate window present in 9 locations (≥7 required)
- No `[5m]` window present
- All 8 QUERIES keys present
- `parse_value("NaN") is None` verified by test
- `python -m pytest tests/test_prometheus.py -q` → 3 passed

## Requirements Satisfied

- DATA-02: TTFT, total_latency, llm_api_latency, tokens_per_sec, deployment_state all scraped as distinct fields
- DATA-05: `llm_api_latency_p50/p95` stored separately from `total_latency_p50/p95` and `ttft_p50/p95`

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all functionality fully implemented.

## Threat Surface

Threat mitigations from plan threat model applied:
- T-01-09 (Tampering): `parse_value` returns None on any non-numeric input; per-query try/except applied
- T-01-10 (DoS): `HTTP_TIMEOUT_SEC = 10` hard timeout per request; per-query error logging and continuation

## Self-Check: PASSED

- `/home/rhx/projects/home-infra-backups/.claude/worktrees/agent-a7fd225f/litellm/dashboard-sidecar/prometheus_scraper.py` — FOUND
- Commit `d861bf7b` (RED test) — FOUND
- Commit `b1a28c15` (GREEN implementation) — FOUND
