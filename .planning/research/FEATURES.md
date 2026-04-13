# Feature Research

**Domain:** LLM performance monitoring dashboard — self-hosted, single-user, multi-node lab diagnostic tool
**Researched:** 2026-04-13
**Confidence:** MEDIUM-HIGH (ecosystem well-documented; specifics for multi-node Ollama/LiteLLM home lab inferred from patterns)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features a monitoring dashboard must have. Missing any of these and the tool is not credibly a dashboard.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Per-model latency display (TTFT + total) | Every LLM observability tool (Langfuse, Helicone, Phoenix) surfaces this as the primary metric | LOW | LiteLLM proxy logs already emit this; read from usage DB or callback logs |
| Token usage per request (prompt + completion) | Required to diagnose context window overflows — the #1 known issue | LOW | Available from LiteLLM response metadata; stored in spend DB |
| Request log table (last N requests, filterable by model) | Users expect to drill into individual failing calls | MEDIUM | Pagination, filter by model/node/status; LiteLLM has `SpendLogsTable` but limited |
| Model health / availability status per node | 5 nodes × 7 models — need to see what's up/down at a glance | MEDIUM | Poll LiteLLM `/health` endpoint or individual model endpoints |
| Basic time-series charts (latency, throughput over time) | Every dashboard from Grafana to Langfuse has this | MEDIUM | Need to bucket LiteLLM logs by time; no built-in time-series DB required if querying log table |
| Error rate per model | Surfaces tool call failures and inference errors | LOW | Derive from request log — count non-200 or exception responses |
| Tokens/sec throughput | Core performance metric for comparing model efficiency under load | LOW | Compute from token count ÷ duration, available per-request |
| Summary stats panel (today's totals: requests, tokens, errors) | The "at a glance" view every dashboard starts with | LOW | Aggregate query over usage DB |

### Differentiators (Specific to This Use Case)

Features that matter for diagnosing agentic underperformance in a multi-node home lab. Not expected by default; this is where the tool earns its existence over just using LiteLLM's built-in UI.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Context window usage bar per request | Directly addresses known issue: "context windows too small for multi-step workflows." Shows prompt tokens as % of model's max context — instantly reveals which requests are near-limit | MEDIUM | Requires model max_context config (maintain a static map per model); compute `prompt_tokens / max_context × 100` |
| Tool call success/failure breakdown | The known issue: "tool calling unreliable — models don't follow schemas." Surface which models fail tool calls most, and show raw tool call JSON for failed attempts | HIGH | Requires structured log parsing; LiteLLM logs tool call results in callback metadata; need to extract and classify |
| Per-node comparison view | 5 nodes with different hardware — need side-by-side latency and throughput to see if spark-003's Nemotron-120B is worth its latency vs spark-001's Qwen | MEDIUM | Group metrics by `litellm_params.model` or custom `node` tag in LiteLLM metadata |
| Config drift surface | Known issue: deployed config has lower `max_tokens`, different routing, hardcoded secrets vs local config. Show a diff or flag divergence | HIGH | Read deployed config via LiteLLM `/config` API endpoint; compare against local YAML; highlight key divergences |
| Agentic session trace view | For multi-step agent workflows (Paperclip, Hermes, OpenClaw), group requests by session/trace ID to see the full call chain, where it fails, and cumulative token use | HIGH | Depends on agents passing a consistent `metadata.session_id` or `trace_id`; Langfuse-style span grouping |
| On-demand latency benchmark trigger | Instead of waiting for organic traffic, fire a synthetic prompt at a model and record cold/warm latency — useful when a node has been idle | MEDIUM | Simple POST to LiteLLM proxy with a standard benchmark prompt; log result separately |
| Historical trend view (7/30 day) | Detect degradation over time — did nemotron-cascade-2 on docker-gpu get slower after a config change? | MEDIUM | Requires retaining timestamped log rows; bucket and chart over rolling window |

### Anti-Features (Deliberately NOT Built for v1)

| Feature | Why Requested | Why Problematic for This Case | What to Do Instead |
|---------|---------------|-------------------------------|-------------------|
| Automated routing adjustments | Tempting once you have performance data | Out of scope by design (PROJECT.md); automation before baseline = guessing with machinery | Collect 2-4 weeks of data first; manual routing changes informed by dashboard |
| Real-time push / WebSocket streaming | Feels premium, shows "live" updates | Adds infra complexity (SSE or WebSocket server), no real need for a diagnostic tool — 30s poll is fine | 30-second polling on the frontend is sufficient for a lab context |
| LLM evaluation / scoring (LLM-as-judge) | Langfuse and Phoenix do this; looks like a feature | Requires ground truth or secondary model calls; adds cost and complexity; not the diagnosis needed | Diagnose at the infrastructure level first (latency, tokens, errors), not output quality |
| Multi-user auth / RBAC | Natural instinct when building a web app | Single user on local network; auth adds complexity with zero security benefit in this threat model | No auth needed; bind to localhost or local subnet only |
| Cost / spend tracking | LiteLLM's built-in UI already does this well for OpenAI-style APIs | All models are local (no API cost); spend tracking is misleading for self-hosted inference | Surface compute cost as latency + tokens, not dollars |
| Alerting / notifications (email, Slack) | Looks complete | Operational overhead for a diagnostic tool; single user checks it manually | Build the dashboard first; add alerting only if a specific pain point emerges |
| Custom dashboard builder (drag-drop widgets) | "Power user" feature | Massive scope creep; this is a diagnostic tool, not a general platform | Fixed layout with the right panels is faster to build and use |
| Prompt management / versioning | Langfuse has it; seems relevant | Completely different problem domain from performance diagnosis; belongs in agent repos | Keep prompts in version control in the agent repos |

---

## Feature Dependencies

```
[Request Log Table]
    └──requires──> [LiteLLM Log Ingestion / DB Query Layer]
                       └──required by──> [Time-Series Charts]
                       └──required by──> [Error Rate Per Model]
                       └──required by──> [Tokens/sec Throughput]
                       └──required by──> [Context Window Usage Bar]
                       └──required by──> [Tool Call Breakdown]
                       └──required by──> [Historical Trend View]

[Model Health Status]
    └──requires──> [Node Health Polling] (separate from log data)

[Per-Node Comparison View]
    └──requires──> [Request Log Table]
    └──requires──> [Model-to-Node Mapping Config]

[Agentic Session Trace View]
    └──requires──> [Request Log Table]
    └──requires──> [Agents passing session_id in metadata] (external dependency)

[Config Drift Surface]
    └──requires──> [LiteLLM /config API access]
    └──requires──> [Local config YAML path]
    └──independent of──> [Request Log Table]

[On-Demand Benchmark Trigger]
    └──requires──> [LiteLLM proxy write access] (only feature needing write)
    └──independent of──> [Request Log Table]

[Context Window Usage Bar]
    └──requires──> [Request Log Table]
    └──requires──> [Static model max_context map]
```

### Dependency Notes

- **Log ingestion is the critical path:** Almost every feature depends on reliably reading LiteLLM's usage DB or log callbacks. This must be solved in Phase 1 before building any visualization.
- **Tool call breakdown requires structured parsing:** LiteLLM logs tool call data in callback metadata but not in the standard spend DB schema. This may require a custom callback or log parsing step — validate this before committing to the feature.
- **Agentic session tracing has an external dependency:** The dashboard can only group by session if the agents (Paperclip, Hermes, OpenClaw) pass a consistent `metadata.session_id` field. This may require a small change to those agents, not just the dashboard.
- **Config drift is independent:** Can be built in any phase — does not depend on log data.

---

## MVP Definition

### Launch With (v1)

Minimum needed to make data-driven decisions about the known issues.

- [ ] Summary stats panel (requests, tokens, errors, avg latency — today) — establishes baseline
- [ ] Per-model latency table (TTFT + total, last 7 days, sortable) — addresses inference latency issue
- [ ] Token usage per request with context window % bar — addresses context window overflow issue
- [ ] Error rate per model (including tool call errors as a category) — addresses tool call reliability issue
- [ ] Model health / availability status per node — addresses "is it even running?" question
- [ ] Request log table (last 500 requests, filter by model, status) — enables drilling into failures

### Add After Validation (v1.x)

Add once the core diagnostic loop is working and generating insights.

- [ ] Time-series charts (latency trend, error rate trend over 30 days) — detect degradation
- [ ] Per-node comparison view — when node-level differences emerge as a question
- [ ] On-demand benchmark trigger — when organic traffic is too sparse for reliable metrics
- [ ] Config drift surface — when deployed/local divergence becomes an active problem

### Future Consideration (v2+)

Defer until phase 1 diagnostic goals are met and agents have been updated.

- [ ] Agentic session trace view — requires agent instrumentation changes; high value but high dependency
- [ ] Historical trend view beyond 30 days — only meaningful after collecting data for that long
- [ ] Tool call success/failure with raw JSON inspection — high complexity; build after error rate surfaces the problem clearly

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Summary stats panel | HIGH | LOW | P1 |
| Per-model latency (TTFT + total) | HIGH | LOW | P1 |
| Context window usage % bar | HIGH | LOW | P1 |
| Error rate per model | HIGH | LOW | P1 |
| Model health per node | HIGH | MEDIUM | P1 |
| Request log table | HIGH | MEDIUM | P1 |
| Time-series charts | MEDIUM | MEDIUM | P2 |
| Per-node comparison view | MEDIUM | MEDIUM | P2 |
| On-demand benchmark trigger | MEDIUM | MEDIUM | P2 |
| Config drift surface | MEDIUM | HIGH | P2 |
| Agentic session trace view | HIGH | HIGH | P3 |
| Tool call JSON inspection | MEDIUM | HIGH | P3 |
| Historical trend (30d+) | LOW | LOW | P3 |

---

## Competitor Feature Analysis

| Feature | LiteLLM Built-in UI | Langfuse | Helicone | Our Approach |
|---------|---------------------|----------|----------|--------------|
| Request log table | Yes (spend-focused) | Yes (trace-focused) | Yes | Yes — filter by model/node/status |
| Latency tracking | Basic | Full TTFT + total | Full | TTFT + total, per model |
| Context window usage | No | Shows token counts, no % | No | % of max context — unique to this tool |
| Tool call tracing | No | Yes (span-level) | No | Error rate first; JSON inspection in v2 |
| Per-node health | No | No | No | Yes — 5-node lab is the differentiator |
| Config drift | No | No | No | Yes — known prod/local divergence issue |
| Cost/spend tracking | Yes (good) | Yes | Yes | Skipped — all local, no API cost |
| Agentic session trace | No | Yes (excellent) | Partial | v2 — requires agent instrumentation |
| Self-hostable | Yes | Yes | Yes | Yes — runs alongside LiteLLM on docker-001 |
| Auth required | Yes (JWT) | Yes | Yes | No — local network, single user |

---

## Sources

- [LiteLLM Admin Dashboard — DeepWiki](https://deepwiki.com/BerriAI/litellm/3.7-admin-dashboard) — MEDIUM confidence (unofficial but thorough)
- [Langfuse AI Agent Observability](https://langfuse.com/blog/2024-07-ai-agent-observability-with-langfuse) — HIGH confidence (official)
- [Helicone vs Competitors Guide](https://www.helicone.ai/blog/the-complete-guide-to-LLM-observability-platforms) — MEDIUM confidence (vendor-authored)
- [8 AI Observability Platforms Compared — Softcery](https://softcery.com/lab/top-8-observability-platforms-for-ai-agents-in-2025) — MEDIUM confidence (third-party analysis)
- [AI Agent Monitoring — TrueFoundry](https://www.truefoundry.com/blog/ai-agent-observability-tools) — MEDIUM confidence
- [LiteLLM GitHub](https://github.com/BerriAI/litellm) — HIGH confidence (source)

---
*Feature research for: LiteLLM Lab Dashboard — multi-node LLM diagnostic tool*
*Researched: 2026-04-13*
