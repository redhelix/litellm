"""Postgres -> DuckDB ingestion poller (DATA-01, DATA-03, DATA-05).

Runs every 30s via APScheduler (scheduler wired in Plan 05). Opens a fresh
psycopg2 connection each poll (per RESEARCH Pattern 2) and upserts into DuckDB
via the single shared connection in db.py.

Bounded-query mandate (QUERY-CONVENTIONS.md): every query MUST include
`AND "startTime" > NOW() - INTERVAL '5 minutes'`. Code review gate.
"""
from __future__ import annotations
import sys
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import psycopg2

from db import query, execute
from repairs import RepairsLogReader

log = logging.getLogger("poller")

POLL_INTERVAL_SQL = "INTERVAL '5 minutes'"  # QUERY-CONVENTIONS.md mandate

SELECT_SQL = """
    SELECT request_id,
           "startTime",
           "endTime",
           "completionStartTime",
           model,
           model_group,
           prompt_tokens,
           completion_tokens,
           total_tokens,
           status,
           api_key,
           metadata,
           metadata::jsonb->'error_information'->>'error_message' AS error_message
           ,requester_ip_address
    FROM "LiteLLM_SpendLogs"
    WHERE "startTime" > %s
      AND "startTime" > NOW() - INTERVAL '5 minutes'
    ORDER BY "startTime" ASC
"""

UPSERT_SQL = """
    INSERT INTO requests (
        request_id, startTime, model, model_group,
        prompt_tokens, completion_tokens, total_tokens,
        ttft_ms, total_latency_ms, status, tool_call_status,
        context_utilization, api_key_alias, team_alias, error_message,
        requester_ip_address
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (request_id) DO UPDATE SET
        ttft_ms             = EXCLUDED.ttft_ms,
        total_latency_ms    = EXCLUDED.total_latency_ms,
        status              = EXCLUDED.status,
        tool_call_status    = EXCLUDED.tool_call_status,
        context_utilization = EXCLUDED.context_utilization,
        error_message       = EXCLUDED.error_message
"""


def get_watermark() -> datetime:
    rows = query("SELECT MAX(startTime) FROM requests")
    if rows and rows[0][0]:
        return rows[0][0]
    return datetime.now(timezone.utc) - timedelta(minutes=5)


def compute_ttft_ms(start: Optional[datetime], completion_start: Optional[datetime]) -> Optional[float]:
    if start is None or completion_start is None:
        return None
    return (completion_start - start).total_seconds() * 1000.0


def compute_total_latency_ms(start: Optional[datetime], end: Optional[datetime]) -> Optional[float]:
    if start is None or end is None:
        return None
    return (end - start).total_seconds() * 1000.0


def compute_context_utilization(prompt_tokens: Optional[int], model: str, max_ctx: dict[str, int]) -> Optional[float]:
    if prompt_tokens is None or model not in max_ctx:
        return None
    return float(prompt_tokens) / float(max_ctx[model])


def classify_tool_status(row_status: str, request_id: str, repair_ids: set[str]) -> str:
    if row_status == "failure":
        return "failed"
    if request_id in repair_ids:
        return "repaired"
    return "success"


def _extract_aliases(metadata) -> tuple[Optional[str], Optional[str]]:
    """Best-effort extraction of api_key_alias / team_alias from metadata JSONB."""
    if metadata is None:
        return None, None
    meta = metadata
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except json.JSONDecodeError:
            return None, None
    if not isinstance(meta, dict):
        return None, None
    user_api = meta.get("user_api_key_alias") or meta.get("api_key_alias")
    team = meta.get("user_api_key_team_alias") or meta.get("team_alias")
    return user_api, team


def poll_once(pg_url: str, repairs_reader: RepairsLogReader, max_ctx: dict[str, int]) -> int:
    """Returns the number of rows ingested this poll."""
    repair_ids = repairs_reader.read_new()
    # Accumulate repair_ids across polls so the match window is not limited to this tick
    if not hasattr(poll_once, "_known_repairs"):
        poll_once._known_repairs = set()
    poll_once._known_repairs |= repair_ids
    known = poll_once._known_repairs

    watermark = get_watermark()
    try:
        conn = psycopg2.connect(pg_url, connect_timeout=10)
    except psycopg2.OperationalError as e:
        log.error("poller: postgres connect failed: %s", e)
        return 0
    try:
        cur = conn.cursor()
        cur.execute(SELECT_SQL, (watermark,))
        rows = cur.fetchall()
    except psycopg2.Error as e:
        log.error("poller: query failed: %s", e)
        conn.close()
        return 0
    finally:
        try:
            conn.close()
        except Exception:
            pass

    count = 0
    for row in rows:
        (request_id, start, end, cstart, model, model_group,
         pt, ct, tt, status, api_key, metadata, error_message, requester_ip) = row
        ttft_ms = compute_ttft_ms(start, cstart)
        total_ms = compute_total_latency_ms(start, end)
        ctx_util = compute_context_utilization(pt, model, max_ctx)
        tool_status = classify_tool_status(status, request_id, known)
        api_alias, team_alias = _extract_aliases(metadata)
        execute(UPSERT_SQL, (
            request_id, start, model, model_group,
            pt, ct, tt,
            ttft_ms, total_ms, status, tool_status,
            ctx_util, api_alias, team_alias, error_message,
            requester_ip,
        ))
        count += 1
    return count
