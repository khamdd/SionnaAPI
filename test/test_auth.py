from fastapi.testclient import TestClient

from backend.api import auth as auth_module
from backend.main import app
from backend.services.auth_service import hash_password, verify_password


client = TestClient(app)


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
