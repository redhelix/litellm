---
phase: 00-infrastructure-prep
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - config.yaml
  - docker-compose.yaml
  - weave_callback.py
  - .planning/phases/00-infrastructure-prep/QUERY-CONVENTIONS.md
autonomous: true
requirements:
  - INFRA-01
  - INFRA-02
must_haves:
  truths:
    - "LiteLLMSpendLogs rows older than 30 days are pruned (count = 0 after retention runs)"
    - "litellm-proxy docker log is capped at 50 MiB per file, max 3 files"
    - "weave.init() failure does not propagate — RecursionError count drops to 0 in new logs"
    - "An index exists on LiteLLMSpendLogs.startTime so bounded queries are fast"
    - "A documented architectural rule requires all spend_logs queries to use WHERE startTime > NOW() - INTERVAL"
  artifacts:
    - path: "config.yaml"
      provides: "maximum_spend_logs_retention_period under general_settings"
      contains: "maximum_spend_logs_retention_period"
    - path: "docker-compose.yaml"
      provides: "json-file logging driver with max-size/max-file on litellm service"
      contains: "max-size"
    - path: "weave_callback.py"
      provides: "try/except wrapping weave.init() and failure event handling"
      contains: "except RecursionError"
    - path: ".planning/phases/00-infrastructure-prep/QUERY-CONVENTIONS.md"
      provides: "Architectural decision record requiring bounded WHERE clauses on LiteLLMSpendLogs"
      contains: "startTime"
  key_links:
    - from: "config.yaml general_settings.maximum_spend_logs_retention_period"
      to: "LiteLLMSpendLogs table growth"
      via: "LiteLLM internal cleanup cycle (verified empirically post-restart)"
      pattern: "maximum_spend_logs_retention_period"
    - from: "docker-compose.yaml litellm.logging"
      to: "/var/lib/docker/containers/*/litellm-proxy*.log"
      via: "docker json-file driver reads config on container (re)create"
      pattern: "json-file"
    - from: "weave_callback.py try/except"
      to: "litellm-proxy stdout"
      via: "suppressed exceptions logged at warning/debug instead of crashing"
      pattern: "except RecursionError"
---

<objective>
Stabilize the live LiteLLM stack so the upcoming dashboard can query it safely. Four concrete edits: enable spend log retention, cap Docker logs, harden the Weave callback against RecursionError, and record the bounded-query architectural rule (with index verification) that Phase 1 will follow.

Purpose: Disk is 76% full with a 3.5 GiB unbounded spend log table, 5,546+ lines of log spam, and 363 active Weave RecursionErrors. These three issues block reliable data collection and must be fixed before Phase 1 ingestion begins.

Output: Edited config.yaml, docker-compose.yaml, weave_callback.py; a new QUERY-CONVENTIONS.md ADR; a verified startTime index on LiteLLMSpendLogs.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/00-infrastructure-prep/00-RESEARCH.md
@.planning/phases/00-infrastructure-prep/00-VALIDATION.md
@config.yaml
@docker-compose.yaml
@weave_callback.py
</context>

<tasks>

<task type="auto">
  <name>Task 1: Enable spend log retention + verify/create startTime index + prune backlog</name>
  <files>config.yaml</files>
  <action>
    Edit `config.yaml`: under the existing `general_settings:` block, add the key:
    ```yaml
      maximum_spend_logs_retention_period: 30
    ```
    (integer days — see RESEARCH Pattern 1 / Assumption A1, A2). Do NOT touch `master_key` or Postgres password lines — those are tracked for later phases.

    Then, without restarting yet, run a one-shot cleanup and index verification against the live DB:

    1. Snapshot current size:
       ```bash
       docker exec litellm-db psql -U litellm -d litellm -c "SELECT pg_size_pretty(pg_total_relation_size('\"LiteLLMSpendLogs\"')) AS size, COUNT(*) AS rows, MIN(\"startTime\") AS oldest FROM \"LiteLLMSpendLogs\";"
       ```
    2. Verify index on startTime:
       ```bash
       docker exec litellm-db psql -U litellm -d litellm -c "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'LiteLLMSpendLogs';"
       ```
       If no index on `startTime` exists, create one:
       ```bash
       docker exec litellm-db psql -U litellm -d litellm -c "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_spend_logs_starttime ON \"LiteLLMSpendLogs\" (\"startTime\" DESC);"
       ```
    3. Prune backlog in batches (per RESEARCH Pitfall 2 — avoid long locks on a 3.5 GiB table):
       ```bash
       docker exec litellm-db psql -U litellm -d litellm <<'SQL'
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
       VACUUM ANALYZE "LiteLLMSpendLogs";
       SQL
       ```
    4. Re-snapshot size to confirm shrinkage.

    Rationale: adding the config key alone does not prune historical data — LiteLLM's internal cycle only prunes going forward. The one-shot DELETE handles the backlog; the config key keeps it bounded from here on. Index is verified first so the DELETE's WHERE scan is fast.
  </action>
  <verify>
    <automated>docker exec litellm-db psql -U litellm -d litellm -tAc "SELECT COUNT(*) FROM \"LiteLLMSpendLogs\" WHERE \"startTime\" < NOW() - INTERVAL '30 days';" | grep -qx "0"</automated>
  </verify>
  <done>
    - `maximum_spend_logs_retention_period: 30` present under `general_settings` in config.yaml
    - Count of rows older than 30 days = 0
    - Index on `"LiteLLMSpendLogs"."startTime"` exists (visible in `pg_indexes`)
    - Post-VACUUM table size recorded in commit message for baseline
  </done>
</task>

<task type="auto">
  <name>Task 2: Add Docker log rotation to litellm service</name>
  <files>docker-compose.yaml</files>
  <action>
    Edit `docker-compose.yaml`: add a `logging:` block to the `litellm` service (NOT to litellm-db or any other service in this task). Insert at the service level alongside `image:`, `ports:`, etc.:

    ```yaml
      litellm:
        # ... existing keys unchanged ...
        logging:
          driver: "json-file"
          options:
            max-size: "50m"
            max-file: "3"
    ```

    Do not modify any other service. Do not change image tags, volumes, env_file, or networks.

    After editing, recreate the container so the logging config takes effect (per RESEARCH Pitfall 3):
    ```bash
    docker compose up -d litellm
    ```

    Wait ~30 seconds, then verify the host-side logging config is applied:
    ```bash
    docker inspect litellm-proxy --format='{{json .HostConfig.LogConfig}}'
    ```
    Expect `"Type":"json-file"` with `"max-size":"50m"` and `"max-file":"3"`.
  </action>
  <verify>
    <automated>docker inspect litellm-proxy --format='{{json .HostConfig.LogConfig}}' | grep -q '"max-size":"50m"' && docker inspect litellm-proxy --format='{{json .HostConfig.LogConfig}}' | grep -q '"max-file":"3"'</automated>
  </verify>
  <done>
    - `logging` block with json-file driver, max-size 50m, max-file 3 present on `litellm` service in docker-compose.yaml
    - `docker inspect litellm-proxy` reports the new LogConfig
    - Container `litellm-proxy` is running (`docker compose ps` shows healthy)
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Harden weave_callback.py against RecursionError + write bounded-query ADR</name>
  <files>weave_callback.py, .planning/phases/00-infrastructure-prep/QUERY-CONVENTIONS.md</files>
  <action>
    Part A — Edit `weave_callback.py` exactly as shown in RESEARCH Pattern 4. Replace the current bare `weave.init(project)` / empty `WeaveCallback` pass body with:

    ```python
    import logging

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


    proxy_handler_instance = WeaveCallback()
    ```

    Preserve existing imports (`os`, `weave`, `CustomLogger` from litellm). The file is volume-mounted (`./weave_callback.py:/app/weave_callback.py`) — no rebuild needed, but a restart of the litellm service is required to reload the module:
    ```bash
    docker compose up -d litellm
    ```

    After restart, wait ~60 seconds and verify:
    ```bash
    docker compose logs litellm --since 2m 2>&1 | grep -i "weave"
    docker compose logs litellm --since 2m 2>&1 | grep -c RecursionError
    ```
    Expect the Weave init log line (info or warning), and `RecursionError` count = 0 for new logs.

    Part B — Create `.planning/phases/00-infrastructure-prep/QUERY-CONVENTIONS.md` as the architectural record that Phase 1+ must follow. Content:

    ```markdown
    # Query Conventions — LiteLLMSpendLogs

    **Decision:** All queries against `LiteLLMSpendLogs` (directly or via any ingestion layer) MUST include a bounded `WHERE "startTime" > NOW() - INTERVAL '<window>'` clause. Unbounded scans are architecturally prohibited.

    **Rationale:** Table is large (3.5 GiB at Phase 0 baseline) and grows with every request. Unbounded queries full-scan the table and will degrade proxy responsiveness.

    **Standard windows:**
    - Live ingestion poller (Phase 1, /spend/logs every 30s): `INTERVAL '5 minutes'` — only fetch rows since last poll.
    - 7-day trend views: `INTERVAL '7 days'`.
    - 30-day trend views: `INTERVAL '30 days'`.

    **Index guarantee:** `idx_spend_logs_starttime` exists on `"LiteLLMSpendLogs"."startTime" DESC` (verified in Phase 0 Task 1). Any new code path MUST assume this index is present; if it is dropped, retention and dashboard queries both regress.

    **Retention envelope:** `general_settings.maximum_spend_logs_retention_period: 30` in config.yaml. Dashboard queries MUST NOT assume data older than 30 days is available.

    **Enforcement:** Code review gate. Any Phase 1+ SQL touching `LiteLLMSpendLogs` without a `startTime` lower bound is a blocker.
    ```

    Commit the ADR alongside the weave_callback.py change.
  </action>
  <verify>
    <automated>python3 -c "import ast, sys; tree = ast.parse(open('weave_callback.py').read()); has_try = any(isinstance(n, ast.Try) for n in ast.walk(tree)); sys.exit(0 if has_try else 1)" && test -f .planning/phases/00-infrastructure-prep/QUERY-CONVENTIONS.md && grep -q "startTime" .planning/phases/00-infrastructure-prep/QUERY-CONVENTIONS.md && [ "$(docker compose logs litellm --since 2m 2>&1 | grep -c RecursionError)" = "0" ]</automated>
  </verify>
  <done>
    - `weave_callback.py` contains a `try/except RecursionError` block around `weave.init()`
    - `async_log_failure_event` is defined on `WeaveCallback` with RecursionError suppression
    - litellm service restarted; new logs (last 2 min) contain 0 RecursionError occurrences
    - `QUERY-CONVENTIONS.md` exists with the bounded-query rule, index guarantee, and retention envelope documented
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Operator → docker host | Claude-executed `docker compose` / `docker exec` commands run against the live proxy and DB |
| litellm-proxy → litellm-db | Internal network; DELETE and CREATE INDEX issued via `docker exec` bypass the proxy |
| External callers → litellm-proxy | Unchanged in this phase; no new ingress |

## STRIDE Threat Register (ASVS L1)

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-00-01 | Tampering | `docker exec litellm-db psql` DELETE | mitigate | Use batched DELETE with explicit `WHERE "startTime" < NOW() - INTERVAL '30 days'` and `LIMIT 5000`; never run unqualified DELETE. Run VACUUM ANALYZE explicitly. |
| T-00-02 | Denial of Service | Long-running DELETE locks table, proxy writes queue | mitigate | Batched 5000-row DELETE with `pg_sleep(0.1)` between batches (RESEARCH Pitfall 2); acceptable because this is a lab with no SLA. |
| T-00-03 | Information Disclosure | `config.yaml` edits could accidentally log secrets | accept | Task 1 only adds `maximum_spend_logs_retention_period`; no secret-adjacent keys touched. Known hardcoded `master_key` and Postgres password are out of scope per RESEARCH Security Domain and are flagged for later phases. |
| T-00-04 | Denial of Service | Docker log rotation misconfigured → logs keep filling disk | mitigate | Post-apply verification via `docker inspect litellm-proxy --format='{{json .HostConfig.LogConfig}}'`; failure to apply is caught by Task 2 verify. |
| T-00-05 | Tampering | `weave_callback.py` broad `except Exception` could mask real errors | accept | Exceptions are logged at warning/debug level with the exception message; no silent `pass`. Tradeoff: Weave tracing gracefully degrades rather than crashing the proxy, consistent with project goal of log hygiene. |
| T-00-06 | Elevation of Privilege | `CREATE INDEX CONCURRENTLY` via `docker exec` as DB superuser | accept | Already the operator's required privilege model for this lab; no new capability introduced. |
| T-00-07 | Repudiation | Retention prunes rows older than 30 days, destroying audit history | accept | Explicit product decision per ROADMAP Phase 0 success criteria; 30-day window is the retention envelope documented in QUERY-CONVENTIONS.md. |

No V2–V6 ASVS controls apply in this phase (per RESEARCH Security Domain — no auth, no sessions, no input validation, no crypto changes).
</threat_model>

<verification>
Per VALIDATION.md per-task map (rows 0-01-01, 0-01-02, 0-01-03) plus index and ADR checks:

1. **Retention active + backlog pruned (INFRA-01):**
   ```bash
   docker exec litellm-db psql -U litellm -d litellm -tAc \
     "SELECT COUNT(*) FROM \"LiteLLMSpendLogs\" WHERE \"startTime\" < NOW() - INTERVAL '30 days';"
   ```
   Expect `0`.

2. **startTime index exists (INFRA-01 support):**
   ```bash
   docker exec litellm-db psql -U litellm -d litellm -tAc \
     "SELECT indexname FROM pg_indexes WHERE tablename='LiteLLMSpendLogs' AND indexdef ILIKE '%startTime%';"
   ```
   Expect at least one row.

3. **Docker log rotation applied (INFRA-02 / success criterion 2):**
   ```bash
   docker inspect litellm-proxy --format='{{json .HostConfig.LogConfig}}'
   ```
   Expect `"max-size":"50m"`, `"max-file":"3"`.

4. **Weave RecursionError silenced (INFRA-02):**
   ```bash
   docker compose logs litellm --since 5m 2>&1 | grep -c RecursionError
   ```
   Expect `0`.

5. **Bounded-query ADR present (success criterion 4):**
   ```bash
   test -f .planning/phases/00-infrastructure-prep/QUERY-CONVENTIONS.md && \
     grep -q 'startTime' .planning/phases/00-infrastructure-prep/QUERY-CONVENTIONS.md
   ```
</verification>

<success_criteria>
- Rows older than 30 days in `LiteLLMSpendLogs` = 0 (both immediately post-task and sustained)
- `maximum_spend_logs_retention_period: 30` present in `config.yaml` under `general_settings`
- Index on `LiteLLMSpendLogs.startTime` confirmed in `pg_indexes`
- `docker inspect litellm-proxy` reports json-file driver, max-size 50m, max-file 3
- `docker compose logs litellm --since 5m | grep -c RecursionError` returns `0`
- `weave_callback.py` contains try/except around `weave.init()` and in `async_log_failure_event`
- `QUERY-CONVENTIONS.md` exists and documents bounded-query rule + index guarantee + retention envelope
- litellm-proxy container is healthy after restart (`docker compose ps` shows running)
</success_criteria>

<output>
After completion, create `.planning/phases/00-infrastructure-prep/00-01-SUMMARY.md` documenting:
- Baseline vs post-prune table size (from Task 1 snapshots)
- Whether the `maximum_spend_logs_retention_period` key is honored empirically (observation window, noted assumption per RESEARCH A1)
- Index name confirmed on `startTime`
- Final LogConfig JSON from `docker inspect`
- Whether any RecursionErrors reappeared in the 5-minute observation window after Weave fix
- Link to `QUERY-CONVENTIONS.md` as the carry-forward artifact for Phase 1
</output>
