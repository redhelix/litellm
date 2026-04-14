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
    with _lock:
        global _model_info
        _model_info = info_map


def get_max_ctx() -> dict[str, int]:
    with _lock:
        return dict(_max_ctx)


def get_model_info_map() -> dict[str, dict]:
    with _lock:
        return dict(_model_info)


def register_sighup(path: str) -> None:
    def handler(signum, frame):
        load_config(path)
    signal.signal(signal.SIGHUP, handler)
