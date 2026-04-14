---
phase: 07-llm-powered-intelligence-layer
plan: "02"
subsystem: intelligence
tags: [intelligence, llm, huggingface_hub, duckdb, apscheduler, fastapi, urllib, tdd]

requires:
  - phase: 07-01
    provides: intelligence_cache DuckDB schema, RED pytest stubs INT-01..INT-06, huggingface_hub pin

provides:
  - intelligence_job.py: call_llm, search_hf_models, assemble_metrics_context, run_intelligence_job, answer_question
  - routers/intelligence.py: GET /api/intelligence, POST /api/intelligence/query
  - APScheduler 12h intelligence job wired in main.py (first run 30s after boot)
  - All 6 INT tests GREEN (INT-01..INT-06)

affects:
  - 07-03 (Wave 2 frontend — GET /api/intelligence and POST /api/intelligence/query now available for IntelligenceTab)

tech-stack:
  added: []
  patterns:
    - urllib.request POST with Bearer auth and timeout=120 for LLM calls (mirrors model_health.py)
    - SimpleNamespace return from search_hf_models for attribute-compatible test surface
    - _model_to_dict() serialisation bridge for JSON storage in DuckDB
    - INSERT OR REPLACE INTO intelligence_cache (id=1) for single-row upsert
    - in_memory_db fixture extended with _cache reset for test isolation

key-files:
  created:
    - dashboard-sidecar/intelligence_job.py
    - dashboard-sidecar/routers/intelligence.py
  modified:
    - dashboard-sidecar/main.py
    - dashboard-sidecar/tests/test_intelligence.py

key-decisions:
  - "search_hf_models returns SimpleNamespace objects (not plain dicts) so test_search_hf_models m.id attribute access works; _model_to_dict() converts to dicts for DuckDB JSON storage and API cache"
  - "in_memory_db fixture extended with monkeypatch.setattr(intelligence_job, '_cache', {}) to ensure test_get_empty sees empty state regardless of prior test run order"
  - "INTELLIGENCE_MODEL defaults to qwq-32b per plan spec (research §Model Selection)"
  - "answer_question raises URLError upward; routers/intelligence.py catches all exceptions and returns 503"

requirements-completed: [INT-01, INT-02, INT-03, INT-04, INT-05, INT-06]

duration: 3 min
completed: 2026-04-14
---

# Phase 07 Plan 02: Intelligence Backend Implementation Summary

**urllib + APScheduler 12h job pipeline: LiteLLM proxy calls (timeout=120, Bearer auth), HuggingFace NVFP4/FP8 model search, DuckDB single-row cache upsert, FastAPI GET/POST intelligence endpoints — all 6 INT tests GREEN**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-14T22:54:29Z
- **Completed:** 2026-04-14T22:57:46Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Created `intelligence_job.py` (412 lines) implementing all 5 public functions:
  - `call_llm`: urllib POST to `{LITELLM_URL}/v1/chat/completions` with Bearer auth and `timeout=120`
  - `search_hf_models`: `HfApi().list_models(filter=["text-generation","nvidia"], sort="lastModified", limit=50, full=True)` — filters NVFP4/FP8 tags, returns SimpleNamespace list
  - `assemble_metrics_context`: 3 aggregate SQL queries (24h model stats, 6h error clusters, 7d latency trend), truncated to 3000 chars
  - `run_intelligence_job`: health summary + anomaly + recommendation LLM calls with JSON parse fallback to `[]`; HF search; `INSERT OR REPLACE INTO intelligence_cache (id=1, ...)` via `db.execute()`; in-memory `_cache` update under lock
  - `answer_question`: single-shot Q&A calling `call_llm` with assembled context
- Module-level cache hydration from DuckDB on import (wrapped in try/except for first-boot safety)
- Created `routers/intelligence.py`: `GET /api/intelligence` returns cached result or empty-state; `POST /api/intelligence/query` wraps `answer_question` with 503 on any LLM failure
- Wired into `main.py`: `_intelligence_job_wrapper`, `scheduler.add_job(hours=12, max_instances=1, next_run_time=now+30s)`, `app.include_router(intelligence_router)`
- Fixed `in_memory_db` fixture to reset `_cache` between tests — ensures `test_get_empty` sees null state even after `test_job_writes_cache` populates the global cache

## Task Commits

1. **Task 1: intelligence_job.py** — `dd0c5d1` (feat)
2. **Task 2: router + main.py wiring + test fixture fix** — `fcf9e4b` (feat)

## Files Created/Modified

- `dashboard-sidecar/intelligence_job.py` — created (412 lines): full intelligence pipeline
- `dashboard-sidecar/routers/intelligence.py` — created (55 lines): GET + POST endpoints
- `dashboard-sidecar/main.py` — modified: imports, `_intelligence_job_wrapper`, scheduler job, router registration
- `dashboard-sidecar/tests/test_intelligence.py` — modified: `in_memory_db` fixture resets `_cache`

## Decisions Made

- **SimpleNamespace return from search_hf_models:** The RED test (`test_search_hf_models`) accesses results via `m.id` (attribute access), not `m["id"]` (dict access). Returning SimpleNamespace objects satisfies the test contract. `_model_to_dict()` converts them to plain dicts before JSON serialisation in `run_intelligence_job`.
- **qwq-32b as default INTELLIGENCE_MODEL:** Per plan spec and research §Model Selection recommendation. Overridable via env var.
- **test fixture _cache reset:** `in_memory_db` fixture extended to also reset `intelligence_job._cache` via monkeypatch, ensuring test isolation without modifying test logic.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] search_hf_models returned dicts but test accessed `.id` attribute**
- **Found during:** Task 1 test run (INT-02 failure: `AttributeError: 'dict' object has no attribute 'id'`)
- **Issue:** Test stub used `m.id` attribute access on returned items; plain dicts don't support this
- **Fix:** Changed return type to `SimpleNamespace` objects; added `_model_to_dict()` helper for serialisation in `run_intelligence_job` and cache storage
- **Files modified:** `intelligence_job.py`
- **Commit:** dd0c5d1

**2. [Rule 1 - Bug] test_get_empty failed due to stale _cache from prior test**
- **Found during:** Task 2 test run (INT-04 failure: `generated_at` was not None)
- **Issue:** `test_job_writes_cache` populates module-level `intelligence_job._cache` directly; `test_get_empty` ran after and saw non-empty cache; `in_memory_db` fixture only patched `db._conn`, not `_cache`
- **Fix:** Extended `in_memory_db` fixture to also `monkeypatch.setattr(intelligence_job, "_cache", {})` so each test using the fixture starts with a clean cache state
- **Files modified:** `tests/test_intelligence.py`
- **Commit:** fcf9e4b

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bugs in test/implementation contract mismatch)
**Impact:** No scope changes; both fixes are correctness-level adjustments.

## Issues Encountered

None beyond the two auto-fixed bugs above.

## Known Stubs

None — all endpoints are fully wired. The `IntelligenceTab` placeholder in `App.tsx` (from Plan 01) is out of scope for this plan and tracked in Plan 01 SUMMARY.

## Threat Surface Scan

No new trust boundaries beyond the plan's `<threat_model>`. Mitigations verified:
- T-07-05: `LITELLM_BENCH_KEY` read from env only via `os.environ.get`, never logged
- T-07-06: `json.loads` in try/except with fallback `[]`; parameterized DuckDB insert
- T-07-07: `max_length=1000` on `QuestionBody.question`; `timeout=120` on `call_llm`
- T-07-10: question passed as user-role message only; 1000-char cap enforced by Pydantic

## Next Phase Readiness

- Wave 2 (Plan 03): `GET /api/intelligence` and `POST /api/intelligence/query` are live; `IntelligenceTab` placeholder in `App.tsx` is the mount point for full UI

---
*Phase: 07-llm-powered-intelligence-layer*
*Completed: 2026-04-14*
