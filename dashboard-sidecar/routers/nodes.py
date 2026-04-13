from fastapi import APIRouter
from db import query

router = APIRouter(prefix="/api", tags=["nodes"])


@router.get("/nodes")
def list_nodes():
    state_sql = """
        SELECT model, deployment_state, scraped_at
        FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY model ORDER BY scraped_at DESC) AS rn
            FROM latency_snapshots
        ) WHERE rn = 1
    """
    last_req_sql = """
        SELECT model, MAX(startTime) FROM requests GROUP BY model
    """
    states = query(state_sql)
    last = {r[0]: r[1] for r in query(last_req_sql)}
    return {"nodes": [
        {"model": m, "deployment_state": d, "last_scrape": s, "last_request_time": last.get(m)}
        for (m, d, s) in states
    ]}
