import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import config_loader


def test_nemotron_cascade_takes_max(tmp_path):
    cfg = tmp_path / "c.yaml"
    cfg.write_text(
        "model_list:\n"
        "- model_name: nemotron-cascade-2\n"
        "  model_info:\n    max_input_tokens: 32768\n"
        "- model_name: nemotron-cascade-2\n"
        "  model_info:\n    max_input_tokens: 65536\n"
    )
    config_loader.load_config(str(cfg))
    assert config_loader.get_max_ctx()["nemotron-cascade-2"] == 65536


def test_context_utilization_helper():
    poller = pytest.importorskip("poller")
    assert hasattr(poller, "compute_context_utilization")
    assert poller.compute_context_utilization(1000, "spark-learner", {"spark-learner": 131072}) == pytest.approx(1000 / 131072)
    assert poller.compute_context_utilization(1000, "unknown", {}) is None
    assert poller.compute_context_utilization(None, "spark-learner", {"spark-learner": 131072}) is None
