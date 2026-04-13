---
phase: 01-data-collection-layer
plan: "01"
subsystem: dashboard-sidecar
tags: [python, duckdb, fastapi, pytest, tdd, scaffold]
dependency_graph:
  requires: []
  provides:
    - dashboard-sidecar/db.py (get_connection, query, execute, init_schema)
    - dashboard-sidecar/config_loader.py (load_config, get_max_ctx, register_sighup)
    - dashboard-sidecar DuckDB schema (requests + latency_snapshots + 4 indexes)
    - Wave 0 pytest RED stubs (6 test modules)
  affects:
    - 01-02-PLAN.md (poller implements poller.py to turn test_poller.py GREEN)
    - 01-03-PLAN.md (prometheus scraper implements prometheus_scraper.py)
    - 01-04-PLAN.md (repairs implements repairs.py)
    - 01-05-PLAN.md (scheduler wires everything via lifespan)
tech_stack:
  added:
    - duckdb==1.5.2
    - psycopg2-binary==2.9.11
    - fastapi==0.115.0
    - uvicorn==0.44.0
    - pyyaml==6.0.3
    - apscheduler==3.11.2
    - prometheus-client==0.25.0
    - pytest==8.3.3
    - pytest-asyncio==0.24.0
  patterns:
    - Single-writer DuckDB with threading.Lock (Pattern 1 from RESEARCH.md)
    - FastAPI lifespan for startup initialization
    - APScheduler background tasks (wired in Plan 05)
key_files:
  created:
    - litellm/dashboard-sidecar/Dockerfile
    - litellm/dashboard-sidecar/requirements.txt
    - litellm/dashboard-sidecar/pytest.ini
    - litellm/dashboard-sidecar/main.py
    - litellm/dashboard-sidecar/db.py
    - litellm/dashboard-sidecar/config_loader.py
    - litellm/dashboard-sidecar/tests/__init__.py
    - litellm/dashboard-sidecar/tests/conftest.py
    - litellm/dashboard-sidecar/tests/test_poller.py
    - litellm/dashboard-sidecar/tests/test_prometheus.py
    - litellm/dashboard-sidecar/tests/test_context_util.py
    - litellm/dashboard-sidecar/tests/test_tool_repair.py
    - litellm/dashboard-sidecar/tests/test_latency_fields.py
    - litellm/dashboard-sidecar/tests/test_security.py
  modified: []
decisions:
  - "Single shared DuckDB connection with threading.Lock prevents connection storms (RESEARCH.md Pattern 1)"
  - "max() dedup for nemotron-cascade-2 ensures larger context window (65536 vs 32768) is never under-reported"
  - "Wave 0 test stubs use importorskip so they SKIP (not ERROR) until Wave 1 modules exist"
  - "test_security.py excludes tests/ directory from LITELLM_MASTER_KEY scan to avoid self-referential false positive"
metrics:
  duration_seconds: 324
  completed_date: "2026-04-13T18:41:17Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 14
  files_modified: 0
---

# Phase 1 Plan 01: Dashboard Sidecar Skeleton Summary

**One-liner:** Python 3.13-slim FastAPI sidecar with single-writer DuckDB, config-driven context cache with max() dedup, and 6 Wave 0 RED pytest stubs for Plans 02-05.

## What Was Built

The `dashboard-sidecar/` project skeleton provides the shared infrastructure all Wave 1 plans build on:

1. **Project scaffold** (Task 1): Dockerfile (python:3.13-slim), pinned requirements.txt, pytest.ini, FastAPI app with lifespan stub, no LITELLM_MASTER_KEY anywhere.

2. **DuckDB layer** (Task 2): `db.py` implements the single shared connection pattern with threading.Lock. `init_schema()` creates the `requests` and `latency_snapshots` tables with exact columns from the plan interfaces, plus a SEQUENCE for latency_snapshots.id and 4 composite indexes. `config_loader.py` walks `model_list[*]`, extracts `max_input_tokens`, uses `max()` dedup for duplicate model names (nemotron-cascade-2), and omits models without `model_info`.

3. **Wave 0 RED stubs** (Task 3): 6 test files with concrete assertions against modules that Plans 02-05 will implement. Tests use `pytest.importorskip` so they skip cleanly rather than error until the target modules exist. The `conftest.py` provides `in_memory_db`, `fake_max_ctx`, and `tmp_repairs_log` fixtures reused across all test files.

## Commits

| Hash | Message |
|------|---------|
| fa88f228 | feat(01-01): create dashboard-sidecar project skeleton |
| 251d0900 | feat(01-01): implement db.py and config_loader.py |
| c4b72bcf | test(01-01): add Wave 0 RED pytest stubs for Plans 02-05 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] test_security.py self-referential LITELLM_MASTER_KEY scan failure**
- **Found during:** Task 3 verification
- **Issue:** `test_no_master_key_in_sidecar_source` was scanning all `.py` files including itself, which contains the constant string "LITELLM_MASTER_KEY" as a test assertion — causing the test to fail against its own file.
- **Fix:** Added a guard to skip files in the `tests/` directory from the scan. The test is still meaningful — it catches any accidental key leakage in non-test production source files.
- **Files modified:** `litellm/dashboard-sidecar/tests/test_security.py`
- **Commit:** c4b72bcf (included in Wave 0 stubs commit)

**2. [Observation] config.yaml nemotron-cascade-2 has only one entry (32768) in current state**
- The plan was designed against a config with two nemotron-cascade-2 entries (65536 + 32768). The current config.yaml only has one entry (32768). The `max()` dedup logic is correct and verified via in-memory YAML. The `test_context_util.py::test_nemotron_cascade_takes_max` uses its own self-contained YAML and passes. The live config scenario will be resolved when both backends are present (hintonator RTX5090 at 65536, docker-gpu at 32768).

## Known Stubs

None — all stubs are intentional Wave 0 RED tests. The `main.py` lifespan calls `load_config("/app/config.yaml")` which is not available at test time; TestClient bypasses lifespan, so healthz tests pass without a config file.

## Threat Flags

No new security surface introduced — this plan creates local scaffolding only, no network endpoints accepting untrusted input.

T-01-01 (LITELLM_MASTER_KEY leakage) mitigated: `test_no_master_key_in_sidecar_source` asserts no production `.py` file references the key.

T-01-03 (DuckDB connection exhaustion) mitigated: Single shared connection + threading.Lock in `db.py`.

## Self-Check: PASSED

All 14 files created confirmed on disk. All 3 commits verified in git log.
