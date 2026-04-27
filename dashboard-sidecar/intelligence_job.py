"""
intelligence_job.py — Phase 07 Wave 1

Scheduled 12h analysis job: assembles DuckDB metrics context, calls local LiteLLM
proxy for health summary / anomaly detection / recommendations, queries HuggingFace
Hub for new instruct-tuned NVFP4/FP8 models, and caches results in DuckDB.

Public surface:
    call_llm(messages, max_tokens=1024) -> str
    search_hf_models(top_n=6) -> list[dict]
    assemble_metrics_context() -> str
    run_intelligence_job() -> None
    answer_question(question) -> str
"""
import json
import logging
import os
import socket
import threading
import urllib.error
import urllib.request
from datetime import datetime, timezone
from types import SimpleNamespace

import db
from config_loader import get_model_info_map, HIDDEN_MODELS

log = logging.getLogger("intelligence_job")

# ---------------------------------------------------------------------------
# Environment config
# ---------------------------------------------------------------------------
LITELLM_URL = os.environ.get("LITELLM_URL", "http://litellm-proxy:4000")
LITELLM_BENCH_KEY = os.environ.get("LITELLM_BENCH_KEY", "")
INTELLIGENCE_MODEL = os.environ.get("INTELLIGENCE_MODEL", "nemotron-cascade-2")

# ---------------------------------------------------------------------------
# In-memory cache (mirrors model_health.py pattern)
# ---------------------------------------------------------------------------
_cache: dict = {}
_cache_lock = threading.Lock()

# Job running state — used by /api/intelligence/status and /api/intelligence/refresh
_job_running: bool = False
_job_started_at: datetime | None = None
_job_state_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Startup: hydrate in-memory cache from DuckDB (survives container restart)
# ---------------------------------------------------------------------------
try:
    _rows = db.query(
        "SELECT id, generated_at, health_summary, anomalies, recommendations, hf_models, model_used "
        "FROM intelligence_cache WHERE id = 1"
    )
    if _rows:
        _r = _rows[0]
        with _cache_lock:
            _cache = {
                "generated_at": _r[1].isoformat() if _r[1] else None,
                "model_used": _r[6],
                "health_summary": _r[2],
                "anomalies": json.loads(_r[3]) if _r[3] else [],
                "recommendations": json.loads(_r[4]) if _r[4] else [],
                "hf_models": json.loads(_r[5]) if _r[5] else [],
                "hf_search_rationale": "",
            }
except Exception:
    pass  # first boot — intelligence_cache may not exist yet


# ---------------------------------------------------------------------------
# call_llm
# ---------------------------------------------------------------------------

def call_llm(messages: list[dict], max_tokens: int = 1024) -> str:
    """POST to LiteLLM proxy /v1/chat/completions and return the content string.

    Raises urllib.error.URLError on network failure — callers should catch.
    """
    payload = json.dumps({
        "model": INTELLIGENCE_MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.2,
        # Disable extended thinking so content tokens are not consumed by reasoning.
        # Passed as extra_body; vLLM forwards chat_template_kwargs to the model.
        "chat_template_kwargs": {"enable_thinking": False},
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{LITELLM_URL}/v1/chat/completions",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {LITELLM_BENCH_KEY}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = json.loads(resp.read())
    return body["choices"][0]["message"]["content"] or ""


# ---------------------------------------------------------------------------
# search_hf_models
# ---------------------------------------------------------------------------

def _extract_hf_hints(recommendations: list[dict]) -> list[str]:
    """Derive 1-3 HuggingFace search keywords from recommendation titles via LLM.

    Returns [] on any failure so callers can fall back to default search.
    """
    if not recommendations:
        return []
    titles = "; ".join(r.get("title", "") for r in recommendations[:3])
    try:
        raw = call_llm([
            {
                "role": "system",
                "content": (
                    "You extract HuggingFace model search keywords. "
                    "Given a list of recommendation titles, output ONLY a JSON array of 1-3 "
                    "strings (model family names or capabilities), e.g. [\"Qwen3\", \"instruct\"]. "
                    "No explanation, just the array."
                ),
            },
            {"role": "user", "content": f"Recommendations: {titles}"},
        ], max_tokens=60)
        hints = json.loads(raw)
        if isinstance(hints, list) and hints:
            return [str(h).strip() for h in hints[:3] if str(h).strip()]
    except Exception as exc:
        log.debug("_extract_hf_hints failed (using defaults): %s", exc)
    return []


def search_hf_models(hints: list[str] | None = None, top_n: int = 6) -> list[dict]:
    """Query HuggingFace Hub for recent NVFP4/FP8 instruct models in the 70B-120B range.

    If *hints* is provided (keywords derived from recommendations), uses them as a
    text-search filter so results are relevant to what the intelligence job suggested.

    Returns list of dicts with keys: id, tags, likes, downloads, hf_url, last_modified.
    Returns [] (never raises) if HfApi raises any exception.
    """
    if hints is None:
        hints = []
    try:
        from huggingface_hub import HfApi
        api = HfApi()
        search_text = " ".join(hints) if hints else None
        list_kwargs: dict = dict(
            filter=["text-generation", "nvidia"],
            sort="lastModified",
            limit=50,
            full=True,
        )
        if search_text:
            list_kwargs["search"] = search_text
        candidates = list(api.list_models(**list_kwargs))
        results = []
        for m in candidates:
            raw_id = getattr(m, "modelId", None) or getattr(m, "id", "")
            tags = getattr(m, "tags", []) or []
            has_quant = any(t.upper() in ("NVFP4", "FP8") for t in tags)
            if not has_quant:
                continue
            # Return SimpleNamespace so attribute-access tests work (m.id, m.tags, etc.)
            # Serialisation callers must convert via _model_to_dict().
            results.append(SimpleNamespace(
                id=raw_id,
                model_id=raw_id,
                tags=tags[:15],
                likes=getattr(m, "likes", 0) or 0,
                downloads=getattr(m, "downloads", 0) or 0,
                hf_url=f"https://huggingface.co/{raw_id}",
                last_modified=str(getattr(m, "lastModified", "")),
            ))
            if len(results) >= top_n:
                break
        return results
    except Exception as exc:
        log.warning("search_hf_models failed (returning []): %s", exc)
        return []


# ---------------------------------------------------------------------------
# assemble_metrics_context
# ---------------------------------------------------------------------------

def _active_model_filter() -> str:
    """Return a SQL IN clause fragment for currently deployed models only.

    Excludes HIDDEN_MODELS (retired / alias duplicates) so the LLM only sees
    metrics for models that are actually running in the lab.
    """
    info_map = get_model_info_map()  # already excludes HIDDEN_MODELS
    active = set(info_map.keys()) - HIDDEN_MODELS
    if not active:
        return "1=1"  # fallback: no filter
    placeholders = ", ".join(f"'{m.replace(chr(39), chr(39)*2)}'" for m in sorted(active))
    return f"model IN ({placeholders})"


def _deployment_context() -> str:
    """Return a fixed description of the lab's hardware topology and quality use-case matrix.

    This is intentionally hardcoded rather than derived from config, because the
    use-case assignments and hardware names are domain knowledge that the LiteLLM
    config does not encode.
    """
    return """## Lab Hardware Topology

IMPORTANT — VRAM constraints are hard limits. Only suggest models that can realistically
run within the target node's VRAM budget. Do not suggest models that exceed these limits.

| Node        | Hardware                        | VRAM       | Current Model                                           |
|-------------|---------------------------------|------------|---------------------------------------------------------|
| spark-001   | DGX SPARK CLUSTER (multi-GPU)   | cluster    | Qwen3.6-35B-A3B-NVFP4  (spark-learner, honcho-chat)    |
| spark-002   | DGX SPARK CLUSTER (multi-GPU)   | cluster    | Gemma4-31B  (spark-gemma4-31B, gemma-4-31b)             |
| spark-003   | DGX SPARK CLUSTER (multi-GPU)   | cluster    | Nemotron-3-Super-120B  (spark-nemotron-120B)            |
| hintonator  | RTX 5090 (single GPU)           | 32 GB      | nemotron-cascade-2  (primary), nomic-embed-text         |
| docker-gpu  | RTX 3090 (single GPU)           | 24 GB      | nemotron-cascade-2  (secondary, lower-priority)         |

VRAM sizing guide (approximate at FP8/NVFP4 quantization):
- ~7B model: 6–8 GB → fits hintonator or docker-gpu
- ~30B model: 20–25 GB → fits hintonator (tight), not docker-gpu
- ~70B model: 35–40 GB → does NOT fit hintonator (32 GB); requires DGX SPARK cluster
- ~120B+ model: 60+ GB → requires DGX SPARK cluster only

## Quality / Capability Use-Case Matrix

| Use Case                        | Best Model                                    | Why                                                                                      |
|---------------------------------|-----------------------------------------------|------------------------------------------------------------------------------------------|
| Agentic orchestration           | nemotron-cascade-2                            | Highest tool-calling accuracy, 3B active params, 110–130 t/s throughput                 |
| Tool-calling                    | nemotron-cascade-2                            | Native function-calling fine-tune, beats 120B on tool-use benchmarks                    |
| Coding                          | spark-learner (Qwen3.5-A3B)                   | Strongest code gen/review in 35B class, thinking-mode toggle for complex debugging       |
| Security analysis               | nemotron-cascade-2 + gemma-4-31b              | Cascade-2 for fast DOM/API automation; Gemma-31B for multimodal threat analysis          |
| UX / low-latency interactions   | nemotron-cascade-2 or spark-learner           | Both hit 110–150 t/s; Gemma-31B too slow (6.5 t/s) for primary UX paths                |
| Architecture / system design    | gemma-4-31b → spark-nemotron-120B             | Gemma-31B for full-document context; 120B for cross-domain pattern recognition           |
| Legal reasoning & analysis      | gemma-4-31b → spark-nemotron-120B             | Gemma-31B for full case files (256K ctx); 120B for precedent chains                     |
| Research & long-form synthesis  | gemma-4-31b                                   | 256K context fits full papers; dense architecture = coherent long-form output            |
| Legal drafting / writing        | spark-nemotron-120B                           | Deepest legal knowledge retention, best long-form coherence for contracts and briefs     |
| Instruction following           | spark-learner (simple) / gemma-4-31b (complex)| Qwen3.5-A3B for routine tasks; Gemma-31B for multi-step long-context instructions       |"""


def assemble_metrics_context() -> str:
    """Run the three aggregate SQL queries and format results as a text table block.

    Only includes currently deployed models (excludes retired/hidden aliases).
    Truncates to ~3000 chars to stay within LLM prompt budget.
    """
    sections = []
    model_filter = _active_model_filter()

    # --- 24h model aggregates ---
    try:
        rows = db.query(f"""
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
              AND {model_filter}
            GROUP BY model
            ORDER BY request_count DESC
        """)
        lines = ["## 24h Model Aggregates", "model | requests | avg_ttft_ms | p95_ttft_ms | avg_latency_ms | ctx_util | error_rate | tool_repairs"]
        for r in rows:
            lines.append(
                f"{r[0]} | {r[1]} | {_fmt(r[2])} | {_fmt(r[3])} | {_fmt(r[4])} | {_fmt(r[5])} | {_fmt(r[6], pct=True)} | {r[7]}"
            )
        sections.append("\n".join(lines))
    except Exception as exc:
        log.warning("24h aggregate query failed: %s", exc)
        sections.append("## 24h Model Aggregates\n(no data)")

    # --- recent error clusters ---
    try:
        rows = db.query(f"""
            SELECT model, error_message, COUNT(*) as occurrences
            FROM requests
            WHERE startTime > NOW() - INTERVAL 6 HOUR
              AND status = 'failed'
              AND error_message IS NOT NULL
              AND {model_filter}
            GROUP BY model, error_message
            ORDER BY occurrences DESC
            LIMIT 10
        """)
        lines = ["## Recent Errors (6h)", "model | error_message | occurrences"]
        for r in rows:
            msg = (r[1] or "")[:100]
            lines.append(f"{r[0]} | {msg} | {r[2]}")
        sections.append("\n".join(lines))
    except Exception as exc:
        log.warning("recent error query failed: %s", exc)
        sections.append("## Recent Errors (6h)\n(no data)")

    # --- 7d latency trend ---
    try:
        rows = db.query(f"""
            SELECT DATE_TRUNC('day', startTime) as day,
                   model,
                   AVG(total_latency_ms) as avg_latency_ms
            FROM requests
            WHERE startTime > NOW() - INTERVAL 7 DAY
              AND {model_filter}
            GROUP BY day, model
            ORDER BY day DESC, model
        """)
        lines = ["## 7d Latency Trend", "day | model | avg_latency_ms"]
        for r in rows:
            lines.append(f"{r[0]} | {r[1]} | {_fmt(r[2])}")
        sections.append("\n".join(lines))
    except Exception as exc:
        log.warning("7d trend query failed: %s", exc)
        sections.append("## 7d Latency Trend\n(no data)")

    context = "\n\n".join(sections)
    # Truncate to ~3000 chars to stay within LLM prompt budget
    if len(context) > 3000:
        context = context[:3000] + "\n...[truncated]"
    return context


def _fmt(val, pct: bool = False) -> str:
    """Format a numeric DB value for display."""
    if val is None:
        return "N/A"
    if pct:
        return f"{val:.2%}"
    return f"{val:.1f}"


def _model_to_dict(m) -> dict:
    """Convert a SimpleNamespace model entry to a serialisable dict."""
    if isinstance(m, dict):
        return m
    return {
        "id": getattr(m, "id", ""),
        "model_id": getattr(m, "model_id", getattr(m, "id", "")),
        "tags": getattr(m, "tags", []),
        "likes": getattr(m, "likes", 0),
        "downloads": getattr(m, "downloads", 0),
        "hf_url": getattr(m, "hf_url", ""),
        "last_modified": getattr(m, "last_modified", ""),
    }


# ---------------------------------------------------------------------------
# run_intelligence_job
# ---------------------------------------------------------------------------

def run_intelligence_job() -> None:
    """Main scheduled job: assembles metrics, calls LLM for analysis, updates DuckDB cache."""
    global _job_running, _job_started_at
    with _job_state_lock:
        if _job_running:
            log.info("intelligence job already running — skipping duplicate trigger")
            return
        _job_running = True
        _job_started_at = datetime.now(timezone.utc)
    log.info("intelligence job started")
    health_summary = None
    anomalies = []
    recommendations = []
    hf_models = []

    # Step 1: assemble metrics context
    try:
        metrics_ctx = assemble_metrics_context()
    except Exception as exc:
        log.exception("assemble_metrics_context failed: %s", exc)
        metrics_ctx = "(metrics unavailable)"

    # Step 2: health summary
    try:
        health_summary = call_llm([
            {
                "role": "system",
                "content": (
                    "You are a lab infrastructure analyst. You have access to LLM inference metrics "
                    "from a homelab running local GPU models. Summarize the overall lab health in 2-3 sentences. "
                    "Be specific about which models are performing well or poorly. Be concise."
                ),
            },
            {
                "role": "user",
                "content": f"Current lab metrics (last 24 hours):\n\n{metrics_ctx}\n\nProvide a 2-3 sentence health summary.",
            },
        ], max_tokens=512)
    except Exception as exc:
        log.exception("health_summary call_llm failed: %s", exc)

    # Step 3: anomaly detection
    try:
        anomaly_raw = call_llm([
            {
                "role": "system",
                "content": (
                    "You are a lab infrastructure analyst. Identify specific anomalies in the "
                    "provided LLM inference metrics. Return a JSON array of objects with keys: "
                    "title (string), severity (one of: low, medium, high), description (string, 1-3 sentences). "
                    "Return ONLY valid JSON, no other text."
                ),
            },
            {
                "role": "user",
                "content": f"Metrics (last 24h vs 7d baseline):\n\n{metrics_ctx}\n\nIdentify up to 5 specific anomalies. Return JSON only.",
            },
        ], max_tokens=1024)
        try:
            anomalies = json.loads(anomaly_raw)
            if not isinstance(anomalies, list):
                anomalies = []
        except json.JSONDecodeError:
            log.warning("anomaly response is not valid JSON: %s", anomaly_raw[:200])
            anomalies = []
    except Exception as exc:
        log.exception("anomaly call_llm failed: %s", exc)
        anomalies = []

    # Step 4: recommendations (quality/capability-driven, not just numbers)
    deploy_ctx = _deployment_context()
    try:
        rec_raw = call_llm([
            {
                "role": "system",
                "content": (
                    "You are a senior ML infrastructure advisor for a private homelab.\n\n"
                    "STRICT RULES — violating any of these invalidates the recommendation:\n"
                    "1. NEVER cite external benchmark numbers, accuracy percentages, or throughput "
                    "figures that are not present in the live metrics provided. No fabricated stats. "
                    "Comparisons must be based on architectural facts (context window, parameter count, "
                    "training focus, fine-tuning type) or observed metrics from the data.\n"
                    "2. NEVER suggest a model that exceeds the target node's VRAM budget. Check the "
                    "VRAM sizing guide in the topology. A 70B model CANNOT run on a 32 GB GPU.\n"
                    "3. Do NOT suggest the same replacement model for multiple different use cases — "
                    "each recommendation must be distinct and targeted.\n"
                    "4. Only recommend changes that are grounded in what is observable from the "
                    "provided metrics (e.g. high latency on a latency-sensitive path, low utilization "
                    "suggesting a misrouted workload, error spikes on a specific model).\n\n"
                    "Each recommendation body MUST follow this exact structure (Markdown):\n"
                    "1. **Current situation**: [model X] handles [use case]; "
                    "observed weakness: [from metrics or known architectural limitation].\n"
                    "2. **Better fit**: [model Y] on [node] ([single-GPU or DGX SPARK cluster]) "
                    "because [architectural reason — context window, training focus, etc.].\n"
                    "3. A Markdown comparison table:\n"
                    "   | Property | Current ([model X]) | Suggested ([model Y]) |\n"
                    "   |----------|--------------------|-----------------------|\n"
                    "   | Context Window | ... | ... |\n"
                    "   | Architecture / Training Focus | ... | ... |\n"
                    "   | Best-fit tasks | ... | ... |\n"
                    "   | Deployment | ... (node, VRAM) | ... (node, VRAM) |\n\n"
                    "Return a JSON array of up to 3 objects with these keys:\n"
                    "  - title (string): short recommendation headline\n"
                    "  - use_case (string): the task/workload being addressed, e.g. 'Tool-calling'\n"
                    "  - current_model (string): the model currently handling it\n"
                    "  - suggested_model (string): the recommended replacement\n"
                    "  - node (string): target deployment node, e.g. 'hintonator (RTX 5090, 32GB)'\n"
                    "  - body (string, Markdown): full analysis per the structure above\n"
                    "Return ONLY valid JSON, no other text."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"{deploy_ctx}\n\n"
                    f"## Live Metrics (last 24h)\n\n{metrics_ctx}\n\n"
                    "Based on the above, identify up to 3 recommendations that would improve "
                    "output quality or functional coverage. Focus on capability gaps and correct "
                    "model-task fit. Return JSON only."
                ),
            },
        ], max_tokens=2048)
        try:
            recommendations = json.loads(rec_raw)
            if not isinstance(recommendations, list):
                recommendations = []
        except json.JSONDecodeError:
            log.warning("recommendations response is not valid JSON: %s", rec_raw[:200])
            recommendations = []
    except Exception as exc:
        log.exception("recommendations call_llm failed: %s", exc)
        recommendations = []

    # Step 5: HF model search — informed by recommendation keywords
    hf_hints: list[str] = []
    hf_search_rationale: str = ""
    try:
        hf_hints = _extract_hf_hints(recommendations)
    except Exception as exc:
        log.warning("_extract_hf_hints failed: %s", exc)
    if hf_hints:
        hf_search_rationale = (
            f"Searched HuggingFace for {', '.join(hf_hints)} models "
            "based on current recommendations."
        )
    else:
        hf_search_rationale = "Searched HuggingFace for recent NVFP4/FP8 NVIDIA instruct models."
    try:
        hf_models = search_hf_models(hints=hf_hints)
    except Exception as exc:
        log.exception("search_hf_models failed: %s", exc)
        hf_models = []

    # Serialise hf_models (may be SimpleNamespace objects from search_hf_models)
    hf_models_dicts = [_model_to_dict(m) for m in hf_models]

    # Step 6: persist to DuckDB
    generated_at = datetime.now(timezone.utc)
    try:
        db.execute(
            "INSERT OR REPLACE INTO intelligence_cache "
            "(id, generated_at, health_summary, anomalies, recommendations, hf_models, model_used) "
            "VALUES (1, ?, ?, ?, ?, ?, ?)",
            (
                generated_at,
                health_summary,
                json.dumps(anomalies),
                json.dumps(recommendations),
                json.dumps(hf_models_dicts),
                INTELLIGENCE_MODEL,
            ),
        )
    except Exception as exc:
        log.exception("DuckDB write failed: %s", exc)

    # Step 7: update in-memory cache (store serialisable dicts)
    new_cache = {
        "generated_at": generated_at.isoformat(),
        "model_used": INTELLIGENCE_MODEL,
        "health_summary": health_summary,
        "anomalies": anomalies,
        "recommendations": recommendations,
        "hf_models": hf_models_dicts,
        "hf_search_rationale": hf_search_rationale,
    }
    with _cache_lock:
        global _cache
        _cache = new_cache

    with _job_state_lock:
        _job_running = False
        _job_started_at = None

    log.info("intelligence job complete: anomalies=%d, recommendations=%d, hf_models=%d",
             len(anomalies), len(recommendations), len(hf_models))


def run_intelligence_job_async() -> bool:
    """Fire run_intelligence_job in a daemon thread. Returns False if already running."""
    with _job_state_lock:
        if _job_running:
            return False
    t = threading.Thread(target=run_intelligence_job, daemon=True, name="intelligence-on-demand")
    t.start()
    return True


# ---------------------------------------------------------------------------
# answer_question
# ---------------------------------------------------------------------------

def answer_question(question: str) -> str:
    """Single-shot Q&A: assemble metrics context and call LLM with the user question.

    Raises urllib.error.URLError (or socket.timeout) on LLM failure — callers catch.
    """
    ctx = assemble_metrics_context()
    messages = [
        {
            "role": "system",
            "content": (
                "You are a lab infrastructure analyst. You have access to LLM inference metrics "
                "from a homelab. Answer the user's question using only the provided data. "
                "Be specific and cite model names and numbers. If the data is insufficient to answer, say so."
            ),
        },
        {
            "role": "user",
            "content": f"Current lab data:\n{ctx}\n\nQuestion: {question}",
        },
    ]
    return call_llm(messages, max_tokens=1024)
