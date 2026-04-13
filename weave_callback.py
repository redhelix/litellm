"""
W&B Weave integration for LiteLLM proxy.

Initializes Weave tracing on import so all LiteLLM calls are automatically
captured. Requires WANDB_API_KEY and WANDB_PROJECT env vars.

Ref: https://docs.wandb.ai/weave/guides/integrations/litellm
"""
import logging
import os

from litellm.integrations.custom_logger import CustomLogger

import weave

logger = logging.getLogger(__name__)

project = os.environ.get("WANDB_PROJECT", "litellm-proxy")

_weave_enabled = False
try:
    weave.init(project)
    _weave_enabled = True
    logger.info(f"Weave tracing initialized for project: {project}")
except RecursionError as e:
    logger.warning(f"Weave init suppressed RecursionError (SDK bug on deep exception chains): {e}")
except Exception as e:
    logger.warning(f"Weave init failed, tracing disabled: {e}")


class WeaveCallback(CustomLogger):
    """No-op callback — Weave auto-patches litellm via weave.init() above.

    If weave.init() failed at startup, this callback is a safe no-op.
    """
    async def async_log_failure_event(self, kwargs, response_obj, start_time, end_time):
        if not _weave_enabled:
            return
        try:
            await super().async_log_failure_event(kwargs, response_obj, start_time, end_time)
        except RecursionError:
            logger.debug("Weave RecursionError suppressed in failure event handler")
        except Exception as e:
            logger.debug(f"Weave failure event handler error suppressed: {e}")


proxy_handler_instance = WeaveCallback()
