import os
import yaml
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api", tags=["config"])

CONFIG_YAML_PATH = os.environ.get("CONFIG_YAML_PATH", "/app/config.yaml")
REPO_CONFIG_PATH = os.environ.get("REPO_CONFIG_PATH", "/app/config.repo.yaml")


def _load_yaml(path: str) -> dict:
    p = Path(path)
    if not p.exists():
        return {}
    with open(p) as f:
        return yaml.safe_load(f) or {}


def build_diff_items(deployed: dict, repo: dict) -> list[dict]:
    """
    Structural diff between two parsed config dicts.
    Returns list of DriftItem dicts — no line-by-line text (DRIFT-04).
    """
    items = []

    # DRIFT-02: hardcoded master_key check
    mk = deployed.get("general_settings", {}).get("master_key", "") or ""
    if mk and not str(mk).startswith("os.environ/"):
        items.append({
            "key_path": "general_settings.master_key",
            "deployed_value": "[REDACTED]",  # never expose value (T-04-02-01)
            "repo_value": "",
            "severity": "security",
        })

    # DRIFT-03: routing strategy
    d_rs = (deployed.get("router_settings") or {}).get("routing_strategy", "")
    r_rs = (repo.get("router_settings") or {}).get("routing_strategy", "")
    if d_rs != r_rs:
        items.append({
            "key_path": "router_settings.routing_strategy",
            "deployed_value": d_rs or "",
            "repo_value": r_rs or "",
            "severity": "mismatch",
        })

    # DRIFT-04: model list — max_tokens and missing backends
    d_models = {m["model_name"]: m for m in (deployed.get("model_list") or [])}
    r_models = {m["model_name"]: m for m in (repo.get("model_list") or [])}

    for name, r_model in r_models.items():
        if name not in d_models:
            items.append({
                "key_path": f"model_list[{name}]",
                "deployed_value": "",
                "repo_value": name,
                "severity": "missing",
            })
            continue
        d_model = d_models[name]
        d_mt = (d_model.get("litellm_params") or {}).get("max_tokens")
        r_mt = (r_model.get("litellm_params") or {}).get("max_tokens")
        if d_mt != r_mt and (d_mt is not None or r_mt is not None):
            items.append({
                "key_path": f"model_list[{name}].litellm_params.max_tokens",
                "deployed_value": str(d_mt) if d_mt is not None else "",
                "repo_value": str(r_mt) if r_mt is not None else "",
                "severity": "mismatch",
            })

    return items


@router.get("/config/diff")
def get_config_diff():
    try:
        deployed = _load_yaml(CONFIG_YAML_PATH)
        repo = _load_yaml(REPO_CONFIG_PATH)
        # If repo config not found, fall back to same file (baseline: zero diff)
        if not repo:
            repo = deployed
        items = build_diff_items(deployed, repo)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "items": items,
        "last_checked": datetime.now(timezone.utc).isoformat(),
    }
