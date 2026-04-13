---
phase: 01
slug: data-collection-layer
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 01 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x |
| **Config file** | `dashboard-sidecar/pytest.ini` (Wave 0 creates) |
| **Quick run command** | `cd dashboard-sidecar && python -m pytest tests/ -q --tb=short` |
| **Full suite command** | `cd dashboard-sidecar && python -m pytest tests/ -v` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick run command
- **After every plan wave:** Run full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| 01-01-01 | 01 | 1 | DATA-01 | — | N/A | unit | `pytest tests/test_poller.py -q` | ⬜ pending |
| 01-01-02 | 01 | 1 | DATA-02 | — | N/A | unit | `pytest tests/test_prometheus.py -q` | ⬜ pending |
| 01-01-03 | 01 | 1 | DATA-03 | — | N/A | unit | `pytest tests/test_context_util.py -q` | ⬜ pending |
| 01-01-04 | 01 | 1 | DATA-04 | — | N/A | unit | `pytest tests/test_tool_repair.py -q` | ⬜ pending |
| 01-01-05 | 01 | 1 | DATA-05 | — | N/A | unit | `pytest tests/test_latency_fields.py -q` | ⬜ pending |
| 01-01-06 | 01 | 1 | SYS-02 | T-01-SEC | Master key not in API response bodies | integration | `pytest tests/test_security.py -q` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `dashboard-sidecar/tests/test_poller.py` — stubs for DATA-01 (poll watermark, upsert deduplication)
- [ ] `dashboard-sidecar/tests/test_prometheus.py` — stubs for DATA-02 (quantile parsing, metric presence)
- [ ] `dashboard-sidecar/tests/test_context_util.py` — stubs for DATA-03 (utilization ratio, NULL for missing)
- [ ] `dashboard-sidecar/tests/test_tool_repair.py` — stubs for DATA-04 (3-state join logic, request_id key)
- [ ] `dashboard-sidecar/tests/test_latency_fields.py` — stubs for DATA-05 (TTFT from timestamps, separate fields)
- [ ] `dashboard-sidecar/tests/test_security.py` — stubs for SYS-02 (no key in response bodies)
- [ ] `dashboard-sidecar/tests/conftest.py` — shared fixtures (mock DB connection, mock DuckDB, mock Prometheus)
- [ ] `dashboard-sidecar/pytest.ini` — test discovery config

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| DuckDB rows have < 60s lag after Postgres write | DATA-01 | Requires live Postgres writes and clock comparison | Insert a test row to LiteLLM_SpendLogs, wait 35s, query DuckDB requests table, confirm row present |
| Prometheus scrape stores deployment_state per model | DATA-02 | Requires live Prometheus instance at 192.168.50.117:9090 | `curl http://localhost:4001/api/nodes` and confirm all 5 nodes appear |
| tool_repairs.jsonl written by fix_json_tool_calls.py | DATA-04 | Requires a live malformed JSON tool call to trigger repair | Send a request with broken JSON tool call args, check /tmp/tool_repairs.jsonl for new entry |
| Master key not present in any sidecar HTTP response | SYS-02 | Requires full container stack running | `curl http://docker-001:4001/api/models` — grep response for LITELLM_MASTER_KEY value |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
