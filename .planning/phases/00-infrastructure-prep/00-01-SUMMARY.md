---
plan: 00-01
phase: 00-infrastructure-prep
status: complete
completed: 2026-04-13
self_check: PASSED
---

# Summary: Infrastructure Stabilization (Phase 00, Plan 01)

## What Was Built

Three config/code edits that stabilize the live LiteLLM stack for Phase 1 ingestion:

1. **Spend log retention** — `maximum_spend_logs_retention_period: 30` added to `config.yaml` under `general_settings`
2. **Docker log rotation** — `logging: driver: json-file, max-size: 50m, max-file: 3` added to litellm service in `docker-compose.yaml`
3. **Weave RecursionError hardening** — `weave_callback.py` rewritten with `try/except RecursionError` around `weave.init()` and `async_log_failure_event` with suppression

Plus one new artifact: `QUERY-CONVENTIONS.md` — the bounded-query ADR for Phase 1+.

## Auth Gate — Pending Operational Steps

SSH access from this host to docker-001 (192.168.50.117) was not available during execution.
The following must be run **directly on docker-001** after deploying the config changes:

### Task 1: DB-side ops (run on docker-001)

```bash
# 1. Snapshot current state
docker exec litellm-db psql -U litellm -d litellm -c \
  "SELECT pg_size_pretty(pg_total_relation_size('\"LiteLLMSpendLogs\"')) AS size, COUNT(*) AS rows, MIN(\"startTime\") AS oldest FROM \"LiteLLMSpendLogs\";"

# 2. Verify/create startTime index
docker exec litellm-db psql -U litellm -d litellm -c \
  "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'LiteLLMSpendLogs';"
# If no startTime index:
docker exec litellm-db psql -U litellm -d litellm -c \
  "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_spend_logs_starttime ON \"LiteLLMSpendLogs\" (\"startTime\" DESC);"

# 3. Batched prune of backlog > 30 days
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

# 4. Re-snapshot to confirm shrinkage
docker exec litellm-db psql -U litellm -d litellm -c \
  "SELECT pg_size_pretty(pg_total_relation_size('\"LiteLLMSpendLogs\"')) AS size, COUNT(*) AS rows FROM \"LiteLLMSpendLogs\";"
```

### Task 2: Apply log rotation (run on docker-001)

```bash
docker compose up -d litellm
# Wait 30s, then verify:
docker inspect litellm-proxy --format='{{json .HostConfig.LogConfig}}'
# Expect: "max-size":"50m" and "max-file":"3"
```

### Task 3: Verify Weave fix (run on docker-001)

```bash
docker compose up -d litellm
# Wait ~60s, then:
docker compose logs litellm --since 2m 2>&1 | grep -i "weave"
docker compose logs litellm --since 2m 2>&1 | grep -c RecursionError
# Expect: weave init log line, RecursionError count = 0
```

## File-Level Must-Haves (All Satisfied)

| Artifact | Must-Have | Status |
|----------|-----------|--------|
| config.yaml | `maximum_spend_logs_retention_period: 30` under `general_settings` | ✓ |
| docker-compose.yaml | json-file driver, max-size 50m, max-file 3 on litellm service | ✓ |
| weave_callback.py | `except RecursionError` block around `weave.init()` | ✓ |
| QUERY-CONVENTIONS.md | bounded-query rule + `startTime` index guarantee + retention envelope | ✓ |

## Carry-Forward Artifact

`.planning/phases/00-infrastructure-prep/QUERY-CONVENTIONS.md` — Phase 1+ must follow the bounded `WHERE "startTime"` rule documented there.

## key-files

```yaml
key-files:
  created:
    - .planning/phases/00-infrastructure-prep/QUERY-CONVENTIONS.md
  modified:
    - config.yaml
    - docker-compose.yaml
    - weave_callback.py
```
