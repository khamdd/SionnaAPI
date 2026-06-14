import json
import logging
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from backend.core.config import get_elasticsearch_settings


logger = logging.getLogger(__name__)
SENSITIVE_KEYS = {
    "password",
    "password_hash",
    "token",
    "access_token",
    "refresh_token",
    "authorization",
    "database_url",
}


def log_event(
    event,
    level="INFO",
    data=None,
    settings=None,
):
    settings = settings or get_elasticsearch_settings()

    if not settings.enabled:
        return False

    payload = build_log_payload(
        event=event,
        level=level,
        data=data,
    )

    try:
        send_to_elasticsearch(
            settings.url,
            settings.index,
            payload,
        )
        return True
    except (HTTPError, URLError, TimeoutError, OSError):
        logger.warning(
            "Failed to send log event to Elasticsearch.",
            exc_info=True,
        )
        return False


def build_log_payload(event, level="INFO", data=None):
    payload = {
        "@timestamp": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "level": str(level).upper(),
        "service": "sionna-backend",
    }

    if data:
        payload.update(sanitize_log_value(data))

    return payload


def send_to_elasticsearch(base_url, index, payload):
    url = build_document_url(base_url, index)
    body = json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
        },
        method="POST",
    )

    with urlopen(request, timeout=2) as response:
        response.read()


def build_document_url(base_url, index):
    return (
        f"{base_url.rstrip('/')}/"
        f"{quote(index, safe='')}/_doc"
    )


def sanitize_log_value(value):
    if isinstance(value, dict):
        return {
            key: "[REDACTED]" if is_sensitive_key(key) else sanitize_log_value(item)
            for key, item in value.items()
        }

    if isinstance(value, (list, tuple)):
        return [
            sanitize_log_value(item)
            for item in value
        ]

    return value


def is_sensitive_key(key):
    normalized = str(key).strip().lower()
    return normalized in SENSITIVE_KEYS or normalized.endswith("_password")
