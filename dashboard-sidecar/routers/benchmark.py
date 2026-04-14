import os
import json
import uuid
import time
import threading
import urllib.request
import urllib.error
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Query
from db import execute, query

router = APIRouter(prefix="/api", tags=["benchmark"])

LITELLM_PROXY_URL = os.environ.get("LITELLM_PROXY_URL", "http://192.168.50.117:4000")
LITELLM_BENCH_KEY = os.environ.get("LITELLM_BENCH_KEY", "")

# Known model aliases benchmarked per run
BENCH_MODELS = [
    "gpt-4o", "gpt-4o-mini", "claude-3-5-sonnet", "claude-3-haiku",
    "deepseek-r1", "qwq-32b", "llama-3.3-70b",
]

BENCH_PROMPT = [{"role": "user", "content": "Reply with exactly: ok"}]
TIMEOUT_S = 30


def _measure_model(model: str) -> dict:
    """
    Fire a single streaming chat completion to the proxy, measure TTFT
    and total latency. Returns a BenchmarkResult dict.
    Uses urllib.request (stdlib only — no extra deps). (T-04-02-04: positional params)
    """
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


def _run_benchmark(run_id: str):
    """Background thread: measures all models, writes results to DuckDB."""
    for model in BENCH_MODELS:
        result = _measure_model(model)
        result_id = str(uuid.uuid4())
        # T-04-02-04: positional params only, no f-string interpolation in SQL
        execute(
            """INSERT INTO benchmark_results
               (id, run_id, model, ttft_ms, total_latency_ms, tokens_per_sec, status, error_message)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (result_id, run_id, result["model"], result["ttft_ms"],
             result["total_latency_ms"], result["tokens_per_sec"],
             result["status"], result["error_message"]),
        )
    execute(
        "UPDATE benchmark_runs SET completed_at = ? WHERE run_id = ?",
        (datetime.now(timezone.utc).isoformat(), run_id),
    )


@router.post("/benchmark/run", status_code=202)
def trigger_benchmark():
    if not LITELLM_BENCH_KEY:
        raise HTTPException(status_code=503, detail="LITELLM_BENCH_KEY not set")
    run_id = str(uuid.uuid4())
    execute(
        "INSERT INTO benchmark_runs (run_id, started_at) VALUES (?, ?)",
        (run_id, datetime.now(timezone.utc).isoformat()),
    )
    t = threading.Thread(target=_run_benchmark, args=(run_id,), daemon=True)
    t.start()
    return {"run_id": run_id, "status": "running"}


def _fetch_run_results(run_id: str) -> list[dict]:
    rows = query(
        """SELECT model, ttft_ms, total_latency_ms, tokens_per_sec, status, error_message
           FROM benchmark_results WHERE run_id = ? ORDER BY model""",
        (run_id,),
    )
    cols = ["model", "ttft_ms", "total_latency_ms", "tokens_per_sec", "status", "error_message"]
    return [dict(zip(cols, r)) for r in rows]


@router.get("/benchmark/latest")
def get_benchmark_latest():
    rows = query(
        "SELECT run_id, started_at, completed_at FROM benchmark_runs ORDER BY started_at DESC LIMIT 1",
        (),
    )
    if not rows:
        return {"run": None}
    run_id, started_at, completed_at = rows[0]
    return {
        "run": {
            "run_id": run_id,
            "started_at": str(started_at),
            "completed_at": str(completed_at) if completed_at else None,
            "results": _fetch_run_results(run_id),
        }
    }


@router.get("/benchmark/history")
def get_benchmark_history(limit: int = Query(10, ge=1, le=50)):
    rows = query(
        "SELECT run_id, started_at, completed_at FROM benchmark_runs ORDER BY started_at DESC LIMIT ?",
        (limit,),
    )
    runs = []
    for run_id, started_at, completed_at in rows:
        runs.append({
            "run_id": run_id,
            "started_at": str(started_at),
            "completed_at": str(completed_at) if completed_at else None,
            "results": _fetch_run_results(run_id),
        })
    return {"runs": runs}
