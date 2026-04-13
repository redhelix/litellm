---
phase: 01-data-collection-layer
plan: 05
subsystem: api
tags: [fastapi, apscheduler, duckdb, docker-compose, traefik, prometheus]

# Dependency graph
requires:
  - phase: 01-data-collection-layer/01-01
    provides: DuckDB schema and db.query/db.execute helpers
  - phase: 01-data-collection-layer/01-02
    provides: poller.poll_once writing to DuckDB
  - phase: 01-data-collection-layer/01-03
    provides: prometheus_scraper.scrape_once writing node scrapes
  - phase: 01-data-collection-layer/01-04
    provides: config_loader and repairs.RepairsLogReader

provides:
  - FastAPI app (dashboard-sidecar) with APScheduler lifespan running poll_once every 30s and scrape_once every 60s
  - GET /healthz liveness endpoint
  - GET /api/requests?window=5m|7d|30d paginated latency rows with ttft_ms, total_latency_ms, model
  - GET /api/models per-model aggregates with llm_api_latency_p50/p95 and overhead_ms_p50
  - GET /api/nodes deployment_state health grid from latest prometheus scrape
  - GET /api/latency/snapshots?model=X&window=7d|30d time-series for trend charts
  - docker-compose.yaml dashboard-sidecar service on port 4001 with traefik-net routing and Authentik SSO

affects:
  - phase-02 (dashboard UI — all endpoints consumed by charts/tables)
  - any monitoring or alerting layer reading /api/nodes

# Tech tracking
tech-stack:
  added: [fastapi, uvicorn, apscheduler, pytz]
  patterns: [lifespan-scheduler, router-per-resource, threading.Lock shared DuckDB conn, window enum validation]

key-files:
  created:
    - dashboard-sidecar/main.py
    - dashboard-sidecar/routers/__init__.py
    - dashboard-sidecar/routers/requests.py
    - dashboard-sidecar/routers/models.py
    - dashboard-sidecar/routers/nodes.py
    - dashboard-sidecar/routers/latency.py
  modified:
    - dashboard-sidecar/requirements.txt
    - docker-compose.yaml

key-decisions:
  - "APScheduler BackgroundScheduler started inside FastAPI lifespan context manager — clean startup/shutdown"
  - "RepairsLogReader instantiated once in main.py and passed to poll_once each tick (persistent cursor state)"
  - "No LITELLM_MASTER_KEY in dashboard-sidecar env — SYS-02 architecturally enforced at compose level"
  - "DATABASE_URL passed with ?connect_timeout=10 stripped before hand-off to DuckDB (psycopg2 param incompatible)"
  - "pytz added to requirements.txt for APScheduler timezone support"
  - "traefik-net + autoheal label added to dashboard-sidecar service (Rule 2 deviation — missing in plan draft)"

patterns-established:
  - "Router per resource: each /api/* path lives in its own routers/*.py file imported in main.py"
  - "Window enum: 5m/7d/30d validated at router layer; SQL INTERVAL injected per case"
  - "DuckDB thread safety: all queries go through db.query() which holds threading.Lock"

requirements-completed: [DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, SYS-02]

# Metrics
duration: ~90min
completed: 2026-04-13
---

# Phase 01 Plan 05: Dashboard Sidecar API Summary

**FastAPI sidecar on port 4001 with APScheduler (poll 30s / scrape 60s) and four live REST endpoints — all verified on docker-001 behind Authentik SSO via Traefik**

## Performance

- **Duration:** ~90 min (including TDD cycles, docker deploy, live verification)
- **Started:** 2026-04-13
- **Completed:** 2026-04-13
- **Tasks:** 2 TDD tasks (RED + GREEN each) + 3 auto-fix deviations + human-verify checkpoint
- **Files modified:** 8

## Accomplishments

- Full FastAPI app with APScheduler lifespan wired to poll_once (30s) and scrape_once (60s) — confirmed running on docker-001
- Four REST routers returning live DuckDB data: /api/requests, /api/models, /api/nodes, /api/latency/snapshots
- SYS-02 enforced: dashboard-sidecar container has no LITELLM_MASTER_KEY; no sk-* tokens in any API response
- Traefik routing via sidecar.thelaljis.com with Authentik SSO middleware applied

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Failing tests for four FastAPI routers** - `3b6a463` (test)
2. **Task 1 GREEN: Implement four FastAPI routers** - `5e31320` (feat)
3. **Task 2 RED: Failing tests for main.py wiring** - `b30686f` (test)
4. **Task 2 GREEN: Wire APScheduler + routers into main.py + docker-compose** - `de798f8` (feat)
5. **Fix: Strip psycopg2-incompatible DATABASE_URL params + add pytz** - `61f69ab` (fix)
6. **Fix: Add traefik-net + autoheal label to docker-compose service** - `fd2cbce` (fix)

## Files Created/Modified

- `dashboard-sidecar/main.py` - FastAPI app, lifespan with BackgroundScheduler, router mounts, /healthz
- `dashboard-sidecar/routers/__init__.py` - package init
- `dashboard-sidecar/routers/requests.py` - GET /api/requests with window enum, paginated DuckDB rows
- `dashboard-sidecar/routers/models.py` - GET /api/models with llm_api_latency_p50/p95 and overhead_ms_p50
- `dashboard-sidecar/routers/nodes.py` - GET /api/nodes with deployment_state from latest prometheus scrape
- `dashboard-sidecar/routers/latency.py` - GET /api/latency/snapshots with scraped_at time-series
- `dashboard-sidecar/requirements.txt` - added pytz
- `docker-compose.yaml` - dashboard-sidecar service on port 4001, traefik-net, autoheal, correct env (no master key)

## Decisions Made

- DATABASE_URL contained `?connect_timeout=10` which is a psycopg2 param not understood by DuckDB's postgres extension — stripped before passing to db layer
- RepairsLogReader instantiated once at startup and reused each scheduler tick so the file cursor persists across polls (avoids re-reading already-processed repairs)
- SYS-02 enforced structurally: dashboard-sidecar service in docker-compose.yaml deliberately omits LITELLM_MASTER_KEY from its environment block

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Strip psycopg2-incompatible query params from DATABASE_URL**
- **Found during:** Task 2 GREEN (docker deployment)
- **Issue:** DATABASE_URL included `?connect_timeout=10`; DuckDB's postgres scanner rejected it, preventing db.query calls
- **Fix:** Strip unsupported query params before passing URL to DuckDB connection
- **Files modified:** dashboard-sidecar/main.py
- **Verification:** /api/requests returned live rows after fix
- **Committed in:** 61f69ab

**2. [Rule 3 - Blocking] Add pytz to requirements.txt**
- **Found during:** Task 2 GREEN (container startup)
- **Issue:** APScheduler imported pytz at runtime; not in requirements.txt; container failed to start
- **Fix:** Added `pytz` to dashboard-sidecar/requirements.txt
- **Files modified:** dashboard-sidecar/requirements.txt
- **Verification:** Container started successfully, scheduler jobs appeared in logs
- **Committed in:** 61f69ab

**3. [Rule 2 - Missing Critical] Add traefik-net network + autoheal label**
- **Found during:** Task 2 GREEN (docker-compose integration review)
- **Issue:** Plan draft did not include traefik-net on the dashboard-sidecar service; without it Traefik cannot route to the container. autoheal label is standard for all services in this compose stack.
- **Fix:** Added `traefik-net` to networks list and `autoheal: "true"` label in docker-compose.yaml
- **Files modified:** docker-compose.yaml
- **Verification:** sidecar.thelaljis.com resolved and responded through Traefik with Authentik SSO
- **Committed in:** fd2cbce

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 missing critical)
**Impact on plan:** All three required for correct deployment. No scope creep.

## Issues Encountered

- DuckDB psycopg2 URL param incompatibility surfaced only at runtime (not caught in unit tests which mock db.query). Fixed inline per Rule 3.

## Known Stubs

None — all four endpoints return live DuckDB data confirmed by human verification on docker-001.

## User Setup Required

None — service is live on docker-001 via docker-compose. No additional manual steps required.

## Next Phase Readiness

- All six DATA/SYS acceptance criteria met (DATA-01 through DATA-05, SYS-02)
- All REST endpoints return live data and are accessible behind Authentik SSO at sidecar.thelaljis.com
- Phase 02 (dashboard UI) can consume all four /api/* endpoints immediately
- No blockers

---
*Phase: 01-data-collection-layer*
*Completed: 2026-04-13*
