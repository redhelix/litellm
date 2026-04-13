"""Prometheus HTTP API scraper (DATA-02, DATA-05 llm_api_latency).

Uses /api/v1/query with server-side histogram_quantile() computation.
MUST use [1h] rate window — shorter windows return NaN for infrequent models
(RESEARCH.md Pattern 3, Pitfall 2).

Called every 60s by the scheduler (Plan 05).
"""
from __future__ import annotations
import json
import logging
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Optional

from db import execute

log = logging.getLogger("prometheus_scraper")

DEFAULT_PROM_BASE = "http://192.168.50.117:9090"
HTTP_TIMEOUT_SEC = 10

# All histogram_quantile queries use [1h] rate window per RESEARCH pitfall 2.
QUERIES: dict[str, str] = {
    "ttft_p50":           "histogram_quantile(0.5, rate(litellm_llm_api_time_to_first_token_metric_bucket[1h]))",
    "ttft_p95":           "histogram_quantile(0.95, rate(litellm_llm_api_time_to_first_token_metric_bucket[1h]))",
    "total_latency_p50":  "histogram_quantile(0.5, rate(litellm_request_total_latency_metric_bucket[1h]))",
    "total_latency_p95":  "histogram_quantile(0.95, rate(litellm_request_total_latency_metric_bucket[1h]))",
    "llm_latency_p50":    "histogram_quantile(0.5, rate(litellm_llm_api_latency_metric_bucket[1h]))",
    "llm_latency_p95":    "histogram_quantile(0.95, rate(litellm_llm_api_latency_metric_bucket[1h]))",
    "tokens_per_sec_p50": "1 / histogram_quantile(0.5, rate(litellm_deployment_latency_per_output_token_bucket[1h]))",
    "deployment_state":   "litellm_deployment_state",
}

INSERT_SQL = """
    INSERT INTO latency_snapshots
        (scraped_at, model,
         ttft_p50, ttft_p95,
         total_latency_p50, total_latency_p95,
         llm_api_latency_p50, llm_api_latency_p95,
         tokens_per_sec, deployment_state)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""


def parse_value(v: str) -> Optional[float]:
    if v is None:
        return None
    if v == "NaN":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _fetch(prom_base: str, promql: str) -> list[dict]:
    url = f"{prom_base}/api/v1/query?query={urllib.parse.quote(promql)}"
    with urllib.request.urlopen(url, timeout=HTTP_TIMEOUT_SEC) as r:
        data = json.load(r)
    if data.get("status") != "success":
        log.warning("prometheus: non-success status: %s", data.get("status"))
        return []
    return data.get("data", {}).get("result", [])


def _extract_model(metric: dict) -> Optional[str]:
    return metric.get("model") or metric.get("litellm_model_name") or metric.get("model_name")


def scrape_once(prom_base: str = DEFAULT_PROM_BASE) -> int:
    """Scrape all QUERIES and write one row per model. Returns row count written."""
    scraped_at = datetime.now(timezone.utc)
    results: dict[str, dict[str, Optional[float]]] = {}

    for metric_name, promql in QUERIES.items():
        try:
            series = _fetch(prom_base, promql)
        except Exception as e:
            log.error("prometheus: %s fetch failed: %s", metric_name, e)
            continue
        for item in series:
            model = _extract_model(item.get("metric", {}))
            if not model:
                continue
            raw = item.get("value", [None, None])[1]
            val = parse_value(raw)
            results.setdefault(model, {})[metric_name] = val

    count = 0
    for model, vals in results.items():
        dep_state = vals.get("deployment_state")
        dep_state_int = int(dep_state) if dep_state is not None else None
        execute(INSERT_SQL, (
            scraped_at, model,
            vals.get("ttft_p50"), vals.get("ttft_p95"),
            vals.get("total_latency_p50"), vals.get("total_latency_p95"),
            vals.get("llm_latency_p50"), vals.get("llm_latency_p95"),
            vals.get("tokens_per_sec_p50"), dep_state_int,
        ))
        count += 1
    return count
