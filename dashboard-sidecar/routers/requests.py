from fastapi import APIRouter, HTTPException, Query
from db import query

router = APIRouter(prefix="/api", tags=["requests"])

WINDOW_TO_SQL = {
    "5m": "startTime > NOW() - INTERVAL 5 MINUTE",
    "7d": "startTime > NOW() - INTERVAL 7 DAY",
    "30d": "startTime > NOW() - INTERVAL 30 DAY",
}


@router.get("/requests")
def list_requests(
    window: str = Query("30d"),
    limit: int = 100,
    offset: int = 0,
    model: str | None = Query(None),
):
    if window not in WINDOW_TO_SQL:
        raise HTTPException(status_code=400, detail="invalid window")
    if limit < 1 or limit > 1000 or offset < 0:
        raise HTTPException(status_code=400, detail="invalid limit/offset")
    if offset >= 500:
        raise HTTPException(status_code=400, detail="offset must be < 500")

    where = WINDOW_TO_SQL[window]
    params_count: list = []
    params_rows: list = []
    if model is not None:
        where += " AND model = ?"
        params_count = [model]
        params_rows = [model, limit, offset]
    else:
        params_count = []
        params_rows = [limit, offset]

    count_sql = f"SELECT MIN(cnt, 500) FROM (SELECT COUNT(*) AS cnt FROM requests WHERE {where})"
    total = query(count_sql, tuple(params_count))[0][0]

    sql = f"""
        SELECT request_id, startTime, model, model_group,
               prompt_tokens, completion_tokens, total_tokens,
               ttft_ms, total_latency_ms, status, tool_call_status,
               context_utilization
        FROM requests
        WHERE {where}
        ORDER BY startTime DESC
        LIMIT ? OFFSET ?
    """
    rows = query(sql, tuple(params_rows))
    cols = ["request_id", "startTime", "model", "model_group",
            "prompt_tokens", "completion_tokens", "total_tokens",
            "ttft_ms", "total_latency_ms", "status", "tool_call_status",
            "context_utilization"]
    return {
        "rows": [dict(zip(cols, r)) for r in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
        "window": window,
    }
