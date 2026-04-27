import logging
import threading
import urllib.request
import urllib.error
import socket
from urllib.parse import urlparse

from fastapi import APIRouter

from config_loader import get_model_info_map, CLOUD_HOSTS

log = logging.getLogger("model_health")
router = APIRouter(prefix="/api", tags=["model_health"])

_health: dict[str, str] = {}
_health_lock = threading.Lock()


def _is_cloud(api_base: str | None) -> bool:
    if api_base is None:
        return True
    host = urlparse(api_base).hostname or ""
    return host in CLOUD_HOSTS


def classify_health(api_base: str | None) -> str:
    if _is_cloud(api_base):
        return "unknown"
    try:
        req = urllib.request.Request(api_base, method="GET")
        urllib.request.urlopen(req, timeout=3)
        return "up"
    except urllib.error.HTTPError:
        return "up"  # got an HTTP response — server is reachable
    except (urllib.error.URLError, socket.timeout, OSError):
        return "down"
    except Exception:
        return "up"


def ping_models_job() -> None:
    info_map = get_model_info_map()
    results: dict[str, str] = {}
    for alias, info in info_map.items():
        results[alias] = classify_health(info.get("api_base"))
    with _health_lock:
        global _health
        _health = results
    log.info("model health updated: %d models", len(results))


@router.get("/model-info")
def model_info():
    return get_model_info_map()


@router.get("/model-health")
def model_health():
    with _health_lock:
        return dict(_health)
