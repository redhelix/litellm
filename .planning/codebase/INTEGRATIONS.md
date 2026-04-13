# External Integrations

**Analysis Date:** 2026-04-13

## LLM Providers (via LiteLLM proxy routing)

**Self-Hosted / LAN GPU Inference:**
- `spark-learner` — Qwen3.5-35B-A3B MoE v3.0 on spark-001 (Tailscale `100.115.141.106:8000/v1`)
- `spark-gemma4-31B` — gemma-4-31b on `192.168.50.79:9005/v1`
- `spark-nemotron-120B` — nemotron-3-super on spark-002 (Tailscale `100.123.128.107:8000/v1`), thinking mode enabled
- `nemotron-cascade-2` — Dual-backend: hintonator RTX 5090 (`192.168.50.73:8000/v1`) + docker-gpu RTX 3090 (`docker-gpu.thelaljis.com:8000/v1`), thinking mode enabled
- `nomic-embed-text` / `openai/text-embedding-3-small` — Ollama on hintonator (`192.168.50.73:11434`)

All self-hosted models use OpenAI-compatible vLLM endpoints. Auth: `api_key: none`.

**OpenRouter (paid aggregator):**
- Auth: `os.environ/OPENROUTER_API_KEY`
- Models routed: `gemini-flash` (gemini-2.5-flash), `gemini-pro` (gemini-2.5-pro), `kimi-k2.5` (moonshotai/kimi-k2.5), `minimax-m2.7`, `google/gemini-3-flash-preview`

**Google Gemini (direct):**
- Auth: `os.environ/GEMINI_API_KEY`
- Models: `nano-banana-pro` (gemini-3-pro-image-preview), `nano-banana-2` (gemini-3.1-flash-image-preview)

**OpenAI (direct):**
- Auth: `os.environ/OPENAI_API_KEY`
- Models: `gpt-4o-mini`

**Perplexity (direct):**
- Auth: `os.environ/PERPLEXITYAI_API_KEY`
- Models: `perplexity-sonar-pro`, `perplexity-sonar`

**Anthropic:**
- Auth: `os.environ/ANTHROPIC_API_KEY`
- No models explicitly configured in `config.yaml` model_list; key available for passthrough

**Moonshot:**
- Auth: `os.environ/MOONSHOT_API_KEY`
- No models explicitly configured; key available for passthrough

## Search Tools

**SearXNG (self-hosted):**
- Provider: `searxng`
- Endpoint: `https://searxng.thelaljis.com`
- Auth: None (open self-hosted instance)
- Config: `config.yaml` `search_tools[].search_tool_name: searxng-search`

**Firecrawl (self-hosted):**
- Provider: `firecrawl`
- Endpoint: `https://firecrawl.thelaljis.com/v1`
- Auth: `os.environ/FIRECRAWL_API_KEY` (value `fc-dummy-self-hosted` per template)
- Config: `config.yaml` `search_tools[].search_tool_name: firecrawl-search`
- Patch: `firecrawl_search_transform.py` overrides LiteLLM's upstream Firecrawl transformer to support self-hosted v1 response format (`{"success": true, "data": [...]}`) in addition to cloud v2 format (`{"data": {"web": [...], "news": [...]}}`)

## Data Storage

**PostgreSQL:**
- Image: `postgres:16-alpine` (container `litellm-db`)
- Purpose: Spend logs, API key management, model configs (`store_model_in_db: true`), prompt logging (`store_prompts_in_spend_logs: true`)
- Connection: `DATABASE_URL=postgresql://litellm:litellm-synergy-2026@db:5432/litellm`
- Volume: `litellm-pgdata` (named Docker volume, persisted)
- Pool: connection limit 10, timeout 30s

**Redis:**
- Image: `redis:7-alpine` (container `litellm-redis`)
- Purpose: Response cache (TTL 3600s), rate limit state
- Connection: `REDIS_HOST=redis`, `REDIS_PORT=6379`
- Cached models: `gemini-flash`, `kimi-k2.5`, `gemini-pro`, `minimax-m2.7`, `gpt-4o-mini`
- Volume: `litellm-redis` (named Docker volume, persisted)

## Observability & Tracing

**Prometheus:**
- Push target: `http://192.168.50.117:9090`
- Integration: built-in LiteLLM `prometheus` callback (listed in `litellm_settings.callbacks`)
- Metrics endpoint: LiteLLM exposes `/metrics` on port 4000
- Config: `config.yaml` `metrics: [prometheus]`

**Weights & Biases Weave:**
- SDK: `weave` Python package (installed in `Dockerfile`)
- Auth: `os.environ/WANDB_API_KEY`
- Project: `os.environ/WANDB_PROJECT` (default: `litellm-proxy`)
- Integration: `weave_callback.py` calls `weave.init(project)` on import; auto-patches LiteLLM
- Mounted at: `/app/weave_callback.py`
- Registered as callback: `weave_callback.proxy_handler_instance` in `config.yaml`

## Reverse Proxy / Ingress

**Traefik:**
- External Docker network: `traefik-net`
- LiteLLM proxy attaches to `traefik-net` for ingress routing
- Traefik container runs separately on docker-001 (`traefik:v3.0`)

## Container Health & Recovery

**Autoheal:**
- Image: `willfarrell/autoheal`
- Monitors containers with label `autoheal=true` (set on `litellm-proxy`)
- Check interval: 30s, start period: 60s
- Restarts unhealthy containers automatically

## Authentication

**LiteLLM Master Key:**
- Local config: `os.environ/LITELLM_MASTER_KEY` (read from env)
- Deployed config (docker-001): hardcoded value in `config.yaml` (security concern — not reading from env)

## Networking

**Internal network (`litellm-internal` bridge):**
- All LiteLLM services (proxy, db, redis, autoheal) communicate on this network
- Self-hosted GPU backends accessed via LAN IPs (`192.168.50.x`) or Tailscale IPs (`100.x.x.x`)

**External access:**
- `docker-gpu.thelaljis.com` — RTX 3090 inference node (nemotron-cascade-2 overflow backend, Ollama)
- `searxng.thelaljis.com` — Self-hosted search
- `firecrawl.thelaljis.com` — Self-hosted web scraper/search

---

*Integration audit: 2026-04-13*
