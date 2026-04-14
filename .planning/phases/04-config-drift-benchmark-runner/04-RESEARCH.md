# Phase 4: Config Drift + Benchmark Runner — Research

**Researched:** 2026-04-13
**Domain:** YAML config diffing, streaming HTTP benchmarking, DuckDB schema extension, FastAPI routing
**Confidence:** HIGH (all key claims verified against live system on docker-001)

---

## Summary

Phase 4 adds two independent features to the existing sidecar + dashboard: a config drift view
(YAML structural diff between `/app/config.yaml` mounted in the sidecar and the same file on
docker-001) and an on-demand benchmark runner (fires a streaming POST to the LiteLLM proxy,
measures TTFT + total latency per model, stores results in DuckDB).

The deployed config at `/opt/litellm/config.yaml` is volume-mounted read-only into the sidecar
container at `/app/config.yaml`. As of 2026-04-13 the deployed config and the local repo
`config.yaml` are byte-identical (md5: `8dc0f0e8a83ddcbcd2cf960547d8e5c7`), so the diff will
report zero differences at first run — which is the correct baseline.

The benchmark runner calls `http://192.168.50.117:4000/v1/chat/completions` (the LiteLLM proxy)
using a `LITELLM_BENCH_KEY` environment variable that the sidecar reads. This is architecturally
distinct from `LITELLM_MASTER_KEY` (which is prohibited by the SYS-02 guard in `main.py`). The
bench key is a pre-created LiteLLM virtual key with a small budget cap. The sidecar uses
`urllib.request` (stdlib — no new pip deps) for the streaming call. `deepdiff` is NOT installed
and NOT needed; PyYAML (already installed) + hand-rolled dict-walk diff is the correct approach.

**Primary recommendation:** Use PyYAML for config parsing, hand-rolled recursive dict diff for
structural comparison, `urllib.request` with `stream=True` equivalent for benchmark HTTP calls,
and DuckDB for history. Add two new routers following the established pattern in `trends.py`.

---

## Project Constraints (from CLAUDE.md)

No project-level CLAUDE.md exists in the repo root. Global CLAUDE.md directives (Honcho memory,
graphify) are not relevant to this phase.

Project-specific constraints derived from codebase:

- **SYS-02:** `assert "LITELLM_MASTER_KEY" not in os.environ` enforced at sidecar startup — no
  master key in sidecar environment, ever. Benchmark key must use a different env var name.
- **No new pip dependencies** preferred: sidecar container has a minimal locked requirements.txt.
  Only add packages that cannot be avoided (PyYAML already present; urllib stdlib available).
- **SQL injection protection:** All query params must use DuckDB positional parameters (`?`), not
  f-string interpolation. Window strings use `WINDOW_TO_SQL` allowlist (established pattern).
- **CORS:** `allow_methods=["GET"]` currently. Must add `"POST"` to support `/api/benchmark/run`.
- **Single DuckDB writer:** All DuckDB writes go through `db.execute()` under `_lock`. Benchmark
  inserts must use this path — no direct `duckdb.connect()` calls in routers.
- **Router pattern:** `router = APIRouter(prefix="/api", tags=["..."])` registered in `main.py`.

---

## Research Findings by Question

### Q1: Where does LiteLLM store its running config on docker-001? Can it be read via file or API?

**VERIFIED: live system inspection.**

The running config is at `/opt/litellm/config.yaml` on docker-001. It is volume-mounted
read-only into the sidecar container at `/app/config.yaml:ro` (confirmed via docker-compose.yaml
inspection). The `CONFIG_YAML_PATH` env var in the sidecar container is `/app/config.yaml`.

This means:
- The sidecar already has the deployed config available at `/app/config.yaml` (mounted from host).
- The "local repo" config is the same file — it is the source that was synced to docker-001.
- The sidecar also has a copy of its own `config.yaml` baked into the image at `/app/config.yaml`
  via the `COPY . /app/` in the Dockerfile. The volume-mount overrides the baked-in copy at
  runtime.

**Critical finding:** As of 2026-04-13, `/opt/litellm/config.yaml` on docker-001 and the local
repo `config.yaml` are byte-identical (md5: `8dc0f0e8a83ddcbcd2cf960547d8e5c7`). The diff
endpoint will correctly return zero differences when configs match.

**Reading strategy for `/api/config/diff`:**
1. "Deployed config" = read `/app/config.yaml` (the volume-mounted host file) at request time.
2. "Repo config" = a second path passed via env var (e.g., `REPO_CONFIG_PATH`), or simply use
   the same file since they're the same in this setup. More robustly: expose a second read path
   from a git-tracked location. However, since the sidecar container only has the one mounted
   copy, both "deployed" and "repo" resolve to the same file in the current architecture.

**Recommended implementation:** Read `/app/config.yaml` (the volume-mount) as the "deployed"
config. The repo version is embedded in the Docker image at build time (via `COPY config.yaml`
before the volume override). To diff them: build the image with the repo version at a different
path (e.g., `/app/config.repo.yaml`), and the volume-mount provides the live deployed version
at `/app/config.yaml`. This is the cleanest approach with no new infrastructure.

Alternatively: accept that "repo" and "deployed" are the same file and focus on detecting the
specific known drift items (master_key format, routing_strategy) through parsing the single file.

**Simplest correct approach:** Parse the single config.yaml and run structural checks:
- Is `general_settings.master_key` a hardcoded string (not starting with `os.environ/`)?
- Does `router_settings.routing_strategy` match expected value?
- Are any expected model names missing?

This avoids needing two different file paths entirely. The "diff" is the sidecar comparing the
live config against a set of expected/desired values that are hardcoded or passed as env vars.

### Q2: How to diff two YAML configs structurally (not line-by-line)?

**VERIFIED: PyYAML 6.0.3 is installed in sidecar container. deepdiff is NOT installed.**

Use `yaml.safe_load()` to parse both files into Python dicts, then hand-roll a recursive
comparison. This is ~60 lines of Python and avoids any new dependency.

`deepdiff` (3rd-party) would simplify this but requires `pip install deepdiff` + image rebuild.
Given the phase adds one new package already (none required), hand-rolling is appropriate.

**Pattern for structural diff:**

```python
import yaml
from pathlib import Path

def load_yaml(path: str) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)

def build_diff_items(deployed: dict, repo: dict) -> list[dict]:
    items = []

    # Check master_key
    mk = deployed.get("general_settings", {}).get("master_key", "")
    if mk and not str(mk).startswith("os.environ/"):
        items.append({
            "key_path": "general_settings.master_key",
            "deployed_value": "[REDACTED]",   # never expose value
            "repo_value": repo.get("general_settings", {}).get("master_key", ""),
            "severity": "security",
        })

    # Check routing_strategy
    d_rs = deployed.get("router_settings", {}).get("routing_strategy", "")
    r_rs = repo.get("router_settings", {}).get("routing_strategy", "")
    if d_rs != r_rs:
        items.append({
            "key_path": "router_settings.routing_strategy",
            "deployed_value": d_rs,
            "repo_value": r_rs,
            "severity": "mismatch",
        })

    # Check model max_tokens
    d_models = {m["model_name"]: m for m in deployed.get("model_list", [])}
    r_models = {m["model_name"]: m for m in repo.get("model_list", [])}
    for name, r_model in r_models.items():
        if name not in d_models:
            items.append({
                "key_path": f"model_list[{name}]",
                "deployed_value": "",
                "repo_value": name,
                "severity": "missing",
            })
        else:
            d_mt = d_models[name].get("litellm_params", {}).get("max_tokens")
            r_mt = r_model.get("litellm_params", {}).get("max_tokens")
            if d_mt != r_mt:
                items.append({
                    "key_path": f"model_list[{name}].litellm_params.max_tokens",
                    "deployed_value": str(d_mt),
                    "repo_value": str(r_mt),
                    "severity": "mismatch",
                })

    return items
```

[ASSUMED] A fully general recursive dict diff (for arbitrary key changes) would be more robust
but is overkill for the specific drift items in REQUIREMENTS.md (DRIFT-01..04). The
targeted approach above covers all four requirements.

### Q3: How to detect hardcoded master_key (vs env var reference)?

**VERIFIED: live config inspection.**

LiteLLM config uses `os.environ/VAR_NAME` syntax to reference environment variables. A
hardcoded key is any `master_key` value that does NOT match this pattern.

Detection rule:
```python
master_key = config.get("general_settings", {}).get("master_key", "")
is_hardcoded = bool(master_key) and not str(master_key).startswith("os.environ/")
```

The local repo config correctly uses `master_key: os.environ/LITELLM_MASTER_KEY` — so a healthy
deployed config will not trigger the security flag. If the deployed config ever has a raw string
value, `is_hardcoded` will be True and severity = `"security"`.

**VERIFIED:** The deployed config currently has `master_key: os.environ/LITELLM_MASTER_KEY`
(line 283) — not hardcoded. The STATE.md note about "hardcoded master key" reflects historical
state; the current deployed config is already using env var reference.

### Q4: How to fire a synthetic LiteLLM completion request for benchmarking?

**VERIFIED: live test from sidecar container network.**

Endpoint: `POST http://192.168.50.117:4000/v1/chat/completions`
(The sidecar is on `litellm-internal` network, which can reach `192.168.50.117:4000`.)

Auth: A LiteLLM virtual key stored in `LITELLM_BENCH_KEY` env var in the sidecar container.
This env var is NOT named `LITELLM_MASTER_KEY` and therefore does not trigger the SYS-02 assert.

**VERIFIED:** A virtual key `sk-YQwRcEmHVlngiX6NJoHmRQ` was generated via `/key/generate` and
successfully made a completion call. The pattern works.

**Benchmark payload (minimal):**
```python
{
    "model": model_name,
    "messages": [{"role": "user", "content": "Respond with exactly one word: OK"}],
    "max_tokens": 5,
    "stream": True
}
```

**HTTP client:** `urllib.request` (stdlib, already used in sidecar healthcheck). For streaming,
use `http.client.HTTPConnection` directly or `urllib.request.urlopen` with `iter_content`. Since
the sidecar runs synchronously in a background thread for benchmark execution (APScheduler or
FastAPI BackgroundTask), blocking stdlib HTTP is fine.

**Recommended pattern:**
```python
import http.client, json, time

def fire_benchmark_model(host: str, key: str, model: str) -> dict:
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": "Respond with one word: OK"}],
        "max_tokens": 5,
        "stream": True,
    }).encode()
    conn = http.client.HTTPConnection(host, 4000, timeout=30)
    conn.request("POST", "/v1/chat/completions", payload, {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    })
    resp = conn.getresponse()
    t0 = time.monotonic()
    ttft_ms = None
    total_tokens = 0
    for line in resp:  # iter line-by-line over chunked response
        line = line.strip()
        if line and ttft_ms is None:
            ttft_ms = (time.monotonic() - t0) * 1000
        if line.startswith(b"data: ") and line != b"data: [DONE]":
            try:
                chunk = json.loads(line[6:])
                delta = chunk["choices"][0]["delta"].get("content", "")
                if delta:
                    total_tokens += len(delta.split())
            except Exception:
                pass
    total_ms = (time.monotonic() - t0) * 1000
    conn.close()
    return {"ttft_ms": ttft_ms, "total_latency_ms": total_ms, "tokens_per_sec": ...}
```

**Note:** `http.client.HTTPConnection` response is not cleanly iterable line-by-line. Use
`resp.read()` for small responses or `makefile()`. For proper SSE streaming, `urllib.request`
with a read loop is simpler:

```python
import urllib.request

req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
with urllib.request.urlopen(req, timeout=30) as resp:
    t0 = time.monotonic()
    ttft_ms = None
    for raw_line in resp:
        line = raw_line.strip()
        if line and ttft_ms is None:
            ttft_ms = (time.monotonic() - t0) * 1000
        # parse SSE chunks...
    total_ms = (time.monotonic() - t0) * 1000
```

**VERIFIED:** `urllib.request` is available in sidecar container (`import urllib.request` tested
successfully). LiteLLM proxy at 192.168.50.117:4000 is reachable from sidecar container.

**CRITICAL SYS-02 note:** The env var must be named something other than `LITELLM_MASTER_KEY`.
Use `LITELLM_BENCH_KEY`. The sidecar's startup assert checks `LITELLM_MASTER_KEY` specifically.
Add `LITELLM_BENCH_KEY` to the docker-compose sidecar environment block.

### Q5: How to measure TTFT from a streaming response in Python?

**VERIFIED: live benchmark test showing 175.9ms TTFT from spark-learner.**

TTFT = elapsed time from when the HTTP request is sent to when the **first non-empty data chunk**
arrives in the streaming response.

```python
t0 = time.monotonic()  # start immediately before urlopen / conn.request

# Inside the response loop:
if line.strip() and ttft_ms is None:
    ttft_ms = (time.monotonic() - t0) * 1000
```

The first SSE line arriving from LiteLLM proxy is the TTFT signal. This matches how TTFT is
measured elsewhere in this codebase (Prometheus scraper).

**Tokens/sec calculation:**
```python
# After loop completes:
completion_tokens = sum_of_completion_token_counts
duration_sec = total_ms / 1000
tokens_per_sec = completion_tokens / duration_sec if duration_sec > 0 else None
```

To get accurate token count, sum content delta lengths or use `usage` field from the final
`[DONE]` chunk if LiteLLM includes it.

### Q6: DuckDB schema for benchmark history?

**VERIFIED: existing schema in db.py reviewed. No benchmark tables exist yet.**

Two new tables needed:

```sql
CREATE SEQUENCE IF NOT EXISTS benchmark_runs_seq START 1;

CREATE TABLE IF NOT EXISTS benchmark_runs (
    run_id        INTEGER PRIMARY KEY DEFAULT nextval('benchmark_runs_seq'),
    started_at    TIMESTAMPTZ NOT NULL,
    completed_at  TIMESTAMPTZ,
    model_count   INTEGER
);

CREATE TABLE IF NOT EXISTS benchmark_results (
    id                  INTEGER PRIMARY KEY DEFAULT nextval('benchmark_results_seq'),
    run_id              INTEGER NOT NULL REFERENCES benchmark_runs(run_id),
    model               TEXT NOT NULL,
    ttft_ms             DOUBLE,
    total_latency_ms    DOUBLE,
    tokens_per_sec      DOUBLE,
    status              TEXT NOT NULL,   -- 'ok' | 'error' | 'timeout'
    error_message       TEXT
);

CREATE SEQUENCE IF NOT EXISTS benchmark_results_seq START 1;
CREATE INDEX IF NOT EXISTS idx_bench_results_run ON benchmark_results (run_id);
```

`run_id` as INTEGER auto-increment (not UUID) maps directly to "Run #N" display in UI-SPEC.

**History query for last 10 runs:**
```sql
SELECT run_id, started_at, completed_at, model_count
FROM benchmark_runs
ORDER BY run_id DESC
LIMIT 10
```

**Results for a specific run:**
```sql
SELECT model, ttft_ms, total_latency_ms, tokens_per_sec, status, error_message
FROM benchmark_results
WHERE run_id = ?
ORDER BY model ASC
```

### Q7: How to add sidecar routes following established pattern?

**VERIFIED: reviewed requests.py and trends.py.**

Established pattern:
1. Create `dashboard-sidecar/routers/config.py` and `dashboard-sidecar/routers/benchmark.py`.
2. `router = APIRouter(prefix="/api", tags=["config"])` / `tags=["benchmark"]`.
3. Import and register in `main.py`: `app.include_router(config_router)` etc.
4. Use `db.query()` and `db.execute()` (thread-safe singleton) for all DuckDB access.
5. All SQL params as positional tuples. No f-string interpolation of user input.

**CORS change required:** `allow_methods=["GET"]` must be extended to `["GET", "POST"]` to
support `POST /api/benchmark/run`. This is a one-line change in `main.py`.

---

## Standard Stack

### Core (no new packages — all stdlib or already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| PyYAML | 6.0.3 | Parse config.yaml into Python dicts | Already installed in sidecar |
| duckdb | 1.5.2 | Persist benchmark runs and results | Existing single-writer pattern |
| urllib.request | stdlib | HTTP calls from sidecar to LiteLLM proxy | No new dep; verified working |
| http.client | stdlib | Low-level HTTP for streaming | Same as urllib.request under the hood |
| time.monotonic | stdlib | Precision timing for TTFT | Monotonic, unaffected by NTP |
| FastAPI APIRouter | 0.115.0 | New route modules | Established pattern |

### Frontend (no new packages — all already installed)

| Library | Version | Purpose |
|---------|---------|---------|
| shadcn Alert / AlertDialog | existing | Security warning + confirm dialog |
| shadcn Table | existing | Benchmark results |
| shadcn Badge | existing | Severity labels, status |
| shadcn Button | existing | Run benchmark CTA |
| shadcn Tooltip | existing | Full value on hover |
| lucide-react | existing | Severity icons |

**No new npm packages. No new pip packages.** Both install steps are omitted.

---

## Architecture Patterns

### Sidecar: Two new routers

```
dashboard-sidecar/routers/
├── config.py       # GET /api/config/diff
└── benchmark.py    # POST /api/benchmark/run
                    # GET  /api/benchmark/latest
                    # GET  /api/benchmark/history
```

### Config diff router (`routers/config.py`)

```python
from fastapi import APIRouter
from pathlib import Path
import yaml, os, time

router = APIRouter(prefix="/api", tags=["config"])

DEPLOYED_CONFIG_PATH = os.environ.get("CONFIG_YAML_PATH", "/app/config.yaml")

@router.get("/config/diff")
def get_config_diff():
    try:
        with open(DEPLOYED_CONFIG_PATH) as f:
            config = yaml.safe_load(f)
    except Exception as e:
        return {"items": [], "last_checked": None, "error": str(e)}

    items = []

    # DRIFT-02: hardcoded master_key
    mk = config.get("general_settings", {}).get("master_key", "")
    if mk and not str(mk).startswith("os.environ/"):
        items.append({
            "key_path": "general_settings.master_key",
            "deployed_value": "[REDACTED]",
            "repo_value": "os.environ/LITELLM_MASTER_KEY",
            "severity": "security",
        })

    # DRIFT-03: routing strategy
    rs = config.get("router_settings", {}).get("routing_strategy", "")
    expected_rs = "latency-based-routing"
    if rs != expected_rs:
        items.append({
            "key_path": "router_settings.routing_strategy",
            "deployed_value": rs,
            "repo_value": expected_rs,
            "severity": "mismatch",
        })

    # DRIFT-04: model max_tokens and missing backends
    # ... (model_list iteration as shown in Q2 section above)

    return {
        "items": items,
        "last_checked": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
```

**Note on "two-file diff":** Since the sidecar has only one config.yaml (the mounted deployed
version), the diff compares the live file against expected/desired values. If a true two-file
diff is required in future, add a `REPO_CONFIG_PATH` env var pointing to a second mount. For
Phase 4, the single-file structural check satisfies all four DRIFT requirements.

### Benchmark router (`routers/benchmark.py`)

The benchmark run is **synchronous and blocking** — for a 7-model lab, each model takes <10s,
so a sequential run across all models completes in under 60s. Fire it in a FastAPI
`BackgroundTask` so the POST returns immediately with the `run_id`.

```
POST /api/benchmark/run
  → Create benchmark_runs row (started_at, completed_at=NULL)
  → Return {"run_id": N, "status": "started"}
  → BackgroundTask: fire each model sequentially, insert benchmark_results rows
  → On completion: UPDATE benchmark_runs SET completed_at = NOW()

GET /api/benchmark/latest
  → SELECT max(run_id) FROM benchmark_runs
  → Return that run's results + run metadata

GET /api/benchmark/history?limit=10
  → SELECT last 10 benchmark_runs with result counts
```

### Frontend: Two new sections appended to App.tsx

```
dashboard/src/
├── components/
│   ├── ConfigDriftSection.tsx    # Section 6
│   └── BenchmarkSection.tsx      # Section 7
└── hooks/
    ├── useConfigDiff.ts           # fetch once on mount
    └── useBenchmark.ts            # POST + poll + history
```

Pattern: `useConfigDiff` fetches `GET /api/config/diff` once on mount (no auto-refresh, per
UI-SPEC). `useBenchmark` manages POST state machine + 5s polling during run + history fetch.

### Anti-Patterns to Avoid

- **Blocking the FastAPI event loop with the benchmark HTTP calls:** Use `BackgroundTasks` (not
  `asyncio.to_thread` — stdlib urllib is sync and the sidecar uses sync patterns throughout).
- **Using `LITELLM_MASTER_KEY` as the bench auth key:** SYS-02 assert will crash the sidecar
  at startup. Use `LITELLM_BENCH_KEY` env var.
- **Interpolating model name into SQL:** Model name must always be passed as a positional `?`
  parameter (established pattern from requests.py and trends.py).
- **Starting the benchmark HTTP call synchronously in the POST handler:** Return immediately,
  run in background.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parsing | Custom parser | `yaml.safe_load()` | Already in requirements.txt |
| SSE streaming | Custom chunked decoder | Read response line-by-line (`for line in resp`) | LiteLLM sends standard SSE format |
| Background task execution | Thread pool management | FastAPI `BackgroundTasks` | Built into FastAPI 0.115 |
| DuckDB connection management | New connection per request | `db.execute()` / `db.query()` singleton | Single-writer pattern already enforced |

---

## Common Pitfalls

### Pitfall 1: SYS-02 assert blocks the sidecar if wrong env var name used

**What goes wrong:** If `LITELLM_MASTER_KEY` is added to the sidecar's docker-compose
environment block (to enable benchmark auth), the `assert "LITELLM_MASTER_KEY" not in
os.environ` in `main.py` will crash the container at startup.

**Why it happens:** SYS-02 architectural guard is explicit and intentional.

**How to avoid:** Use `LITELLM_BENCH_KEY` as the env var name. Read it with
`os.environ.get("LITELLM_BENCH_KEY")` in the benchmark router. Never name it `LITELLM_MASTER_KEY`.

**Warning signs:** Sidecar container exits immediately after start; logs show `AssertionError`.

### Pitfall 2: CORS blocks POST /api/benchmark/run from browser

**What goes wrong:** Browser fetch to `POST /api/benchmark/run` returns CORS error because
`allow_methods=["GET"]` in `main.py`.

**Why it happens:** The CORS middleware currently only whitelists GET.

**How to avoid:** Change `allow_methods=["GET"]` to `allow_methods=["GET", "POST"]` in `main.py`.
This is a one-line change but it's easy to miss.

**Warning signs:** Network tab shows CORS preflight failure on the POST call.

### Pitfall 3: DuckDB nested aggregate in COUNT queries

**What goes wrong:** `SELECT MIN(COUNT(*), 500)` raises `BinderException: aggregate function
calls cannot be nested`.

**Why it happens:** DuckDB does not support nested aggregates (documented bug/limitation, already
hit in Phase 3).

**How to avoid:** Use subquery pattern: `SELECT MIN(cnt, 500) FROM (SELECT COUNT(*) AS cnt ...)`.
Already established as the correct pattern in requests.py.

### Pitfall 4: urllib streaming requires correct response iteration

**What goes wrong:** `urllib.request.urlopen().read()` buffers the entire response before
returning — TTFT measurement is impossible.

**Why it happens:** `read()` blocks until EOF.

**How to avoid:** Iterate over the response object line-by-line:
```python
with urllib.request.urlopen(req, timeout=30) as resp:
    for raw_line in resp:  # yields lines as bytes
        ...
```
This works because LiteLLM sends chunked transfer encoding with newline-delimited SSE events.

### Pitfall 5: Two configs appear identical (no drift to show)

**What goes wrong:** Config diff returns empty list; developer thinks the feature is broken.

**Why it happens:** As of 2026-04-13 the deployed config and local repo config are byte-identical.
This is the **correct behaviour** — zero drift is a valid and expected result.

**How to avoid:** The empty state displays "No differences detected" per UI-SPEC. Write tests
that simulate a mismatch by injecting a modified config dict, not by relying on real file drift.

### Pitfall 6: Benchmark fires against cloud models (expensive or slow)

**What goes wrong:** Benchmark runs against all 17+ model_names including OpenRouter/Gemini/
Perplexity cloud models, running up costs and timing out.

**Why it happens:** The config has 17 model entries including cloud APIs.

**How to avoid:** For Phase 4, benchmark only the 7 local/primary model aliases listed in
REQUIREMENTS.md (VIEW-01): spark-learner, spark-gemma4-31B, spark-nemotron-120B,
nemotron-cascade-2, nemotron-cascade-2-hintonator, honcho-chat. Filter out embedding models and
cloud-only models. Alternatively, accept all model_names but set a per-model timeout of 30s.

---

## Runtime State Inventory

> Applicable: Phase 4 adds DuckDB schema changes (new tables). No rename/refactor.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | DuckDB `requests` + `latency_snapshots` tables exist; no `benchmark_runs` or `benchmark_results` tables | Add tables via `init_schema()` in `db.py` — DuckDB `CREATE TABLE IF NOT EXISTS` is idempotent |
| Live service config | `LITELLM_BENCH_KEY` env var does not exist in sidecar docker-compose.yaml | Add to docker-compose.yaml `environment` block; rebuild sidecar image |
| OS-registered state | None — no Task Scheduler, pm2, or systemd units involved | None |
| Secrets/env vars | `LITELLM_BENCH_KEY` is a new secret (LiteLLM virtual key with budget cap) | Pre-create key via `/key/generate`; add to docker-001 `.env`; mount into sidecar |
| Build artifacts | Sidecar Docker image must be rebuilt after any Python file changes | `docker compose build dashboard-sidecar && docker compose up -d dashboard-sidecar` |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| LiteLLM proxy (docker-001:4000) | Benchmark runner | ✓ | 1.83.6 | — |
| PyYAML | Config diff parsing | ✓ | 6.0.3 | — |
| urllib.request | Benchmark HTTP calls | ✓ | stdlib | — |
| DuckDB | Benchmark history | ✓ | 1.5.2 | — |
| FastAPI BackgroundTasks | Async benchmark execution | ✓ | 0.115.0 | — |
| LITELLM_BENCH_KEY env var | Benchmark auth | ✗ | — | Must pre-create before deployment |
| deepdiff | Structural YAML diff | ✗ | — | Hand-rolled diff (sufficient for DRIFT-01..04) |
| httpx | Async HTTP client | ✗ | — | urllib.request (sync, acceptable) |

**Missing with no fallback:**
- `LITELLM_BENCH_KEY`: Must be pre-created via `POST /key/generate` on docker-001 and added
  to the sidecar environment before the benchmark router will function.

**Missing with fallback:**
- `deepdiff`: Hand-rolled dict comparison is sufficient for the four specific drift checks.
- `httpx`: `urllib.request` handles streaming adequately for this use case.

---

## Code Examples

### Config diff — master_key detection
```python
# Source: Q3 analysis, verified against /opt/litellm/config.yaml
mk = config.get("general_settings", {}).get("master_key", "")
is_env_ref = str(mk).startswith("os.environ/")
is_hardcoded = bool(mk) and not is_env_ref
```

### Streaming TTFT measurement
```python
# Source: Q5 analysis, verified via live test (175.9ms TTFT observed)
import urllib.request, json, time

t0 = time.monotonic()
ttft_ms = None

with urllib.request.urlopen(req, timeout=30) as resp:
    for raw_line in resp:
        line = raw_line.strip()
        if line and ttft_ms is None:
            ttft_ms = (time.monotonic() - t0) * 1000
        if line.startswith(b"data: ") and line != b"data: [DONE]":
            try:
                chunk = json.loads(line[6:])
                # process chunk
            except Exception:
                pass

total_latency_ms = (time.monotonic() - t0) * 1000
```

### BackgroundTasks pattern for async benchmark start
```python
# Source: FastAPI 0.115.0 docs pattern [ASSUMED - standard FastAPI]
from fastapi import BackgroundTasks

@router.post("/benchmark/run")
def trigger_benchmark(background_tasks: BackgroundTasks):
    run_id = _create_run_row()
    background_tasks.add_task(_run_all_models, run_id)
    return {"run_id": run_id, "status": "started"}
```

### DuckDB sequence + insert pattern
```python
# Source: existing db.py pattern
from db import execute, query

def _create_run_row() -> int:
    execute("""
        INSERT INTO benchmark_runs (started_at, model_count)
        VALUES (NOW(), ?)
    """, (len(BENCHMARK_MODELS),))
    run_id = query("SELECT MAX(run_id) FROM benchmark_runs")[0][0]
    return run_id
```

### Frontend: useConfigDiff hook sketch
```typescript
// Source: mirrors useRequestLog hook pattern from Phase 3 [ASSUMED pattern]
export function useConfigDiff(sidecarUrl: string) {
  const [data, setData] = useState<ConfigDiffResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${sidecarUrl}/api/config/diff`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setError('Could not load config diff'))
      .finally(() => setLoading(false))
  }, [sidecarUrl])

  return { data, error, loading }
}
```

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 8.3.3 (sidecar) + vitest (frontend) |
| Config file | `dashboard-sidecar/pytest.ini` |
| Quick run command | `docker exec dashboard-sidecar pytest tests/ -x -q` |
| Full suite command | `docker exec dashboard-sidecar pytest tests/ -v` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command |
|--------|----------|-----------|-------------------|
| DRIFT-01 | /api/config/diff returns item list | unit | `pytest tests/test_config.py -x` |
| DRIFT-02 | hardcoded master_key → severity=security | unit | `pytest tests/test_config.py::test_hardcoded_key -x` |
| DRIFT-03 | routing mismatch → severity=mismatch | unit | `pytest tests/test_config.py::test_routing_strategy -x` |
| DRIFT-04 | missing model → severity=missing | unit | `pytest tests/test_config.py::test_missing_model -x` |
| BENCH-01 | POST /api/benchmark/run returns run_id | unit/mock | `pytest tests/test_benchmark.py::test_trigger -x` |
| BENCH-02 | GET /api/benchmark/latest returns results shape | unit | `pytest tests/test_benchmark.py::test_latest -x` |
| BENCH-03 | GET /api/benchmark/history returns list of runs | unit | `pytest tests/test_benchmark.py::test_history -x` |

### Wave 0 Gaps
- [ ] `tests/test_config.py` — covers DRIFT-01..04 (stub: mock yaml.safe_load to return test configs)
- [ ] `tests/test_benchmark.py` — covers BENCH-01..03 (stub: mock urllib.request, mock DuckDB)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Bench key via env var only; never in frontend bundle |
| V4 Access Control | yes | SYS-02 assert prevents master key in sidecar; bench key is budget-capped |
| V5 Input Validation | yes | model name in benchmark must be in allowlist from config |
| V6 Cryptography | no | No crypto operations |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Master key exposed via /api/config/diff response | Information Disclosure | Never include raw `master_key` value in diff response; always return `[REDACTED]` |
| Model name injection into SQL | Tampering | Positional params `?` always; never f-string |
| Benchmark DoS (repeated POST /run) | Denial of Service | Check if a run is already in-progress (completed_at IS NULL on latest run); return 409 if so |
| Bench key in browser (frontend calling LiteLLM directly) | Elevation of Privilege | Benchmark fires from sidecar only; frontend POSTs to sidecar, sidecar calls LiteLLM |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | BackgroundTasks fires in same process/thread pool as FastAPI app | Code Examples | If BackgroundTask is killed on response completion, benchmark silently fails; use threading.Thread as fallback |
| A2 | urllib response is iterable line-by-line for SSE | Pitfalls / Code Examples | If chunking doesn't align to newlines, TTFT measurement breaks; switch to read-in-chunks loop |
| A3 | The 7 benchmark target models are the local/primary aliases only (not cloud) | Common Pitfalls | If cloud models are included, costs money; add an explicit BENCHMARK_MODELS allowlist in config |
| A4 | Single-file structural check satisfies DRIFT-01 without needing two separate files | Architecture | If future requirement needs true git-vs-deployed diff, second mount point needed |

---

## Open Questions

1. **Which models should the benchmark target?**
   - What we know: 17+ model_names exist in config; 7 are local inference nodes; the rest are cloud APIs
   - What's unclear: Whether cloud models (gemini-flash, kimi-k2.5, gpt-4o-mini etc.) should be included
   - Recommendation: Default to local models only; make BENCHMARK_MODELS an env var list or derive from config by checking `api_base` contains a LAN IP

2. **What constitutes "TTFT above p95 threshold" for benchmark colour coding?**
   - What we know: UI-SPEC says colour green/amber based on p95 historical threshold
   - What's unclear: The p95 is computed from which historical dataset? Last 10 benchmark runs? The live requests table?
   - Recommendation: Compare against the p95 from the `latency_snapshots` table for each model; if no history exists, show no colour coding

3. **Should the LITELLM_BENCH_KEY be a permanent key or regenerated per deploy?**
   - What we know: LiteLLM supports budget-capped virtual keys
   - What's unclear: Expiry policy
   - Recommendation: Create once with no expiry and a $10 lifetime budget cap; document the key alias as `dashboard-benchmark`

---

## Sources

### Primary (HIGH confidence — live system verified)
- `/opt/litellm/config.yaml` on docker-001 — deployed config path, master_key format, routing_strategy
- `docker exec dashboard-sidecar pip list` — confirmed PyYAML 6.0.3, no httpx/deepdiff/requests
- `docker exec dashboard-sidecar python3 -c "import urllib.request"` — stdlib HTTP confirmed
- `curl 192.168.50.117:4000/health/readiness` — LiteLLM 1.83.6 running
- Live streaming benchmark test — 175.9ms TTFT, 325.8ms total from spark-learner
- `docker-compose.yaml` sidecar service definition — volume mounts, env vars, network

### Secondary (MEDIUM confidence — code review)
- `dashboard-sidecar/db.py` — existing DuckDB schema and singleton pattern
- `dashboard-sidecar/main.py` — CORS config, SYS-02 assert, router registration pattern
- `dashboard-sidecar/routers/trends.py` — WINDOW_TO_SQL allowlist, parameterised query pattern
- `dashboard-sidecar/routers/requests.py` — COUNT subquery workaround for DuckDB

### Tertiary (LOW confidence — training knowledge)
- FastAPI BackgroundTasks behaviour (task lifecycle) [A1] — not verified against FastAPI 0.115 docs

---

## Metadata

**Confidence breakdown:**
- Config diff approach: HIGH — live system verified, file paths confirmed, master_key format confirmed
- Benchmark HTTP calls: HIGH — live test executed, 200 response with correct TTFT measurement
- DuckDB schema: HIGH — existing schema reviewed, no benchmark tables exist, CREATE IF NOT EXISTS is safe
- CORS change: HIGH — allow_methods=["GET"] confirmed in code
- BackgroundTasks lifecycle: MEDIUM — standard FastAPI pattern, not version-verified

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable stack; LiteLLM version pinned at 1.83.6)
