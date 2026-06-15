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


def parse_bool(value):
    return str(value).strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
