# LiteLLM Lab Dashboard

## What This Is

A custom web dashboard for visualizing real-time and historical performance metrics across a personal AI lab — 5 nodes running 7 models through a LiteLLM proxy. The dashboard exists to diagnose why agentic workloads (Paperclip AI, Hermes, OpenClaw) underperform relative to available compute, and to inform future model deployment decisions.

## Core Value

Actionable visibility into which models are actually performing — so decisions about routing, context window sizing, and stack restructuring are data-driven rather than guesswork.

## Requirements

### Validated

- ✓ LiteLLM proxy routing traffic across all nodes — existing
- ✓ Models deployed across spark-001, spark-002, spark-003, hintonator, docker-gpu — existing
- ✓ Config-based routing (`latency-based-routing` locally) — existing

### Active

- [ ] Per-model latency tracking (TTFT + total response time)
- [ ] Context window usage visualization per request / per model
- [ ] Tool call success/failure rate tracking
- [ ] Throughput (tokens/sec) per model under load
- [ ] Per-node health and model availability status
- [ ] Historical trend view (degradation over time)
- [ ] Deployed vs local config drift surface (hardcoded secrets, routing differences)

### Out of Scope

- Automated routing adjustments — diagnose only for now; routing changes will be manual
- External access / auth — local network only, single user
- Multi-user / team features — not needed at this stage
- Full observability platform (Grafana, Prometheus) — custom web app preferred

## Context

**Hardware:**
- `spark-002` — DGX SPARK cluster, Gemma4-31B
- `spark-001` — DGX SPARK cluster, Qwen3.5-35B-3A-Distilled (also serves spark-learner, honcho-chat)
- `spark-003` — DGX SPARK cluster, spark-nemotron-120B
- `hintonator` — RTX 5090 (64GB), nemotron-cascade-2 + nomic-embed-text + text-embedding-3-small
- `docker-gpu` — RTX 3090 (64GB), nemotron-cascade-2

**Known issues with current stack:**
- Context windows too small for multi-step agentic workflows
- Tool calling unreliable (models don't follow schemas correctly)
- Inference latency disrupts agent loops
- Deployed config has hardcoded `master_key` (security issue)
- Deployed config behind local: `simple-shuffle` routing, missing overflow backend, lower `max_tokens`
- Untracked `ollama_embedding_handler_patch.py` on server

**Data sources for dashboard:**
- LiteLLM proxy logs
- LiteLLM usage/spend DB and API
- On-demand benchmarks against model endpoints

**This is phase 1 of a larger restructure** — the dashboard produces evidence for later decisions about model deployment strategy, context window allocation, and routing changes.

## Constraints

- **Access**: Local network only — no external auth required
- **Stack**: Custom React/Next.js web app — no Grafana/Prometheus
- **Deployment**: Must run alongside existing LiteLLM stack on docker-001
- **Data**: Must not require changes to LiteLLM proxy internals (read-only where possible)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Custom web app over Grafana | User prefers full control over design and data presentation | — Pending |
| Diagnose-only (no auto-routing) | Need baseline data before automating anything | — Pending |
| Dashboard as phase 1 of restructure | Data should drive stack decisions, not intuition | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-13 after initialization*
