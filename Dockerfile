FROM ghcr.io/berriai/litellm:v1.83.13-nightly
RUN pip install --no-cache-dir weave

# PATCH: litellm/router.py line 5688 -- async_function_with_retries
# Upstream does `num_retries = kwargs.pop("num_retries")` with no default, and
# when a caller sends max_retries=None (or litellm.num_retries is None at the
# module level, which is the REAL upstream trigger here), None flows into
# `if num_retries > 0:` at line 5771 and raises TypeError in the exception
# handler, shadowing the real underlying error.
#
# GOTCHA: the base image ships TWO copies of litellm source:
#   /app/litellm/                                    (present, NOT imported by proxy)
#   /usr/lib/python3.13/site-packages/litellm/       (what the proxy actually loads)
# Why: /usr/bin/litellm is a script, so Python sets sys.path[0] to /usr/bin
# (the script dir), which has no litellm pkg, so it falls through to
# site-packages. A bare `python3 -c "import litellm"` from /app misleads you
# into thinking /app/litellm is active (because sys.path[0]="" for -c, which
# resolves to cwd). It ISN'T at proxy runtime. Patch BOTH for safety.
#
# The grep -q guards fail the build loudly if a future litellm upgrade
# reflows these lines, forcing a re-audit.
# See nemotron .planning 2026-04-11 for the full investigation.
RUN for f in /usr/lib/python3.13/site-packages/litellm/router.py /app/litellm/router.py; do \
      sed -i 's|num_retries = kwargs.pop("num_retries")|_nr = kwargs.pop("num_retries", None); num_retries = self.num_retries if _nr is None else _nr|' "$f" && \
      grep -q 'num_retries = self.num_retries if _nr is None' "$f" && \
      python3 -c "import ast; ast.parse(open('$f').read())" || exit 1; \
    done

# PATCH: exception_mapping_utils.py -- classify vLLM context-overflow 400s as
# ContextWindowExceededError so router context_window_fallbacks actually fire.
# vLLM emits "max_tokens=N cannot be greater than max_model_len=..." (output
# overflow) and "... longer than the maximum model length ..." (prompt overflow),
# NEITHER of which is in litellm's known_exception_substrings list -> the error
# is mapped to a generic BadRequestError (400), fallbacks never trigger, and the
# raw 400 leaks to the client (opencode hintonator-qwen3-30b-a3b). Proven live:
# curl :8000 -> {"message":"max_tokens=999999 cannot be greater than
# max_model_len=max_total_tokens=81920...","type":"BadRequestError","code":400}.
# We append two distinctive substrings after the Gemini anchor line. Both are
# low-false-positive (vLLM-specific phrasings). grep -q guard fails the build if
# a future upgrade reflows the anchor; ast.parse guards syntax. See site-packages
# gotcha in the router patch above -- patch BOTH copies.
RUN for f in /usr/lib/python3.13/site-packages/litellm/litellm_core_utils/exception_mapping_utils.py /app/litellm/litellm_core_utils/exception_mapping_utils.py; do \
      sed -i 's|\(\s*\)\("exceeds the maximum number of tokens allowed",\s*# Gemini\)|\1\2\n\1"cannot be greater than max_model_len",  # vLLM output overflow\n\1"longer than the maximum model length",  # vLLM prompt overflow|' "$f" && \
      grep -q 'cannot be greater than max_model_len' "$f" && \
      python3 -c "import ast; ast.parse(open('$f').read())" || exit 1; \
    done
