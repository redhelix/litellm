"""
Tests for config_loader MODEL_INFO_MAP, classify_health, and /api/model-health endpoint.
"""
import sys
import os
import textwrap
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# --- config_loader MODEL_INFO_MAP tests ---

def test_model_info_map_parsed_from_yaml(tmp_path):
    cfg = textwrap.dedent("""
        model_list:
          - model_name: spark-learner
            litellm_params:
              model: openai/spark-learner
              api_base: http://100.115.141.106:8000/v1
          - model_name: gemini-flash
            litellm_params:
              model: gemini/gemini-2.5-flash
    """)
    p = tmp_path / "config.yaml"
    p.write_text(cfg)

    import config_loader
    config_loader.load_config(str(p))
    m = config_loader.get_model_info_map()

    assert "spark-learner" in m
    assert m["spark-learner"]["backend_model"] == "openai/spark-learner"
    assert m["spark-learner"]["api_base"] == "http://100.115.141.106:8000/v1"
    assert m["spark-learner"]["provider"] == "openai"

    assert "gemini-flash" in m
    assert m["gemini-flash"]["provider"] == "gemini"
    assert m["gemini-flash"]["api_base"] is None


def test_model_info_map_first_entry_wins(tmp_path):
    cfg = textwrap.dedent("""
        model_list:
          - model_name: my-model
            litellm_params:
              model: openai/first
              api_base: http://first-host/v1
          - model_name: my-model
            litellm_params:
              model: openai/second
              api_base: http://second-host/v1
    """)
    p = tmp_path / "config.yaml"
    p.write_text(cfg)

    import config_loader
    config_loader.load_config(str(p))
    m = config_loader.get_model_info_map()

    assert m["my-model"]["backend_model"] == "openai/first"
    assert m["my-model"]["api_base"] == "http://first-host/v1"


# --- classify_health tests ---

def test_classify_health_none_is_unknown():
    from routers.model_health import classify_health
    assert classify_health(None) == "unknown"


def test_classify_health_cloud_host_is_unknown():
    from routers.model_health import classify_health
    assert classify_health("http://api.openai.com/v1") == "unknown"
    assert classify_health("https://openrouter.ai/api/v1") == "unknown"


def test_classify_health_refused_connection_is_down():
    from routers.model_health import classify_health
    # Port 19999 should be refused on localhost
    result = classify_health("http://localhost:19999")
    assert result == "down"


# --- /api/model-health endpoint ---

def test_model_health_endpoint_returns_dict():
    from routers.model_health import router
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    resp = client.get("/api/model-health")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, dict)
    for val in data.values():
        assert val in {"up", "down", "unknown"}


def test_model_info_endpoint_returns_dict(tmp_path):
    cfg = textwrap.dedent("""
        model_list:
          - model_name: test-model
            litellm_params:
              model: ollama/llama3
              api_base: http://docker-gpu.thelaljis.com:11434
    """)
    p = tmp_path / "config.yaml"
    p.write_text(cfg)

    import config_loader
    config_loader.load_config(str(p))

    from routers.model_health import router
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    resp = client.get("/api/model-info")
    assert resp.status_code == 200
    data = resp.json()
    assert "test-model" in data
    assert data["test-model"]["provider"] == "ollama"
