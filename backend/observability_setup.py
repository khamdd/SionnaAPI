import json
import os
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from datetime import datetime, timezone
from urllib.request import Request, urlopen


ELASTICSEARCH_URL = os.getenv("ELASTICSEARCH_URL", "http://elasticsearch:9200").rstrip("/")
KIBANA_URL = os.getenv("KIBANA_URL", "http://kibana:5601").rstrip("/")
INDEX_NAME = os.getenv("ELASTICSEARCH_INDEX", "sionna-logs-dev")
INDEX_PATTERN = f"{INDEX_NAME}*"
RETENTION_DAYS = int(os.getenv("ELASTICSEARCH_LOG_RETENTION_DAYS", "30"))

POLICY_NAME = "sionna-logs-retention"
TEMPLATE_NAME = "sionna-logs-template"
DATA_VIEW_ID = "sionna-logs"


TRANSIENT_HTTP_STATUSES = {429, 502, 503, 504}


def request(
    method,
    url,
    payload=None,
    accepted_statuses=(200,),
    attempts=6,
    timeout=15,
):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}

    if url.startswith(KIBANA_URL):
        headers["kbn-xsrf"] = "observability-setup"

    last_error = None

    for attempt in range(1, attempts + 1):
        req = Request(url, data=body, headers=headers, method=method)

        try:
            with urlopen(req, timeout=timeout) as response:
                response_body = response.read()
                if response.status not in accepted_statuses:
                    raise RuntimeError(f"Unexpected HTTP {response.status} from {url}")
                return json.loads(response_body) if response_body else None
        except HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            error = RuntimeError(f"HTTP {exc.code} from {url}: {details}")
            if exc.code not in TRANSIENT_HTTP_STATUSES:
                raise error from exc
            last_error = error
        except (URLError, TimeoutError, OSError) as exc:
            last_error = exc

        if attempt < attempts:
            time.sleep(2)

    raise RuntimeError(
        f"Request failed after {attempts} attempts: {method} {url}: {last_error}"
    ) from last_error


def wait_until_ready(name, url, attempts=90, delay_seconds=2):
    for _ in range(attempts):
        try:
            request("GET", url, attempts=1, timeout=5)
            return
        except (RuntimeError, URLError, TimeoutError, OSError):
            time.sleep(delay_seconds)

    raise RuntimeError(f"{name} did not become ready: {url}")


def ensure_index_exists():
    daily_index = f"{INDEX_NAME}-{datetime.now(timezone.utc).strftime('%Y.%m.%d')}"
    encoded_index = quote(daily_index, safe="")

    try:
        request("HEAD", f"{ELASTICSEARCH_URL}/{encoded_index}")
    except RuntimeError as exc:
        if "HTTP 404" not in str(exc):
            raise
        request(
            "PUT",
            f"{ELASTICSEARCH_URL}/{encoded_index}",
            accepted_statuses=(200, 201),
        )

    encoded_pattern = quote(INDEX_PATTERN, safe="*")
    request(
        "PUT",
        f"{ELASTICSEARCH_URL}/{encoded_pattern}/_settings",
        {"index.lifecycle.name": POLICY_NAME},
    )


def configure_elasticsearch():
    if RETENTION_DAYS < 1:
        raise ValueError("ELASTICSEARCH_LOG_RETENTION_DAYS must be at least 1")

    request(
        "PUT",
        f"{ELASTICSEARCH_URL}/_ilm/policy/{POLICY_NAME}",
        {
            "policy": {
                "phases": {
                    "hot": {"actions": {}},
                    "delete": {
                        "min_age": f"{RETENTION_DAYS}d",
                        "actions": {"delete": {}},
                    },
                }
            }
        },
    )

    request(
        "PUT",
        f"{ELASTICSEARCH_URL}/_index_template/{TEMPLATE_NAME}",
        {
            "index_patterns": [INDEX_PATTERN],
            "priority": 500,
            "template": {
                "settings": {
                    "index.lifecycle.name": POLICY_NAME,
                    "number_of_shards": 1,
                    "number_of_replicas": 0,
                },
                "mappings": {
                    "dynamic": True,
                    "properties": {
                        "@timestamp": {"type": "date"},
                        "event": {"type": "keyword"},
                        "level": {"type": "keyword"},
                        "service": {"type": "keyword"},
                        "simulation_type": {"type": "keyword"},
                        "request_id": {"type": "keyword"},
                        "method": {"type": "keyword"},
                        "path": {"type": "keyword"},
                        "status_code": {"type": "integer"},
                        "duration_ms": {"type": "float"},
                        "client_host": {"type": "ip"},
                        "scene_id": {"type": "keyword"},
                        "scene_name": {"type": "keyword"},
                        "job_id": {"type": "keyword"},
                        "status": {"type": "keyword"},
                        "error": {"type": "text"},
                    },
                },
            },
        },
    )

    ensure_index_exists()


def configure_kibana():
    request(
        "POST",
        f"{KIBANA_URL}/api/data_views/data_view",
        {
            "data_view": {
                "id": DATA_VIEW_ID,
                "name": "Sionna application logs",
                "title": INDEX_PATTERN,
                "timeFieldName": "@timestamp",
                "allowNoIndex": True,
            },
            "override": True,
        },
    )

    request(
        "POST",
        f"{KIBANA_URL}/api/data_views/default",
        {
            "data_view_id": DATA_VIEW_ID,
            "force": True,
        },
    )


def main():
    wait_until_ready("Elasticsearch", ELASTICSEARCH_URL)
    wait_until_ready("Kibana", f"{KIBANA_URL}/api/status")
    configure_elasticsearch()
    configure_kibana()
    print(
        f"Observability ready: data view '{INDEX_PATTERN}', "
        f"retention {RETENTION_DAYS} days."
    )


if __name__ == "__main__":
    main()
