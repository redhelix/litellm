---
phase: 02
slug: core-dashboard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest + @testing-library/react |
| **Config file** | dashboard/vite.config.ts (Wave 0 installs) |
| **Quick run command** | `cd dashboard && npx vitest run --reporter=verbose` |
| **Full suite command** | `cd dashboard && npx vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd dashboard && npx vitest run --reporter=verbose`
- **After every plan wave:** Run `cd dashboard && npx vitest run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 0 | SYS-03 | — | No auth headers, no credentials in bundle | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 0 | MET-01 | — | deriveStatus maps 0/1/null correctly | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | MET-01/02 | — | Overview panel renders aggregate values | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 1 | VIEW-01 | — | Tool call stacked bar totals to 100% | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 1 | VIEW-02 | — | Node grid renders healthy/slow/unreachable | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 02-04-01 | 04 | 1 | MET-03/04/05 | — | Per-model cards render all metric fields | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 02-05-01 | 05 | 2 | SYS-03 | — | Docker service accessible on LAN port, no auth | manual | curl http://docker-001:4002 | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `dashboard/src/__tests__/utils.test.ts` — stubs for deriveStatus, aggregate helpers
- [ ] `dashboard/src/__tests__/Overview.test.tsx` — stub for MET-01/02 Overview panel
- [ ] `dashboard/src/__tests__/NodeGrid.test.tsx` — stub for VIEW-02 node health grid
- [ ] `dashboard/src/__tests__/ModelCards.test.tsx` — stub for MET-03/04/05 per-model cards
- [ ] vitest + @testing-library/react installed in Wave 0 scaffold plan

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dashboard accessible at http://docker-001:4002 without login | SYS-03 | Requires live docker-001 LAN access | `curl -sS http://docker-001:4002` returns HTML; no 302 redirect |
| Auto-refresh fires every 30s without page reload | MET-01 | Requires browser observation | Open DevTools Network tab, confirm periodic API calls |
| Stale banner appears >60s after sidecar goes down | MET-01 | Requires stopping sidecar container | Stop dashboard-sidecar, wait 65s, verify banner appears |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
