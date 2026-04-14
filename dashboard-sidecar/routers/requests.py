from fastapi import APIRouter, HTTPException, Query
from db import query

router = APIRouter(prefix="/api", tags=["requests"])

WINDOW_TO_SQL = {
    "5m": "startTime > NOW() - INTERVAL 5 MINUTE",
    "7d": "startTime > NOW() - INTERVAL 7 DAY",
    "30d": "startTime > NOW() - INTERVAL 30 DAY",
}

# Whitelisted sort column names — never interpolate raw user input into SQL
SORT_COLUMNS = {
    "startTime": "startTime",
    "ttft_ms": "ttft_ms",
    "total_latency_ms": "total_latency_ms",
}

SORT_DIRS = {
    "asc": "ASC",
    "desc": "DESC",
}

STATUS_VALUES = {"success", "repaired", "failed"}


@router.get("/requests")
def list_requests(
    window: str = Query("30d"),
    limit: int = 100,
    offset: int = 0,
    model: str | None = Query(None),
    sort_by: str = Query("startTime"),
    sort_dir: str = Query("desc"),
    status_filter: str | None = Query(None),
):
    if window not in WINDOW_TO_SQL:
        raise HTTPException(status_code=400, detail="invalid window")
    if limit < 1 or limit > 1000 or offset < 0:
        raise HTTPException(status_code=400, detail="invalid limit/offset")
    if offset >= 500:
        raise HTTPException(status_code=400, detail="offset must be < 500")
    if sort_by not in SORT_COLUMNS:
        raise HTTPException(status_code=400, detail=f"invalid sort_by; allowed: {sorted(SORT_COLUMNS)}")
    if sort_dir not in SORT_DIRS:
        raise HTTPException(status_code=400, detail="invalid sort_dir; allowed: asc, desc")
    if status_filter is not None and status_filter not in STATUS_VALUES:
        raise HTTPException(status_code=400, detail=f"invalid status_filter; allowed: {sorted(STATUS_VALUES)}")

    where = WINDOW_TO_SQL[window]
    params_count: list = []
    params_rows: list = []

    if model is not None:
        where += " AND model = ?"
        params_count.append(model)
        params_rows.append(model)

    if status_filter is not None:
        where += " AND tool_call_status = ?"
        params_count.append(status_filter)
        params_rows.append(status_filter)

    params_rows += [limit, offset]

    count_sql = f"SELECT MIN(cnt, 500) FROM (SELECT COUNT(*) AS cnt FROM requests WHERE {where})"
    total = query(count_sql, tuple(params_count))[0][0]

    # Use only whitelist-mapped column and direction values — no raw user input in SQL
    order_col = SORT_COLUMNS[sort_by]
    order_dir = SORT_DIRS[sort_dir]

    sql = f"""
        SELECT request_id, startTime, model, model_group,
               prompt_tokens, completion_tokens, total_tokens,
               ttft_ms, total_latency_ms, status, tool_call_status,
               context_utilization, error_message,
               api_key_alias, requester_ip_address
        FROM requests
        WHERE {where}
        ORDER BY {order_col} {order_dir} NULLS LAST, startTime DESC
        LIMIT ? OFFSET ?
    """
    rows = query(sql, tuple(params_rows))
    cols = ["request_id", "startTime", "model", "model_group",
            "prompt_tokens", "completion_tokens", "total_tokens",
            "ttft_ms", "total_latency_ms", "status", "tool_call_status",
            "context_utilization", "error_message",
            "api_key_alias", "requester_ip_address"]
    return {
        "rows": [dict(zip(cols, r)) for r in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
        "window": window,
    }
