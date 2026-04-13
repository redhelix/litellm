# Phase 0: Infrastructure Prep - Research

**Researched:** 2026-04-13
**Domain:** PostgreSQL retention, Docker log rotation, Python exception handling, bounded SQL queries
**Confidence:** HIGH (all findings verified against actual codebase files on disk)

---

## Summary

Phase 0 has four concrete tasks drawn directly from the live system state: (1) add a PostgreSQL spend log retention policy so the 3.5 GiB database does not grow unboundedly on a 52 GiB remaining filesystem, (2) add Docker log rotation to the `litellm-proxy` service to cap the existing 5,546+ line log spam, (3) wrap `weave.init()` and the `WeaveCallback` body in try/except so 363 active `RecursionError` exceptions stop polluting logs, and (4) document the architectural rule that all future `spend_logs` queries must use bounded `WHERE startTime > NOW() - INTERVAL` clauses.

All four tasks are config or file edits — no new dependencies, no service rebuilds beyond a compose restart. The changes are low-risk and independently verifiable. The largest risk in this phase is applying the retention deletion to an already-large table; a DELETE with no LIMIT on 3.5 GiB of data can take minutes and cause I/O pressure during business hours.

**Primary recommendation:** Edit three files (`config.yaml`, `docker-compose.yaml`, `weave_callback.py`) and write a bounded-query architecture decision record. No new tools or runtimes are required.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-01 | Spend log retention policy in place — automatic pruning or archival to prevent unbounded DB growth (currently 3.5 GiB, 76% disk used) | LiteLLM `general_settings.maximum_spend_logs_retention_period` config key; fallback: scheduled DELETE cron or pg_cron job. Both approaches documented below. |
| INFRA-02 | Weave callback RecursionErrors suppressed or isolated — 363 errors confirmed; must not pollute tool call metrics | Direct file edit to `weave_callback.py`: wrap `weave.init()` and class body in try/except. Pattern documented below. |
</phase_requirements>

---

## Standard Stack

### Core (all already present — no new dependencies)

| Component | Current State | Change Required |
|-----------|--------------|-----------------|
| PostgreSQL 16 (litellm-db) | Running, 3.5 GiB pgdata volume | Add retention via config key or SQL DELETE |
| Docker Compose (docker-compose.yaml) | No logging config on any service | Add `logging` driver block to `litellm` service |
| `weave_callback.py` | Bare `weave.init()` at module import, no error handling | Wrap in try/except |
| `config.yaml` | No `maximum_spend_logs_retention_period` key present | Add key under `general_settings` |

**Installation:** None required — all changes are edits to existing files.

---

## Architecture Patterns

### Pattern 1: LiteLLM Native Retention (Preferred)

**What:** LiteLLM exposes `maximum_spend_logs_retention_period` under `general_settings` in `config.yaml`. When set, LiteLLM automatically deletes spend log rows older than the specified period on its internal cleanup cycle.

**When to use:** Always — this is the zero-maintenance path. No cron job, no external scheduler.

**Example:**
```yaml
# In config.yaml under general_settings:
general_settings:
  # ... existing keys ...
  maximum_spend_logs_retention_period: 30  # days
```

**Confidence:** MEDIUM [ASSUMED] — this key is referenced in the prior pitfalls research (PITFALLS.md line 117) citing LiteLLM docs. Not verified against the live `v1.83.6-nightly` config schema in this session. The planner should verify this key is accepted by the deployed version before treating it as the primary approach.

**Fallback if key is not supported:** Run a manual DELETE first, then schedule via cron or pg_cron (see Pattern 2).

---

### Pattern 2: Manual SQL Retention (Fallback)

**What:** Direct DELETE against the `LiteLLMSpendLogs` table with a bounded WHERE clause.

**When to use:** If `maximum_spend_logs_retention_period` is not accepted by the deployed nightly build, or as an immediate one-shot cleanup before the config key takes effect.

```sql
-- Run inside litellm-db container
DELETE FROM "LiteLLMSpendLogs"
WHERE "startTime" < NOW() - INTERVAL '30 days';
```

```bash
# One-liner via docker exec
docker exec litellm-db psql -U litellm -d litellm \
  -c "DELETE FROM \"LiteLLMSpendLogs\" WHERE \"startTime\" < NOW() - INTERVAL '30 days';"
```

**Warning:** On a 3.5 GiB table, this DELETE may take 30–120 seconds and will generate significant I/O. Run during low-traffic period. Add `VACUUM ANALYZE "LiteLLMSpendLogs";` afterward to reclaim space.

**Confidence:** HIGH [VERIFIED: docker-compose.yaml, config.yaml] — table name confirmed from codebase research, PostgreSQL syntax is standard.

---

### Pattern 3: Docker Log Rotation

**What:** Docker's `json-file` logging driver supports `max-size` and `max-file` options per service. Adding this to the `litellm` service in `docker-compose.yaml` caps the log file size.

**When to use:** Always — the litellm-proxy log currently has 5,546+ lines of "Proxy initialized" spam and no cap is configured.

**Example:**
```yaml
# In docker-compose.yaml under the litellm service:
  litellm:
    # ... existing config ...
    logging:
      driver: "json-file"
      options:
        max-size: "50m"
        max-file: "3"
```

**Effect:** Maximum 150 MiB of litellm-proxy logs on disk at any time (3 files × 50 MiB). Existing log is not immediately truncated — Docker rotates on write, so the cap applies to new log content going forward. A `docker compose up -d` restart is required to apply the logging config.

**Confidence:** HIGH [VERIFIED: docker-compose.yaml, Docker documentation is standard] — the existing compose file has no logging block, confirming the gap.

---

### Pattern 4: Weave Callback Defensive Init

**What:** Wrap `weave.init()` in try/except so a Weave SDK failure (RecursionError, network error, bad API key) degrades gracefully instead of crashing the proxy or silently dropping traces.

**Current code (weave_callback.py lines 16–24):**
```python
project = os.environ.get("WANDB_PROJECT", "litellm-proxy")
weave.init(project)                          # <-- fails hard on RecursionError

class WeaveCallback(CustomLogger):
    """No-op callback — Weave auto-patches litellm via weave.init() above."""
    pass

proxy_handler_instance = WeaveCallback()
```

**Fixed pattern:**
```python
import logging
import sys

logger = logging.getLogger(__name__)

project = os.environ.get("WANDB_PROJECT", "litellm-proxy")

_weave_enabled = False
try:
    weave.init(project)
    _weave_enabled = True
    logger.info(f"Weave tracing initialized for project: {project}")
except RecursionError as e:
    logger.warning(f"Weave init suppressed RecursionError (SDK bug on deep exception chains): {e}")
except Exception as e:
    logger.warning(f"Weave init failed, tracing disabled: {e}")


class WeaveCallback(CustomLogger):
    """No-op callback — Weave auto-patches litellm via weave.init() above.
    
    If weave.init() failed at startup, this callback is a safe no-op.
    """
    async def async_log_failure_event(self, kwargs, response_obj, start_time, end_time):
        if not _weave_enabled:
            return
        try:
            await super().async_log_failure_event(kwargs, response_obj, start_time, end_time)
        except RecursionError:
            logger.debug("Weave RecursionError suppressed in failure event handler")
        except Exception as e:
            logger.debug(f"Weave failure event handler error suppressed: {e}")
```

**Confidence:** HIGH [VERIFIED: weave_callback.py] — current file confirmed to have no try/except. The `RecursionError` root cause (deep exception chaining from docker-gpu failures) is documented in CONCERNS.md.

**Note on root cause:** The 363 RecursionErrors are triggered by connection failures to `docker-gpu.thelaljis.com:11434` (Ollama, currently unreachable). Fixing Weave stops the log spam but does not fix the upstream connectivity issue. The connection errors will still appear in litellm logs — they will just no longer cascade into RecursionErrors in the Weave handler.

---

### Pattern 5: Bounded Query Architecture Decision

**What:** Establish as an explicit constraint (documented or commented) that all queries against `LiteLLMSpendLogs` must include a time-bounded WHERE clause.

**Why needed now (Phase 0):** The success criteria require this is "architecturally excluded before any query is written." This means the decision is made in Phase 0 so Phase 1 (Data Collection) cannot accidentally ship unbounded queries.

**Standard clause:**
```sql
WHERE "startTime" > NOW() - INTERVAL '30 days'
```

**For 7-day trend views:**
```sql
WHERE "startTime" > NOW() - INTERVAL '7 days'
```

**Index requirement:** The above clauses are only fast if `startTime` is indexed. Verify:
```sql
-- Check existing indexes
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'LiteLLMSpendLogs';
```

If no index on `startTime` exists, add one:
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_spend_logs_starttime
  ON "LiteLLMSpendLogs" ("startTime" DESC);
```

**Confidence:** HIGH [VERIFIED: config.yaml confirms `store_prompts_in_spend_logs: true` is active, meaning the table is large and unbounded queries will be slow]

---

### Anti-Patterns to Avoid

- **`SELECT * FROM "LiteLLMSpendLogs"`** — Never run without a WHERE clause on startTime. Will full-scan 3.5 GiB.
- **Unbounded DELETE** — `DELETE FROM "LiteLLMSpendLogs"` without a WHERE clause drops all data.
- **Calling `weave.init()` without error handling** — Current pattern. Fails hard on RecursionError at startup if deep exception chains are present.
- **Skipping `VACUUM ANALYZE` after bulk DELETE** — PostgreSQL does not immediately reclaim disk space after DELETE. VACUUM is required.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Spend log retention | Custom Python script | LiteLLM `maximum_spend_logs_retention_period` config key | Zero-maintenance, runs on LiteLLM's internal cycle |
| Log size limiting | logrotate cron | Docker `json-file` logging options | Native to Docker Compose, no external scheduler |
| DB index creation | ORM migration | Direct `CREATE INDEX CONCURRENTLY` SQL | Simple one-time DDL, no migration framework needed for a single index |

**Key insight:** Every task in this phase is a config edit or a 5-line file change. There is nothing to build.

---

## Common Pitfalls

### Pitfall 1: Config Key Not Supported by Nightly Build

**What goes wrong:** `maximum_spend_logs_retention_period` is added to `config.yaml` but the nightly build does not accept it silently — LiteLLM ignores unknown keys without error, so there is no confirmation it is active.

**Why it happens:** `v1.83.6-nightly` is not a stable release. Config schema can differ from docs.

**How to avoid:** After adding the key and restarting, verify it took effect by checking LiteLLM startup logs for any retention-related messages, and manually query the table row count before/after a 30+ day boundary to confirm rows are being pruned.

**Warning signs:** Table size continues to grow after adding the key.

---

### Pitfall 2: DELETE Locks Table During Peak Traffic

**What goes wrong:** Running `DELETE FROM "LiteLLMSpendLogs" WHERE ...` on a 3.5 GiB table acquires row-level locks for the duration. During a long DELETE, new spend log writes may queue or fail if the proxy hits its `database_connection_pool_limit: 10`.

**Why it happens:** PostgreSQL DELETE is not instantaneous on large tables. At 3.5 GiB, the DELETE may take 1–3 minutes depending on I/O.

**How to avoid:** Run during a low-traffic window. If needed, chunk the delete:
```sql
-- Delete in batches to avoid prolonged lock
DO $$
DECLARE deleted INT;
BEGIN
  LOOP
    DELETE FROM "LiteLLMSpendLogs"
    WHERE id IN (
      SELECT id FROM "LiteLLMSpendLogs"
      WHERE "startTime" < NOW() - INTERVAL '30 days'
      LIMIT 5000
    );
    GET DIAGNOSTICS deleted = ROW_COUNT;
    EXIT WHEN deleted = 0;
    PERFORM pg_sleep(0.1);
  END LOOP;
END $$;
```

---

### Pitfall 3: Log Rotation Config Not Applied Until Restart

**What goes wrong:** Adding the `logging` block to `docker-compose.yaml` does not cap the current log file. The existing log continues to exist at its current size.

**Why it happens:** Docker reads logging config when a container starts, not when compose config changes. The existing log file is not truncated.

**How to avoid:** After editing `docker-compose.yaml`, run `docker compose up -d litellm` to recreate the container with the new logging config. The old log file will be abandoned and the new container will start fresh rotation.

**Optional:** Clear the old log first: `docker inspect litellm-proxy --format='{{.LogPath}}'` then truncate that file (requires root on the host).

---

### Pitfall 4: Weave Fix Does Not Stop All RecursionErrors

**What goes wrong:** The `WeaveCallback.async_log_failure_event` method is wrapped, but Weave's auto-patch of litellm may invoke other internal handlers not exposed via the CustomLogger interface. Some RecursionErrors may persist from internal Weave hooks.

**Why it happens:** `weave.init()` monkey-patches litellm at the module level. The CustomLogger interface only controls the explicit callback methods.

**How to avoid:** If RecursionErrors persist after the fix, add a global `sys.setrecursionlimit` guard or install a `threading.excepthook` to suppress them at the Python level. The ultimate fix is resolving the `docker-gpu.thelaljis.com:11434` connectivity issue, which stops the deep exception chains that trigger Weave's bug.

---

## Code Examples

### Verify LiteLLMSpendLogs Table Size and Index State

```bash
# Connect to the litellm database
docker exec litellm-db psql -U litellm -d litellm -c "
SELECT
  pg_size_pretty(pg_total_relation_size('\"LiteLLMSpendLogs\"')) AS total_size,
  COUNT(*) AS row_count,
  MIN(\"startTime\") AS oldest_row,
  MAX(\"startTime\") AS newest_row
FROM \"LiteLLMSpendLogs\";
"
```

```bash
# Check indexes on LiteLLMSpendLogs
docker exec litellm-db psql -U litellm -d litellm -c "
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'LiteLLMSpendLogs';
"
```

### Verify Docker Log Size After Rotation Config Applied

```bash
# Find log file path
docker inspect litellm-proxy --format='{{.LogPath}}'

# Check current size (on docker-001)
sudo du -sh $(docker inspect litellm-proxy --format='{{.LogPath}}')
```

### Test Weave Callback After Fix

```bash
# Verify the proxy starts and logs a clean Weave init message (not a RecursionError)
docker compose logs litellm --since 5m | grep -i weave
```

---

## Runtime State Inventory

This is not a rename/refactor phase — no runtime state rename is required. Including this section to document the live infrastructure state relevant to Phase 0 tasks.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | PostgreSQL `LiteLLMSpendLogs` — 3.5 GiB, unbounded growth, full prompts stored | Add retention config key; run initial DELETE for rows older than 30 days; add index on `startTime` if absent |
| Live service config | `config.yaml` — no `maximum_spend_logs_retention_period` key; `docker-compose.yaml` — no logging driver config on any service | File edits + `docker compose up -d` restart |
| OS-registered state | None — no Task Scheduler, cron, or systemd units involved | None |
| Secrets/env vars | No changes to secrets required for this phase | None |
| Build artifacts | `weave_callback.py` is volume-mounted at runtime (`./weave_callback.py:/app/weave_callback.py`). No rebuild required — editing the file on the host is immediately effective on next proxy restart | Edit file; restart proxy |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL (litellm-db) | Retention DELETE | ✓ (confirmed running) | 16-alpine | — |
| Docker Compose | Log rotation config | ✓ (confirmed in use) | — | — |
| `psql` CLI (via docker exec) | Manual SQL verification | ✓ (in postgres:16-alpine image) | — | — |
| `docker-gpu.thelaljis.com:11434` | Weave RecursionError root cause | ✗ (unreachable — confirmed) | — | Fix Weave; root cause not addressed in this phase |

**Missing dependencies with no fallback:** None that block Phase 0. The docker-gpu connectivity issue is the upstream trigger for the Weave errors, but Phase 0 only requires suppressing the errors in the Weave handler — not fixing the connectivity.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | No automated test framework exists in this project |
| Config file | None |
| Quick run command | Manual verification steps (see below) |
| Full suite command | Manual verification checklist |

This phase has no automated test framework. All verification is manual inspection.

### Phase Requirements — Test Map

| Req ID | Behavior | Test Type | Automated Command | Notes |
|--------|----------|-----------|-------------------|-------|
| INFRA-01 | Rows older than 30 days are pruned | manual | `docker exec litellm-db psql -U litellm -d litellm -c "SELECT COUNT(*) FROM \"LiteLLMSpendLogs\" WHERE \"startTime\" < NOW() - INTERVAL '30 days';"` | Expect 0 after retention runs |
| INFRA-01 | Table not growing unboundedly | manual | Monitor `pg_total_relation_size` before and after 24h | Compare size at T+0 vs T+24h |
| INFRA-01 (success criterion 4) | All dashboard queries use bounded WHERE clauses | review | Code review of all SQL in Phase 1 | Architecture constraint — enforced at review, not runtime |
| INFRA-02 | RecursionErrors no longer appear in logs | manual | `docker logs litellm-proxy --since 10m 2>&1 \| grep -c RecursionError` | Expect 0 after weave_callback.py fix + restart |
| Success criterion 2 | Docker log capped | manual | Check log file size via `docker inspect` path | Expect < 50 MiB per file |

### Wave 0 Gaps

None — this phase has no code to test and no test framework is expected. The verification is manual inspection of running infrastructure state.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Note |
|---------------|---------|------|
| V2 Authentication | No | No auth changes in this phase |
| V3 Session Management | No | No session changes |
| V4 Access Control | No | No access changes |
| V5 Input Validation | No | No user input in this phase |
| V6 Cryptography | No | No crypto changes |

**Security note from CONCERNS.md:** The hardcoded Postgres password in `docker-compose.yaml` is a known issue flagged during codebase audit. It is NOT in scope for Phase 0 (assigned to later phases per ROADMAP.md). Do not address it here — flag only if the Phase 0 plan accidentally touches those lines.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `maximum_spend_logs_retention_period: 30` is a valid `general_settings` key in LiteLLM v1.83.6-nightly | Architecture Patterns, Pattern 1 | If not supported, the config edit is a silent no-op. Fallback is Pattern 2 (manual DELETE). Medium risk — pitfalls research cited this key, but nightly builds differ from stable docs. |
| A2 | LiteLLM `general_settings.maximum_spend_logs_retention_period` value is in days (integer) | Pattern 1 code example | If wrong format, key may be silently ignored. Risk: low — the unit "30d" vs `30` can be tested empirically. |
| A3 | The table name is `LiteLLMSpendLogs` (case-sensitive, double-quoted) | Pattern 2 SQL | If table name differs in the deployed DB, the DELETE will fail with a clear error. Low risk — verify with `\dt` in psql before running. |

---

## Open Questions (RESOLVED)

1. **Does `maximum_spend_logs_retention_period` work in v1.83.6-nightly?**
   - What we know: Pitfalls research (PITFALLS.md) cited this config key; it is not currently set in config.yaml.
   - What's unclear: Whether the nightly build honors it or silently ignores it.
   - RESOLVED: Plan mitigates uncertainty with a dual approach — add the config key AND run a one-shot DELETE for rows older than 30 days. Success criterion is table-size observable regardless of whether the config key is honored. If no automatic pruning occurs after 30 days, the fallback DELETE pattern is documented.

2. **Is there already an index on `LiteLLMSpendLogs.startTime`?**
   - What we know: LiteLLM creates its own schema; the exact indexes are unknown without querying the live DB.
   - What's unclear: Whether bounded queries will be fast immediately or require an explicit CREATE INDEX.
   - RESOLVED: Task 1 includes an explicit check (`SELECT indexname FROM pg_indexes WHERE tablename='LiteLLMSpendLogs'`) followed by a conditional `CREATE INDEX CONCURRENTLY` if not present. Plan does not assume the index exists.

3. **Will restarting the litellm container to apply log rotation config cause a meaningful service disruption?**
   - What we know: Container has `restart: unless-stopped`; restart is typically < 15 seconds for litellm.
   - What's unclear: Whether any in-flight requests will be dropped during the restart.
   - RESOLVED: Accepted as low risk — this is a dev/lab environment with no SLA. Task 2 documents the restart step and notes it should be run during a quiet period. Threat model entry T-00-02 acknowledges this risk.

---

## Sources

### Primary (HIGH confidence — verified from files on disk)
- `/home/rhx/projects/home-infra-backups/litellm/weave_callback.py` — confirmed no try/except, bare weave.init()
- `/home/rhx/projects/home-infra-backups/litellm/docker-compose.yaml` — confirmed no logging config on any service
- `/home/rhx/projects/home-infra-backups/litellm/config.yaml` — confirmed no maximum_spend_logs_retention_period, confirmed store_prompts_in_spend_logs: true
- `.planning/codebase/CONCERNS.md` — confirmed 3.5 GiB pgdata volume, 5,546+ log lines, 363 Weave RecursionErrors, docker-gpu unreachable
- `.planning/research/PITFALLS.md` — confirmed retention gap (Pitfall 5), Weave reliability gap (Pitfall 6), Docker log rotation fix pattern

### Secondary (MEDIUM confidence)
- `.planning/research/PITFALLS.md` — `maximum_spend_logs_retention_period` key cited (not re-verified against live docs in this session)
- Docker documentation pattern for `json-file` logging driver options — standard, widely known

---

## Metadata

**Confidence breakdown:**
- Retention gap: HIGH — confirmed from config.yaml (no key present) and CONCERNS.md (3.5 GiB, growing)
- Docker log rotation: HIGH — confirmed from docker-compose.yaml (no logging block) and CONCERNS.md (5,546+ lines)
- Weave fix pattern: HIGH — confirmed from weave_callback.py (no error handling) and CONCERNS.md (363 errors)
- LiteLLM retention config key: MEDIUM — cited in prior research but not re-verified against nightly build

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable infra; Docker and PostgreSQL patterns do not change rapidly)
