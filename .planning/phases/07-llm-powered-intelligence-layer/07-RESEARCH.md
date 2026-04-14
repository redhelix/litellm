# Phase 07: LLM-Powered Intelligence Layer — Research

**Researched:** 2026-04-14
**Domain:** LLM-as-analyst, HuggingFace Hub search, FastAPI background scheduler, DuckDB caching
**Confidence:** HIGH (all major claims verified against codebase or live tools)

---

## Summary

Phase 07 adds an autonomous intelligence layer to the sidecar: a scheduled background job runs every 12 hours, queries DuckDB for recent metrics, calls the local LiteLLM proxy via plain `urllib` (already used throughout the codebase), assembles a structured prompt, and caches the LLM response in a new DuckDB table. A second APScheduler job queries HuggingFace Hub via the `huggingface_hub` Python library (must be added to `requirements.txt`) to surface new large-instruct models matching the lab profile. Two new FastAPI endpoints — `GET /api/intelligence` (cached results) and `POST /api/intelligence/query` (on-demand Q&A) — serve the frontend. On the frontend, App.tsx gains an Intelligence tab backed by a simple `useIntelligence` hook that polls the GET endpoint.

The sidecar already has all structural patterns needed: APScheduler jobs with `max_instances=1`, an in-memory dict cache protected by a threading lock (see `model_health.py`), `urllib.request` for HTTP calls (no `httpx` or `requests` available or needed), DuckDB `execute`/`query` wrappers in `db.py`, and FastAPI APIRouter with prefix `/api`. The planner can follow these patterns verbatim.

**Primary recommendation:** Use `urllib.request` for LiteLLM proxy calls (already present, no new dep), add `huggingface_hub==1.10.2` to `requirements.txt`, cache intelligence results in a new DuckDB table `intelligence_cache`, and expose them through a new `routers/intelligence.py` following the `model_health.py` pattern exactly.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Dedicated "Intelligence" tab in the dashboard. Tab label: "Intelligence". Tab contains: lab health summary, anomaly/diagnosis section, HF recommendations section, single-shot Q&A box.
- **D-02:** LLM for analysis — local models via LiteLLM proxy at `http://litellm-proxy:4000/v1/chat/completions`. Model name configurable in sidecar env. Model selection left to planner (nemotron-cascade-2, Qwen3.5-35B, Gemma4-31B).
- **D-03:** Scheduled — every 12 hours via APScheduler. Results cached in DuckDB or JSON. New `/api/intelligence` endpoint returns latest cached result + timestamp.
- **D-04:** HuggingFace filter — task: coding/agentic/analysis/research/drafting; size: 70B–120B; runtime: vLLM or SLANG; quant: NVFP4 or FP8. Run on same 12h schedule. Surface top N new/notable models not already deployed.
- **D-05:** Single-shot Q&A — POST `/api/intelligence/query`, no history. Sidecar assembles metrics context, calls LLM, returns plain text/markdown. No streaming.

### Constraints (Carried Forward)

- **Diagnose only** — no automated config changes; all recommendations are advisory.
- **Local-only** — no external notifications, webhooks, or data egress beyond LiteLLM proxy calls.
- **Minimal UI** — consistent with dashboard aesthetic established in prior phases.

### Deferred Ideas (OUT OF SCOPE)

- Automated routing adjustments
- External access / auth
- Streaming responses
- Multi-turn conversation history
</user_constraints>

---

## Standard Stack

### Core (already in sidecar)

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| `duckdb` | 1.5.2 | Metrics storage + new intelligence_cache table | Already in requirements.txt [VERIFIED: requirements.txt] |
| `apscheduler` | 3.11.2 | Background job scheduling (12h interval) | Already in requirements.txt [VERIFIED: requirements.txt] |
| `fastapi` | 0.115.0 | API router for /api/intelligence endpoints | Already in requirements.txt [VERIFIED: requirements.txt] |
| `urllib.request` | stdlib | HTTP calls to LiteLLM proxy | Already used in model_health.py [VERIFIED: routers/model_health.py] |

### New Additions Required

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `huggingface_hub` | 1.10.2 | HF model search via `list_models()` | Latest on PyPI as of 2026-04-14 [VERIFIED: pip index] |

**No `httpx`, no `requests`.** The existing pattern uses `urllib.request` exclusively. The LiteLLM proxy call for chat completions (POST with JSON body) requires a small wrapper — see Code Examples below.

**Installation (add to `dashboard-sidecar/requirements.txt`):**
```
huggingface_hub==1.10.2
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `urllib.request` | `httpx` | httpx not in requirements.txt; urllib already imported in model_health.py — stay consistent |
| DuckDB table for cache | JSON file | DuckDB is already the canonical store; single-writer lock already in db.py; table survives container restart with the same volume |

---

## Architecture Patterns

### Recommended File Structure

```
dashboard-sidecar/
├── routers/
│   └── intelligence.py        # New: GET /api/intelligence + POST /api/intelligence/query
├── intelligence_job.py        # New: scheduled analysis + HF search logic
├── requirements.txt           # Add huggingface_hub==1.10.2
├── main.py                    # Wire: import + register job + include_router
└── db.py                      # Add: intelligence_cache table schema
```

### Pattern 1: Scheduled Job with In-Memory Cache (from model_health.py)

**What:** APScheduler background job updates an in-memory dict; endpoint reads from that dict with a lock.
**When to use:** For all cached intelligence results — avoids DB read on every GET request.

```python
# Source: dashboard-sidecar/routers/model_health.py (verified)
import threading

_cache: dict = {}
_cache_lock = threading.Lock()

def run_intelligence_job() -> None:
    result = _run_analysis()  # calls LiteLLM + HF Hub
    with _cache_lock:
        global _cache
        _cache = result

@router.get("/api/intelligence")
def get_intelligence():
    with _cache_lock:
        return dict(_cache)
```

### Pattern 2: LiteLLM Proxy HTTP Call via urllib

**What:** POST to `http://litellm-proxy:4000/v1/chat/completions` with JSON body and `Authorization: Bearer <key>` header. The sidecar uses `LITELLM_BENCH_KEY` (already in docker-compose env) — use the same key or a dedicated `INTELLIGENCE_LLM_KEY` env var.
**When to use:** Every intelligence analysis call and every Q&A call.

```python
# Source: [VERIFIED: docker-compose.yaml LITELLM_BENCH_KEY pattern + model_health.py urllib pattern]
import urllib.request
import json
import os

LITELLM_URL = os.environ.get("LITELLM_URL", "http://litellm-proxy:4000")
LITELLM_KEY = os.environ.get("LITELLM_BENCH_KEY", "")  # reuse existing key
INTELLIGENCE_MODEL = os.environ.get("INTELLIGENCE_MODEL", "nemotron-cascade-2")

def call_llm(messages: list[dict], max_tokens: int = 1024) -> str:
    payload = json.dumps({
        "model": INTELLIGENCE_MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.2,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{LITELLM_URL}/v1/chat/completions",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {LITELLM_KEY}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = json.loads(resp.read())
    return body["choices"][0]["message"]["content"]
```

**Important:** `timeout=120` is necessary for large local models. The ping job uses `timeout=3` but LLM inference can take 30-90 seconds.

### Pattern 3: HuggingFace Hub Model Search

**What:** Use `HfApi.list_models()` with tag filters to find recent instruct models in the 70B–120B range.
**When to use:** In the 12h scheduled job, alongside the LLM analysis.

```python
# Source: [VERIFIED: live huggingface_hub 1.9.0 API test in this session]
from huggingface_hub import HfApi

def search_hf_models(top_n: int = 6) -> list[dict]:
    api = HfApi()
    # Filter by text-generation + nvidia tags (catches NVFP4, FP8, NIM-compatible)
    # Post-filter by tag content for NVFP4/FP8 and size range
    candidates = list(api.list_models(
        filter=["text-generation", "nvidia"],
        sort="lastModified",
        limit=50,
        full=True,
    ))
    results = []
    for m in candidates:
        tags = getattr(m, "tags", []) or []
        # Require NVFP4 or fp8 tag
        has_quant = any(t.upper() in ("NVFP4", "FP8") for t in tags)
        if not has_quant:
            continue
        results.append({
            "model_id": m.modelId,
            "tags": tags[:15],
            "likes": getattr(m, "likes", 0),
            "downloads": getattr(m, "downloads", 0),
            "hf_url": f"https://huggingface.co/{m.modelId}",
            "last_modified": str(getattr(m, "lastModified", "")),
        })
        if len(results) >= top_n:
            break
    return results
```

**Notes verified by live API test:**
- Tags `NVFP4` and `FP8` (uppercase) are used as canonical tag strings on HF [VERIFIED: live API test]
- `sort="lastModified"` returns most recently updated models first [VERIFIED: live API test]
- `filter=["text-generation", "nvidia"]` returns models with BOTH tags [VERIFIED: live API test]
- `full=True` populates `tags`, `likes`, `downloads` fields [VERIFIED: live API test]
- `expand` cannot be combined with `full`, `cardData`, or `fetch_config` [VERIFIED: live API test error message]
- No auth token required for public model search [VERIFIED: live API test ran without HF_TOKEN]

**Size filtering caveat:** `num_parameters` field is NOT reliably populated on all model cards. Size must be inferred from model name strings (e.g., "70B", "120B") or tag strings. Do not rely on `num_parameters` for filtering — use string matching on `modelId`. [VERIFIED: live API test — num_parameters not present in full=True results]

### Pattern 4: DuckDB Cache Table

**What:** Persist the latest intelligence result so it survives sidecar restarts.
**When to use:** Write after each successful analysis run; read on startup to populate in-memory cache.

```python
# Source: [VERIFIED: db.py pattern]
# In db.py init_schema():
conn.execute("""
    CREATE TABLE IF NOT EXISTS intelligence_cache (
        id              INTEGER PRIMARY KEY DEFAULT 1,
        generated_at    TIMESTAMPTZ NOT NULL,
        health_summary  TEXT,
        anomalies       TEXT,   -- JSON string: list of {title, severity, description}
        recommendations TEXT,   -- JSON string: list of {title, body}
        hf_models       TEXT,   -- JSON string: list of model dicts
        model_used      TEXT
    )
""")
```

Use DuckDB's `INSERT OR REPLACE` (via `id=1` primary key) so the table always holds exactly one row — the latest result.

### Pattern 5: Metrics Context Assembly for LLM Prompt

**What:** Query DuckDB for recent aggregate stats to give the LLM grounded context.
**When to use:** Before every analysis call (scheduled job) and Q&A call.

Recommended context queries:
```sql
-- Recent model-level aggregates (last 24h)
SELECT model,
       COUNT(*) as request_count,
       AVG(ttft_ms) as avg_ttft_ms,
       PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ttft_ms) as p95_ttft_ms,
       AVG(total_latency_ms) as avg_latency_ms,
       AVG(context_utilization) as avg_ctx_util,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as error_rate,
       SUM(CASE WHEN tool_call_status = 'repaired' THEN 1 ELSE 0 END) as tool_repairs
FROM requests
WHERE startTime > NOW() - INTERVAL 24 HOUR
GROUP BY model
ORDER BY request_count DESC
```

```sql
-- Recent errors (last 6h, for anomaly context)
SELECT model, error_message, COUNT(*) as occurrences
FROM requests
WHERE startTime > NOW() - INTERVAL 6 HOUR
  AND status = 'failed'
  AND error_message IS NOT NULL
GROUP BY model, error_message
ORDER BY occurrences DESC
LIMIT 10
```

```sql
-- Latency trend (last 7d daily aggregates for anomaly baseline)
SELECT DATE_TRUNC('day', startTime) as day,
       model,
       AVG(total_latency_ms) as avg_latency_ms
FROM requests
WHERE startTime > NOW() - INTERVAL 7 DAY
GROUP BY day, model
ORDER BY day DESC, model
```

These three queries give the LLM enough signal to identify latency spikes, error clusters, and context pressure without overwhelming the context window.

### Pattern 6: Frontend Hook (useIntelligence)

**What:** Poll `GET /api/intelligence` on mount; no interval refresh needed (data is stale-for-12h by design).
**When to use:** IntelligenceTab component mount.

```typescript
// Source: [VERIFIED: mirrors useRequestLog.ts pattern exactly]
import { useState, useEffect } from 'react'

export interface IntelligenceResult {
  generated_at: string | null
  health_summary: string | null
  anomalies: Array<{ title: string; severity: 'low' | 'medium' | 'high'; description: string }>
  recommendations: Array<{ title: string; body: string }>
  hf_models: Array<{ model_id: string; hf_url: string; tags: string[]; likes: number; last_modified: string }>
  model_used: string | null
}

export function useIntelligence(sidecarUrl: string) {
  const [data, setData] = useState<IntelligenceResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    fetch(`${sidecarUrl}/api/intelligence`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((d: IntelligenceResult) => { if (mounted) { setData(d); setLoading(false) } })
      .catch(err => { if (mounted) { setError('Could not load health summary. Check that the sidecar is running on docker-001:4001.'); setLoading(false) } })
    return () => { mounted = false }
  }, [sidecarUrl])

  return { data, loading, error }
}
```

### Anti-Patterns to Avoid

- **Streaming LLM responses:** D-05 explicitly rules out streaming. Use blocking `urllib.urlopen` with `timeout=120`. [VERIFIED: CONTEXT.md D-05]
- **Importing `requests` or `httpx`:** Neither is in `requirements.txt`. `urllib.request` is stdlib and proven in the codebase. [VERIFIED: requirements.txt]
- **Calling HF Hub with `expand=` combined with `full=True`:** Raises `ValueError`. [VERIFIED: live API test]
- **Relying on `num_parameters` for size filtering:** Field is often absent; use model name string matching. [VERIFIED: live API test]
- **Adding LITELLM_MASTER_KEY to sidecar env:** Forbidden by SYS-02 assertion in main.py line 34. Use `LITELLM_BENCH_KEY` which already exists in docker-compose. [VERIFIED: main.py line 34, docker-compose.yaml]
- **Running the intelligence job outside APScheduler:** Concurrent calls risk DuckDB locking. `max_instances=1` on the APScheduler job prevents overlapping runs — follow the `_poll_job` pattern exactly. [VERIFIED: main.py scheduler pattern]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HF model search | Manual HF REST API calls with urllib | `huggingface_hub.HfApi.list_models()` | Handles pagination, auth, field expansion, rate limit headers automatically [VERIFIED: live API test] |
| JSON serialization of LLM response | Custom parsing | `json.loads(resp.read())["choices"][0]["message"]["content"]` | Standard OpenAI-compat response shape; LiteLLM proxy guarantees this shape [ASSUMED] |
| Prompt templating | Jinja2 or similar | Python f-strings / string concatenation | Prompt is a single JSON messages array; no template engine complexity needed |
| Async HTTP calls | asyncio + aiohttp | Synchronous urllib in the APScheduler job | APScheduler jobs run in a thread pool already; blocking calls are correct here — same pattern as poll_once and ping_models_job [VERIFIED: main.py] |

---

## Model Selection Recommendation

The user locked D-02 to "planner recommends." Based on the deployed models:

| Model | Context Window | Reasoning | Instruction Following | Recommendation |
|-------|---------------|-----------|----------------------|----------------|
| `nemotron-cascade-2` | 131K [ASSUMED from config-cluster.yaml reference] | HIGH (MoE, NVIDIA reasoning) | HIGH | **Recommended for analysis** — largest context, strongest reasoning |
| `Qwen3.5-35B` | 32K [ASSUMED] | HIGH | HIGH | Viable fallback if nemotron unavailable |
| `Gemma4-31B` | 128K [ASSUMED] | MEDIUM | HIGH | Third choice |

**Recommendation: use `nemotron-cascade-2` as default.** It runs on hintonator (RTX 5090), is already load-balanced, and has the largest context window — important for the metrics context assembly which can produce 2000-4000 tokens of tabular data. Make the model name an env var `INTELLIGENCE_MODEL` defaulting to `nemotron-cascade-2`.

Note: all three models are tagged [ASSUMED] — actual context windows depend on the deployed `config.yaml` max_context values. The planner may want to verify via the `/api/model-info` endpoint which already returns model metadata including `max_input_tokens`.

---

## Common Pitfalls

### Pitfall 1: DuckDB Concurrent Write from Scheduler Thread

**What goes wrong:** The APScheduler job writes to DuckDB from a background thread. The FastAPI endpoint reads from the same connection. DuckDB's single-writer constraint causes `duckdb.Error: IO Error: Could not set lock on file`.

**Why it happens:** The sidecar uses a single global `duckdb.DuckDBPyConnection` (see `db.py` `_conn` global). DuckDB supports one write connection at a time. The existing `_lock` threading lock in `db.py` prevents this for all existing callers.

**How to avoid:** Route all writes through `db.execute()` (which acquires `_lock`) — do NOT create a second DuckDB connection in the intelligence job. Use the existing `db.execute()` and `db.query()` wrappers. [VERIFIED: db.py lines 93-106]

### Pitfall 2: LLM Timeout Too Short

**What goes wrong:** `urllib.urlopen(req, timeout=3)` (the ping job's timeout) silently fails for LLM calls. nemotron-cascade-2 at 120B can take 30-90 seconds for a 1000-token completion.

**How to avoid:** Use `timeout=120` (2 minutes) for intelligence LLM calls. Catch `socket.timeout` and log the error with a human-readable message rather than crashing the scheduler. [VERIFIED: model_health.py timeout=3 for pings; [ASSUMED] 90s inference time based on typical 120B model throughput]

### Pitfall 3: HF Hub Rate Limiting Without Auth

**What goes wrong:** Anonymous HF Hub requests are rate-limited at ~100 req/hour. The intelligence job runs once per 12 hours and makes O(1) list_models calls — this is safe. However, if the scheduler fires multiple times in error recovery, rate limits can trigger.

**How to avoid:** `max_instances=1` on the APScheduler job prevents overlapping runs. Log HF rate limit errors gracefully and return the previous cached results. [VERIFIED: main.py scheduler pattern; HF rate limit behavior [CITED: huggingface.co/docs/hub/rate-limits]]

### Pitfall 4: Prompt Context Window Overflow

**What goes wrong:** Assembling 7 days of per-model latency data row-by-row creates prompts with 10,000+ tokens. nemotron-cascade-2 will truncate or refuse.

**How to avoid:** Use aggregate queries (GROUP BY day, model) rather than raw rows. Cap the metrics context at ~3000 tokens of text by limiting the number of models and days in the query. The three SQL queries in the Architecture Patterns section are designed for this.

### Pitfall 5: App.tsx Tab Architecture

**What goes wrong:** App.tsx currently has NO tab switcher — it is a single-page scrolling layout. There is no `<Tabs>` component in the current code.

**Why it matters:** D-01 says "dedicated Intelligence tab" but the current layout uses vertical Separator-divided sections. The planner must decide: (a) introduce shadcn `<Tabs>` component wrapping the entire page, or (b) treat "tab" as a scrollable section and add Intelligence as another Separator-divided section.

**Recommendation:** The UI-SPEC says "tab switcher" and "tab bar pattern already established in App.tsx" — but the codebase shows no such pattern exists yet. This means Phase 07 must introduce the tab architecture. The planner should add a Wave 0 task to introduce `<Tabs>`, `<TabsList>`, `<TabsTrigger>`, `<TabsContent>` from shadcn, restructure App.tsx sections into tabs (Models, Requests, Intelligence), then add the IntelligenceTab component. [VERIFIED: App.tsx — no Tabs component, no ToggleGroup-based tab system, all content inline]

**Check if Tabs is already installed:**
```bash
ls dashboard/src/components/ui/tabs.tsx 2>/dev/null || echo "MISSING"
```

### Pitfall 6: docker-compose CORS

**What goes wrong:** The sidecar restricts CORS to `http://docker-001:4002` (main.py line 82). POST `/api/intelligence/query` is a cross-origin POST — it must be in `allow_methods`. Currently `allow_methods=["GET", "POST"]` is set, so this is fine. [VERIFIED: main.py lines 80-85]

---

## Prompt Engineering Patterns

### Health Summary Prompt Structure

```python
system = """You are a lab infrastructure analyst. You have access to LLM inference metrics 
from a homelab running local GPU models. Summarize the overall lab health in 2-3 sentences. 
Be specific about which models are performing well or poorly. Be concise."""

user = f"""Current lab metrics (last 24 hours):

{metrics_table}

Recent errors:
{error_table}

Provide a 2-3 sentence health summary."""
```

### Anomaly Detection Prompt Structure

```python
system = """You are a lab infrastructure analyst. Identify specific anomalies in the 
provided LLM inference metrics. Return a JSON array of objects with keys: 
title (string), severity (one of: low, medium, high), description (string, 1-3 sentences).
Return ONLY valid JSON, no other text."""

user = f"""Metrics (last 24h vs 7d baseline):

{metrics_with_baseline}

Identify up to 5 specific anomalies. Return JSON only."""
```

**Important:** Request JSON output explicitly and parse with `json.loads()`. Wrap in try/except — if the LLM returns malformed JSON, fall back to an empty list and log the raw response. nemotron-cascade-2 follows instruction-following well but may occasionally add preamble. [ASSUMED based on model family characteristics]

### Q&A Prompt Structure

```python
system = """You are a lab infrastructure analyst. You have access to LLM inference metrics 
from a homelab. Answer the user's question using only the provided data. 
Be specific and cite model names and numbers. If the data is insufficient to answer, say so."""

user = f"""Current lab data:
{assembled_context}

Question: {user_question}"""
```

---

## API Shape Specification

### GET /api/intelligence

Response:
```json
{
  "generated_at": "2026-04-14T10:00:00Z",
  "model_used": "nemotron-cascade-2",
  "health_summary": "Lab is operating normally...",
  "anomalies": [
    {"title": "High p95 TTFT on spark-learner", "severity": "medium", "description": "..."}
  ],
  "recommendations": [
    {"title": "Increase max_tokens for nemotron-cascade-2", "body": "..."}
  ],
  "hf_models": [
    {
      "model_id": "nvidia/Llama-3.1-Nemotron-70B-Instruct-HF",
      "hf_url": "https://huggingface.co/nvidia/Llama-3.1-Nemotron-70B-Instruct-HF",
      "tags": ["text-generation", "nvidia", "FP8"],
      "likes": 423,
      "last_modified": "2026-03-10T..."
    }
  ]
}
```

Empty state (no job has run yet):
```json
{
  "generated_at": null,
  "model_used": null,
  "health_summary": null,
  "anomalies": [],
  "recommendations": [],
  "hf_models": []
}
```

### POST /api/intelligence/query

Request body:
```json
{"question": "Which model has the highest error rate in the last 7 days?"}
```

Response:
```json
{"answer": "nemotron-cascade-2 had the highest error rate at 4.2% over the last 7 days..."}
```

Error response (LLM unreachable):
```json
{"detail": "LLM call failed: <error message>"}
```
HTTP 503.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `huggingface_hub` | HF model search | Not in requirements.txt | — | Must add to requirements.txt |
| `urllib.request` | LiteLLM proxy calls | stdlib, confirmed present | Python 3.13 | — |
| `litellm-proxy` (Docker service) | LLM analysis + Q&A | On `litellm-internal` network | v1.83.6-nightly | — |
| HuggingFace Hub API | HF model search | Public endpoint, no auth needed | REST v5 | Skip HF section if unreachable |
| `LITELLM_BENCH_KEY` | Auth to LiteLLM proxy | In docker-compose.yaml env | — | Fallback: empty string (may 401) |
| shadcn `Tabs` component | Intelligence tab UI | Not confirmed in codebase | — | Must init: `npx shadcn@latest add tabs` |

**Missing dependencies with no fallback:**
- `huggingface_hub` — must be added to `requirements.txt` and sidecar image rebuilt.
- shadcn `Tabs` — must be added before IntelligenceTab component can be built. Check with `ls dashboard/src/components/ui/tabs.tsx`.

**Missing dependencies with fallback:**
- HuggingFace Hub API reachability — if network call fails (offline), return previously cached `hf_models` from DuckDB and log the error. Do not crash the job.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest 8.3.3 + pytest-asyncio 0.24.0 |
| Config file | none explicit (runs from dashboard-sidecar/) |
| Quick run command | `cd dashboard-sidecar && pytest tests/ -x -q` |
| Full suite command | `cd dashboard-sidecar && pytest tests/ -v` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INT-01 | `call_llm()` assembles correct OpenAI-compat request and returns content string | unit (mock urllib) | `pytest tests/test_intelligence.py::test_call_llm -x` | Wave 0 |
| INT-02 | `search_hf_models()` filters by NVFP4/FP8 tags and returns correct shape | unit (mock HfApi) | `pytest tests/test_intelligence.py::test_search_hf_models -x` | Wave 0 |
| INT-03 | `run_intelligence_job()` writes to DuckDB intelligence_cache table | unit (in_memory_db fixture) | `pytest tests/test_intelligence.py::test_job_writes_cache -x` | Wave 0 |
| INT-04 | GET /api/intelligence returns empty state when no job has run | integration | `pytest tests/test_intelligence.py::test_get_empty -x` | Wave 0 |
| INT-05 | POST /api/intelligence/query returns 503 when LLM unreachable | unit (mock urllib raise) | `pytest tests/test_intelligence.py::test_query_llm_error -x` | Wave 0 |
| INT-06 | metrics context assembly SQL queries run without error on in_memory_db | unit | `pytest tests/test_intelligence.py::test_metrics_context_sql -x` | Wave 0 |

### Wave 0 Gaps

- [ ] `tests/test_intelligence.py` — covers INT-01 through INT-06
- [ ] Verify `dashboard/src/components/ui/tabs.tsx` exists; if not, run `npx shadcn@latest add tabs` in `dashboard/`

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | nemotron-cascade-2 has 131K context window | Model Selection | Planner should verify via /api/model-info before setting max_tokens in prompt assembly |
| A2 | nemotron-cascade-2 inference takes 30-90s for 1000-token completion at 120B | Pitfall 2 | timeout=120 may be too short; could increase to 180s |
| A3 | LiteLLM proxy returns standard `choices[0].message.content` JSON for all local models | Don't Hand-Roll | If a local model variant returns a different shape, response parsing will KeyError |
| A4 | `LITELLM_BENCH_KEY` has sufficient permissions to call chat completions (not just benchmarks) | Pattern 2 | May need a new env var `INTELLIGENCE_LLM_KEY` with appropriate scope |
| A5 | shadcn Tabs component not yet installed in dashboard/ | Pitfall 5 | If it is already present, Wave 0 skip shadcn add step |

---

## Sources

### Primary (HIGH confidence)
- `dashboard-sidecar/routers/model_health.py` — in-memory cache + lock pattern, urllib usage, APScheduler job pattern
- `dashboard-sidecar/main.py` — APScheduler wiring, job registration, lifespan pattern
- `dashboard-sidecar/db.py` — DuckDB schema, execute/query wrappers, thread lock
- `dashboard-sidecar/requirements.txt` — exact dependencies available in sidecar image
- `dashboard-sidecar/Dockerfile` — confirms python:3.13-slim base, no extra packages
- `docker-compose.yaml` — confirms `litellm-internal` network, `LITELLM_BENCH_KEY` env var, sidecar CORS setting
- Live `huggingface_hub 1.9.0` API test — confirmed `list_models()` signature, tag filtering, `full=True` fields, `expand` incompatibility
- Live `pip index versions huggingface_hub` — confirmed 1.10.2 is latest

### Secondary (MEDIUM confidence)
- `07-UI-SPEC.md` — component inventory, layout order, interaction contracts
- `07-CONTEXT.md` — locked decisions D-01 through D-05
- `dashboard/src/App.tsx` — confirmed no Tabs component exists; scrolling layout only
- `dashboard/src/hooks/useRequestLog.ts` — hook pattern for useIntelligence

### Tertiary (LOW confidence / ASSUMED)
- Model context window sizes (A1) — not verified against live /api/model-info
- LLM inference timing (A2) — estimated from model size, not measured

---

## Metadata

**Confidence breakdown:**
- Sidecar patterns: HIGH — all verified from codebase
- HuggingFace Hub API: HIGH — verified via live API calls
- Docker networking: HIGH — verified from docker-compose.yaml
- Model recommendations: MEDIUM — model capabilities assumed from training knowledge
- Prompt engineering: MEDIUM — patterns recommended based on general LLM best practices

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (huggingface_hub API stable; sidecar patterns stable)
