---
phase: 06
slug: dashboard-ux-enhancements
created: 2026-04-14
status: decisions-captured
---

# Phase 06 — UX Enhancements: User Decisions

## Scope (all in)

Four items confirmed for this phase:
1. **Error display in request log** — colour-code failed rows, show error message
2. **Context utilization fix** — fix null ctx% for known models, show '?' with tooltip for unknowns
3. **Sort + filter enhancements** — column sorting + status filter in request log table
4. **Help tooltips** — p50/p95/TTFT/ctx% explanations as hover tooltips in Overview and ModelCard

Items NOT in this phase (deferred):
- Last request timestamp accuracy fix
- Server names in ModelCard
- Show model metadata per model card

---

## Decision Log

### D-01: Error message data source
**Decision:** Pull `exception` column directly from LiteLLM's `spend_logs` table via the existing poller.
**Rationale:** spend_logs already has an `exception` nullable text column — direct SELECT is the fastest path. LiteLLM metadata JSON schema is undocumented and fragile.
**Implementation:** Extend `poller.py` SELECT to include `exception AS error_message`. Add `error_message TEXT` column to DuckDB `requests` table schema. Surface in `/api/requests` response and `RequestLogRow` type.

### D-02: Context utilization fix + UI treatment
**Decision:** Fix the alias→max_context_window lookup table in `config_loader.py`. For models where ctx% is still unknown (not in lookup), show '?' with a tooltip explaining "Context window size unknown for this model alias".
**Rationale:** Many deployed aliases (e.g., nemotron-cascade-2, spark-learner, gemma-4-31b) aren't in the current hardcoded map. Fix the map first; '?' with tooltip is more informative than a dash for the remaining unknowns.
**Implementation:**
- Update `config_loader.py` MODEL_CTX_MAP with all 7 deployed aliases from config.yaml
- In RequestLogTable and OverviewPanel, render '?' in a Tooltip when context_utilization is null

### D-03: Sort + filter enhancements
**Decision:** Add column sorting for TTFT, total latency, and timestamp (asc/desc toggle). Add status filter (success/repaired/failed) alongside the existing model filter.
**Rationale:** These are the most actionable sorts for diagnosing slow or failed requests.
**Implementation:**
- Add `sort_by` (ttft_ms|total_latency_ms|startTime) and `sort_dir` (asc|desc) query params to `/api/requests`
- Add `status_filter` query param to `/api/requests`
- Update `useRequestLog` hook to pass sort and filter state
- Add sortable column headers (clickable arrows) and status filter dropdown to `RequestLogTable`

### D-04: Help tooltips
**Decision:** Add hover tooltips explaining p50, p95, TTFT, and ctx% in the Overview panel and ModelCard.
**Rationale:** These metrics are non-obvious to anyone not familiar with LLM observability. Tooltips are low-effort, high-value.
**Implementation:**
- Add Tooltip wrapping to metric labels in OverviewPanel and ModelCard
- Explanations: p50="50th percentile (median) response time", p95="95th percentile — worst-case for 1 in 20 requests", TTFT="Time to first token — latency before streaming begins", ctx%="Fraction of the model's context window used by this request's prompt"

---

## Existing Asset Inventory (from scout)

| Asset | State | Notes |
|-------|-------|-------|
| `RequestLogTable.tsx` | Exists | 6 columns, no error column, no sort state |
| `useRequestLog.ts` | Exists | model filter + pagination only, no sort/status params |
| `routers/requests.py` | Exists | No error_message, no sort/filter params |
| `api.ts RequestLogRow` | Exists | No error_message field |
| `config_loader.py MODEL_CTX_MAP` | Exists | Missing most deployed aliases → null ctx% |
| `ModelCard.tsx` | Exists | 6 metrics, no tooltips |
| `OverviewPanel.tsx` | Exists | Aggregate stats, no tooltips |
| shadcn Tooltip | Installed | Already in use (Phase 3+4) |

---

## Out of Scope (Phase 6)

- Last request timestamp accuracy — deferred (requires investigation of node grid data flow)
- Server names in ModelCard — deferred
- Model metadata per card — deferred

These stay in Phase 6 backlog items list but are not planned in this phase.
