# Codebase Structure

**Analysis Date:** 2026-04-13

## Directory Layout

```
litellm/                              # Repository root (home-infra-backups/litellm)
├── config.yaml                       # Active production proxy config (models, routing, caching)
├── config-cluster.yaml               # Alternate cluster-mode config (not currently deployed)
├── docker-compose.yaml               # Service definitions: proxy, db, redis, autoheal
├── Dockerfile                        # Custom image: litellm nightly + weave + router.py patch
├── .env.template                     # Template listing required environment variables
├── fix_json_tool_calls.py            # CustomLogger: pre+post hook to repair malformed tool call JSON
├── weave_callback.py                 # CustomLogger: W&B Weave tracing integration
├── strip_think.py                    # CustomLogger: strip <think> tokens (inactive in current config)
├── firecrawl_search_transform.py     # Overrides LiteLLM's Firecrawl search transformation module
├── RESTORE.md                        # Runbook for restoring from backup
└── backups/
    └── litellm-20260410-231946.tar.gz   # Point-in-time snapshot
```

## Directory Purposes

**Root (`/`):**
- All active files live at the root — this is a single-service configuration repo, not a source code project
- No subdirectory structure beyond `backups/`

**`backups/`:**
- Purpose: Archived snapshots of the full deployment directory
- Contains: `.tar.gz` tarballs, one per backup event
- Generated: manually / via backup script
- Committed: Yes (versioned alongside config)

## Key File Locations

**Entry Points:**
- `docker-compose.yaml`: Service orchestration — start/stop/rebuild the entire stack
- `Dockerfile`: Custom image build — base image version pinned here (`v1.83.6-nightly`)

**Configuration:**
- `config.yaml`: The single source of truth for all model definitions, routing rules, fallbacks, caching, callbacks, and general settings. This is the primary file to edit for model/routing changes.
- `config-cluster.yaml`: Alternative config for a cluster topology (gpt-oss-120b-cluster primary). Not deployed; retained for reference / future use.
- `.env.template`: Documents required environment variable names. Actual `.env` is gitignored on the server.

**Custom Callbacks (Python):**
- `fix_json_tool_calls.py`: Registered in `config.yaml` → `litellm_settings.callbacks` as `fix_json_tool_calls.proxy_handler_instance`
- `weave_callback.py`: Registered as `weave_callback.proxy_handler_instance`
- `strip_think.py`: Callback class present; NOT currently registered in `config.yaml` callbacks (removed 2026-04-12)
- `firecrawl_search_transform.py`: Not a callback — bind-mounted directly into LiteLLM's site-packages to patch upstream search transformation logic

**Documentation:**
- `RESTORE.md`: Step-by-step instructions for restoring from a backup tarball

## Naming Conventions

**Files:**
- Config variants: `config[-descriptor].yaml` (e.g., `config-cluster.yaml`, `config-simple.yaml`)
- Callback plugins: `snake_case.py` matching the module name used in `config.yaml` callback references
- Backups: `litellm-YYYYMMDD-HHMMSS.tar.gz`

**Docker container names:**
- `litellm-proxy`, `litellm-db`, `litellm-redis`, `litellm-autoheal` — all prefixed `litellm-`

**Docker volume names:**
- `litellm-pgdata`, `litellm-redis` — prefixed `litellm-`

## Where to Add New Code

**New model or provider:**
- Edit `config.yaml` → `model_list` to add the model entry
- Add fallback entries in `router_settings.fallbacks` and `context_window_fallbacks` if appropriate
- Add to `litellm_settings.cache_models` if the model is metered and should be cached

**New custom callback:**
- Create `<name>.py` at repo root extending `CustomLogger`
- Export `proxy_handler_instance = <ClassName>()`
- Add bind-mount volume in `docker-compose.yaml`: `- ./<name>.py:/app/<name>.py`
- Register in `config.yaml` → `litellm_settings.callbacks`: `- <name>.proxy_handler_instance`

**Patching upstream LiteLLM source:**
- Add `RUN sed ...` block to `Dockerfile` with `grep -q` guard to verify patch applied
- Target `/usr/lib/python3.13/site-packages/litellm/` (what the proxy runtime actually imports)
- Also patch `/app/litellm/` for consistency (see Dockerfile comments for explanation)
- Document the upstream issue and litellm version in a Dockerfile comment

**Config variant (e.g., for testing):**
- Create `config-<descriptor>.yaml` at root
- Override in `docker-compose.yaml` command: `--config /app/config-<descriptor>.yaml`

## Special Directories

**`.git/`:**
- Purpose: Git version history for this backup repo
- Generated: Yes (git)
- Committed: No (standard git internals)

**`.planning/`:**
- Purpose: GSD planning and codebase analysis documents
- Generated: by GSD tooling
- Committed: Yes

**`backups/`:**
- Purpose: Compressed deployment snapshots
- Generated: by backup scripts
- Committed: Yes

---

*Structure analysis: 2026-04-13*
