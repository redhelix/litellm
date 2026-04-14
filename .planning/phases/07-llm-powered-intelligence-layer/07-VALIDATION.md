---
phase: 07
slug: llm-powered-intelligence-layer
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-14
---

# Phase 07 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 8.3.3 + pytest-asyncio 0.24.0 |
| **Config file** | none explicit (runs from dashboard-sidecar/) |
| **Quick run command** | `cd dashboard-sidecar && pytest tests/test_intelligence.py -x -q` |
| **Full suite command** | `cd dashboard-sidecar && pytest tests/ -v` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd dashboard-sidecar && pytest tests/test_intelligence.py -x -q`
- **After every plan wave:** Run `cd dashboard-sidecar && pytest tests/ -v`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| INT-01 | 07-02 | 2 | call_llm() assembles correct OpenAI-compat request and returns content string | unit (mock urllib) | `pytest tests/test_intelligence.py::test_call_llm -x` | Wave 0 stub | pending |
| INT-02 | 07-02 | 2 | search_hf_models() filters by NVFP4/FP8 tags and returns correct shape | unit (mock HfApi) | `pytest tests/test_intelligence.py::test_search_hf_models -x` | Wave 0 stub | pending |
| INT-03 | 07-02 | 2 | run_intelligence_job() writes to DuckDB intelligence_cache table | unit (in_memory_db fixture) | `pytest tests/test_intelligence.py::test_job_writes_cache -x` | Wave 0 stub | pending |
| INT-04 | 07-02 | 2 | GET /api/intelligence returns empty state when no job has run | integration | `pytest tests/test_intelligence.py::test_get_empty -x` | Wave 0 stub | pending |
| INT-05 | 07-02 | 2 | POST /api/intelligence/query returns 503 when LLM unreachable | unit (mock urllib raise) | `pytest tests/test_intelligence.py::test_query_llm_error -x` | Wave 0 stub | pending |
| INT-06 | 07-02 | 2 | metrics context assembly SQL queries run without error on in_memory_db | unit | `pytest tests/test_intelligence.py::test_metrics_context_sql -x` | Wave 0 stub | pending |

---

## Wave 0 Gaps

- [ ] `dashboard-sidecar/tests/test_intelligence.py` — RED stubs for INT-01 through INT-06 (created by Plan 07-01)
- [ ] `dashboard/src/components/ui/tabs.tsx` — shadcn Tabs component (installed by Plan 07-01)
- [ ] `dashboard-sidecar/intelligence_job.py` — module stub (created by Plan 07-01)
- [ ] `dashboard-sidecar/routers/intelligence.py` — router stub (created by Plan 07-01)
