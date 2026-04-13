# Technology Stack

**Analysis Date:** 2026-04-13

## Languages

**Primary:**
- Python 3.13 - All proxy logic, custom callbacks, search transforms, and patches

## Runtime

**Environment:**
- Docker container based on `ghcr.io/berriai/litellm:v1.83.6-nightly`
- Python 3.13 (baked into base image at `/usr/lib/python3.13/`)

**Package Manager:**
- pip (no lockfile — dependencies pinned via Docker image tag)

## Frameworks

**Core:**
- LiteLLM v1.83.6-nightly - OpenAI-compatible proxy/gateway for routing, caching, cost tracking

**Build/Dev:**
- Docker + Docker Compose v2 - Container build and orchestration

## Key Dependencies

**Critical:**
- `ghcr.io/berriai/litellm:v1.83.6-nightly` - Base image providing the entire proxy runtime
- `weave` (W&B) - Installed via `RUN pip install --no-cache-dir weave` in `Dockerfile`; auto-patches LiteLLM for tracing

**Infrastructure:**
- `postgres:16-alpine` - Spend logs, API keys, model configs in DB
- `redis:7-alpine` - Response cache (TTL 3600s), rate limiting state
- `willfarrell/autoheal` - Auto-restarts unhealthy containers (watches `autoheal=true` label)

## Custom Python Modules (volume-mounted)

All custom code is bind-mounted into the running container — no rebuild needed for config changes.

| File | Mount Path | Purpose |
|------|-----------|---------|
| `fix_json_tool_calls.py` | `/app/fix_json_tool_calls.py` | Pre/post call hook: repairs malformed JSON in tool call arguments |
| `weave_callback.py` | `/app/weave_callback.py` | Initializes W&B Weave tracing via `weave.init()` on import |
| `strip_think.py` | `/app/strip_think.py` | Strips `<think>...</think>` blocks from model responses (currently not in active callbacks) |
| `firecrawl_search_transform.py` | `/usr/lib/python3.13/site-packages/litellm/llms/firecrawl/search/transformation.py` | Patches LiteLLM's Firecrawl integration to support both cloud (v2) and self-hosted (v1) response formats |

## Source Patches Applied at Build Time

**`Dockerfile` router.py patch:**
- File: `Dockerfile`
- Target: `/usr/lib/python3.13/site-packages/litellm/router.py` and `/app/litellm/router.py`
- Fix: `num_retries = kwargs.pop("num_retries")` → `_nr = kwargs.pop("num_retries", None); num_retries = self.num_retries if _nr is None else _nr`
- Rationale: Prevents `TypeError` in exception handler when `num_retries=None` flows from caller into `if num_retries > 0:`
- Guard: `grep -q` assertions fail the build loudly if a future LiteLLM version reflows the patched lines

## Configuration

**Primary config:** `config.yaml` (mounted at `/app/config.yaml`)

**Environment variables (from `.env`):**
- `ANTHROPIC_API_KEY` - Anthropic API access
- `OPENAI_API_KEY` - OpenAI API access
- `OPENROUTER_API_KEY` - OpenRouter (Gemini, Kimi, Minimax, DeepSeek via proxy)
- `GEMINI_API_KEY` - Direct Google Gemini access
- `PERPLEXITYAI_API_KEY` - Perplexity Sonar models
- `MOONSHOT_API_KEY` - Moonshot/Kimi direct access
- `FIRECRAWL_API_KEY` - Self-hosted Firecrawl search
- `LITELLM_MASTER_KEY` - Proxy authentication master key
- `WANDB_API_KEY` - Weights & Biases tracing
- `WANDB_PROJECT` - W&B project name (default: `litellm-proxy`)
- `DATABASE_URL` - PostgreSQL connection string (hardcoded in docker-compose)
- `REDIS_HOST` / `REDIS_PORT` - Redis cache connection

**Template:** `.env.template` (shows required vars with `REDACTED` values)

**Build:**
- `Dockerfile` - Extends base image, installs weave, patches router.py
- `docker-compose.yaml` - Wires all services, bind mounts, healthchecks

## Platform Requirements

**Development:**
- Docker with Compose v2
- Access to self-hosted GPU inference endpoints (Tailscale/LAN)
- `.env` file populated from `.env.template`

**Production:**
- Deployed on `docker-001` at `/opt/litellm/`
- Exposed on port `4000`
- Connected to `traefik-net` (external) for reverse proxy ingress
- Prometheus metrics scraped by Prometheus at `192.168.50.117:9090`

---

## Deployed vs Local Differences

**Compared:** `/opt/litellm/` on `docker-001` vs `/home/rhx/projects/home-infra-backups/litellm/`

### Dockerfile
**Status: Identical.** Both use `ghcr.io/berriai/litellm:v1.83.6-nightly` with the same router.py patch and `weave` install.

### docker-compose.yaml
**Status: Identical.** No differences detected.

### config.yaml — Notable differences (deployed vs local)

| Area | Deployed (docker-001) | Local (repo) |
|------|-----------------------|--------------|
| `spark-nemotron-120B` max_tokens | `8192` | `32768` |
| `nemotron-cascade-2` (hintonator backend) max_tokens | `8192` | `32768` |
| Extra model alias | `gemma4-26b` → aliases nemotron-cascade-2 hintonator | Replaced by `nemotron-cascade-2` (docker-gpu overflow backend) + `nemotron-cascade-2-hintonator` (explicit alias) |
| `routing_strategy` | `simple-shuffle` | `latency-based-routing` |
| `enable_pre_call_checks` | absent | `true` |
| `context_window_fallbacks` format | inline list dicts (`- model: [list]`) | YAML block scalars with `nemotron-cascade-2-hintonator` as first fallback |
| `general_settings.master_key` | Hardcoded value `sk-litellm-master-synergy2026` | `os.environ/LITELLM_MASTER_KEY` |

**Summary:**
- Local repo is ahead of deployed on several model config improvements: `latency-based-routing`, higher `max_tokens` limits, the two-backend nemotron-cascade-2 split (hintonator primary + docker-gpu overflow), `nemotron-cascade-2-hintonator` alias, and `enable_pre_call_checks: true`.
- Deployed server has the master key hardcoded in `config.yaml` rather than reading from env — this is a security concern (see CONCERNS.md if created).
- The `gemma4-26b` alias in deployed config is a stale name that the local repo has replaced with `spark-gemma4-31B`.

### Extra Files on Server (not in local repo)

| File | Path | Description |
|------|------|-------------|
| `ollama_embedding_handler_patch.py` | `/opt/litellm/ollama_embedding_handler_patch.py` | Ollama `/api/embed` async handler patch — implements `ollama_aembeddings()` and `ollama_embeddings()` functions. Not mounted in docker-compose, appears to be a development artifact or pending integration. |
| `config-daily.yaml` | `/opt/litellm/config-daily.yaml` | A config snapshot (5223 bytes, dated Mar 31) — not tracked in local repo. |
| `config-simple.yaml` | `/opt/litellm/config-simple.yaml` | Minimal config (592 bytes, dated Mar 19). |
| Dockerfile backups | `Dockerfile.bak-*` | Old Dockerfile versions from pre-upgrade. |
| config.yaml backups | `config.yaml.bak*`, `config.yaml.backup.*` | Extensive backup history going back to Mar 22. |

### .env
Server has a `.env` file at `/opt/litellm/.env` (not readable — `.gitignore`d). Local repo provides only `.env.template`.

---

*Stack analysis: 2026-04-13*
