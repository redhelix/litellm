from contextlib import asynccontextmanager
from fastapi import FastAPI
from db import get_connection, init_schema
from config_loader import load_config


@asynccontextmanager
async def lifespan(app: FastAPI):
    conn = get_connection()
    init_schema(conn)
    load_config("/app/config.yaml")
    yield


app = FastAPI(lifespan=lifespan, title="dashboard-sidecar")


@app.get("/healthz")
def healthz():
    return {"status": "ok"}
