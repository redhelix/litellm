import json
import os
import time
import threading
import urllib.request
import urllib.error
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Query
from db import execute, query

router = APIRouter(prefix="/api", tags=["benchmark"])

LITELLM_PROXY_URL = os.environ.get("LITELLM_PROXY_URL", "http://192.168.50.117:4000")
LITELLM_BENCH_KEY = os.environ.get("LITELLM_BENCH_KEY", "")

BENCH_PROMPT = [{"role": "user", "content": "Reply with exactly: ok"}]
TIMEOUT_S = 30

# ---------------------------------------------------------------------------
# Running state (module-level, protected by _state_lock)
# ---------------------------------------------------------------------------
_running: bool = False
_run_tier: str | None = None
_run_start: datetime | None = None
_current_run_id: str | None = None
_state_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Helpers: model list
# ---------------------------------------------------------------------------

import ipaddress

def _is_local_host(api_base: str | None) -> bool:
    """Return True if the api_base points to a private/local host."""
    if not api_base:
        return False
    try:
        import urllib.parse
        host = urllib.parse.urlparse(api_base).hostname or ""
    except Exception:
        return False
    if host in ("localhost", "127.0.0.1", "::1"):
        return True
    # Docker service names (no dots) are internal
    if "." not in host:
        return True
    try:
        addr = ipaddress.ip_address(host)
        # RFC 1918 private ranges
        private = [
            ipaddress.ip_network("10.0.0.0/8"),
            ipaddress.ip_network("172.16.0.0/12"),
            ipaddress.ip_network("192.168.0.0/16"),
            # Tailscale
            ipaddress.ip_network("100.64.0.0/10"),
        ]
        return any(addr in net for net in private)
    except ValueError:
        return False


def _get_benchmark_models(scope: str = "all") -> list[str]:
    from config_loader import get_model_info_map
    info_map = get_model_info_map()
    skip_keywords = {"embed", "nomic"}
    result = []
    for model, info in info_map.items():
        if any(s in model.lower() for s in skip_keywords):
            continue
        backend = (info.get("backend_model") or "").lower()
        if any(s in backend for s in skip_keywords):
            continue
        if scope != "all":
            local = _is_local_host(info.get("api_base"))
            if scope == "local" and not local:
                continue
            if scope == "cloud" and local:
                continue
        result.append(model)
    return result


# ---------------------------------------------------------------------------
# Short benchmark (latency/perf)
# ---------------------------------------------------------------------------

def _measure_model(model: str) -> dict:
    """Fire a single streaming chat completion to the proxy, measure TTFT and total latency."""
    payload = json.dumps({
        "model": model,
        "messages": BENCH_PROMPT,
        "max_tokens": 5,
        "stream": True,
    }).encode()
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {LITELLM_BENCH_KEY}",
    }
    req = urllib.request.Request(
        f"{LITELLM_PROXY_URL}/v1/chat/completions",
        data=payload,
        headers=headers,
        method="POST",
    )
    t_start = time.monotonic()
    ttft_ms = None
    tokens = 0
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            for line in resp:
                if ttft_ms is None:
                    ttft_ms = int((time.monotonic() - t_start) * 1000)
                line = line.decode("utf-8").strip()
                if line.startswith("data: ") and line != "data: [DONE]":
                    try:
                        chunk = json.loads(line[6:])
                        content = (chunk.get("choices") or [{}])[0].get("delta", {}).get("content", "")
                        if content:
                            tokens += len(content.split())
                    except json.JSONDecodeError:
                        pass
        total_latency_ms = int((time.monotonic() - t_start) * 1000)
        elapsed_s = total_latency_ms / 1000
        tps = round(tokens / elapsed_s, 1) if elapsed_s > 0 else None
        return {
            "model": model,
            "ttft_ms": ttft_ms,
            "total_latency_ms": total_latency_ms,
            "tokens_per_sec": tps,
            "status": "ok",
            "error_message": None,
        }
    except urllib.error.URLError:
        return {
            "model": model, "ttft_ms": None, "total_latency_ms": None,
            "tokens_per_sec": None, "status": "timeout",
            "error_message": "Connection error",
        }
    except Exception as e:
        return {
            "model": model, "ttft_ms": None, "total_latency_ms": None,
            "tokens_per_sec": None, "status": "error",
            "error_message": str(e)[:200],
        }


def _run_short_benchmark(run_id: str, scope: str = "all") -> None:
    """Background thread: measures all models, writes perf results to DuckDB."""
    global _running, _run_tier, _run_start, _current_run_id
    try:
        models = _get_benchmark_models(scope)
        for model in models:
            result = _measure_model(model)
            result_id = str(uuid.uuid4())
            execute(
                "INSERT INTO benchmark_results "
                "(id, run_id, model, ttft_ms, total_latency_ms, tokens_per_sec, status, error_message) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (result_id, run_id, result["model"], result["ttft_ms"],
                 result["total_latency_ms"], result["tokens_per_sec"],
                 result["status"], result["error_message"]),
            )
        execute(
            "UPDATE benchmark_runs SET completed_at = ? WHERE run_id = ?",
            (datetime.now(timezone.utc).isoformat(), run_id),
        )
    except Exception:
        pass
    finally:
        with _state_lock:
            _running = False
            _run_tier = None
            _run_start = None
            _current_run_id = None


def _run_full_benchmark_wrapper(run_id: str, models: list[str]) -> None:
    """Background thread: runs full capability benchmark, clears running state on finish."""
    global _running, _run_tier, _run_start, _current_run_id
    try:
        from benchmark_tasks import run_full_benchmark
        run_full_benchmark(run_id, models)
    except Exception:
        pass
    finally:
        with _state_lock:
            _running = False
            _run_tier = None
            _run_start = None
            _current_run_id = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/benchmark/run", status_code=202)
def trigger_benchmark(
    tier: str = Query("short", regex="^(short|full)$"),
    scope: str = Query("all", regex="^(local|cloud|all)$"),
):
    if not LITELLM_BENCH_KEY:
        raise HTTPException(status_code=503, detail="LITELLM_BENCH_KEY not set")

    run_id = str(uuid.uuid4())

    with _state_lock:
        global _running, _run_tier, _run_start, _current_run_id
        if _running:
            raise HTTPException(status_code=409, detail="Benchmark already running")
        _running = True
        _run_tier = tier
        _run_start = datetime.now(timezone.utc)
        _current_run_id = run_id

    execute(
        "INSERT INTO benchmark_runs (run_id, started_at, tier) VALUES (?, ?, ?)",
        (run_id, datetime.now(timezone.utc).isoformat(), tier),
    )

    if tier == "short":
        t = threading.Thread(target=_run_short_benchmark, args=(run_id, scope), daemon=True)
    else:
        models = _get_benchmark_models(scope)
        t = threading.Thread(target=_run_full_benchmark_wrapper, args=(run_id, models), daemon=True)

    t.start()
    return {"run_id": run_id, "tier": tier, "status": "running"}


@router.get("/benchmark/status")
def get_benchmark_status():
    with _state_lock:
        return {
            "running": _running,
            "tier": _run_tier,
            "run_id": _current_run_id,
            "started_at": _run_start.isoformat() if _run_start else None,
        }


@router.get("/benchmark/task-results/{run_id}")
def get_task_results(run_id: str):
    rows = query(
        "SELECT model, task_name, score, skipped, judge_reasoning, response_preview "
        "FROM benchmark_task_results WHERE run_id = ? ORDER BY model, task_name",
        (run_id,),
    )
    result: dict = {}
    for model, task_name, score, skipped, reasoning, preview in rows:
        if model not in result:
            result[model] = {}
        result[model][task_name] = {
            "score": score,
            "skipped": bool(skipped),
            "reasoning": reasoning,
            "response_preview": preview,
        }
    return {"run_id": run_id, "results": result}


def _fetch_run_results(run_id: str) -> list[dict]:
    rows = query(
        "SELECT model, ttft_ms, total_latency_ms, tokens_per_sec, status, error_message "
        "FROM benchmark_results WHERE run_id = ? ORDER BY model",
        (run_id,),
    )
    cols = ["model", "ttft_ms", "total_latency_ms", "tokens_per_sec", "status", "error_message"]
    return [dict(zip(cols, r)) for r in rows]


@router.get("/benchmark/latest")
def get_benchmark_latest(tier: str | None = Query(None)):
    sql = "SELECT run_id, started_at, completed_at, tier FROM benchmark_runs"
    params: tuple = ()
    if tier:
        sql += " WHERE tier = ?"
        params = (tier,)
    sql += " ORDER BY started_at DESC LIMIT 1"
    rows = query(sql, params if params else None)
    if not rows:
        return {"run": None}
    run_id, started_at, completed_at, run_tier = rows[0]
    return {
        "run": {
            "run_id": run_id,
            "started_at": str(started_at),
            "completed_at": str(completed_at) if completed_at else None,
            "tier": run_tier or "short",
            "results": _fetch_run_results(run_id),
        }
    }


@router.get("/benchmark/history")
def get_benchmark_history(
    limit: int = Query(10, ge=1, le=50),
    tier: str | None = Query(None),
):
    sql = "SELECT run_id, started_at, completed_at, tier FROM benchmark_runs"
    params: list = []
    if tier:
        sql += " WHERE tier = ?"
        params.append(tier)
    sql += " ORDER BY started_at DESC LIMIT ?"
    params.append(limit)
    rows = query(sql, tuple(params))
    runs = []
    for run_id, started_at, completed_at, run_tier in rows:
        runs.append({
            "run_id": run_id,
            "started_at": str(started_at),
            "completed_at": str(completed_at) if completed_at else None,
            "tier": run_tier or "short",
            "results": _fetch_run_results(run_id),
        })
    return {"runs": runs}


# ---------------------------------------------------------------------------
# Model refresh
# ---------------------------------------------------------------------------

@router.post("/models/refresh")
def refresh_models():
    """Reload config.yaml and trigger immediate health ping."""
    from config_loader import reload_config, get_model_info_map
    from routers.model_health import ping_models_job
    try:
        reload_config()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Config reload failed: {e}")
    t = threading.Thread(target=ping_models_job, daemon=True)
    t.start()
    info_map = get_model_info_map()
    return {"status": "refreshed", "model_count": len(info_map)}
