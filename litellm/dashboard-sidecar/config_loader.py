import yaml
import signal
import threading

_max_ctx: dict[str, int] = {}
_lock = threading.Lock()


def load_config(path: str = "/app/config.yaml") -> None:
    with open(path) as f:
        cfg = yaml.safe_load(f)
    mapping: dict[str, int] = {}
    for entry in cfg.get("model_list", []):
        name = entry.get("model_name")
        info = entry.get("model_info") or {}
        tokens = info.get("max_input_tokens")
        if not name or not tokens:
            continue
        # Per RESEARCH.md pitfall 4: nemotron-cascade-2 has two entries (65536, 32768).
        # Take max() so we never silently under-report the window size.
        if name in mapping:
            mapping[name] = max(mapping[name], int(tokens))
        else:
            mapping[name] = int(tokens)
    with _lock:
        global _max_ctx
        _max_ctx = mapping


def get_max_ctx() -> dict[str, int]:
    with _lock:
        return dict(_max_ctx)


def register_sighup(path: str) -> None:
    def handler(signum, frame):
        load_config(path)
    signal.signal(signal.SIGHUP, handler)
