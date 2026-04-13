from fastapi import APIRouter, HTTPException, Query
from db import query

router = APIRouter(prefix="/api", tags=["requests"])

WINDOW_TO_SQL = {
    "5m": "startTime > NOW() - INTERVAL 5 MINUTE",
    "7d": "startTime > NOW() - INTERVAL 7 DAY",
    "30d": "startTime > NOW() - INTERVAL 30 DAY",
}


@router.get("/requests")
def list_requests(window: str = Query("5m"), limit: int = 100, offset: int = 0):
    if window not in WINDOW_TO_SQL:
        raise HTTPException(status_code=400, detail="invalid window")
    if limit < 1 or limit > 1000 or offset < 0:
        raise HTTPException(status_code=400, detail="invalid limit/offset")
    sql = f"""
        SELECT request_id, startTime, model, model_group,
               prompt_tokens, completion_tokens, total_tokens,
               ttft_ms, total_latency_ms, status, tool_call_status,
               context_utilization
        FROM requests
        WHERE {WINDOW_TO_SQL[window]}
        ORDER BY startTime DESC
        LIMIT ? OFFSET ?
    """
    rows = query(sql, (limit, offset))
    cols = ["request_id", "startTime", "model", "model_group",
            "prompt_tokens", "completion_tokens", "total_tokens",
            "ttft_ms", "total_latency_ms", "status", "tool_call_status",
            "context_utilization"]
    return {"rows": [dict(zip(cols, r)) for r in rows], "limit": limit, "offset": offset, "window": window}
