from fastapi import APIRouter
from db import query

router = APIRouter(prefix="/api", tags=["models"])


@router.get("/models")
def per_model_aggregates():
    # Latest Prometheus snapshot per model
    snap_sql = """
        SELECT model, ttft_p50, ttft_p95,
               total_latency_p50, total_latency_p95,
               llm_api_latency_p50, llm_api_latency_p95,
               tokens_per_sec
        FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY model ORDER BY scraped_at DESC) AS rn
            FROM latency_snapshots
        )
        WHERE rn = 1
    """
    snaps = {r[0]: r for r in query(snap_sql)}

    # Per-model tool-call rates + avg context utilization over last 1h
    agg_sql = """
        SELECT model,
               SUM(CASE WHEN tool_call_status='success'  THEN 1 ELSE 0 END) AS n_success,
               SUM(CASE WHEN tool_call_status='repaired' THEN 1 ELSE 0 END) AS n_repaired,
               SUM(CASE WHEN tool_call_status='failed'   THEN 1 ELSE 0 END) AS n_failed,
               AVG(context_utilization) AS avg_ctx_util
        FROM requests
        WHERE startTime > NOW() - INTERVAL 1 HOUR
        GROUP BY model
    """
    aggs = {r[0]: r for r in query(agg_sql)}

    out = []
    for model in set(list(snaps.keys()) + list(aggs.keys())):
        s = snaps.get(model)
        a = aggs.get(model)
        total_p50 = s[3] if s else None
        llm_p50 = s[5] if s else None
        overhead_p50 = (total_p50 - llm_p50) if (total_p50 is not None and llm_p50 is not None) else None
        n_success = a[1] if a else 0
        n_repaired = a[2] if a else 0
        n_failed = a[3] if a else 0
        total = (n_success or 0) + (n_repaired or 0) + (n_failed or 0)

        def rate(n, _total=total):
            return (n / _total) if _total else None

        out.append({
            "model": model,
            "ttft_p50": s[1] if s else None,
            "ttft_p95": s[2] if s else None,
            "total_latency_p50": total_p50,
            "total_latency_p95": s[4] if s else None,
            "llm_api_latency_p50": llm_p50,
            "llm_api_latency_p95": s[6] if s else None,
            "overhead_ms_p50": overhead_p50,
            "tokens_per_sec": s[7] if s else None,
            "tool_call_rates": {
                "success": rate(n_success),
                "repaired": rate(n_repaired),
                "failed": rate(n_failed),
            },
            "avg_context_utilization": a[4] if a else None,
        })
    return {"models": out}
