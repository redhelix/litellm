---
phase: 08-model-client-visibility
plan: "01"
subsystem: dashboard-sidecar
tags: [backend, duckdb, poller, fastapi, model-health, clients]
dependency_graph:
  requires: []
  provides:
    - requester_ip_address ingestion pipeline
    - GET /api/clients endpoint
    - GET /api/model-info endpoint
    - GET /api/model-health endpoint with 30 s ping job
  affects:
    - dashboard-sidecar/db.py
    - dashboard-sidecar/poller.py
    - dashboard-sidecar/config_loader.py
    - dashboard-sidecar/routers/requests.py
    - dashboard-sidecar/routers/clients.py
    - dashboard-sidecar/routers/model_health.py
    - dashboard-sidecar/main.py
tech_stack:
  added: [APScheduler ping job, requests (HTTP GET for ping)]
  patterns: [whitelist SQL injection guard, backward-compat ALTER TABLE migration, first-entry-wins alias map]
key_files:
  created:
    - dashboard-sidecar/routers/clients.py
    - dashboard-sidecar/routers/model_health.py
    - dashboard-sidecar/tests/test_clients.py
    - dashboard-sidecar/tests/test_model_health.py
  modified:
    - dashboard-sidecar/db.py
    - dashboard-sidecar/poller.py
    - dashboard-sidecar/config_loader.py
    - dashboard-sidecar/routers/requests.py
    - dashboard-sidecar/main.py
    - dashboard-sidecar/tests/test_poller.py
    - dashboard-sidecar/tests/test_requests.py
decisions:
  - "requester_ip_address is not updated on UPSERT conflict — set once at ingest time"
  - "First model_list entry per alias wins in MODEL_INFO_MAP (matches existing max_ctx pattern)"
  - "classify_health treats None api_base and all CLOUD_HOSTS as unknown, not down"
  - "ping_models_job max_instances=1 prevents scheduler pile-up on slow local hosts"
metrics:
  duration: ~25 min
  completed: "2026-04-14"
  tasks_completed: 3
  files_changed: 11
---

# Phase 8 Plan 01: Model & Client Visibility — Backend Summary

One-liner: requester IP ingestion + /api/clients top-clients endpoint + /api/model-info and /api/model-health with APScheduler 30 s ping job, all wired into FastAPI sidecar.

## What Was Built

### Task 1: requester_ip_address ingestion (db + poller + requests router)

- `db.py`: Added `requester_ip_address TEXT` to `CREATE TABLE IF NOT EXISTS requests` and a second backward-compat `ALTER TABLE ADD COLUMN` migration block (same pattern as `error_message`).
- `poller.py`: Added `,requester_ip_address` to `SELECT_SQL`, added column and `?` placeholder to `UPSERT_SQL` (not updated on conflict), destructured `requester_ip` from 14-element row tuple, passed it as last arg to `execute`.
- `routers/requests.py`: Added `api_key_alias, requester_ip_address` to SELECT clause and `cols` list so both keys appear in every response row.
- Tests updated: `test_poller.py` — fixed stale `"exception"` assertion to `"error_message"`, updated `_make_pg_row` to 14-element tuple, added `test_requester_ip_address_column_in_schema` and `test_requester_ip_stored_in_upsert`. `test_requests.py` — added `test_api_key_alias_and_requester_ip_in_response_keys`.

### Task 2: config_loader MODEL_INFO_MAP + new routers

- `config_loader.py`: Added `CLOUD_HOSTS` set, `_model_info` dict, second pass over `model_list` in `load_config` building per-alias `{backend_model, api_base, provider}` map (first entry wins), `get_model_info_map()` accessor under `_lock`.
- `routers/clients.py`: New file. `WINDOW_TO_SQL` whitelist (1h/24h/7d/30d). `GET /api/clients` groups by `COALESCE(api_key_alias, requester_ip_address)`, counts requests and failures, returns top-10 sorted by requests desc with `error_rate`.
- `routers/model_health.py`: New file. `_is_cloud()` checks `urlparse(api_base).hostname` against `CLOUD_HOSTS`. `classify_health()` returns `"unknown"` for cloud/None, `"up"` on any HTTP response (even 4xx), `"down"` on `ConnectionError`/`Timeout`. `ping_models_job()` iterates `get_model_info_map()` and updates `_health` dict under lock. `GET /api/model-info` returns info map. `GET /api/model-health` returns health dict.

### Task 3: main.py wiring

- Imported `clients_router`, `model_health_router`, `ping_models_job`.
- Added `scheduler.add_job(ping_models_job, "interval", seconds=30, id="ping_models", max_instances=1)`.
- Registered both routers with `app.include_router`.

## Test Results

```
95 passed, 4 skipped (CI volume/network skips), 2 warnings
```

All new tests pass. No regressions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed stale `test_select_sql_includes_exception` assertion**
- **Found during:** Task 1 — pre-existing test failure before any changes
- **Issue:** Test checked for `"exception"` in `SELECT_SQL`, but the column was already refactored to `metadata::jsonb->'error_information'->>'error_message' AS error_message`
- **Fix:** Updated assertion to check for `"error_message"` which is present in the SQL alias
- **Files modified:** `tests/test_poller.py`
- **Commit:** b13f768

**2. [Rule 2 - Missing] Updated `_make_pg_row` to 14-element tuple**
- **Found during:** Task 1
- **Issue:** `_make_pg_row` produced 13-element tuples; adding `requester_ip_address` to `SELECT_SQL` makes rows 14 elements, which would cause unpacking errors in existing tests
- **Fix:** Added `requester_ip` parameter to `_make_pg_row` and appended it to the tuple
- **Files modified:** `tests/test_poller.py`
- **Commit:** b13f768

## Known Stubs

None — all endpoints return live data from DuckDB or in-memory state populated by the ping job.

## Threat Flags

No new threat surface beyond what is documented in the plan's threat model (T-08-01 through T-08-05). All mitigations applied:
- T-08-01: `WINDOW_TO_SQL` whitelist enforced in `/api/clients`, raises 400 for unknown values.
- T-08-03: `timeout=3` on every `http_requests.get` call; `max_instances=1` on scheduler job.

## Self-Check: PASSED

- `dashboard-sidecar/routers/clients.py` — exists
- `dashboard-sidecar/routers/model_health.py` — exists
- `dashboard-sidecar/tests/test_clients.py` — exists
- `dashboard-sidecar/tests/test_model_health.py` — exists
- Commits b13f768, 118456c, 502571e — all present in git log
