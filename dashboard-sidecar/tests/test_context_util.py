import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import config_loader

# All 7 constraint-listed deployed dashboard aliases
REQUIRED_ALIASES = [
    "gemma-4-31b",
    "nemotron-cascade-2",
    "spark-learner",
    "nomic-embed-text",
    "google/gemini-2.5-flash",
    "openai/nemotron-cascade-2",
    "openai/spark-learner",
]


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


# --- D-02: All 7 deployed aliases must resolve via get_max_ctx() ---

@pytest.fixture
def empty_config(tmp_path):
    """Load a config with no model_list so fallback map must cover all aliases."""
    cfg = tmp_path / "empty.yaml"
    cfg.write_text("model_list: []\n")
    config_loader.load_config(str(cfg))
    return config_loader.get_max_ctx()


@pytest.mark.parametrize("alias", REQUIRED_ALIASES)
def test_all_required_aliases_resolve(empty_config, alias):
    """Every constraint-listed alias must resolve to a positive int even with empty config."""
    ctx = empty_config
    assert alias in ctx, f"alias '{alias}' not found in get_max_ctx() result"
    assert isinstance(ctx[alias], int), f"ctx for '{alias}' must be int, got {type(ctx[alias])}"
    assert ctx[alias] > 0, f"ctx for '{alias}' must be positive, got {ctx[alias]}"


@pytest.mark.parametrize("alias", REQUIRED_ALIASES)
def test_context_utilization_non_none_for_all_aliases(empty_config, alias):
    """compute_context_utilization for each alias with prompt_tokens=1000 returns float in (0,1)."""
    poller = pytest.importorskip("poller")
    result = poller.compute_context_utilization(1000, alias, empty_config)
    assert result is not None, f"compute_context_utilization returned None for alias '{alias}'"
    assert isinstance(result, float), f"expected float, got {type(result)}"
    assert 0.0 < result < 1.0, f"expected result in (0,1), got {result} for alias '{alias}'"


def test_unknown_alias_returns_none(empty_config):
    """Unknown aliases must still return None (graceful '?' fallback in UI)."""
    poller = pytest.importorskip("poller")
    result = poller.compute_context_utilization(1000, "some-unknown-model-xyz", empty_config)
    assert result is None


def test_yaml_parsed_values_win_over_fallback(tmp_path):
    """When YAML declares max_input_tokens for an alias, that value takes precedence over fallback."""
    cfg = tmp_path / "c.yaml"
    cfg.write_text(
        "model_list:\n"
        "- model_name: spark-learner\n"
        "  model_info:\n    max_input_tokens: 999999\n"
    )
    config_loader.load_config(str(cfg))
    ctx = config_loader.get_max_ctx()
    assert ctx["spark-learner"] == 999999, f"YAML value should win, got {ctx['spark-learner']}"
