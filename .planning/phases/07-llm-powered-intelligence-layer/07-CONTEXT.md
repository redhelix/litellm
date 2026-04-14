---
phase: 07
slug: llm-powered-intelligence-layer
created: 2026-04-14
status: decisions-captured
---

# Phase 07 — LLM-Powered Intelligence Layer: User Decisions

## Scope

1. **Anomaly detection** — LLM analyzes collected metrics for latency spikes, error rate increases, context utilization trends
2. **Automated diagnosis** — root cause suggestions when a model degrades
3. **Config/model recommendations** — routing strategy, max_tokens, context window settings
4. **Model swap recommendations** — benchmark results vs. alternatives
5. **HuggingFace monitoring** — surface new model releases that fit the deployment profile
6. **Natural language Q&A** — single-shot query interface over collected metrics

---

## Decision Log

### D-01: Where insights surface
**Decision:** Dedicated "Intelligence" tab in the dashboard.
**Rationale:** Clean separation — existing Model grid and Request Log views stay uncluttered. All AI-generated content lives in one place.
**Implementation:** New tab alongside existing tabs. Tab contains: lab health summary, anomaly/diagnosis section, HF recommendations section, single-shot Q&A box.

### D-02: LLM for analysis
**Decision:** Local models via the existing LiteLLM proxy. Model selection left to planning agent — recommend best fit from currently deployed models (nemotron-cascade-2, Qwen3.5-35B, Gemma4-31B) based on reasoning capability and context window.
**Rationale:** Metrics stay on-network, no API cost, consistent with local-only dashboard theme.
**Implementation:** Sidecar calls LiteLLM proxy at `http://litellm-proxy:4000/v1/chat/completions` with appropriate model. Model name should be configurable in sidecar config/env.

### D-03: Trigger model
**Decision:** Scheduled — analysis runs every 12 hours in the sidecar background scheduler.
**Rationale:** Tab always has something to show when opened; no user action required.
**Implementation:** APScheduler job in sidecar (already uses APScheduler for poller + ping jobs). Results cached in DuckDB or JSON file. New `/api/intelligence` endpoint returns latest cached result + timestamp.

### D-04: HuggingFace monitoring scope
**Decision:** Filter for models matching the lab's deployment profile:
- **Task focus:** coding, agentic orchestration, analysis, research, drafting (instruct/chat models)
- **Size range:** up to 70B–120B parameters
- **Runtime:** vLLM or SLANG (NVIDIA SLANG/NIM-compatible)
- **Quantization:** NVFP4 or FP8 preferred
**Implementation:** HF Hub API (huggingface_hub Python library) — search recent uploads/trending in the instruct category, filter by tags and metadata. Run on same 12h schedule. Surface top N new/notable models not already deployed.

### D-05: NL Q&A interface
**Decision:** Single-shot query box — user types a question, gets one answer, no conversation history.
**Rationale:** Lower friction for a single-user local tool. No state to manage between sessions.
**Implementation:** Input box + submit button in Intelligence tab. POST to `/api/intelligence/query` with question string. Sidecar assembles relevant metrics context (recent aggregates, model health, top errors) and calls local LLM. Returns answer as plain text/markdown. No streaming required.

---

## Constraints (carried forward)

- **Diagnose only** — no automated config changes; all recommendations are advisory (PROJECT.md)
- **Local-only** — no external notifications, webhooks, or data egress beyond LiteLLM proxy calls
- **Minimal UI** — consistent with dashboard aesthetic established in prior phases

---

## Canonical Refs

- `.planning/PROJECT.md` — core value, constraints, hardware profile
- `.planning/REQUIREMENTS.md` — acceptance criteria
- `.planning/codebase/STACK.md` — runtime, APScheduler usage, container layout
- `.planning/codebase/ARCHITECTURE.md` — sidecar data flow, LiteLLM proxy connection
- `.planning/phases/01-data-collection-layer/01-CONTEXT.md` — DuckDB schema, poller patterns
- `.planning/phases/08-model-client-visibility/08-CONTEXT.md` — model health patterns, /api/model-health shape
