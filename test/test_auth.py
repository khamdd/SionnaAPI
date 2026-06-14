import contextlib
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from backend.api import auth as auth_module
from backend.main import app
from backend.services import auth_service
from backend.services.auth_service import hash_password, verify_password


client = TestClient(app)


class FakeResult:
    def __init__(self, row):
        self.row = row

    def mappings(self):
        return self

    def first(self):
        return self.row


class FakeSession:
    def __init__(self, row):
        self.row = row

    def execute(self, *args, **kwargs):
        return FakeResult(self.row)


@contextlib.contextmanager
def fake_session(row):
    yield FakeSession(row)


def test_password_hash_does_not_store_plain_password():
    password = "super-secret-password"
    encoded = hash_password(password)

    assert password not in encoded
    assert verify_password(password, encoded) is True
    assert verify_password("wrong-password", encoded) is False


def test_register_returns_created_user(monkeypatch):
    monkeypatch.setattr(
        auth_module,
        "create_user",
        lambda username, password: {
            "status": "success",
            "user": {
                "id": "00000000-0000-0000-0000-000000000001",
                "username": username,
                "created_at": "2026-06-14T00:00:00+00:00",
            },
        },
    )

    response = client.post(
        "/api/v1/auth/register",
        json={
            "username": "alice",
            "password": "password123",
        },
    )

    assert response.status_code == 200
    assert response.json()["user"]["username"] == "alice"


def test_login_rejects_invalid_credentials(monkeypatch):
    monkeypatch.setattr(
        auth_module,
        "login_user",
        lambda username, password: {
            "status": "failure",
            "status_code": 401,
            "error": "Invalid username or password.",
        },
    )

    response = client.post(
        "/api/v1/auth/login",
        json={
            "username": "alice",
            "password": "wrong-password",
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"]["error"] == "Invalid username or password."


def test_register_logs_database_not_configured(monkeypatch):
    events = []
    monkeypatch.setattr(auth_service, "is_database_configured", lambda: False)
    monkeypatch.setattr(
        auth_service,
        "log_event",
        lambda event, level="INFO", data=None: events.append((event, level, data)),
    )

    result = auth_service.create_user(" alice ", "password123")

    assert result["status"] == "failure"
    assert events == [
        (
            "register_failed",
            "WARNING",
            {
                "username": "alice",
                "reason": "database_not_configured",
            },
        )
    ]


def test_register_success_logs_user_without_password(monkeypatch):
    events = []
    row = {
        "id": "00000000-0000-0000-0000-000000000001",
        "username": "alice",
        "created_at": datetime(2026, 6, 14, tzinfo=timezone.utc),
    }
    monkeypatch.setattr(auth_service, "is_database_configured", lambda: True)
    monkeypatch.setattr(auth_service, "db_session", lambda: fake_session(row))
    monkeypatch.setattr(auth_service, "hash_password", lambda password: "hashed")
    monkeypatch.setattr(
        auth_service,
        "log_event",
        lambda event, level="INFO", data=None: events.append((event, level, data)),
    )

    result = auth_service.create_user("alice", "password123")

    assert result["status"] == "success"
    assert events == [
        (
            "user_registered",
            "INFO",
            {
                "username": "alice",
                "user_id": "00000000-0000-0000-0000-000000000001",
            },
        )
    ]
    assert "password" not in events[0][2]


def test_login_invalid_credentials_logs_failure(monkeypatch):
    events = []
    monkeypatch.setattr(auth_service, "is_database_configured", lambda: True)
    monkeypatch.setattr(auth_service, "db_session", lambda: fake_session(None))
    monkeypatch.setattr(
        auth_service,
        "log_event",
        lambda event, level="INFO", data=None: events.append((event, level, data)),
    )

    result = auth_service.login_user("alice", "password123")

    assert result["status"] == "failure"
    assert events == [
        (
            "login_failed",
            "WARNING",
            {
                "username": "alice",
                "reason": "invalid_credentials",
            },
        )
    ]
