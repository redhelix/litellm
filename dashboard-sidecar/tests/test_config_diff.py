"""
Tests for config_diff router — build_diff_items() function.
RED phase: tests written before implementation.
"""
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# RED: import will fail until implementation exists
from routers.config_diff import build_diff_items


def test_security_item_for_hardcoded_key():
    deployed = {"general_settings": {"master_key": "sk-hardcoded-abc123"}}
    repo = {"general_settings": {"master_key": "os.environ/LITELLM_MASTER_KEY"}}
    items = build_diff_items(deployed, repo)
    security = [i for i in items if i["severity"] == "security"]
    assert len(security) == 1
    assert security[0]["deployed_value"] == "[REDACTED]"
    assert security[0]["key_path"] == "general_settings.master_key"


def test_deployed_value_always_redacted_regardless_of_key():
    deployed = {"general_settings": {"master_key": "any-value-here"}}
    repo = {}
    items = build_diff_items(deployed, repo)
    security = [i for i in items if i["severity"] == "security"]
    assert len(security) == 1
    assert security[0]["deployed_value"] == "[REDACTED]"
    assert "any-value-here" not in str(items)


def test_no_security_item_for_env_ref_key():
    deployed = {"general_settings": {"master_key": "os.environ/LITELLM_MASTER_KEY"}}
    repo = {"general_settings": {"master_key": "os.environ/LITELLM_MASTER_KEY"}}
    items = build_diff_items(deployed, repo)
    security = [i for i in items if i["severity"] == "security"]
    assert len(security) == 0


def test_routing_strategy_mismatch():
    deployed = {"router_settings": {"routing_strategy": "simple-shuffle"}}
    repo = {"router_settings": {"routing_strategy": "latency-based-routing"}}
    items = build_diff_items(deployed, repo)
    mismatch = [i for i in items if i["severity"] == "mismatch" and "routing_strategy" in i["key_path"]]
    assert len(mismatch) == 1
    assert mismatch[0]["deployed_value"] == "simple-shuffle"
    assert mismatch[0]["repo_value"] == "latency-based-routing"


def test_model_missing_in_deployed():
    deployed = {"model_list": []}
    repo = {"model_list": [{"model_name": "gpt-4o", "litellm_params": {}}]}
    items = build_diff_items(deployed, repo)
    missing = [i for i in items if i["severity"] == "missing"]
    assert len(missing) == 1
    assert "gpt-4o" in missing[0]["key_path"]


def test_max_tokens_mismatch_per_model():
    deployed = {"model_list": [{"model_name": "gpt-4o", "litellm_params": {"max_tokens": 4096}}]}
    repo = {"model_list": [{"model_name": "gpt-4o", "litellm_params": {"max_tokens": 8192}}]}
    items = build_diff_items(deployed, repo)
    mismatch = [i for i in items if i["severity"] == "mismatch" and "max_tokens" in i["key_path"]]
    assert len(mismatch) == 1
    assert mismatch[0]["deployed_value"] == "4096"
    assert mismatch[0]["repo_value"] == "8192"


def test_no_items_when_configs_identical():
    cfg = {
        "router_settings": {"routing_strategy": "latency-based-routing"},
        "model_list": [],
        "general_settings": {"master_key": "os.environ/LITELLM_MASTER_KEY"},
    }
    assert build_diff_items(cfg, cfg) == []


def test_empty_configs_produce_no_items():
    assert build_diff_items({}, {}) == []
