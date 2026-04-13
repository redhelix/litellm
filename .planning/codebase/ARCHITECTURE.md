# Architecture

**Analysis Date:** 2026-04-13

## Pattern Overview

**Overall:** Containerized reverse-proxy / LLM gateway

**Key Characteristics:**
- LiteLLM proxy acts as a unified OpenAI-compatible API endpoint for all upstream LLM providers
- Stateless proxy layer backed by PostgreSQL (spend/audit) and Redis (response cache)
- Custom Python callbacks extend the proxy at pre/post call hooks — no application framework beyond LiteLLM's plugin system
- Traefik terminates TLS and routes public traffic to the proxy

## Layers

**Upstream LLM Backends:**
- Purpose: Actual model inference — local GPU nodes, Ollama instances, commercial APIs
- Access: via HTTP (vLLM `/v1`, Ollama `:11434`, OpenRouter, Perplexity, Gemini, OpenAI)
- Config location: `config.yaml` → `model_list[].litellm_params.api_base`

**LiteLLM Proxy (litellm-proxy container):**
- Purpose: Unified API gateway — routing, fallbacks, caching, rate-limiting, spend tracking
- Image: `litellm-proxy:local` (built from `Dockerfile`)
- Base: `ghcr.io/berriai/litellm:v1.83.6-nightly`
- Port: `4000` (internal), exposed to `traefik-net`
- Config: `/app/config.yaml` (bind-mounted from `./config.yaml`)
- Depends on: `litellm-db` (healthy), `litellm-redis` (healthy)

**Custom Callback Plugins (Python files, bind-mounted into container):**
- `fix_json_tool_calls.py` — pre+post hook repairing malformed JSON in tool call arguments; mounted as `/app/fix_json_tool_calls.py`
- `weave_callback.py` — W&B Weave tracing, auto-patches LiteLLM via `weave.init()` on import; mounted as `/app/weave_callback.py`
- `strip_think.py` — strips `<think>…</think>` reasoning tokens from responses; mounted as `/app/strip_think.py` (present in codebase but NOT active in current `config.yaml` callbacks)
- `firecrawl_search_transform.py` — overrides the upstream LiteLLM Firecrawl search transformation module; mounted directly into site-packages at `/usr/lib/python3.13/site-packages/litellm/llms/firecrawl/search/transformation.py`

**Persistence Layer:**
- `litellm-db`: PostgreSQL 16 (Alpine) — stores spend logs, API keys, user budgets. Volume: `litellm-pgdata`
- `litellm-redis`: Redis 7 (Alpine) — response cache (TTL 1 hour for metered models). Volume: `litellm-redis`

**Reliability Layer:**
- `litellm-autoheal`: `willfarrell/autoheal` watches containers labelled `autoheal=true` and restarts unhealthy ones every 30s

**Ingress / TLS:**
- Traefik (`traefik-net` external network) terminates HTTPS and routes to `litellm-proxy:4000`

## Data Flow

**Standard Chat Request:**
1. Client sends POST to `https://<host>/v1/chat/completions` (via Traefik)
2. Traefik forwards to `litellm-proxy:4000`
3. LiteLLM `async_pre_call_hook` fires — `FixJsonToolCallsCallback` repairs any malformed JSON in request message history
4. Router selects backend using `latency-based-routing`; checks Redis cache for matching request
5. If cache hit: return cached response
6. If cache miss: forward request to selected upstream backend
7. On upstream failure: retry up to 5 times, then fall through fallback chain defined in `router_settings.fallbacks`
8. `async_post_call_success_hook` fires — `FixJsonToolCallsCallback` repairs tool call JSON in response
9. Weave callback traces the call to W&B
10. Response returned to client; spend logged to PostgreSQL

**Context Window Fallback:**
- If response exceeds model context, router retries on `context_window_fallbacks` chain (e.g., `nemotron-cascade-2` → `nemotron-cascade-2-hintonator` → `kimi-k2.5` → `gemini-flash`)

**Budget / Rate Limiting:**
- Per-proxy budget: $100 / 30-day rolling window
- Prometheus metrics emitted on each call; Prometheus server at `192.168.50.117:9090`

## Key Abstractions

**Model Aliases:**
- Purpose: Decouple client model names from backend endpoints; enable transparent failover
- Defined in: `config.yaml` → `model_list`
- Pattern: multiple entries with the same `model_name` (e.g., two `nemotron-cascade-2` entries for latency-based load balancing across hintonator and docker-gpu)

**Fallback Chains:**
- Purpose: Automatic failover from local GPU → capable cloud model
- Defined in: `config.yaml` → `router_settings.fallbacks` and `context_window_fallbacks`
- General priority: local fine-tuned → local GPU → cloud (kimi-k2.5, gemini-flash)

**Custom Callbacks:**
- Purpose: Extend LiteLLM behavior without forking upstream
- Pattern: Python class extending `litellm.integrations.custom_logger.CustomLogger`, implementing `async_pre_call_hook` and/or `async_post_call_success_hook`; instance registered as `proxy_handler_instance`; referenced in `config.yaml` → `litellm_settings.callbacks`

**Dockerfile Patches:**
- Purpose: Fix upstream LiteLLM bugs without forking the package
- Pattern: `sed` patches applied at image build time with `grep -q` guards to fail loudly on future regressions
- Current patch: `router.py` line 5688 — `num_retries` pop with no default causes `TypeError` when `litellm.num_retries` is None
- Critical note: base image ships litellm source in BOTH `/app/litellm/` AND `/usr/lib/python3.13/site-packages/litellm/` — proxy runtime uses site-packages, not `/app`; patch targets both

## Entry Points

**Proxy Process:**
- Container command: `litellm --config /app/config.yaml --port 4000 --num_workers 1`
- Health endpoint: `GET /health/readiness` (used by Docker healthcheck)

**Configuration:**
- `config.yaml` — primary; active production config
- `config-cluster.yaml` — alternate cluster-mode config (not currently deployed; uses `usage-based-routing`, different model set oriented around `gpt-oss-120b-cluster`)

## Error Handling

**Strategy:** Retry-then-fallback at router level; LiteLLM handles all upstream error surfacing

**Patterns:**
- `num_retries: 5`, `retry_after: 5s`, `cooldown_time: 30s`, `allowed_fails: 25` (per `config.yaml` router_settings)
- `enable_pre_call_checks: true` — validates model availability before sending
- Budget alerts at 85% threshold; rate limit alerts enabled
- Autoheal container restarts unhealthy proxy within 30s

## Cross-Cutting Concerns

**Logging:** W&B Weave tracing (`weave_callback.py`); `store_prompts_in_spend_logs: true` persists prompts to PostgreSQL
**Metrics:** Prometheus callback + dedicated Prometheus server at `192.168.50.117:9090`; Grafana at `192.168.50.117:3000`
**Caching:** Redis, TTL 1 hour, applied only to metered cloud models (not local GPU, not Perplexity)
**Authentication:** `LITELLM_MASTER_KEY` env var; per-key budget enforcement via PostgreSQL

---

## Deployed vs Local Differences

**SSH target:** `root@docker-001`, deployment directory: `/opt/litellm/`

### config.yaml — Diverged (deployed is BEHIND local)

Deployed `config.yaml` was last modified `2026-04-13 12:29` and differs from local in the following ways:

| Area | Deployed (server) | Local (repo) |
|------|-------------------|--------------|
| `spark-nemotron-120B` max_tokens | `8192` | `32768` |
| `nemotron-cascade-2` (backend 1) max_tokens | `8192` | `32768` |
| nemotron-cascade-2 Backend 2 (docker-gpu) | **absent** — only single backend | Two entries for latency load balancing |
| `nemotron-cascade-2-hintonator` max_tokens | `8192` | `32768` |
| Model name at position 58 | `gemma4-26b` (old name) | `nemotron-cascade-2` second backend + `nemotron-cascade-2-hintonator` |
| `routing_strategy` | `simple-shuffle` | `latency-based-routing` |
| `context_window_fallbacks` | dict-style (old LiteLLM format) | list-style (new format) |
| `enable_pre_call_checks` | absent | `true` |
| `master_key` | hardcoded `sk-litellm-master-synergy2026` | `os.environ/LITELLM_MASTER_KEY` |

**Critical:** The deployed config has the master key hardcoded as a plaintext string rather than referencing an environment variable.

### Dockerfile — Identical

No differences between deployed and local.

### docker-compose.yaml — Identical

No differences between deployed and local.

### Extra Files on Server (not in local repo)

The following files exist in `/opt/litellm/` on the server but are absent from the local backup repo:
- `config-daily.yaml` — an intermediate config variant (5223 bytes, dated 2026-03-31)
- `config-simple.yaml` — minimal/simple config (592 bytes, dated 2026-03-19)
- `ollama_embedding_handler_patch.py` — Ollama embedding handler patch (3725 bytes); not bind-mounted in docker-compose, likely superseded
- `ollama_embedding_handler_patch.py.bak.20260328023951` — backup of above
- Numerous `config.yaml.bak*` versioned backups (20+ files) dating back to 2026-03-22
- `Dockerfile.bak-20260411-105428` and `Dockerfile.bak.preupgrade-20260411T043730Z`
- `docker-compose.yaml.bak.preupgrade-20260411T043730Z`
- `.gitignore`, `.env` (existence noted; contents not read)

### Running Container Context

The server runs a large multi-service homelab stack. LiteLLM-specific containers:
- `litellm-proxy` — Up 6 minutes (recently restarted), healthy, port 4000
- `litellm-db` — Up 32 hours, healthy (PostgreSQL 16)
- `litellm-redis` — Up 32 hours, healthy (Redis 7)
- `litellm-autoheal` — Up 32 hours, healthy

Other notable co-located services on the same host: Traefik, Authentik (SSO), DeerFlow (LangGraph AI agent stack), Firecrawl, SearXNG, Prometheus, Grafana, Portainer, Infisical, Frigate (NVR).

### Architectural Differences

- **Routing strategy mismatch:** Deployed uses `simple-shuffle`; local repo targets `latency-based-routing`. The local version actively routes to the faster backend (hintonator RTX 5090) first.
- **Missing second nemotron backend:** Deployed config lacks the docker-gpu overflow backend for `nemotron-cascade-2`, removing load balancing and overflow capacity.
- **Reduced max_tokens on local GPU models:** Deployed caps several models at 8192 tokens; local bumps these to 32768, increasing usable output length.
- **Security gap:** Deployed config has plaintext `master_key`; local correctly references env var.
- **`ollama_embedding_handler_patch.py`** on server is not referenced in `docker-compose.yaml` volumes and appears to be dead code from a previous approach.

---

*Architecture analysis: 2026-04-13*
