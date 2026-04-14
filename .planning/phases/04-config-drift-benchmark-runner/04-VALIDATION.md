---
phase: 04
slug: config-drift-benchmark-runner
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 04 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (frontend) + pytest (sidecar) |
| **Config file** | `dashboard/vite.config.ts` / `dashboard-sidecar/tests/` |
| **Quick run command** | `cd dashboard && npm run test -- --run` |
| **Full suite command** | `cd dashboard && npm run test -- --run && cd ../dashboard-sidecar && python -m pytest tests/ -q` |
| **Estimated runtime** | ~20 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd dashboard && npm run test -- --run`
- **After every plan wave:** Run full suite (vitest + pytest)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 04-01-01 | 01 | 1 | DRIFT-01..04 | unit | `cd dashboard && npm run test -- --run` | ⬜ pending |
| 04-01-02 | 01 | 1 | BENCH-01..03 | unit | `cd dashboard && npm run test -- --run` | ⬜ pending |
| 04-02-01 | 02 | 1 | DRIFT-01..04 | unit | `python -m pytest tests/test_config_diff.py -q` | ⬜ pending |
| 04-02-02 | 02 | 1 | BENCH-01..03 | unit | `python -m pytest tests/test_benchmark.py -q` | ⬜ pending |
| 04-03-01 | 03 | 2 | DRIFT-01..04 | unit | `cd dashboard && npm run test -- --run` | ⬜ pending |
| 04-03-02 | 03 | 2 | BENCH-01..03 | unit | `cd dashboard && npm run test -- --run` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `dashboard/src/__tests__/ConfigDriftView.test.tsx` — stubs for DRIFT-01..04
- [ ] `dashboard/src/__tests__/BenchmarkRunner.test.tsx` — stubs for BENCH-01..03
- [ ] `dashboard-sidecar/tests/test_config_diff.py` — stubs for /api/config/diff endpoint
- [ ] `dashboard-sidecar/tests/test_benchmark.py` — stubs for /api/benchmark/* endpoints

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Benchmark fires real requests to LiteLLM proxy | BENCH-01 | Requires live docker-001:4000 | Click "Run benchmark", watch Network tab for POST to proxy |
| TTFT measured correctly via SSE stream | BENCH-01 | Requires streaming response | Compare TTFT to Prometheus p50 in Overview panel |
| Security warning renders orange-500 | DRIFT-02 | Requires live config with hardcoded key | Temporarily set master_key in config, rebuild, verify orange Alert |
| Benchmark history shows 10+ runs | BENCH-03 | Requires multiple runs | Run benchmark 10 times, verify history list shows all |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
