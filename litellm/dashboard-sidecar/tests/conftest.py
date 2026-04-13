import pytest
import duckdb
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import db as db_module


@pytest.fixture
def in_memory_db():
    conn = duckdb.connect(":memory:")
    db_module.init_schema(conn)
    yield conn
    conn.close()


@pytest.fixture
def fake_max_ctx():
    return {"spark-learner": 131072, "nemotron-cascade-2": 65536, "gpt-4o-mini": 128000}


@pytest.fixture
def tmp_repairs_log(tmp_path):
    p = tmp_path / "tool_repairs.jsonl"
    p.touch()
    return str(p)
