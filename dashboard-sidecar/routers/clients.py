from fastapi import APIRouter, HTTPException, Query
from db import query

router = APIRouter(prefix="/api", tags=["clients"])

WINDOW_TO_SQL = {
    "1h":  "startTime > NOW() - INTERVAL 1 HOUR",
    "24h": "startTime > NOW() - INTERVAL 24 HOUR",
    "7d":  "startTime > NOW() - INTERVAL 7 DAY",
    "30d": "startTime > NOW() - INTERVAL 30 DAY",
}


@router.get("/clients")
def list_clients(window: str = Query("24h")):
    if window not in WINDOW_TO_SQL:
        raise HTTPException(status_code=400, detail=f"invalid window; allowed: {sorted(WINDOW_TO_SQL)}")
    where = WINDOW_TO_SQL[window]
    sql = f"""
        SELECT
            COALESCE(api_key_alias, requester_ip_address) AS client,
            COUNT(*)                                       AS requests,
            SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) AS errors
        FROM requests
        WHERE {where}
          AND (api_key_alias IS NOT NULL OR requester_ip_address IS NOT NULL)
        GROUP BY client
        ORDER BY requests DESC
        LIMIT 10
    """
    rows = query(sql)
    result = []
    for (client, requests, errors) in rows:
        error_rate = round(errors / requests, 4) if requests > 0 else 0.0
        result.append({
            "client": client,
            "requests": requests,
            "errors": errors,
            "error_rate": error_rate,
        })
    return result
