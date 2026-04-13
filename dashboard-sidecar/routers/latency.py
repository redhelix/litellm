from fastapi import APIRouter, HTTPException, Query
from db import query

router = APIRouter(prefix="/api", tags=["latency"])

WINDOW_TO_SQL = {
    "7d":  "scraped_at > NOW() - INTERVAL 7 DAY",
    "30d": "scraped_at > NOW() - INTERVAL 30 DAY",
}


@router.get("/latency/snapshots")
def latency_snapshots(model: str = Query(...), window: str = Query("7d")):
    if window not in WINDOW_TO_SQL:
        raise HTTPException(status_code=400, detail="invalid window")
    sql = f"""
        SELECT scraped_at, ttft_p50, ttft_p95,
               total_latency_p50, total_latency_p95,
               llm_api_latency_p50, llm_api_latency_p95,
               tokens_per_sec, deployment_state
        FROM latency_snapshots
        WHERE {WINDOW_TO_SQL[window]} AND model = ?
        ORDER BY scraped_at ASC
    """
    rows = query(sql, (model,))
    cols = ["scraped_at", "ttft_p50", "ttft_p95", "total_latency_p50", "total_latency_p95",
            "llm_api_latency_p50", "llm_api_latency_p95", "tokens_per_sec", "deployment_state"]
    return {"model": model, "window": window, "series": [dict(zip(cols, r)) for r in rows]}
