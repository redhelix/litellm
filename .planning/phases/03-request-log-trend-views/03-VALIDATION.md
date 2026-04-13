---
phase: 03
slug: request-log-trend-views
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (frontend) + pytest (sidecar) |
| **Config file** | `dashboard/vite.config.ts` / `dashboard-sidecar/tests/` |
| **Quick run command** | `cd dashboard && npm run test -- --run` |
| **Full suite command** | `cd dashboard && npm run test -- --run && cd ../dashboard-sidecar && python -m pytest tests/ -q` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd dashboard && npm run test -- --run`
- **After every plan wave:** Run full suite (vitest + pytest)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 03-01-01 | 01 | 1 | VIEW-03 | unit | `cd dashboard && npm run test -- --run` | ⬜ pending |
| 03-01-02 | 01 | 1 | VIEW-03 | unit | `cd dashboard && npm run test -- --run` | ⬜ pending |
| 03-02-01 | 02 | 2 | VIEW-04 | unit | `cd dashboard && npm run test -- --run` | ⬜ pending |
| 03-02-02 | 02 | 2 | VIEW-04 | unit | `cd dashboard && npm run test -- --run` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `dashboard/src/__tests__/RequestLogTable.test.tsx` — stubs for VIEW-03
- [ ] `dashboard/src/__tests__/TrendView.test.tsx` — stubs for VIEW-04
- [ ] `dashboard-sidecar/tests/test_requests.py` — stubs for /api/requests endpoint
- [ ] `dashboard-sidecar/tests/test_trends.py` — stubs for /api/trends endpoint

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 30-day query returns within 2s | VIEW-04 | Requires live DuckDB with real data | Load dashboard, open trends, check Network tab timing |
| Pagination correctly shows 500+ rows | VIEW-03 | Requires live sidecar with real request history | Navigate to page 2+ and verify row continuity |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
