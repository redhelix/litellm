from fastapi import APIRouter, HTTPException, Query
from db import query

router = APIRouter(prefix="/api", tags=["trends"])

WINDOW_TO_SQL = {
    "7d":  "startTime > NOW() - INTERVAL 7 DAY",
    "30d": "startTime > NOW() - INTERVAL 30 DAY",
}


@router.get("/trends")
def get_trends(model: str = Query(...), window: str = Query("7d")):
    if window not in WINDOW_TO_SQL:
        raise HTTPException(status_code=400, detail="invalid window — must be 7d or 30d")
    sql = f"""
        SELECT
            CAST(DATE_TRUNC('day', startTime) AS DATE) AS day,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_latency_ms) AS latency_p95,
            AVG(context_utilization)                                         AS avg_context_utilization,
            SUM(CASE WHEN tool_call_status IN ('failed','repaired') THEN 1 ELSE 0 END)::DOUBLE
                / NULLIF(COUNT(*), 0)                                        AS error_repair_rate
        FROM requests
        WHERE {WINDOW_TO_SQL[window]} AND model = ?
        GROUP BY 1
        ORDER BY 1 ASC
    """
    rows = query(sql, (model,))
    cols = ["day", "latency_p95", "avg_context_utilization", "error_repair_rate"]
    series = []
    for r in rows:
        row_dict = dict(zip(cols, r))
        row_dict["day"] = str(row_dict["day"])
        series.append(row_dict)
    return {"model": model, "window": window, "series": series}
