# Coding Conventions

**Analysis Date:** 2026-04-13

## Overview

This is a LiteLLM proxy operations repository. The Python source files are LiteLLM CustomLogger plugins and a LiteLLM search transformation class — not a general application. Conventions are drawn from the four Python files: `firecrawl_search_transform.py`, `fix_json_tool_calls.py`, `strip_think.py`, `weave_callback.py`.

## Naming Patterns

**Files:**
- snake_case for Python plugin files: `fix_json_tool_calls.py`, `strip_think.py`, `weave_callback.py`, `firecrawl_search_transform.py`
- Each plugin file exposes a module-level `proxy_handler_instance` variable pointing to the instantiated callback

**Classes:**
- PascalCase: `FixJsonToolCallsCallback`, `StripThinkCallback`, `WeaveCallback`, `FirecrawlSearchConfig`
- LiteLLM callback classes use a `Callback` suffix: `FixJsonToolCallsCallback`, `StripThinkCallback`, `WeaveCallback`
- LiteLLM search config classes use a `Config` suffix: `FirecrawlSearchConfig`

**Methods:**
- snake_case throughout
- LiteLLM hook methods follow the framework's naming contract: `async_pre_call_hook`, `async_post_call_success_hook`
- Private/internal helpers are prefixed with `_`: `_fix_messages`
- Static utility methods have no prefix: `fix_json`, `ui_friendly_name`

**Variables:**
- snake_case: `api_key`, `api_base`, `request_data`, `result_data`, `brace_depth`
- Constants in SCREAMING_SNAKE_CASE on class body: `FIRECRAWL_API_BASE`, `THINK_RE`
- Compiled regex patterns stored as class-level constants: `THINK_RE = re.compile(...)`

**TypedDict types:**
- PascalCase with descriptive names: `FirecrawlSearchRequest`, `_FirecrawlSearchRequestRequired`
- Private required-fields base class prefixed with `_`: `_FirecrawlSearchRequestRequired`

## Code Style

**Formatting:**
- No formatter config file detected (no `.prettierrc`, `pyproject.toml`, `setup.cfg`, or `ruff.toml` in repo)
- Style is consistent with PEP 8: 4-space indentation, blank lines between class methods
- Line length appears ~90-100 chars in practice

**Linting:**
- No linting config detected in repo
- Code follows idiomatic Python typing patterns with `from typing import Dict, List, Optional, TypedDict, Union`

## Import Organization

**Order observed:**
1. Standard library (`json`, `re`, `os`)
2. Third-party packages (`httpx`, `weave`)
3. LiteLLM internal imports from `litellm.*`

**Style:**
- Explicit named imports, no wildcard imports
- Each import on its own line

## Error Handling

**Patterns:**
- Silent fallback on parse failure: `fix_json` returns the original string if all repair attempts fail — never raises
- `try/except json.JSONDecodeError` used for JSON validation with explicit fallback
- `ValueError` raised for missing required environment configuration (e.g., missing `FIRECRAWL_API_KEY`)
- Attribute access on response objects uses `hasattr` / `getattr` with `None` defaults before operating, avoiding `AttributeError` on unexpected response shapes

**Pattern example from `fix_json_tool_calls.py`:**
```python
try:
    json.loads(s)
    return s
except json.JSONDecodeError:
    pass
# ... repair attempts ...
try:
    json.loads(fixed)
    return fixed
except json.JSONDecodeError:
    return s  # return original on total failure
```

## Logging

**Framework:** None — LiteLLM's built-in `LiteLLMLoggingObj` is accepted as a parameter in `transform_search_response` but not actively called within these plugins. No direct `logging` or `print` usage.

## Comments

**When to Comment:**
- Module-level docstrings for all files with non-trivial purpose (`firecrawl_search_transform.py`, `weave_callback.py`)
- Class-level docstrings for all classes
- Method-level docstrings for public methods with Args/Returns sections (`firecrawl_search_transform.py`)
- Inline comments for non-obvious logic: JSON repair steps labeled "Fix 1", "Fix 2"; YAML config annotates individual model backends with backend name, port, and use-case

**Dockerfile comments:**
- Long explanatory comments for upstream patches, including GOTCHA notes and references to planning docs
- Each Dockerfile `RUN` layer with a patch includes the upstream file path, line number, and reason for the patch

## Function Design

**Size:** Functions are small and single-purpose (5–30 lines typical)

**Parameters:** Use `**kwargs` to absorb unknown LiteLLM framework params; explicit required params come first

**Return Values:** All transform/hook methods return the (possibly mutated) object — never `None` on success paths

## Module Design

**Exports:**
- Each plugin module exposes exactly one name: `proxy_handler_instance`
- This is the LiteLLM convention for custom callback/search plugins loaded by `config.yaml`

**Pattern:**
```python
class MyCallback(CustomLogger):
    ...

proxy_handler_instance = MyCallback()
```

## YAML Config Conventions (`config.yaml`)

**Model entries:**
- `model_name` uses kebab-case slugs: `spark-learner`, `nemotron-cascade-2`
- Inline comments on `api_base` fields identify the physical host and its Tailscale/LAN IP
- `model_info.notes` used for extended documentation on non-obvious models

**Routing:**
- `os.environ/VAR_NAME` syntax (LiteLLM-specific) for all secret references — never hardcoded values
- Fallback chains defined explicitly per model in `router_settings.fallbacks`

**Commented-out config:**
- Disabled callbacks left in config with explanatory comment including date and reason, e.g.:
  ```yaml
  # strip_think removed 2026-04-12: no active model benefits.
  # spark-learner: neutral. nemotron-120B: -2 tests. cascade-2: -19 tests.
  ```

---

*Convention analysis: 2026-04-13*
