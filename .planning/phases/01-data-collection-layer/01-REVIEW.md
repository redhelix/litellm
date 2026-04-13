---
phase: 01-data-collection-layer
reviewed: 2026-04-13T00:00:00Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - dashboard-sidecar/config_loader.py
  - dashboard-sidecar/db.py
  - dashboard-sidecar/main.py
  - dashboard-sidecar/poller.py
  - dashboard-sidecar/repairs.py
  - dashboard-sidecar/routers/__init__.py
  - dashboard-sidecar/routers/latency.py
  - dashboard-sidecar/routers/models.py
  - dashboard-sidecar/routers/nodes.py
  - dashboard-sidecar/routers/requests.py
  - dashboard-sidecar/tests/conftest.py
  - dashboard-sidecar/tests/test_context_util.py
  - dashboard-sidecar/tests/test_latency_fields.py
  - dashboard-sidecar/tests/test_poller.py
  - dashboard-sidecar/tests/test_tool_repair.py
  - docker-compose.yaml
  - fix_json_tool_calls.py
findings:
  critical: 2
  warning: 5
  info: 3
  total: 10
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-04-13T00:00:00Z
**Depth:** standard
**Files Reviewed:** 17
**Status:** issues_found

## Summary

Reviewed the full data-collection-layer implementation: Postgres-to-DuckDB poller, repair log tailer, config loader, FastAPI routers, and the `fix_json_tool_calls.py` LiteLLM callback. The architecture is sound and the bounded-query convention is respected. Two critical issues were found: a hardcoded database password in `docker-compose.yaml` that is replicated verbatim into service environment variables, and a thread-safety bug in `db.py` where `get_connection()` is called outside the lock but `_conn` is mutated inside it. Five warnings cover logic and reliability gaps in the poller, the SIGHUP handler, and the DuckDB connection model.

---

## Critical Issues

### CR-01: Hardcoded Postgres Password in docker-compose.yaml

**File:** `docker-compose.yaml:9` and `docker-compose.yaml:61` and `docker-compose.yaml:119`
**Issue:** The Postgres password `litellm-synergy-2026` is hardcoded directly in the compose file — once in the `db` service definition and twice in `DATABASE_URL` strings passed to `litellm` and `dashboard-sidecar`. Anyone with read access to the repo or the running container's environment can extract the credential. Even if `.env` substitution is used for the master key, the database password bypasses that protection entirely.
**Fix:**
```yaml
# In docker-compose.yaml, replace hardcoded password with a variable:
db:
  environment:
    - POSTGRES_USER=${POSTGRES_USER:-litellm}
    - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}   # no default — must be set
    - POSTGRES_DB=${POSTGRES_DB:-litellm}

litellm:
  environment:
    - DATABASE_URL=postgresql://${POSTGRES_USER:-litellm}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB:-litellm}?connect_timeout=10

dashboard-sidecar:
  environment:
    - DATABASE_URL=postgresql://${POSTGRES_USER:-litellm}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB:-litellm}?connect_timeout=10
```
Store the actual password in a `.env` file that is git-ignored.

---

### CR-02: Race Condition in db.py get_connection() — Double-Checked Locking Broken

**File:** `dashboard-sidecar/db.py:10-16`
**Issue:** `get_connection()` reads `_conn` on line 11 without holding `_lock`, then initialises it inside `query()` / `execute()` which acquire the lock later. Because DuckDB's single-file connection is not thread-safe for concurrent writers, two threads can simultaneously observe `_conn is None`, both call `duckdb.connect()`, and create two connections to the same file. The second `duckdb.connect()` on an already-open file raises an error or silently opens a second read-write handle depending on DuckDB version.

```python
# Current — racy
def get_connection() -> duckdb.DuckDBPyConnection:
    global _conn
    if _conn is None:                  # read outside lock
        Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
        _conn = duckdb.connect(DB_PATH)
        init_schema(_conn)
    return _conn
```

**Fix:**
```python
def get_connection() -> duckdb.DuckDBPyConnection:
    global _conn
    # _lock must already be held by the caller (query/execute acquire it).
    # Do NOT call get_connection() without holding _lock.
    if _conn is None:
        Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
        _conn = duckdb.connect(DB_PATH)
        init_schema(_conn)
    return _conn
```
And enforce the invariant by calling `get_connection()` only from within the `with _lock:` blocks in `query()` and `execute()` — which is already the case for those two functions. The real fix is to document (or assert) that `get_connection()` must only be called under the lock, and to remove the call in `main.py` line 56 (`conn = get_connection()`) which is made from the async lifespan without holding the lock.

---

## Warnings

### WR-01: poll_once Uses a Function Attribute for Mutable State — Fragile Pattern

**File:** `dashboard-sidecar/poller.py:115-118`
**Issue:** `poll_once._known_repairs` is initialised with `hasattr` on the function object. This is an unconventional Python pattern that is invisible to type checkers, not reset between test runs (the function object persists for the process lifetime), and makes unit-testing `poll_once` with a clean state impossible without monkeypatching the function attribute.
**Fix:** Move `_known_repairs` to module level or, better, encapsulate `poll_once` state into a `Poller` class with `self._known_repairs: set[str] = set()`.

---

### WR-02: SIGHUP Handler Calls Non-Signal-Safe Code

**File:** `dashboard-sidecar/config_loader.py:36-38`
**Issue:** The SIGHUP handler calls `load_config()`, which opens a file, parses YAML, and acquires `_lock`. POSIX signal handlers must only call async-signal-safe functions. Calling into PyYAML's parser or `threading.Lock.acquire()` from a signal handler can deadlock if the main thread is holding `_lock` when the signal fires (e.g., during a concurrent `get_max_ctx()` call). This is a low-probability but un-diagnosable deadlock.
**Fix:** Use a flag-based approach: set a `threading.Event` in the signal handler, and check + reload in the scheduler's poll job.
```python
_reload_needed = threading.Event()

def register_sighup(path: str) -> None:
    def handler(signum, frame):
        _reload_needed.set()          # async-signal-safe
    signal.signal(signal.SIGHUP, handler)

def maybe_reload(path: str) -> None:
    if _reload_needed.is_set():
        _reload_needed.clear()
        load_config(path)
```

---

### WR-03: conn.close() Called Twice in poll_once on Query Failure Path

**File:** `dashboard-sidecar/poller.py:131-138`
**Issue:** When the `cur.execute()` call at line 129 raises `psycopg2.Error`, the `except` block calls `conn.close()` at line 132, and then the `finally` block also calls `conn.close()` at line 137. Calling `close()` twice on a psycopg2 connection raises `InterfaceError: connection already closed`. While this error is itself caught by the bare `except Exception`, it introduces spurious noise and masks whether the original error was handled.
**Fix:** Remove the `conn.close()` from the `except` block and rely solely on the `finally` block:
```python
    try:
        cur = conn.cursor()
        cur.execute(SELECT_SQL, (watermark,))
        rows = cur.fetchall()
    except psycopg2.Error as e:
        log.error("poller: query failed: %s", e)
        rows = []           # fall through to finally for close
    finally:
        try:
            conn.close()
        except Exception:
            pass
    if not rows:
        return 0
```

---

### WR-04: SQL Injection in latency.py via Unparameterised WINDOW_TO_SQL Interpolation

**File:** `dashboard-sidecar/routers/latency.py:16-24`
**Issue:** The `window` parameter is validated against `WINDOW_TO_SQL` (line 14), so the set of interpolated strings is fixed — this is not exploitable as written. However the pattern of string-formatting a validated value directly into SQL (`WHERE {WINDOW_TO_SQL[window]} AND model = ?`) is fragile: if the validation guard is ever removed or bypassed (e.g., a refactor that adds a new code path), it becomes an injection vector. The same pattern exists in `routers/requests.py:19-26`.
**Fix:** Move the time-window clause to a parameterised form using DuckDB's `NOW() - INTERVAL ? DAY` syntax, or keep a whitelist but add an explicit assertion before the f-string interpolation to make the intent clear and make future regressions fail loudly:
```python
assert window in WINDOW_TO_SQL, f"window {window!r} not in whitelist"  # belt-and-suspenders
sql = f"... WHERE {WINDOW_TO_SQL[window]} AND model = ?"
```

---

### WR-05: main.py Calls get_connection() Outside the db._lock — Breaks Invariant

**File:** `dashboard-sidecar/main.py:56-57`
**Issue:** The lifespan function calls `get_connection()` and `init_schema()` directly at startup, bypassing the `_lock` that `query()` and `execute()` use. If the scheduler starts its first `_poll_job` before the lifespan `yield`, `get_connection()` can be called concurrently from two goroutines with `_conn is None`. (This is the same root cause as CR-02 but a distinct call site.)
**Fix:** Remove the explicit `get_connection()` / `init_schema()` call from lifespan. The first `query()` or `execute()` call from `poll_once` will initialise the connection under lock automatically. If eager initialisation is desired for fail-fast behaviour, wrap the call:
```python
with db._lock:
    db.get_connection()   # initialises and runs init_schema under lock
```

---

## Info

### IN-01: asyncio.get_event_loop() Deprecated in Tests

**File:** `dashboard-sidecar/tests/test_tool_repair.py:97` and `:142`
**Issue:** `asyncio.get_event_loop().run_until_complete(...)` is deprecated since Python 3.10 and raises a `DeprecationWarning` in 3.12+. In Python 3.12 the implicit loop creation was removed.
**Fix:** Replace with `asyncio.run(...)`:
```python
asyncio.run(handler.async_post_call_success_hook({}, None, resp))
```

---

### IN-02: Magic Number — PROMETHEUS_URL Hardcoded as Default in main.py

**File:** `dashboard-sidecar/main.py:23`
**Issue:** `"http://192.168.50.117:9090"` is a site-specific LAN address embedded as a default. It is already overridable via `PROMETHEUS_URL` env var (and the compose file sets it), but the hardcoded default will silently produce wrong behaviour in any environment that does not set the variable explicitly.
**Fix:** Change the default to `""` or `None` and guard against it:
```python
PROMETHEUS_URL = os.environ.get("PROMETHEUS_URL") or ""
# In _scrape_job:
if not PROMETHEUS_URL:
    log.warning("PROMETHEUS_URL not set; skipping scrape")
    return
```

---

### IN-03: repaired=True Filter Silently Drops Non-Boolean repaired Values

**File:** `dashboard-sidecar/repairs.py:37`
**Issue:** The filter `obj.get("repaired") is True` uses identity comparison. If a future emitter writes `"repaired": 1` or `"repaired": "true"`, the line is silently dropped. The emit side (`fix_json_tool_calls.py:96`) always writes `True`, so this is not currently a bug, but it is a fragility worth noting.
**Fix:** Use `==` instead of `is` for the boolean check:
```python
if obj.get("repaired") == True and obj.get("request_id"):
```

---

_Reviewed: 2026-04-13T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
