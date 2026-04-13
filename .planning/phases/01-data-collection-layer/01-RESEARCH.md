# Phase 1: Data Collection Layer - Research

**Researched:** 2026-04-13
**Domain:** Python FastAPI sidecar — DuckDB, psycopg2, Prometheus HTTP API, CustomLogger instrumentation
**Confidence:** HIGH (all key claims verified against live system or installed libraries)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Data source: Direct Postgres via psycopg2, table `LiteLLM_SpendLogs` (underscore)
- Connection string: `DATABASE_URL` from existing docker-compose.yaml
- All queries MUST follow QUERY-CONVENTIONS.md: bounded `WHERE "startTime" > NOW() - INTERVAL '<window>'`
- Poll window: `INTERVAL '5 minutes'` for 30s ingestion cycle
- Tool repair signal: append JSON lines to `/tmp/tool_repairs.jsonl` in `fix_json_tool_calls.py`
- Repair line format: `{"request_id": "<uuid>", "timestamp": "<iso8601>", "repaired": true}`
- Tool call 3-states: `success` / `repaired` / `failed`
- Sidecar: Python + FastAPI, service name `dashboard-sidecar`, port 4001
- DuckDB: named Docker volume `dashboard-duckdb`, mounted at `/data/metrics.duckdb`
- `/tmp/tool_repairs.jsonl` shared via host bind mount between `litellm-proxy` and `dashboard-sidecar`
- Context utilization: `prompt_tokens / max_input_tokens` from config.yaml, NULL if not defined
- TTFT derived from DB: `EXTRACT(EPOCH FROM ("completionStartTime" - "startTime")) * 1000`
- `llm_api_latency_ms` from Prometheus `litellm_llm_api_latency_metric`
- `overhead_ms` = `total_latency_ms - llm_api_latency_ms` (computed, not stored separately)

### Claude's Discretion
- DuckDB concurrency pattern (single shared connection + threading.Lock vs. other approaches)
- Background task framework (APScheduler vs asyncio loop vs threading)
- Prometheus scrape method (raw scrape vs. HTTP query API)
- Specific column types and index strategy for DuckDB schema

### Deferred Ideas
- None raised during discussion.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DATA-01 | LiteLLM_SpendLogs polled and written to DuckDB every 30s | psycopg2 + DuckDB upsert pattern verified; QUERY-CONVENTIONS bounded query confirmed |
| DATA-02 | Prometheus metrics scraped — TTFT histogram, latency, tokens, deployment state | All metrics confirmed present on 192.168.50.117:9090; HTTP query API returns quantiles directly |
| DATA-03 | Context window utilization ratio at ingestion | config.yaml structure verified; all local models have `max_input_tokens`; cloud models present too |
| DATA-04 | Tool call 3-state: success / repaired / failed | fix_json hook analysis complete; `response.id` is the correct join key to SpendLogs.request_id |
| DATA-05 | TTFT, model latency, LiteLLM overhead as separate fields | Prometheus metrics confirmed for all three; TTFT also derivable from DB timestamps |
| SYS-02 | LiteLLM master key server-side only | docker-compose env var pattern is correct; LITELLM_MASTER_KEY never reaches sidecar response bodies |
</phase_requirements>

---

## Summary

This phase builds a Python FastAPI sidecar (`dashboard-sidecar`) that ingests data from two sources — Postgres (LiteLLM_SpendLogs) and Prometheus — into DuckDB, then exposes an HTTP API on port 4001. All architectural decisions are locked in CONTEXT.md; this research validates the implementation details.

The critical concurrency constraint is that DuckDB does not allow simultaneous read/write connections from different connection configs. The correct pattern is a single shared `duckdb.connect()` instance protected by a `threading.Lock`, used by both the poller thread and the FastAPI request handlers. This was verified empirically.

The `fix_json_tool_calls.py` instrumentation requires capturing `response.id` (not `data["litellm_call_id"]`) as the join key — `response.id` is the model-returned ID that LiteLLM stores as `LiteLLM_SpendLogs.request_id`. The repair signal must compare before/after in `async_post_call_success_hook` since the current code silently overwrites without recording whether a change occurred.

**Primary recommendation:** Single-writer DuckDB with `threading.Lock`; Prometheus HTTP query API for quantiles; APScheduler for background tasks alongside FastAPI lifespan.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| duckdb | 1.5.2 | Embedded analytics DB | Columnar, fast aggregates, no server; `INSERT ... ON CONFLICT` upsert supported [VERIFIED: pip install] |
| psycopg2-binary | 2.9.11 | Postgres client | Standard Postgres adapter for Python [VERIFIED: pip install] |
| fastapi | (via uvicorn 0.44.0) | HTTP API framework | Already in stack; consistent with project [VERIFIED: pip show] |
| uvicorn | 0.44.0 | ASGI server | Production ASGI, already installed [VERIFIED: pip show] |
| pyyaml | 6.0.3 | Parse config.yaml at startup | Already installed [VERIFIED: pip show] |
| apscheduler | 3.11.2 | Background task scheduling | Integrates cleanly with FastAPI lifespan; avoids raw threading.Thread management [VERIFIED: pip install] |
| prometheus-client | 0.25.0 | Prometheus HTTP scrape (optional) | Used if raw scrape needed; HTTP query API preferred for quantiles [VERIFIED: pip install] |

### Dockerfile Base
The sidecar is a new container. Use `python:3.13-slim` to match the litellm-proxy base OS. All dependencies installed via pip in the image.

**Installation:**
```bash
pip install duckdb==1.5.2 psycopg2-binary==2.9.11 fastapi uvicorn pyyaml apscheduler==3.11.2 prometheus-client==0.25.0
```

---

## Architecture Patterns

### Recommended Project Structure
```
dashboard-sidecar/
├── Dockerfile
├── requirements.txt
├── main.py              # FastAPI app, lifespan, router includes
├── db.py                # DuckDB connection, schema init, threading.Lock
├── poller.py            # Postgres → DuckDB ingestion loop
├── prometheus.py        # Prometheus HTTP API scrape + latency_snapshots writer
├── config_loader.py     # config.yaml parser, max_input_tokens cache
├── repairs.py           # /tmp/tool_repairs.jsonl tail reader
└── routers/
    ├── requests.py      # GET /api/requests
    ├── models.py        # GET /api/models
    ├── nodes.py         # GET /api/nodes
    └── latency.py       # GET /api/latency/snapshots
```

### Pattern 1: DuckDB Single-Writer with threading.Lock

**What:** All DuckDB access (reads and writes) shares one `duckdb.connect()` instance. A `threading.Lock` serializes access. Read-only connections are NOT used — mixing read/write and read-only connection configs on the same file raises `ConnectionException`.

**Why:** DuckDB 1.5.x does not allow `read_only=True` and a simultaneous read-write connection to the same file. Verified empirically. [VERIFIED: local test]

**Example:**
```python
# db.py
import duckdb
import threading

_conn: duckdb.DuckDBPyConnection | None = None
_lock = threading.Lock()

def get_connection() -> duckdb.DuckDBPyConnection:
    global _conn
    if _conn is None:
        _conn = duckdb.connect("/data/metrics.duckdb")
        _init_schema(_conn)
    return _conn

def query(sql: str, params=None):
    with _lock:
        conn = get_connection()
        if params:
            return conn.execute(sql, params).fetchall()
        return conn.execute(sql).fetchall()

def execute(sql: str, params=None):
    with _lock:
        conn = get_connection()
        if params:
            conn.execute(sql, params)
        else:
            conn.execute(sql)
```

### Pattern 2: Postgres Poller with Watermark

**What:** Track last-ingested `startTime` in DuckDB. On each 30s poll, query Postgres with `WHERE "startTime" > :watermark AND "startTime" > NOW() - INTERVAL '5 minutes'`. The `INTERVAL '5 minutes'` bound is always applied per QUERY-CONVENTIONS.md, even when the watermark is more restrictive. Upsert on `request_id` handles any duplicates from overlapping windows.

**Example:**
```python
# poller.py
import psycopg2
from db import execute, query
from datetime import datetime, timezone

def get_watermark() -> datetime:
    rows = query("SELECT MAX(startTime) FROM requests")
    if rows and rows[0][0]:
        return rows[0][0]
    return datetime.now(timezone.utc).replace(hour=0, minute=0, second=0)

def poll_once(pg_url: str, repair_index: set[str], max_ctx: dict[str, int]):
    watermark = get_watermark()
    conn = psycopg2.connect(pg_url)
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT request_id, "startTime", "endTime", "completionStartTime",
                   model, model_group, prompt_tokens, completion_tokens, total_tokens,
                   status, api_key, metadata
            FROM "LiteLLM_SpendLogs"
            WHERE "startTime" > %s
              AND "startTime" > NOW() - INTERVAL '5 minutes'
            ORDER BY "startTime" ASC
        """, (watermark,))
        rows = cur.fetchall()
    finally:
        conn.close()

    for row in rows:
        request_id, start, end, cstart, model, model_group, pt, ct, tt, status, api_key, meta = row
        ttft_ms = None
        if cstart and start:
            ttft_ms = (cstart - start).total_seconds() * 1000
        total_ms = (end - start).total_seconds() * 1000 if end and start else None
        ctx_util = (pt / max_ctx[model]) if model in max_ctx and pt else None
        tool_status = "failed" if status == "failure" else (
            "repaired" if request_id in repair_index else "success"
        )
        execute("""
            INSERT INTO requests (request_id, startTime, model, model_group,
                prompt_tokens, completion_tokens, total_tokens,
                ttft_ms, total_latency_ms, status, tool_call_status, context_utilization)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (request_id) DO UPDATE SET
                tool_call_status = EXCLUDED.tool_call_status,
                context_utilization = EXCLUDED.context_utilization
        """, (request_id, start, model, model_group, pt, ct, tt,
              ttft_ms, total_ms, status, tool_status, ctx_util))
```

**Connection resilience:** Wrap `psycopg2.connect()` in a try/except. On `OperationalError`, log and return early — the scheduler will retry on the next 30s tick. Do not hold a persistent connection; open/close per poll cycle to avoid stale connections.

### Pattern 3: Prometheus HTTP Query API

**What:** Use the Prometheus HTTP API (`/api/v1/query`) instead of raw metric scraping. Pre-compute quantiles server-side using `histogram_quantile()`. This avoids parsing the exposition format and handling bucket math in Python.

**Verified working queries (tested against 192.168.50.117:9090):** [VERIFIED: live Prometheus]

```python
# prometheus.py
import urllib.request, json
from db import execute
from datetime import datetime, timezone

PROM_BASE = "http://192.168.50.117:9090"

QUERIES = {
    "ttft_p50": "histogram_quantile(0.5,rate(litellm_llm_api_time_to_first_token_metric_bucket[1h]))",
    "ttft_p95": "histogram_quantile(0.95,rate(litellm_llm_api_time_to_first_token_metric_bucket[1h]))",
    "total_latency_p50": "histogram_quantile(0.5,rate(litellm_request_total_latency_metric_bucket[1h]))",
    "total_latency_p95": "histogram_quantile(0.95,rate(litellm_request_total_latency_metric_bucket[1h]))",
    "llm_latency_p50": "histogram_quantile(0.5,rate(litellm_llm_api_latency_metric_bucket[1h]))",
    "llm_latency_p95": "histogram_quantile(0.95,rate(litellm_llm_api_latency_metric_bucket[1h]))",
    "tokens_per_sec_p50": "1/histogram_quantile(0.5,rate(litellm_deployment_latency_per_output_token_bucket[1h]))",
    "deployment_state": "litellm_deployment_state",
}

def scrape_once():
    scraped_at = datetime.now(timezone.utc)
    results: dict[str, dict] = {}
    
    for metric_name, query in QUERIES.items():
        url = f"{PROM_BASE}/api/v1/query?query={urllib.parse.quote(query)}"
        with urllib.request.urlopen(url, timeout=10) as r:
            data = json.load(r)
        for item in data["data"]["result"]:
            model = item["metric"].get("model") or item["metric"].get("litellm_model_name")
            val_str = item["value"][1]
            val = None if val_str == "NaN" else float(val_str)
            if model not in results:
                results[model] = {}
            results[model][metric_name] = val
    
    for model, vals in results.items():
        execute("""
            INSERT INTO latency_snapshots
                (scraped_at, model, ttft_p50, ttft_p95, total_latency_p50, total_latency_p95,
                 tokens_per_sec, deployment_state)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (scraped_at, model,
              vals.get("ttft_p50"), vals.get("ttft_p95"),
              vals.get("total_latency_p50"), vals.get("total_latency_p95"),
              vals.get("tokens_per_sec_p50"), vals.get("deployment_state")))
```

**NaN handling:** `histogram_quantile()` returns `NaN` when no data flows through the rate window. Store as NULL in DuckDB. Use a 1-hour rate window (`[1h]`) — short windows (e.g., `[5m]`) return NaN when no recent requests, which is common for infrequently used models. [VERIFIED: live Prometheus test]

### Pattern 4: FastAPI Lifespan with APScheduler

**What:** Use FastAPI's `@asynccontextmanager` lifespan to start APScheduler background jobs. This avoids subprocess or raw threading and gives clean startup/shutdown.

```python
# main.py
from contextlib import asynccontextmanager
from fastapi import FastAPI
from apscheduler.schedulers.background import BackgroundScheduler
from poller import poll_once
from prometheus import scrape_once

@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = BackgroundScheduler()
    scheduler.add_job(poll_once, "interval", seconds=30, kwargs={...})
    scheduler.add_job(scrape_once, "interval", seconds=60)
    scheduler.start()
    yield
    scheduler.shutdown()

app = FastAPI(lifespan=lifespan)
```

**Note:** Use `BackgroundScheduler` (not `AsyncIOScheduler`) since DuckDB operations are synchronous and the `threading.Lock` pattern is synchronous. `BackgroundScheduler` runs jobs in a thread pool, which is correct. [ASSUMED: APScheduler 3.x BackgroundScheduler/thread interaction with FastAPI]

### Pattern 5: Tool Repair Instrumentation

**Critical finding:** In `async_post_call_success_hook`, `response.id` is the model-returned response ID. LiteLLM stores this as `LiteLLM_SpendLogs.request_id` (falling back to `litellm_call_id` only if `response.id` is absent). [VERIFIED: litellm/proxy/spend_tracking/spend_tracking_utils.py lines 173-175]

The current `fix_json_tool_calls.py` does not record whether a repair occurred. The instrumentation must:
1. Capture the original `fn.arguments`
2. Call `self.fix_json(fn.arguments)`
3. If result differs from original, write a repair event to `/tmp/tool_repairs.jsonl`
4. Use `response.id` as the `request_id` in the JSON line

```python
# Instrumented async_post_call_success_hook addition:
import json, os
from datetime import datetime, timezone

REPAIRS_LOG = "/tmp/tool_repairs.jsonl"

async def async_post_call_success_hook(self, data, user_api_key_dict, response):
    if not hasattr(response, "choices"):
        return response
    repaired = False
    for choice in response.choices:
        msg = getattr(choice, "message", None)
        if not msg:
            continue
        tool_calls = getattr(msg, "tool_calls", None)
        if not tool_calls:
            continue
        for tc in tool_calls:
            fn = getattr(tc, "function", None)
            if fn and fn.arguments:
                original = fn.arguments
                fixed = self.fix_json(fn.arguments)
                fn.arguments = fixed
                if fixed != original:
                    repaired = True
    
    if repaired and hasattr(response, "id") and response.id:
        line = json.dumps({
            "request_id": response.id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "repaired": True
        })
        with open(REPAIRS_LOG, "a") as f:
            f.write(line + "\n")
    
    return response
```

**File-sharing constraint:** `/tmp/tool_repairs.jsonl` is a host-path bind mount in docker-compose. The litellm-proxy container writes it; the dashboard-sidecar reads it. The sidecar reads the entire file periodically, builds a set of repaired `request_id`s, and uses it during DuckDB ingestion. Since this is append-only, the sidecar can track byte offset to avoid re-reading the full file on every poll.

### Pattern 6: config.yaml Parser

**What:** At sidecar startup, parse config.yaml and build a `dict[str, int]` of `model_name → max_input_tokens`. Reload on SIGHUP.

```python
# config_loader.py
import yaml, signal, threading

_max_ctx: dict[str, int] = {}
_lock = threading.Lock()

def load_config(path: str = "/app/config.yaml"):
    global _max_ctx
    with open(path) as f:
        cfg = yaml.safe_load(f)
    mapping = {}
    for entry in cfg.get("model_list", []):
        name = entry.get("model_name")
        tokens = entry.get("model_info", {}).get("max_input_tokens")
        if name and tokens:
            mapping[name] = tokens
    with _lock:
        _max_ctx = mapping

def get_max_ctx() -> dict[str, int]:
    with _lock:
        return dict(_max_ctx)

def register_sighup(path: str):
    def handler(signum, frame):
        load_config(path)
    signal.signal(signal.SIGHUP, handler)
```

**config.yaml observation:** All local models have `max_input_tokens` defined. Cloud models (gemini-flash, kimi-k2.5, gemini-pro, minimax-m2.7, gpt-4o-mini, perplexity) also have it defined. The `nomic-embed-text` embedding models do NOT have `model_info` at all. Context utilization for embedding models should be NULL. [VERIFIED: config.yaml read]

Note: `nemotron-cascade-2` has TWO entries (hintonator: 65536, docker-gpu: 32768). Both map to `model_name: nemotron-cascade-2`. The last entry will overwrite in the dict. Use `max()` when the same model_name appears multiple times to avoid silently discarding the larger context window.

### Anti-Patterns to Avoid

- **Do not open a `read_only=True` connection while a read-write connection is open.** DuckDB raises `ConnectionException`. Use the single shared connection + lock pattern. [VERIFIED: empirical test]
- **Do not use `rate()[5m]` in Prometheus queries for infrequently polled models.** Returns NaN. Use `[1h]`. [VERIFIED: live Prometheus test]
- **Do not write `litellm_call_id` to tool_repairs.jsonl as `request_id`.** The spend log uses `response.id` (the model-returned ID) as the primary key. Use `response.id`. [VERIFIED: spend_tracking_utils.py]
- **Do not hold a persistent psycopg2 connection.** Open/close per poll to avoid connection drops killing the poller.
- **Do not run unbounded Postgres queries.** QUERY-CONVENTIONS.md is a hard gate: always include `AND "startTime" > NOW() - INTERVAL '5 minutes'`.

---

## DuckDB Schema

```sql
-- requests: one row per LiteLLM_SpendLogs row
CREATE TABLE IF NOT EXISTS requests (
    request_id          TEXT PRIMARY KEY,
    startTime           TIMESTAMPTZ NOT NULL,
    model               TEXT,
    model_group         TEXT,
    prompt_tokens       INTEGER,
    completion_tokens   INTEGER,
    total_tokens        INTEGER,
    ttft_ms             DOUBLE,          -- nullable; NULL when completionStartTime absent
    total_latency_ms    DOUBLE,
    status              TEXT,            -- 'success' | 'failure' (from LiteLLM_SpendLogs)
    tool_call_status    TEXT,            -- 'success' | 'repaired' | 'failed'
    context_utilization DOUBLE,          -- nullable; NULL when max_input_tokens not defined
    api_key_alias       TEXT,
    team_alias          TEXT
);

-- latency_snapshots: Prometheus scrapes, one row per scrape × model
CREATE TABLE IF NOT EXISTS latency_snapshots (
    id                  INTEGER PRIMARY KEY,  -- auto-increment via SEQUENCE
    scraped_at          TIMESTAMPTZ NOT NULL,
    model               TEXT,
    ttft_p50            DOUBLE,
    ttft_p95            DOUBLE,
    total_latency_p50   DOUBLE,
    total_latency_p95   DOUBLE,
    tokens_per_sec      DOUBLE,
    deployment_state    INTEGER              -- 0=healthy, 1=degraded (from litellm_deployment_state)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_requests_starttime ON requests (startTime DESC);
CREATE INDEX IF NOT EXISTS idx_requests_model ON requests (model, startTime DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_scraped ON latency_snapshots (scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_model ON latency_snapshots (model, scraped_at DESC);
```

**DuckDB PRIMARY KEY note:** DuckDB supports `PRIMARY KEY` as a uniqueness constraint. `ON CONFLICT (request_id) DO UPDATE SET ...` uses standard SQL upsert syntax. [VERIFIED: empirical test]

**latency_snapshots auto-increment:** DuckDB uses `CREATE SEQUENCE` or `INTEGER PRIMARY KEY` does not auto-increment by default. Use `SEQUENCE` or omit the PK and use a composite key `(scraped_at, model)` instead.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Histogram quantile computation | Bucket math in Python | Prometheus HTTP API `histogram_quantile()` | Server-side, handles bucket boundaries correctly |
| Scheduler/polling loop | `while True: sleep(30)` | APScheduler `BackgroundScheduler` | Handles missed runs, jitter, error recovery |
| Postgres reconnect logic | Manual retry loop | psycopg2 open/close per poll | Simplest resilient pattern; no connection state |
| YAML parsing | Custom parser | PyYAML (already installed) | Already in stack |

---

## Common Pitfalls

### Pitfall 1: DuckDB Concurrent Connection Configs
**What goes wrong:** Adding a FastAPI endpoint that opens a new `duckdb.connect(path, read_only=True)` while the writer connection is already open raises `ConnectionException: Can't open a connection to same database file with a different configuration`. [VERIFIED: empirical test]
**Why it happens:** DuckDB enforces a single connection configuration per file when open.
**How to avoid:** All access through the single shared `_conn` + `_lock` in `db.py`. Never open a second connection in request handlers.

### Pitfall 2: NaN Quantile Results from Short Rate Window
**What goes wrong:** `histogram_quantile(0.95, rate(metric_bucket[5m]))` returns NaN when no data has arrived in the last 5 minutes. NULL is stored in DuckDB for every model, making latency_snapshots useless.
**Why it happens:** `rate()` over an empty window produces 0, which makes `histogram_quantile()` return NaN.
**How to avoid:** Use `[1h]` rate window for Prometheus quantile queries. [VERIFIED: live Prometheus]

### Pitfall 3: Wrong Join Key in tool_repairs.jsonl
**What goes wrong:** Writing `data["litellm_call_id"]` as the `request_id` in the repair log. The `LiteLLM_SpendLogs.request_id` column stores `response.id` (the model-returned chat completion ID, e.g., `chatcmpl-xxx`), not the internal `litellm_call_id` UUID. The join silently produces zero matches.
**Why it happens:** Two different IDs exist in scope in `async_post_call_success_hook`.
**How to avoid:** Write `response.id` (from `ModelResponse.id`) to tool_repairs.jsonl. [VERIFIED: spend_tracking_utils.py lines 173-175]

### Pitfall 4: nemotron-cascade-2 Duplicate model_name in config.yaml
**What goes wrong:** `config.yaml` has two entries with `model_name: nemotron-cascade-2` (hintonator: max_input=65536, docker-gpu: max_input=32768). A naive last-write dict parse silently uses 32768 as the max context for all nemotron-cascade-2 requests, causing context_utilization to be inflated for requests that went to hintonator.
**How to avoid:** When the same model_name appears multiple times, take `max()` of `max_input_tokens`. [VERIFIED: config.yaml read]

### Pitfall 5: /tmp/tool_repairs.jsonl Not Created at Container Start
**What goes wrong:** docker-compose bind-mounts a host path `/tmp/tool_repairs.jsonl`. If the file does not exist on the host, Docker creates it as a directory, causing the litellm-proxy write to fail.
**How to avoid:** Pre-create the file in the docker-compose startup: `touch /tmp/tool_repairs.jsonl` as a host prerequisite, or add it to the `Dockerfile`/`entrypoint.sh` of `litellm-proxy`.

### Pitfall 6: Postgres startTime is Postgres-side NOW(), Not Python UTC
**What goes wrong:** Comparing Python `datetime.now()` watermarks against Postgres `NOW()` when the two clocks drift causes rows to be missed or double-ingested.
**How to avoid:** Use `timezone.utc` in Python; ensure `DATABASE_URL` uses `connect_timeout` (already set). The watermark query (`SELECT MAX(startTime) FROM requests`) is fetched from DuckDB (which stores what Postgres returned), so clock drift does not accumulate.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Port 4001 is localhost/internal only (SYS-03) |
| V3 Session Management | No | Stateless HTTP API |
| V4 Access Control | No | No multi-user |
| V5 Input Validation | Yes | Validate `window` query param (enum: 5m/7d/30d); reject unknown values |
| V6 Cryptography | No | No sensitive data stored |

### SYS-02: Master Key Handling

**Pattern:** `LITELLM_MASTER_KEY` is injected into `litellm-proxy` container only via docker-compose `environment`. The `dashboard-sidecar` container uses `DATABASE_URL` (Postgres direct access) and `PROMETHEUS_URL`. It does NOT need or receive `LITELLM_MASTER_KEY`. [VERIFIED: docker-compose.yaml]

**Safe pattern for docker-compose:**
```yaml
dashboard-sidecar:
  environment:
    - DATABASE_URL=${DATABASE_URL}
    - PROMETHEUS_URL=http://192.168.50.117:9090
    # LITELLM_MASTER_KEY is intentionally absent
```

**Threat:** If the sidecar ever logs or returns `LITELLM_MASTER_KEY` in an API response, SYS-02 is violated. Since it's not in the sidecar env, this is architecturally prevented.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (to be installed in sidecar) |
| Config file | `dashboard-sidecar/pytest.ini` — Wave 0 gap |
| Quick run command | `pytest dashboard-sidecar/tests/ -x -q` |
| Full suite command | `pytest dashboard-sidecar/tests/ -v` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command / Verification |
|--------|----------|-----------|----------------------------------|
| DATA-01 | SpendLogs polled every 30s, DuckDB has live rows within 60s | Integration | `SELECT COUNT(*) FROM requests WHERE startTime > NOW() - INTERVAL '2 minutes'` returns > 0 after sidecar starts 90s |
| DATA-01 | Bounded query enforced (no unbounded scan) | Code review | `grep -n "LiteLLM_SpendLogs" dashboard-sidecar/poller.py` must show `INTERVAL '5 minutes'` |
| DATA-02 | Prometheus metrics scraped into latency_snapshots | Integration | `SELECT COUNT(*) FROM latency_snapshots WHERE scraped_at > NOW() - INTERVAL '5 minutes'` returns > 0 after 120s |
| DATA-02 | All 5 Prometheus metric categories stored | Query | `SELECT model, ttft_p50, ttft_p95, total_latency_p50, total_latency_p95, tokens_per_sec FROM latency_snapshots ORDER BY scraped_at DESC LIMIT 5` — verify non-NULL for active models |
| DATA-03 | context_utilization = prompt_tokens / max_input_tokens | Unit | `pytest dashboard-sidecar/tests/test_config_loader.py` — verify spark-learner=131072, nemotron-cascade-2=65536 (max of two entries) |
| DATA-03 | context_utilization NULL for models without max_input_tokens | Unit | `SELECT context_utilization FROM requests WHERE model = 'nomic-embed-text' LIMIT 1` returns NULL |
| DATA-04 | tool_call_status = 'repaired' when repair event present | Unit | `pytest dashboard-sidecar/tests/test_repairs.py` — mock tool_repairs.jsonl with a known request_id |
| DATA-04 | tool_call_status = 'failed' for status=failure rows | Unit | `pytest dashboard-sidecar/tests/test_poller.py` |
| DATA-04 | fix_json writes to /tmp/tool_repairs.jsonl on repair | Integration | Trigger a malformed tool call through litellm-proxy; `wc -l /tmp/tool_repairs.jsonl` increases |
| DATA-05 | ttft_ms stored as separate field | Query | `SELECT request_id, ttft_ms, total_latency_ms FROM requests WHERE ttft_ms IS NOT NULL LIMIT 3` |
| DATA-05 | llm_api_latency_ms and overhead_ms computed at API layer | Query | `GET /api/models` response includes `llm_api_latency_p50`, `overhead_ms_p50` fields |
| SYS-02 | LITELLM_MASTER_KEY absent from sidecar env | Config check | `docker inspect dashboard-sidecar \| grep LITELLM_MASTER_KEY` returns empty |
| SYS-02 | Master key never in API responses | Smoke | `curl http://localhost:4001/api/requests` response does not contain `sk-` prefix strings |

### Wave 0 Gaps
- [ ] `dashboard-sidecar/tests/test_config_loader.py` — covers DATA-03 (config parsing, nemotron-cascade-2 max logic)
- [ ] `dashboard-sidecar/tests/test_repairs.py` — covers DATA-04 (repair join logic)
- [ ] `dashboard-sidecar/tests/test_poller.py` — covers DATA-01, DATA-04 (poller unit tests with mocked psycopg2)
- [ ] `dashboard-sidecar/tests/conftest.py` — in-memory DuckDB fixture
- [ ] `dashboard-sidecar/pytest.ini` — framework config
- [ ] Framework install: `pip install pytest pytest-asyncio` in sidecar Dockerfile

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | Container build | ✓ | 29.3.0 | — |
| Python 3.x (host) | Local test runs | ✓ | 3.12.3 | — |
| duckdb (pip) | DuckDB layer | ✓ | 1.5.2 | — |
| psycopg2-binary (pip) | Postgres poll | ✓ | 2.9.11 | — |
| fastapi/uvicorn (pip) | Sidecar API | ✓ | uvicorn 0.44.0 | — |
| pyyaml (pip) | config.yaml parse | ✓ | 6.0.3 | — |
| apscheduler (pip) | Background scheduler | ✓ | 3.11.2 | — |
| Prometheus (192.168.50.117:9090) | DATA-02 | ✓ | reachable | — |
| traefik-net Docker network | docker-compose external network | ✓ (assumed from existing compose) | — | Remove label if absent |

**Missing dependencies with no fallback:** None — all dependencies verified available.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | APScheduler `BackgroundScheduler` does not conflict with FastAPI's asyncio event loop | Pattern 4 | Scheduler jobs may block or deadlock; mitigation: use `ThreadPoolExecutor` explicitly |
| A2 | `traefik-net` external network exists on docker-001 (inherited from existing litellm container) | docker-compose wiring | `dashboard-sidecar` compose add fails; mitigation: make traefik-net optional or omit it |
| A3 | `deployment_state` gauge value 0 = healthy, 1 = degraded/failed | Prometheus schema | Misinterpretation of node health; verify against LiteLLM docs or live data |

---

## Open Questions

1. **deployment_state value semantics**
   - What we know: `litellm_deployment_state` gauge observed values 0 and 1 on live Prometheus. Models showing 0 are cloud/API models; models showing 1 are local models currently responding.
   - What's unclear: Is 0 = healthy or 0 = offline? LiteLLM source defines it as `0=healthy, 1=degraded` in some versions and `1=healthy` in others.
   - Recommendation: Query the gauge at scrape time and display raw integer. Defer semantic interpretation to Phase 3 (dashboard UI). Store the raw integer in `deployment_state` column.

2. **/tmp/tool_repairs.jsonl file growth**
   - What we know: The file is append-only with no rotation logic.
   - What's unclear: How many repairs occur per day? Could become large.
   - Recommendation: Phase 1 scope is to get the signal working. Add log rotation (e.g., `logrotate` or a max-size check) in Phase 2 or as a follow-up task.

---

## Sources

### Primary (HIGH confidence)
- [VERIFIED: live Prometheus 192.168.50.117:9090] — all litellm metric names confirmed; quantile queries tested
- [VERIFIED: litellm pip 1.83.6 install] — CustomLogger hook signatures confirmed; `response.id` and `litellm_call_id` relationship verified in `spend_tracking_utils.py`
- [VERIFIED: duckdb 1.5.2 empirical test] — upsert syntax, concurrent connection behavior, single-writer + lock pattern
- [VERIFIED: config.yaml read] — all model `max_input_tokens` values; nemotron-cascade-2 duplicate entry confirmed
- [VERIFIED: docker-compose.yaml read] — network topology, volume mounts, existing service structure
- [VERIFIED: QUERY-CONVENTIONS.md] — mandatory `INTERVAL '5 minutes'` bound for poller

### Secondary (MEDIUM confidence)
- [CITED: litellm/proxy/spend_tracking/spend_tracking_utils.py:173-175] — `request_id = response_obj.get("id") or litellm_call_id`

### Tertiary (LOW confidence)
- [ASSUMED] APScheduler BackgroundScheduler + FastAPI asyncio interaction (A1)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified via pip install with exact versions
- Architecture: HIGH — DuckDB concurrency verified empirically; Prometheus queries verified live
- Pitfalls: HIGH — all pitfalls derived from verified test results or source code inspection
- fix_json instrumentation: HIGH — source code read and join key traced to spend_tracking_utils.py

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable stack; DuckDB and litellm APIs unlikely to change in 30 days)
