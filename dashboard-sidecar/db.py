import duckdb
import threading
from pathlib import Path

_conn: duckdb.DuckDBPyConnection | None = None
_lock = threading.Lock()
DB_PATH = "/data/metrics.duckdb"


def get_connection() -> duckdb.DuckDBPyConnection:
    global _conn
    if _conn is None:
        Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
        _conn = duckdb.connect(DB_PATH)
        init_schema(_conn)
    return _conn


def init_schema(conn: duckdb.DuckDBPyConnection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS requests (
            request_id          TEXT PRIMARY KEY,
            startTime           TIMESTAMPTZ NOT NULL,
            model               TEXT,
            model_group         TEXT,
            prompt_tokens       INTEGER,
            completion_tokens   INTEGER,
            total_tokens        INTEGER,
            ttft_ms             DOUBLE,
            total_latency_ms    DOUBLE,
            status              TEXT,
            tool_call_status    TEXT,
            context_utilization DOUBLE,
            api_key_alias       TEXT,
            team_alias          TEXT,
            error_message       TEXT,
            requester_ip_address TEXT
        )
    """)
    # Backward-compat migration: add error_message to existing volume-mounted DBs
    try:
        conn.execute("ALTER TABLE requests ADD COLUMN error_message TEXT")
    except duckdb.Error:
        pass  # column already exists
    # Backward-compat migration: add requester_ip_address to existing volume-mounted DBs
    try:
        conn.execute("ALTER TABLE requests ADD COLUMN requester_ip_address TEXT")
    except duckdb.Error:
        pass  # column already exists
    conn.execute("CREATE SEQUENCE IF NOT EXISTS latency_snapshots_seq START 1")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS latency_snapshots (
            id                    INTEGER PRIMARY KEY DEFAULT nextval('latency_snapshots_seq'),
            scraped_at            TIMESTAMPTZ NOT NULL,
            model                 TEXT,
            ttft_p50              DOUBLE,
            ttft_p95              DOUBLE,
            total_latency_p50     DOUBLE,
            total_latency_p95     DOUBLE,
            llm_api_latency_p50   DOUBLE,
            llm_api_latency_p95   DOUBLE,
            tokens_per_sec        DOUBLE,
            deployment_state      INTEGER
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_requests_starttime ON requests (startTime DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_requests_model ON requests (model, startTime DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_snapshots_scraped ON latency_snapshots (scraped_at DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_snapshots_model ON latency_snapshots (model, scraped_at DESC)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS benchmark_runs (
            run_id      VARCHAR PRIMARY KEY,
            started_at  TIMESTAMPTZ NOT NULL,
            completed_at TIMESTAMPTZ
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS benchmark_results (
            id               VARCHAR PRIMARY KEY,
            run_id           VARCHAR NOT NULL,
            model            VARCHAR NOT NULL,
            ttft_ms          INTEGER,
            total_latency_ms INTEGER,
            tokens_per_sec   DOUBLE,
            status           VARCHAR NOT NULL,
            error_message    VARCHAR,
            FOREIGN KEY (run_id) REFERENCES benchmark_runs(run_id)
        )
    """)
    # Backward-compat migration: add tier column to benchmark_runs
    try:
        conn.execute("ALTER TABLE benchmark_runs ADD COLUMN tier VARCHAR DEFAULT 'short'")
    except duckdb.Error:
        pass  # column already exists

    conn.execute("""
        CREATE TABLE IF NOT EXISTS benchmark_task_results (
            id                VARCHAR PRIMARY KEY,
            run_id            VARCHAR NOT NULL,
            model             VARCHAR NOT NULL,
            task_name         VARCHAR NOT NULL,
            score             DOUBLE,
            skipped           BOOLEAN DEFAULT false,
            judge_reasoning   TEXT,
            response_preview  TEXT,
            FOREIGN KEY (run_id) REFERENCES benchmark_runs(run_id)
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS intelligence_cache (
            id              INTEGER PRIMARY KEY DEFAULT 1,
            generated_at    TIMESTAMPTZ NOT NULL,
            health_summary  TEXT,
            anomalies       TEXT,
            recommendations TEXT,
            hf_models       TEXT,
            model_used      TEXT
        )
    """)


def query(sql: str, params: tuple | None = None) -> list[tuple]:
    with _lock:
        conn = get_connection()
        cur = conn.execute(sql, params) if params else conn.execute(sql)
        return cur.fetchall()


def execute(sql: str, params: tuple | None = None) -> None:
    with _lock:
        conn = get_connection()
        if params:
            conn.execute(sql, params)
        else:
            conn.execute(sql)
