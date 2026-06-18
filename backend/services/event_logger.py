import json
import logging
import queue
import threading
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from backend.constants import SENSITIVE_KEYS
from backend.core.config import get_elasticsearch_settings


logger = logging.getLogger(__name__)

LOG_QUEUE_MAX_SIZE = 256
LOG_WORKER_SHUTDOWN_TIMEOUT_SECONDS = 5

_log_queue = queue.Queue(maxsize=LOG_QUEUE_MAX_SIZE)
_worker_lock = threading.Lock()
_worker_thread = None
_stop_item = object()


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

    return enqueue_log_event(
        settings.url,
        settings.index,
        payload,
    )


def enqueue_log_event(base_url, index, payload):
    start_event_logger()

    try:
        _log_queue.put_nowait((base_url, index, payload))
        return True
    except queue.Full:
        logger.warning(
            "Elasticsearch log queue is full; dropping event: %s",
            payload.get("event", "unknown"),
        )
        return False


def start_event_logger():
    global _worker_thread

    with _worker_lock:
        if _worker_thread is not None and _worker_thread.is_alive():
            return

        _worker_thread = threading.Thread(
            target=event_log_worker,
            name="elasticsearch-log-worker",
            daemon=True,
        )
        _worker_thread.start()


def stop_event_logger(timeout=LOG_WORKER_SHUTDOWN_TIMEOUT_SECONDS):
    global _worker_thread

    with _worker_lock:
        worker = _worker_thread
        if worker is None or not worker.is_alive():
            _worker_thread = None
            return

        try:
            _log_queue.put(_stop_item, timeout=timeout)
        except queue.Full:
            logger.warning("Could not stop Elasticsearch log worker: queue is full.")
            return

    worker.join(timeout=timeout)

    with _worker_lock:
        if not worker.is_alive():
            _worker_thread = None


def event_log_worker():
    while True:
        item = _log_queue.get()

        try:
            if item is _stop_item:
                return

            deliver_log_event(*item)
        finally:
            _log_queue.task_done()


def deliver_log_event(base_url, index, payload):
    try:
        send_to_elasticsearch(base_url, index, payload)
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
