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
