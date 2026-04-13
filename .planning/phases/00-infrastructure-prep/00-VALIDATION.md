---
phase: 0
slug: infrastructure-prep
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 0 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bash / manual verification (no test framework — infra config changes) |
| **Config file** | none |
| **Quick run command** | `docker compose logs --tail=10 litellm` |
| **Full suite command** | `docker compose ps && docker compose logs --tail=50 litellm` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `docker compose logs --tail=10 litellm`
- **After every plan wave:** Run `docker compose ps && docker compose logs --tail=50 litellm`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 0-01-01 | 01 | 1 | INFRA-01 | — | Retention config active, table not unbounded | manual | `docker compose exec postgres psql -U litellm -c "SELECT COUNT(*) FROM LiteLLMSpendLogs WHERE startTime < NOW() - INTERVAL '30 days';"` | ✅ | ⬜ pending |
| 0-01-02 | 01 | 1 | SC-2 | — | Log rotation capped | manual | `docker compose logs --tail=5 litellm \| wc -l` | ✅ | ⬜ pending |
| 0-01-03 | 01 | 1 | INFRA-02 | — | Weave errors silenced | manual | `docker compose logs litellm 2>&1 \| grep -c RecursionError` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Verify PostgreSQL connectivity: `docker compose exec postgres psql -U litellm -c "\dt"`
- [ ] Confirm `docker-compose.yaml` is editable and stack can be restarted cleanly

*Existing infrastructure covers the phase — no new test framework needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Spend log retention active | INFRA-01 | Requires DB query against live container | `docker compose exec postgres psql -U litellm -c "SELECT COUNT(*) FROM \"LiteLLMSpendLogs\" WHERE \"startTime\" < NOW() - INTERVAL '30 days';"` |
| Log rotation applied | INFRA-02 | Requires restart + log inspection | Restart with `docker compose up -d`, wait 60s, check `docker inspect litellm --format='{{.HostConfig.LogConfig}}'` |
| Weave RecursionError silenced | INFRA-01 | Requires live request to trigger failure path | Send a request that hits an unavailable model, check logs for absence of RecursionError |
| startTime index exists | INFRA-01 | DB introspection | `docker compose exec postgres psql -U litellm -c "SELECT indexname FROM pg_indexes WHERE tablename='LiteLLMSpendLogs';"` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
