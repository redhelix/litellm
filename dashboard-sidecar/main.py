import os
import sys
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.background import BackgroundScheduler

from db import get_connection, init_schema
from config_loader import load_config, get_max_ctx, register_sighup
from repairs import RepairsLogReader
from poller import poll_once
from prometheus_scraper import scrape_once

from routers.requests import router as requests_router
from routers.models import router as models_router
from routers.nodes import router as nodes_router
from routers.latency import router as latency_router
from routers.trends import router as trends_router
from routers.config_diff import router as config_diff_router
from routers.benchmark import router as benchmark_router
from routers.clients import router as clients_router
from routers.model_health import router as model_health_router, ping_models_job

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("main")

DATABASE_URL = os.environ.get("DATABASE_URL")
PROMETHEUS_URL = os.environ.get("PROMETHEUS_URL", "http://192.168.50.117:9090")
CONFIG_YAML_PATH = os.environ.get("CONFIG_YAML_PATH", "/app/config.yaml")
TOOL_REPAIRS_LOG = os.environ.get("TOOL_REPAIRS_LOG", "/tmp/tool_repairs.jsonl")

# SYS-02 architectural guard: fail fast if master key somehow leaked into env.
assert "LITELLM_MASTER_KEY" not in os.environ, \
    "SYS-02 violation: LITELLM_MASTER_KEY must NOT be present in dashboard-sidecar env"

if not DATABASE_URL:
    print("FATAL: DATABASE_URL is required", file=sys.stderr)
    sys.exit(2)

scheduler: BackgroundScheduler | None = None
repairs_reader: RepairsLogReader | None = None


def _poll_job():
    try:
        poll_once(DATABASE_URL, repairs_reader, get_max_ctx())
    except Exception as e:
        log.exception("poll_once failed: %s", e)


def _scrape_job():
    try:
        scrape_once(PROMETHEUS_URL)
    except Exception as e:
        log.exception("scrape_once failed: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global scheduler, repairs_reader
    conn = get_connection()
    init_schema(conn)
    load_config(CONFIG_YAML_PATH)
    register_sighup(CONFIG_YAML_PATH)
    repairs_reader = RepairsLogReader(TOOL_REPAIRS_LOG)
    scheduler = BackgroundScheduler()
    scheduler.add_job(_poll_job, "interval", seconds=30, id="poll", max_instances=1)
    scheduler.add_job(_scrape_job, "interval", seconds=60, id="scrape", max_instances=1)
    scheduler.add_job(ping_models_job, "interval", seconds=30, id="ping_models", max_instances=1)
    scheduler.start()
    log.info("scheduler started: poll=30s, scrape=60s, ping=30s")
    yield
    if scheduler:
        scheduler.shutdown(wait=False)


app = FastAPI(lifespan=lifespan, title="dashboard-sidecar")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://docker-001:4002"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


app.include_router(requests_router)
app.include_router(models_router)
app.include_router(nodes_router)
app.include_router(latency_router)
app.include_router(trends_router)
app.include_router(config_diff_router)
app.include_router(benchmark_router)
app.include_router(clients_router)
app.include_router(model_health_router)
