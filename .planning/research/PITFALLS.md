# Pitfalls Research

**Domain:** LLM observability dashboard for heterogeneous proxy cluster
**Researched:** 2026-04-13
**Confidence:** HIGH (grounded in actual codebase state + verified LiteLLM docs)

---

## Critical Pitfalls

### Pitfall 1: `fix_json_tool_calls.py` Makes Tool Call Failures Invisible

**What goes wrong:**
The proxy silently repairs malformed JSON tool call arguments before returning responses to clients. A model that produces increasingly degraded JSON still appears to "work" — the dashboard shows successful tool calls while actual model quality is declining. Because repair happens pre-return, the raw failure is never written to spend_logs.

**Why it happens:**
The callback is intentionally designed to mask errors from clients. This is correct for production reliability but creates a blindspot: success/failure in spend_logs reflects post-repair state, not model quality.

**How to avoid:**
Instrument `fix_json_tool_calls.py` itself. Before returning the repaired response, emit a custom metric or log entry recording: (a) that a repair was attempted, (b) which model triggered it, (c) what category of fix was applied (trailing comma, unterminated string, etc.). The dashboard must have a "repair rate" metric per model, not just tool call success rate.

**Warning signs:**
- Tool call "success rate" in dashboard looks healthy while downstream agent tools fail with bad arguments (complex corruption the repair can't fix).
- A new model checkpoint produces more frequent repairs without alert.
- The repair state machine in `fix_json.py` applies Fix 1 (trailing commas) 10x more than Fix 2+ — useful signal that one model is systematically worse.

**Phase to address:**
Data collection phase — instrument before building any visualization.

---

### Pitfall 2: LiteLLM Has No Native Tool Call Failure Rate Metric

**What goes wrong:**
Prometheus metrics from LiteLLM expose latency, token counts, and spend. There is no `litellm_tool_call_failure_total` or equivalent. The `StandardLoggingPayload` includes `mcp_tool_call_metadata` (name, arguments, result) but this field is MCP-specific and only populated for MCP tool calls, not standard OpenAI-format tool calls.

**Why it happens:**
LiteLLM is an API gateway, not an agentic observability platform. It logs what models return, not whether the calling agent successfully used the result. Tool call failures (model returns wrong schema, required fields missing, arguments not parseable even after repair) appear as successful completions from the proxy's perspective.

**How to avoid:**
Tool call observability requires a two-layer approach:
1. **Proxy layer:** Count responses where `tool_calls` are present in the completion. Log whether `fix_json_tool_calls.py` had to intervene. Log whether `arguments` was valid JSON after repair.
2. **Agent layer:** The agents (Paperclip, Hermes, OpenClaw) must emit their own tool execution outcomes back to the dashboard. The proxy cannot see whether the returned tool call actually executed.

For the dashboard specifically: query `spend_logs` for completions where `finish_reason = "tool_calls"` and join against any repair log to compute a proxy-side quality score.

**Warning signs:**
- Dashboard shows 0% tool call errors even during known agent failures.
- Agents log "tool execution failed" while LiteLLM shows clean completions.

**Phase to address:**
Data model design phase — decide what "tool call success" means before building any chart.

---

### Pitfall 3: Collapsing TTFT and Total Latency into One Number

**What goes wrong:**
Tracking only total request duration obscures whether slow responses are caused by (a) model processing, (b) LiteLLM overhead, (c) network to the node, or (d) time-to-first-token delay. For agentic workflows where the agent is waiting in a loop, TTFT is the metric that directly causes agent loop degradation — not total latency.

**Why it happens:**
Total latency is what most dashboard builders measure first because it's a single obvious number. LiteLLM's Prometheus metrics (`litellm_request_total_latency_metric`, `litellm_llm_api_latency_metric`, `litellm_overhead_latency_metric`) are separate but this breakdown is not obvious until you read the full metrics spec.

**How to avoid:**
Track all three as separate time series per model:
- `litellm_llm_api_time_to_first_token_metric` — TTFT (first streaming token)
- `litellm_llm_api_latency_metric` — pure model latency
- `litellm_overhead_latency_metric` — LiteLLM's own processing cost

Always expose p95, not p50. For `spark-nemotron-120B` vs `Gemma4-31B`, the p50 may look similar but p95 will reveal when the large model stalls. Agent loops fail on tail latency, not median.

**Warning signs:**
- A model's p50 TTFT looks fine but agents report timeouts.
- Latency charts look smooth while the proxy re-initialization loop (every 44s) correlates with latency spikes.

**Phase to address:**
Metric definition phase — define all metrics with their exact source field before implementing.

---

### Pitfall 4: Context Window Usage Is Not Exposed by LiteLLM Prometheus

**What goes wrong:**
`litellm_input_tokens_metric` tells you how many tokens were sent — it does not tell you how close the request was to the model's context window limit. A request that sends 30,000 tokens to a model with a 32,768 token limit is almost overflowing, but the raw token count metric makes it look fine unless you know the limit.

This is the primary diagnostic need for the project (context windows too small for multi-step agentic workflows) and it requires explicit calculation, not a native LiteLLM metric.

**Why it happens:**
LiteLLM doesn't store model-specific context window sizes in its metric labels. The model's `max_context_window` is in `config.yaml` but is not emitted alongside token usage metrics.

**How to avoid:**
Build a context utilization metric at the dashboard layer:
- Read `max_context_window` for each model alias from `config.yaml` (or LiteLLM's `/v1/model/info` endpoint which returns this per deployment).
- For each spend_log entry, compute `prompt_tokens / max_context_window` as a utilization ratio.
- Visualize as a gauge per model: green (<70%), yellow (70-90%), red (>90%).

Alert threshold: any model consistently above 80% utilization is the candidate for context window restructuring.

**Warning signs:**
- Agents fail with `context_length_exceeded` errors in LiteLLM logs but no dashboard panel flags it.
- Token count charts show high numbers but you can't tell if they're near-limit without mental math.

**Phase to address:**
Metric definition phase — compute utilization ratio before first chart iteration.

---

### Pitfall 5: PostgreSQL Spend Logs Volume Will Explode

**What goes wrong:**
`store_prompts_in_spend_logs: true` is currently enabled. The DB volume is already 3.5 GiB with no retention policy. The dashboard's data queries will get progressively slower as the table grows. Without a retention policy, the 52 GiB free on the root filesystem is the only limit — and Docker is already at 76% capacity.

**Why it happens:**
Storing full prompts was enabled to support debugging. There is no automatic LiteLLM retention unless `maximum_spend_logs_retention_period` is configured (configurable via UI as of recent versions).

**How to avoid:**
Before the dashboard is built:
1. Set `maximum_spend_logs_retention_period: 30d` in `config.yaml` (or via the Admin UI without restart).
2. Add Docker log rotation to `docker-compose.yaml` to cap the proxy log (currently 5,546+ re-init messages accumulating).
3. Design dashboard queries to use time-bounded `WHERE startTime > NOW() - INTERVAL` clauses from day one — never unbounded table scans.

**Warning signs:**
- Dashboard queries return slowly or time out after 2-3 weeks of data.
- Disk at >85% triggers Docker overlay write failures.
- `docker-compose.yaml` logs directory balloons without log rotation.

**Phase to address:**
Infrastructure / data pipeline phase — before any data query is written.

---

### Pitfall 6: Weave Callback Produces Unreliable Trace Data During Errors

**What goes wrong:**
The Weave callback (`weave_callback.py`) currently throws `RecursionError` on every failed call from the dead `docker-gpu:11434` node (363 occurrences observed). This means all traces for failed requests are dropped. If the dashboard reads from Weave as a supplementary data source, it will show no traces for the failure cases that matter most.

More broadly: `weave.init()` is called at module import time. If the W&B endpoint is unreachable at startup, the entire proxy fails to start — the dashboard has no data source at all.

**Why it happens:**
Exception chaining depth (Ollama → httpx → aiohttp → OpenAI wrapper) exceeds Python's recursion limit inside Weave's async error handler. This is a Weave SDK bug triggered by abnormal exception depth.

**How to avoid:**
- Wrap `weave.init()` in try/except so Weave failures degrade gracefully.
- Do not use Weave as the primary data source for the dashboard. Use LiteLLM's Postgres spend_logs + Prometheus metrics as the ground truth. Weave can be supplementary for session-level traces.
- Fix the `docker-gpu:11434` connectivity issue first — it stops the error cascade upstream.

**Warning signs:**
- Dashboard shows no traces for any request that failed at the model layer.
- Proxy startup fails after W&B API key rotation or outage.

**Phase to address:**
Data source design phase — establish primary vs. supplementary source hierarchy before querying either.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Querying `spend_logs` directly from dashboard | Simple, no extra pipeline | Couples dashboard to DB schema; queries slow as table grows unbounded | Only if retention policy is already enforced |
| Using Prometheus scrape as only latency source | Zero extra code | Loses per-request trace data; can't correlate latency spike with specific model call | Acceptable for aggregate dashboards; never for per-request diagnosis |
| Treating `finish_reason=tool_calls` as "tool call success" | Easy to query | Hides all quality failures that `fix_json_tool_calls.py` masks | Never — always instrument the repair layer separately |
| Single line for all latency (total only) | One simple chart | Can't distinguish TTFT from model compute from LiteLLM overhead | MVP only, flag for immediate refinement |
| Reading model context limits from hardcoded config | No API calls needed | Stale if config changes; `config-cluster.yaml` already diverged from `config.yaml` | Only if config is treated as the authoritative schema and version-tracked |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| LiteLLM Prometheus `/metrics` | Assuming all metrics emit without extra config | Some metric groups are disabled by default. Check `prometheus_grouping_by` settings. Per-model labels require `litellm_model_name` is set correctly in deployment config |
| LiteLLM `/v1/model/info` | Not querying this for context window limits | This endpoint returns `max_context_window`, `max_tokens`, and other per-deployment caps that are not in Prometheus metrics |
| LiteLLM spend_logs Postgres | Joining on `model` field to get per-model data | The `model` column stores the alias (e.g. `spark-learner`), not the underlying model name. Ensure alias consistency — `config-cluster.yaml` uses different aliases than `config.yaml` for the same backends |
| LiteLLM `/health` endpoint | Using it as node health indicator | `/health` checks the proxy process, not individual backend node reachability. Use `/health/liveliness` or the per-model endpoint tests from `/model/info` instead |
| Weave traces | Reading Weave as canonical trace log | Weave drops traces on errors (RecursionError bug). Use Postgres spend_logs as truth for completeness, Weave for session detail only |
| nightly build (`v1.83.6-nightly`) | Assuming API surface is stable | Nightly builds can change metric names, endpoint schemas, or log field names between versions. Pin dashboard queries to fields verified against the actual deployed version |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unbounded `SELECT *` from `spend_logs` | Dashboard hangs; DB CPU spikes | Always add `WHERE startTime > NOW() - INTERVAL '24 hours'` plus index on `startTime` | After ~2 weeks of data at current write rate |
| Polling LiteLLM proxy `/metrics` from dashboard browser directly | Adds load to the single-worker proxy during high concurrency | Either pre-aggregate via a backend service or use Prometheus scrape (already configured at `192.168.50.117:9090`) | Immediately under any concurrent agent load |
| Re-fetching model metadata (`/v1/model/info`) per dashboard page load | Slow cold start; extra proxy load | Cache model metadata at dashboard startup; invalidate on config reload signal | Every page load adds ~200ms to single-worker proxy |
| Computing context utilization client-side per spend_log row | Scales with data volume | Pre-compute `prompt_tokens / max_context_window` as a view or materialized column | After ~10k spend_log rows |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Single combined latency chart for all 7 models | Can't see which model is degrading; all lines overlap | Small multiples: one latency sparkline per model alias, sorted by p95 descending |
| Showing p50 latency only | Hides tail latency; agent loops fail on p95, not p50 | Always show p95 alongside p50; mark agentic workflow timeout thresholds on the chart |
| Tool call success rate as binary (pass/fail) | Misses the "repaired but degraded" middle state | Three-state: clean success / repaired success / failure; color-coded per model |
| Node health as single green/red indicator | Doesn't distinguish "unreachable" from "slow" from "restarting" | Show last successful request time + current TTFT per node, not just ping status |
| Showing raw token counts without context window utilization | Useless for diagnosing context overflow | Always show tokens as percentage of context limit, not raw number |
| Dashboard auto-refreshing at high frequency on the single-worker proxy | Adds constant background load during agent workflows | Default to 30s refresh or manual; never auto-refresh more than once per 10s |

---

## "Looks Done But Isn't" Checklist

- [ ] **Tool call tracking:** Chart shows "tool call requests" from `finish_reason` — verify it also tracks repair rate from `fix_json_tool_calls.py` separately
- [ ] **Context utilization:** Token count chart is showing — verify it also shows utilization ratio against each model's `max_context_window`
- [ ] **Node health:** Nodes show green — verify this reflects actual last-successful-inference time, not just TCP ping to the proxy
- [ ] **Latency chart:** Latency visible — verify TTFT is tracked separately from total latency, and both are shown as p95 not just p50
- [ ] **Historical trend:** Past 7 days visible — verify the underlying query is bounded and won't time out at 30+ days of data
- [ ] **Spend log retention:** Dashboard queries work now — verify `maximum_spend_logs_retention_period` is set, otherwise disk fills and DB writes fail
- [ ] **Config drift surface:** Dashboard shows routing config — verify it reads from the actually-active `config.yaml`, not `config-cluster.yaml`

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Unbounded spend_logs table fills disk | HIGH | Stop proxy, run retention delete manually, add index and retention policy before restart. May lose recent data. |
| Tool call metrics are all "success" and trust is lost in dashboard | HIGH | Retroactively instrument `fix_json_tool_calls.py`, but historical data is already corrupted. Must start fresh metric collection. |
| Dashboard queries cause proxy slowdown during agent runs | MEDIUM | Add query caching layer or read replica. Requires adding a second Postgres connection or pre-aggregation job. |
| Weave traces missing for error cases | LOW | Fix `weave_callback.py` error handling. Historical traces are unrecoverable but future traces are capturable. |
| Context utilization metric was never built | MEDIUM | Model metadata must be backfilled from `config.yaml` history. Computable from historical spend_logs if prompt_tokens were stored (they are, with current config). |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| `fix_json_tool_calls.py` masking tool call quality | Phase 1: Data collection setup | `fix_json` repair events appear as a distinct metric alongside raw tool call count |
| No native tool call failure metric | Phase 1: Data model definition | "Tool call success" definition is documented and implemented as 3-state, not binary |
| Collapsed latency metric | Phase 1: Metric definition | TTFT, model latency, overhead are all separate time series with p95 exposed |
| Context window utilization not in Prometheus | Phase 1: Derived metric design | Utilization ratio chart exists; pulls `max_context_window` from `/v1/model/info` |
| Spend log volume explosion | Phase 0: Infrastructure prep | `maximum_spend_logs_retention_period` is set; Docker log rotation is configured |
| Weave trace unreliability | Phase 0: Data source hierarchy | `weave_callback.py` wrapped in try/except; Postgres is primary source, Weave supplementary |
| Stale `config-cluster.yaml` aliasing | Phase 1: Config ingestion | Dashboard reads from one authoritative config with explicit path; config source is logged on startup |

---

## Sources

- LiteLLM Prometheus metrics documentation: https://docs.litellm.ai/docs/proxy/prometheus
- LiteLLM StandardLoggingPayload spec: https://docs.litellm.ai/docs/proxy/logging_spec
- LiteLLM v1.81.6 release notes (Tool Call Tracing): https://docs.litellm.ai/release_notes/v1-81-6
- LLM observability production pitfalls (TianPan.co, Nov 2025): https://tianpan.co/blog/2025-11-01-llm-observability-production
- LLM inference observability — latency/tokens/cost (dasroot.net, Mar 2026): https://dasroot.net/posts/2026/03/llm-inference-observability-latency-tokens-cost/
- LLM observability best practices 2025 (Maxim): https://www.getmaxim.ai/articles/llm-observability-best-practices-for-2025/
- Codebase analysis: `.planning/codebase/CONCERNS.md` (2026-04-13 audit)
- Project context: `.planning/PROJECT.md`

---
*Pitfalls research for: LLM observability dashboard (LiteLLM proxy cluster)*
*Researched: 2026-04-13*
