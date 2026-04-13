# Codebase Concerns

**Analysis Date:** 2026-04-13

---

## Tech Debt

**Upstream Router Patch (num_retries TypeError):**
- Issue: Upstream litellm `router.py` calls `kwargs.pop("num_retries")` with no default; when `litellm.num_retries` is `None` at module level, `None > 0` raises `TypeError` inside the exception handler, shadowing the real error.
- Files: `Dockerfile` (patch applied at build time via `sed`), affects `/usr/lib/python3.13/site-packages/litellm/router.py` and `/app/litellm/router.py` inside the container
- Impact: Without the patch, all retries silently fail with an obscure TypeError instead of the real upstream exception. Retry logic is completely broken until the patch is applied.
- Fix approach: Patch is applied in `Dockerfile` with a `grep -q` guard that fails the build if a future litellm upgrade reflows the patched line. Must re-audit on every litellm version bump. Upstream issue should be reported/tracked for eventual removal.

**Firecrawl Library Override via Volume Mount:**
- Issue: `docker-compose.yaml` mounts `firecrawl_search_transform.py` directly over the installed litellm package file at `/usr/lib/python3.13/site-packages/litellm/llms/firecrawl/search/transformation.py`
- Files: `docker-compose.yaml` (line 51), `firecrawl_search_transform.py`
- Impact: Any litellm upgrade that changes the interface of `BaseSearchConfig`, `SearchResponse`, or `SearchResult` will silently break Firecrawl search without a clear error. The override is invisible at the application layer — it looks like a normal litellm install.
- Fix approach: Long-term, contribute the dual-format (v1/v2) fix upstream to litellm. Short-term, add a version check or interface assertion in the mounted file.

**`config-cluster.yaml` is an Orphaned Alternate Config:**
- Issue: `config-cluster.yaml` exists as a separate, fully-featured alternate config with different model aliases (`firm-default`, `gpt-oss-120b-cluster`, `hintonator-35b`), different routing strategy (`usage-based-routing` vs `latency-based-routing`), and different callback set (includes `strip_think` instead of `fix_json_tool_calls` + `weave_callback`).
- Files: `config-cluster.yaml`
- Impact: Unclear which config is active for which deployment context. The cluster config uses `strip_think` which was removed from the main config on 2026-04-12 based on benchmark data. The two configs will drift without coordination and there is no documentation of when/where `config-cluster.yaml` is used. `honcho-chat` in cluster config still points to `qwen3:14b` on `docker-gpu:11434` (which is down).
- Fix approach: Document in a comment block which deployment uses each config, or consolidate under a single config with environment-driven overrides.

**Hardcoded Postgres Password in docker-compose.yaml:**
- Issue: `docker-compose.yaml` contains the Postgres password in plaintext in two locations: the `POSTGRES_PASSWORD` env var (line 8) and embedded in the `DATABASE_URL` connection string (line 60).
- Files: `docker-compose.yaml`
- Impact: If this file is committed to version control or shared, the database password is exposed. The password `litellm-synergy-2026` is visible in the backup repository.
- Fix approach: Move `POSTGRES_PASSWORD` and the password component of `DATABASE_URL` to the `.env` file, sourced via `${POSTGRES_PASSWORD}` substitution.

**Prometheus URL Hardcoded in Config:**
- Issue: `prometheus_url: http://192.168.50.117:9090` is a bare IP in both `config.yaml` and `config-cluster.yaml`. If the Prometheus host moves, config must be manually updated.
- Files: `config.yaml` (line 301), `config-cluster.yaml` (line 232)
- Fix approach: Move to an env var `os.environ/PROMETHEUS_URL` consistent with other settings.

**`strip_think.py` Retained but Unused:**
- Issue: `strip_think.py` is still mounted in `docker-compose.yaml` (line 49) and exists in the repo, but it is explicitly NOT included in the `config.yaml` callbacks as of 2026-04-12. The comment in `config.yaml` explains why (net negative benchmark impact). The file remains, creating confusion about whether it should be used.
- Files: `strip_think.py`, `docker-compose.yaml` (line 49), `config.yaml` (lines 287-289)
- Fix approach: Either delete and remove the volume mount, or keep with a clear comment that it is available but intentionally disabled.

---

## Known Bugs / Active Errors

**`docker-gpu.thelaljis.com:11434` (Ollama) Unreachable:**
- Symptoms: Continuous `APIConnectionError` / `OllamaException` in `litellm-proxy` logs: `Cannot connect to host docker-gpu.thelaljis.com:11434 ... Connect call failed ('192.168.50.25', 11434)`
- Files: `config.yaml` (lines 106-114 — `nomic-embed-text` + `openai/text-embedding-3-small` both point to `192.168.50.73:11434`), `config-cluster.yaml` (lines 51-57 embed `docker-gpu.thelaljis.com:11434`)
- Impact: Every embedding request fails on the primary route before falling back. The fallback for `openai/text-embedding-3-small` is `nomic-embed-text` — which is the same dead host. Both routes point to `192.168.50.73:11434` (hintonator) in `config.yaml`. The `config-cluster.yaml` still has `docker-gpu.thelaljis.com:11434` which resolves to `192.168.50.25` (different host, also down).
- Trigger: Any embedding request routed to either `nomic-embed-text` or `openai/text-embedding-3-small`.
- Workaround: The proxy falls back gracefully for chat but embedding failures propagate to callers like Honcho.

**Weave `RecursionError` on Failed Requests:**
- Symptoms: `RecursionError: maximum recursion depth exceeded` appearing in `weave` error output lines in `litellm-proxy` logs (363 occurrences observed).
- Files: `weave_callback.py`, triggered by `docker-gpu.thelaljis.com:11434` connection failures
- Impact: When Weave attempts to log a failed call and the underlying error involves a deeply chained exception (Ollama → httpx → aiohttp → OpenAI), Weave's async call creation recurses into its own error handler. This produces noisy log spam and may cause trace data loss for failed calls.
- Trigger: Connection errors on `docker-gpu.thelaljis.com:11434`.
- Fix approach: Fix the upstream Ollama connectivity issue to stop the error cascade. The RecursionError is a Weave SDK bug triggered by abnormal exception chaining.

**`openai/qwen3:14b` Model Mapping Error:**
- Symptoms: `router.py:8898 - This model isn't mapped yet. model=openai/qwen3:14b` appearing in logs.
- Files: `config-cluster.yaml` (line 63 — `honcho-chat` uses `ollama/qwen3:14b` on `docker-gpu`, which when routed through the proxy gets mapped as `openai/qwen3:14b`)
- Impact: Routing failures and incomplete cost tracking for `honcho-chat` requests in the cluster config.
- Fix approach: The main `config.yaml` has already fixed this by pointing `honcho-chat` to `spark-learner` instead. Ensure `config-cluster.yaml` is updated consistently.

**Proxy Re-initialization Loop:**
- Symptoms: "LiteLLM: Proxy initialized with Search Tools" appears 5,546 times in the current container's log, approximately 81 times in the last hour alone (roughly every 44 seconds).
- Files: `docker-compose.yaml` (healthcheck restarts via `autoheal`), litellm internal
- Impact: This is not a restart loop (container RestartCount=0, started at 12:29:53). The re-initialization messages appear to be triggered by litellm's internal health/reload cycle, not container restarts. However, the frequency is abnormal and may indicate worker recycling under load or a background reload trigger firing continuously.
- Fix approach: Investigate litellm's `--num_workers 1` behavior and whether the autoheal container is triggering unnecessary health check responses that cause soft re-inits.

---

## Security Considerations

**Postgres Password in Plaintext in Compose File:**
- Risk: `docker-compose.yaml` contains `POSTGRES_PASSWORD=litellm-synergy-2026` and the full `DATABASE_URL` with embedded credentials.
- Files: `docker-compose.yaml` (lines 8, 60)
- Current mitigation: File is in a local backup repo, not a public remote. `.env` file with actual API keys is gitignored.
- Recommendations: Move database password to `.env`, reference via `${POSTGRES_PASSWORD}`. Rotate password if this file has been committed to any shared repo.

**No TLS on Internal Backend Connections:**
- Risk: All local model backends (`spark-001`, `hintonator`, `docker-gpu`) are accessed over plain HTTP (`http://` `api_base` values). Traffic between docker-001 and these hosts crosses LAN/Tailscale.
- Files: `config.yaml` (all `api_base` entries)
- Current mitigation: Tailscale IPs (`100.x.x.x`) are encrypted at the Tailscale layer. LAN IPs are on a private network.
- Recommendations: Acceptable for home lab. No action required unless compliance is needed.

**Postgres Port Not Externally Exposed (Good):**
- `docker-compose.yaml` correctly omits port mapping for `litellm-db` — Postgres is only accessible on `litellm-internal` network. No external exposure.

**`api_key: none` for Local Models:**
- Risk: All local vLLM/Ollama backends use `api_key: none`. If any of these hosts were exposed externally, they would have no authentication.
- Files: `config.yaml` (all local model entries)
- Current mitigation: Hosts are on private LAN or Tailscale. LiteLLM proxy enforces `LITELLM_MASTER_KEY` for all inbound requests.

---

## Performance Bottlenecks

**Single Worker (`--num_workers 1`):**
- Problem: The proxy runs with one Uvicorn worker. All concurrent requests share a single async event loop.
- Files: `docker-compose.yaml` (line 84)
- Cause: Likely intentional to reduce memory footprint on a shared host (21 GiB RAM, 38 containers).
- Impact: Under high concurrency (e.g., Honcho bulk embedding + Deerflow chat simultaneously), the single worker creates backpressure. Long-running model calls (600s timeout) can block the event loop for other requests.
- Improvement path: Increase to `--num_workers 2` if memory headroom allows. Current litellm-proxy memory is 737 MiB — doubling would use ~1.5 GiB.

**Redis Cache Only Covers Cloud/Paid Models:**
- Problem: `cache_models` in `config.yaml` lists only cloud models (gemini-flash, kimi-k2.5, etc.). Local models (`spark-learner`, `nemotron-cascade-2`, `honcho-chat`) are not cached.
- Files: `config.yaml` (lines 278-283)
- Cause: Local models are fast and presumably free so caching was deprioritized.
- Impact: Repeated identical prompts to local models always generate fresh responses, wasting GPU time.

**PostgreSQL Volume at 3.5 GiB:**
- Problem: `litellm_litellm-pgdata` volume is 3.5 GiB. This grows with `store_prompts_in_spend_logs: true` enabled, which stores full prompt/completion text in spend logs.
- Files: `config.yaml` (line 298), `docker-compose.yaml` volume `litellm-pgdata`
- Impact: At current growth rate, will consume meaningful disk space on the 222 GiB root filesystem (currently 76% full — 52 GiB free).
- Improvement path: Add a spend log retention policy or periodic `DELETE FROM spend_logs WHERE startTime < NOW() - INTERVAL '30 days'`.

---

## Fragile Areas

**File-Patched LiteLLM Internals:**
- Files: `Dockerfile` (router.py sed patch), `docker-compose.yaml` (firecrawl transformation.py volume mount)
- Why fragile: Any litellm version bump can silently break either patch. The router.py patch has a build-time grep guard that will fail loudly. The firecrawl volume mount has no guard — if the file interface changes, errors appear at runtime only.
- Safe modification: Before bumping the litellm base image version in `Dockerfile`, manually diff the patched sections of `router.py` and the `BaseSearchConfig` interface. Update `firecrawl_search_transform.py` accordingly.
- Test coverage: None — no automated tests verify these patches survive upgrades.

**`config-cluster.yaml` / `config.yaml` Divergence:**
- Files: `config-cluster.yaml`, `config.yaml`
- Why fragile: These configs share model names (`kimi-k2.5`, `gemini-flash`, `honcho-chat`) but use different routing strategies, callback sets, and backend URLs. A change made to one is rarely mirrored to the other. `config-cluster.yaml` already contains stale references (`docker-gpu:11434`, `qwen3:14b`) that were fixed in `config.yaml`.
- Safe modification: Treat `config-cluster.yaml` as a separate deployment config. Any shared model definition change must be applied to both files.

**Weave Initialization at Module Import Time:**
- Files: `weave_callback.py` (line 16: `weave.init(project)`)
- Why fragile: `weave.init()` is called at module import, not lazily. If `WANDB_API_KEY` is missing or Weave's W&B endpoint is unreachable at container startup, the entire proxy fails to start.
- Safe modification: Wrap `weave.init()` in a try/except to degrade gracefully if Weave is unavailable.
- Test coverage: None.

---

## Scaling Limits

**Disk (Root Filesystem):**
- Current: 160 GiB used / 222 GiB total (76% full, 52 GiB free)
- Limit: At 90% (~200 GiB), Docker overlay and PostgreSQL writes will begin failing.
- Growth drivers: `litellm_litellm-pgdata` (3.5 GiB, growing with spend logs), Docker image layers, Deerflow/Firecrawl data.
- Scaling path: Enable spend log retention policy; periodically run `docker system prune` to remove unused layers.

**Swap Exhaustion:**
- Current: 1.9 GiB used / 2.0 GiB total virtual swap (only 126 MiB free)
- Risk: Swap is a virtual device (not disk-backed). If a container allocates memory that tips into swap, the kernel OOM killer may terminate containers.
- Most at-risk containers: `rhx-paperclip-server-1` (1.25 GiB), `litellm-proxy` (737 MiB), `authentik-server` (731 MiB), `infisical` (750 MiB), `scrypted` (728 MiB).
- Scaling path: Increase swap size on the Proxmox VM or add memory limits to low-priority containers.

---

## Dependencies at Risk

**Pinned to `litellm:v1.83.6-nightly` (Nightly Build):**
- Risk: Nightly builds are not stable releases. The `-nightly` tag may receive breaking changes without a major version bump.
- Files: `Dockerfile` (line 1)
- Impact: The router.py patch is line-number-sensitive. A nightly reshuffle of router.py can silently skip the patch (the grep guard catches this, but it requires a rebuild to discover).
- Migration plan: Move to a stable litellm release tag when available. Track upstream router.py fix for the num_retries bug to remove the Dockerfile patch.

**`fix_json_tool_calls.py` Masks Model Quality Issues:**
- Risk: This callback silently repairs malformed JSON tool call arguments produced by models. It may hide regressions in model quality (e.g., a new checkpoint that produces worse JSON will appear to work normally).
- Files: `fix_json_tool_calls.py`
- Impact: Silent quality degradation. The fix is best-effort — complex JSON corruption (e.g., wrong keys, truncated nested objects) passes through unfixed and causes downstream tool execution failures.

---

## Missing Critical Features

**No Spend Log Retention Policy:**
- Problem: `store_prompts_in_spend_logs: true` stores full prompt text indefinitely. PostgreSQL volume is already 3.5 GiB.
- Blocks: Long-term operation without manual intervention.
- Files: `config.yaml` (line 298)

**No Log Rotation for Container Logs:**
- Problem: Docker container logs have no `max-size` or `max-file` limits configured in `docker-compose.yaml`.
- Files: `docker-compose.yaml`
- Impact: The litellm-proxy log (5,546+ "Proxy initialized" lines observed) will grow unboundedly, consuming the 52 GiB free disk space over time.
- Fix: Add `logging` driver config to each service in `docker-compose.yaml`:
  ```yaml
  logging:
    driver: "json-file"
    options:
      max-size: "50m"
      max-file: "3"
  ```

---

## Test Coverage Gaps

**No Tests for Any Custom Callbacks:**
- What's not tested: `fix_json_tool_calls.py`, `strip_think.py`, `weave_callback.py`, `firecrawl_search_transform.py`
- Files: All `.py` files in the project root
- Risk: The JSON repair logic in `fix_json_tool_calls.py` handles edge cases (unterminated strings, unbalanced braces) with a custom state machine that is entirely untested. A regression in the repair logic would silently break tool calls for all models.
- Priority: High for `fix_json_tool_calls.py` (active in production), Medium for `firecrawl_search_transform.py`.

**No Integration Tests for Fallback Chains:**
- What's not tested: The router fallback sequences in `config.yaml` `router_settings.fallbacks` are not validated end-to-end.
- Risk: A misconfigured fallback (e.g., circular reference or missing model alias) fails silently at runtime only when the primary model is down.
- Priority: Medium.

---

## Deployed Operational Concerns

*Findings from SSH audit of `root@docker-001` on 2026-04-13.*

**CRITICAL: Swap Nearly Exhausted**
- Status: 1.9 GiB / 2.0 GiB virtual swap used (only ~126 MiB free)
- Risk: Any memory spike from a container (authentik, scrypted, infisical, litellm-proxy, paperclip-server) will invoke the OOM killer. The host has 21 GiB RAM with ~11 GiB used and ~9.8 GiB available including buff/cache — actual free is only 1.2 GiB. The system is relying on buff/cache being evictable to absorb spikes.
- Recommended action: Investigate which process drove swap to near-full. Consider adding a disk-backed swapfile or increasing VM memory in Proxmox.

**WARNING: Root Filesystem at 76% (52 GiB Free)**
- Status: 160 GiB used / 222 GiB total on `/dev/loop1`
- Docker overlay filesystems all mount on this volume. PostgreSQL data (`litellm_litellm-pgdata` = 3.5 GiB) also lives here.
- Immediate action: Enable spend log retention and add Docker log rotation (see Missing Critical Features above). Run `docker system prune --volumes` with caution to reclaim unused layers.

**ACTIVE: `docker-gpu.thelaljis.com:11434` (192.168.50.25) Unreachable**
- Ollama on `docker-gpu` (RTX 3090) is not responding. This host is referenced in `config-cluster.yaml` for `honcho-chat` (`qwen3:14b`) and both embedding models.
- Impact: All embedding requests via `nomic-embed-text` and `openai/text-embedding-3-small` fail on first attempt before falling back. In `config-cluster.yaml`, the `honcho-chat` fallback chain is also broken.
- Note: `config.yaml` (active config) routes embeddings to `192.168.50.73:11434` (hintonator), not docker-gpu. Confirm whether hintonator's Ollama is running and serving `nomic-embed-text`.

**ACTIVE: Continuous Proxy Re-initialization (Every ~44s)**
- The log message "LiteLLM: Proxy initialized with Search Tools" appears approximately 81 times in the last hour (5,546 total since container start at 12:29:53). Container itself has not restarted (RestartCount=0).
- This frequency is abnormal and suggests litellm's internal worker/reload mechanism is firing on a tight cycle, possibly triggered by health checks or a background config polling loop.
- Recommended action: Check if the autoheal container is sending restart signals via healthcheck. Review litellm nightly build changelog for background reload behavior.

**ACTIVE: Weave RecursionError Spam (363 occurrences)**
- Weave SDK throws `RecursionError: maximum recursion depth exceeded` when attempting to log failed calls caused by the `docker-gpu:11434` connection errors. This produces noisy log output and likely results in dropped Weave traces for affected calls.
- Root cause: Chained exception depth (Ollama → httpx → aiohttp → OpenAI wrapper) exceeds Python recursion limit inside Weave's async error handling.
- Fix: Resolving the `docker-gpu:11434` connectivity issue will stop the error cascade.

**INFO: Frigate Container at 190% CPU**
- `frigate` (camera/NVR container) is consuming 190% CPU as of the audit snapshot. This is expected for active video processing but worth monitoring under memory pressure.

**INFO: High Load Average**
- System load: 3.52 / 2.80 / 2.67 (uptime: 2 days 11h). With 38 containers running, this is elevated but not critical. Scrypted (5.09% CPU), Frigate (190%), and authentik-server (3.13%) are primary consumers.

---

*Concerns audit: 2026-04-13*
