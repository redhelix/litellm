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
INTELLIGENCE_MODEL = os.environ.get("INTELLIGENCE_MODEL", "qwq-32b")

# ---------------------------------------------------------------------------
# In-memory cache (mirrors model_health.py pattern)
# ---------------------------------------------------------------------------
_cache: dict = {}
_cache_lock = threading.Lock()

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

def search_hf_models(top_n: int = 6) -> list[dict]:
    """Query HuggingFace Hub for recent NVFP4/FP8 instruct models in the 70B-120B range.

    Returns list of dicts with keys: id, tags, likes, downloads, hf_url, last_modified.
    Returns [] (never raises) if HfApi raises any exception.
    """
    try:
        from huggingface_hub import HfApi
        api = HfApi()
        candidates = list(api.list_models(
            filter=["text-generation", "nvidia"],
            sort="lastModified",
            limit=50,
            full=True,
        ))
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
    """Build a concise deployment inventory for the LLM recommendation prompt.

    For each active model alias, describes the backend node IP and whether it is
    a single-node or multi-node deployment (determined by whether the same
    api_base is shared across multiple aliases).
    """
    info_map = get_model_info_map()
    # Group aliases by api_base to detect shared (multi-node capable) backends
    base_to_aliases: dict[str, list[str]] = {}
    for alias, info in info_map.items():
        base = info.get("api_base") or "cloud"
        base_to_aliases.setdefault(base, []).append(alias)

    lines = ["## Currently Deployed Models"]
    lines.append("alias | backend_node | node_type | model")
    for alias, info in sorted(info_map.items()):
        base = info.get("api_base") or "cloud"
        node_type = "cloud" if base == "cloud" else (
            "multi-node" if len(base_to_aliases.get(base, [])) > 2 else "single-node"
        )
        backend = info.get("backend_model", "")
        lines.append(f"{alias} | {base} | {node_type} | {backend}")
    return "\n".join(lines)


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

    # Step 4: recommendations (includes deployment topology for model-swap suggestions)
    deploy_ctx = _deployment_context()
    try:
        rec_raw = call_llm([
            {
                "role": "system",
                "content": (
                    "You are a lab infrastructure analyst for a private homelab running local GPU models. "
                    "Based on the LLM inference metrics and current deployment topology, provide actionable "
                    "recommendations. Return a JSON array of objects with keys: "
                    "title (string), body (string, 2-4 sentences). "
                    "IMPORTANT — when recommending a model replacement or addition:\n"
                    "  1. Name the specific model to deploy.\n"
                    "  2. State which backend node (IP or alias) it should run on.\n"
                    "  3. State whether it requires single-node or multi-node deployment.\n"
                    "  4. Explain WHY it is better than the currently deployed model it would replace "
                    "(e.g., lower latency, higher throughput, better quantization, smaller VRAM footprint).\n"
                    "Return ONLY valid JSON, no other text."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Current deployment topology:\n\n{deploy_ctx}\n\n"
                    f"Metrics:\n\n{metrics_ctx}\n\n"
                    "Provide up to 3 recommendations. For any model-swap suggestion include node, "
                    "single/multi-node, and why it beats the current model. Return JSON only."
                ),
            },
        ], max_tokens=1024)
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

    # Step 5: HF model search
    try:
        hf_models = search_hf_models()
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
    }
    with _cache_lock:
        global _cache
        _cache = new_cache

    log.info("intelligence job complete: anomalies=%d, recommendations=%d, hf_models=%d",
             len(anomalies), len(recommendations), len(hf_models))


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
