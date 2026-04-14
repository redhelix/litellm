---
status: complete
phase: 08-model-client-visibility
source: 08-01-SUMMARY.md, 08-02-SUMMARY.md
started: 2026-04-14T15:45:00Z
updated: 2026-04-14T20:30:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Local/Cloud toggle visible at top of model grid
expected: Above the ModelCard grid, a segmented control with All / Local / Cloud options. Default = All, all models shown.
result: pass

### 2. Local filter shows only local models
expected: Clicking "Local" hides cloud-only cards (gemini-flash, gpt-4o-mini, perplexity-*, etc.) and shows only models with a local api_base (spark-learner, nemotron-cascade-2, hintonator-35b, etc.)
result: pass

### 3. Cloud filter shows only cloud models
expected: Clicking "Cloud" shows only models routed through cloud providers (openai API, openrouter, google, perplexity). Local models disappear.
result: pass

### 4. ModelCard connectivity ball
expected: Each local ModelCard has a small colored circle: green = up, red = down. Cloud models show grey. Ball visible in the card header area.
result: pass

### 5. ModelCard server name and runtime
expected: Local ModelCards show a server name (spark-001, spark-002, hintonator, docker-gpu) and runtime (vLLM, Ollama). Cloud cards show "cloud".
result: pass

### 6. ModelCard backend model and URL:port
expected: Local ModelCards show the backend model string (e.g. openai/nemotron-cascade-2) and URL:port (e.g. 192.168.50.73:8000). Cloud cards omit URL:port.
result: pass

### 7. ModelCard HuggingFace link
expected: Cards whose backend model has an org/model HF path (e.g. Kbenkhaled/Qwen3.5-35B-A3B-NVFP4) show a clickable HF link. Standard API models (gpt-4o, gemini-*) do not.
result: skipped
reason: No currently deployed model has a genuine HF-style path — all are either named models (gpt-4o, gemini-*) or local vLLM/Ollama paths without org/repo structure. HF link logic corrected to exclude cloud sub-providers (openrouter/google/, openrouter/moonshotai/ etc). Feature will activate when a model like hintonator-35b (Kbenkhaled/Qwen3.5-35B-A3B-NVFP4) is deployed.

### 8. ModelCard model size
expected: Cards show extracted size where parseable (e.g. "35B", "31B", "14B"). Cards with no parseable size show "?".
result: pass

### 9. OverviewPanel collapsible sections
expected: Overview panel sections (Metrics, Tool Calls, Top Clients) each have a clickable header with a chevron. Clicking a header collapses/expands that section.
result: pass

### 10. Top Clients section
expected: A "Top Clients" section in the Overview panel shows a list of top API key aliases or IPs with request counts and error rates.
result: pass

### 11. Request log Key and IP columns
expected: The request log table has two new columns: "Key" (showing api_key_alias) and "IP" (showing requester_ip_address). Rows with no alias show "—".
result: pass

### 12. Request log client filter
expected: Typing partial key alias or IP in the filter input narrows rows to matching entries.
result: pass

## Summary

total: 12
passed: 11
issues: 0
pending: 0
skipped: 1
blocked: 0

## Gaps
