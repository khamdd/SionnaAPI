import os
from dataclasses import dataclass

from dotenv import load_dotenv


load_dotenv()


@dataclass(frozen=True)
class ElasticsearchSettings:
    enabled: bool
    url: str
    index: str


@dataclass(frozen=True)
class AuthSettings:
    secret_key: str


@dataclass(frozen=True)
class SimulationJobSettings:
    worker_enabled: bool
    poll_interval_seconds: float
    heartbeat_interval_seconds: float
    lease_seconds: int
    timeout_seconds: int
    max_attempts: int
    retry_base_seconds: int
    retry_max_seconds: int


def get_elasticsearch_settings():
    return ElasticsearchSettings(
        enabled=parse_bool(os.getenv("ELASTICSEARCH_ENABLED", "false")),
        url=os.getenv("ELASTICSEARCH_URL", "http://localhost:9200"),
        index=os.getenv("ELASTICSEARCH_INDEX", "sionna-logs-dev"),
    )


def get_auth_settings():
    return AuthSettings(
        secret_key=os.getenv(
            "AUTH_SECRET_KEY",
            "dev-only-change-this-secret-before-deploying",
        ),
    )


def get_simulation_job_settings():
    lease_seconds = _positive_int("SIMULATION_JOB_LEASE_SECONDS", 90)
    heartbeat_interval = _positive_float(
        "SIMULATION_JOB_HEARTBEAT_SECONDS",
        20.0,
    )
    return SimulationJobSettings(
        worker_enabled=parse_bool(os.getenv("SIMULATION_WORKER_ENABLED", "true")),
        poll_interval_seconds=_positive_float(
            "SIMULATION_WORKER_POLL_SECONDS",
            1.0,
        ),
        heartbeat_interval_seconds=min(
            heartbeat_interval,
            max(1.0, lease_seconds / 2),
        ),
        lease_seconds=lease_seconds,
        timeout_seconds=_positive_int("SIMULATION_JOB_TIMEOUT_SECONDS", 3600),
        max_attempts=_positive_int("SIMULATION_JOB_MAX_ATTEMPTS", 3),
        retry_base_seconds=_positive_int("SIMULATION_JOB_RETRY_BASE_SECONDS", 5),
        retry_max_seconds=_positive_int("SIMULATION_JOB_RETRY_MAX_SECONDS", 300),
    )


def parse_bool(value):
    return str(value).strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _positive_int(name, default):
    try:
        return max(1, int(os.getenv(name, str(default))))
    except ValueError:
        return default


def _positive_float(name, default):
    try:
        return max(0.1, float(os.getenv(name, str(default))))
    except ValueError:
        return default
