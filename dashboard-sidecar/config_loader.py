import yaml
import signal
import threading

_max_ctx: dict[str, int] = {}
_model_info: dict[str, dict] = {}
_lock = threading.Lock()

CLOUD_HOSTS = {
    "api.openai.com", "openrouter.ai", "generativelanguage.googleapis.com",
    "api.anthropic.com", "api.perplexity.ai",
}

# Fallback context window sizes for deployed aliases whose YAML entries may not
# declare max_input_tokens (e.g., embedding models, proxy aliases).
# Sources:
#   gemma-4-31b:             131072  — Gemma 4 31B default (Google DeepMind spec)
#   nemotron-cascade-2:      65536   — max of two config entries (RESEARCH pitfall 4)
#   spark-learner:           131072  — from deployed config.yaml
#   nomic-embed-text:        8192    — Nomic Embed v1 spec (embedding input cap)
#   google/gemini-2.5-flash: 1048576 — Gemini 2.5 Flash (Google AI docs)
#   openai/nemotron-cascade-2: 65536 — proxy alias for nemotron-cascade-2 underlying model
#   openai/spark-learner:    131072  — proxy alias for spark-learner underlying model
# Extra model_group aliases that appear in spend_logs but have no model_name entry
# in config.yaml (clients send these strings directly). Maps alias → known api_base.
EXTRA_MODEL_INFO: dict[str, dict] = {
    # model_group aliases from spend_logs that have no matching model_name in config.yaml
    "nemotron-3-super": {
        "backend_model": "openai/nemotron-3-super",
        "api_base": "http://100.123.128.107:8000/v1",
        "provider": "openai",
    },
    "openai/nemotron-3-super": {
        "backend_model": "openai/nemotron-3-super",
        "api_base": "http://100.123.128.107:8000/v1",
        "provider": "openai",
    },
    "openai/nemotron-cascade-2": {
        "backend_model": "openai/nemotron-cascade-2",
        "api_base": "http://192.168.50.73:8000/v1",
        "provider": "openai",
    },
    "openai/spark-learner": {
        "backend_model": "openai/spark-learner",
        "api_base": "http://100.115.141.106:8000/v1",
        "provider": "openai",
    },
    "gemma-4-31b": {
        "backend_model": "openai/gemma-4-31b",
        "api_base": "http://192.168.50.79:9005/v1",
        "provider": "openai",
    },
    "openai/gemma-4-31b": {
        "backend_model": "openai/gemma-4-31b",
        "api_base": "http://192.168.50.79:9005/v1",
        "provider": "openai",
    },
    "ollama/nomic-embed-text": {
        "backend_model": "ollama/nomic-embed-text",
        "api_base": "http://192.168.50.73:11434",
        "provider": "ollama",
    },
}

# Models to hide from the dashboard. These are either retired (historical requests
# exist in DuckDB but they're no longer deployed) or redundant aliases that would
# create duplicate cards. LiteLLM routing is unaffected — only the dashboard view
# is filtered.
HIDDEN_MODELS: frozenset[str] = frozenset({
    "gemma4-26b",       # alias → nemotron-cascade-2 (duplicate card)
    "qwq-32b",          # retired — no longer deployed
    "deepseek-r1",      # retired — no longer deployed
    "gpt-4o",           # not deployed in this lab
    "claude-3-5-sonnet",# not deployed in this lab
    "claude-3-haiku",   # not deployed in this lab
    "google/gemini-2.5-flash",  # not deployed (external, not part of lab)
    "gpt-4o-mini",      # not deployed in this lab
    "llama-3.3-70b",    # retired — no longer deployed
})

FALLBACK_CTX_MAP: dict[str, int] = {
    "gemma-4-31b":              131072,
    "nemotron-cascade-2":       65536,
    "spark-learner":            131072,
    "nomic-embed-text":         8192,
    "google/gemini-2.5-flash":  1048576,
    "openai/nemotron-cascade-2": 65536,
    "openai/spark-learner":     131072,
}


def load_config(path: str = "/app/config.yaml") -> None:
    with open(path) as f:
        cfg = yaml.safe_load(f)
    mapping: dict[str, int] = {}
    for entry in cfg.get("model_list", []):
        name = entry.get("model_name")
        # Check top-level model_info first, then litellm_params.model_info nesting
        info = entry.get("model_info") or {}
        tokens = info.get("max_input_tokens")
        if tokens is None:
            # Some entries nest under litellm_params
            lp = entry.get("litellm_params") or {}
            lp_info = lp.get("model_info") or {}
            tokens = lp_info.get("max_input_tokens")
        if not name or not tokens:
            continue
        # Per RESEARCH.md pitfall 4: nemotron-cascade-2 has two entries (65536, 32768).
        # Take max() so we never silently under-report the window size.
        if name in mapping:
            mapping[name] = max(mapping[name], int(tokens))
        else:
            mapping[name] = int(tokens)

    # Merge: YAML-parsed values win; fallback fills gaps for aliases not declared in YAML
    merged = dict(FALLBACK_CTX_MAP)
    for name, tokens in mapping.items():
        if name in merged:
            merged[name] = max(merged[name], tokens)
        else:
            merged[name] = tokens

    with _lock:
        global _max_ctx
        _max_ctx = merged

    # Build MODEL_INFO_MAP: first entry per alias wins
    info_map: dict[str, dict] = {}
    for entry in cfg.get("model_list", []):
        name = entry.get("model_name")
        if not name or name in info_map:
            continue
        lp = entry.get("litellm_params") or {}
        backend_model = lp.get("model", "")
        api_base = lp.get("api_base") or None
        provider = backend_model.split("/")[0] if "/" in backend_model else ""
        info_map[name] = {
            "backend_model": backend_model,
            "api_base": api_base,
            "provider": provider,
        }
    # Merge extra aliases that appear in spend_logs but lack a model_name entry
    for alias, info in EXTRA_MODEL_INFO.items():
        if alias not in info_map:
            info_map[alias] = info

    with _lock:
        global _model_info
        _model_info = info_map


def get_max_ctx() -> dict[str, int]:
    with _lock:
        return dict(_max_ctx)


def get_model_info_map() -> dict[str, dict]:
    with _lock:
        return {k: v for k, v in _model_info.items() if k not in HIDDEN_MODELS}


def register_sighup(path: str) -> None:
    def handler(signum, frame):
        load_config(path)
    signal.signal(signal.SIGHUP, handler)


def reload_config(path: str = "/app/config.yaml") -> None:
    """Reload config.yaml into memory (for on-demand refresh)."""
    load_config(path)
