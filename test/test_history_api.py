from fastapi.testclient import TestClient
import pytest

from backend.api import sinr as api_module
from backend.api.dependencies import require_current_user
from backend.main import app


client = TestClient(app)


@pytest.fixture(autouse=True)
def authenticated_user():
    app.dependency_overrides[require_current_user] = lambda: {
        "id": "00000000-0000-0000-0000-000000000001",
        "username": "test-user",
    }
    yield
    app.dependency_overrides.pop(require_current_user, None)


def test_simulation_runs_returns_empty_list_when_database_is_not_configured(
    monkeypatch,
):
    monkeypatch.setattr(
        api_module,
        "list_simulation_runs",
        lambda limit=25, scene_id=None: {
            "database_configured": False,
            "items": [],
        },
    )

    response = client.get("/api/v1/simulation-runs")

    assert response.status_code == 200
    assert response.json() == {
        "database_configured": False,
        "items": [],
    }


def test_simulation_run_detail_returns_not_found_for_missing_run(monkeypatch):
    monkeypatch.setattr(
        api_module,
        "get_simulation_run",
        lambda run_id: {
            "database_configured": True,
            "item": None,
        },
    )

    response = client.get("/api/v1/simulation-runs/00000000-0000-0000-0000-000000000000")

    assert response.status_code == 404


def test_simulation_run_result_returns_saved_result(monkeypatch):
    monkeypatch.setattr(
        api_module,
        "get_simulation_run_result",
        lambda run_id: {
            "database_configured": True,
            "result": {
                "status": "success",
                "sinr_db": 12.5,
            },
        },
    )

    response = client.get(
        "/api/v1/simulation-runs/00000000-0000-0000-0000-000000000000/result"
    )

    assert response.status_code == 200
    assert response.json() == {
        "status": "success",
        "sinr_db": 12.5,
    }


def test_simulation_run_result_returns_not_found(monkeypatch):
    monkeypatch.setattr(
        api_module,
        "get_simulation_run_result",
        lambda run_id: {
            "database_configured": True,
            "result": None,
        },
    )

    response = client.get(
        "/api/v1/simulation-runs/00000000-0000-0000-0000-000000000000/result"
    )

    assert response.status_code == 404


def test_delete_simulation_run_returns_success(monkeypatch):
    monkeypatch.setattr(
        api_module,
        "delete_simulation_run",
        lambda run_id: {
            "database_configured": True,
            "deleted": True,
            "deleted_files": 1,
            "deleted_jobs": 1,
        },
    )

    response = client.delete(
        "/api/v1/simulation-runs/00000000-0000-0000-0000-000000000000"
    )

    assert response.status_code == 200
    assert response.json()["deleted"] is True
    assert response.json()["deleted_files"] == 1
    assert response.json()["deleted_jobs"] == 1


def test_delete_simulation_run_returns_not_found(monkeypatch):
    monkeypatch.setattr(
        api_module,
        "delete_simulation_run",
        lambda run_id: {
            "database_configured": True,
            "deleted": False,
        },
    )

    response = client.delete(
        "/api/v1/simulation-runs/00000000-0000-0000-0000-000000000000"
    )

    assert response.status_code == 404


def test_simulation_jobs_returns_items(monkeypatch):
    monkeypatch.setattr(
        api_module,
        "list_simulation_jobs",
        lambda limit=100: {
            "database_configured": True,
            "items": [
                {
                    "id": "11111111-1111-1111-1111-111111111111",
                    "status": "queued",
                },
            ],
        },
    )

    response = client.get("/api/v1/simulation-jobs")

    assert response.status_code == 200
    assert response.json()["items"][0]["status"] == "queued"


def test_simulation_job_result_returns_result(monkeypatch):
    monkeypatch.setattr(
        api_module,
        "get_simulation_job_result",
        lambda job_id: {
            "database_configured": True,
            "result": {
                "status": "success",
                "sinr_db": 12.5,
            },
        },
    )

    response = client.get(
        "/api/v1/simulation-jobs/11111111-1111-1111-1111-111111111111/result"
    )

    assert response.status_code == 200
    assert response.json()["sinr_db"] == 12.5


def test_save_simulation_job_returns_run_id(monkeypatch):
    monkeypatch.setattr(
        api_module,
        "save_simulation_job_result",
        lambda job_id: {
            "database_configured": True,
            "saved": True,
            "run_id": "22222222-2222-2222-2222-222222222222",
        },
    )

    response = client.post(
        "/api/v1/simulation-jobs/11111111-1111-1111-1111-111111111111/save"
    )

    assert response.status_code == 200
    assert response.json()["saved"] is True
    assert response.json()["run_id"] == "22222222-2222-2222-2222-222222222222"


def test_cancel_simulation_job_requests_cancellation(monkeypatch):
    monkeypatch.setattr(
        api_module,
        "request_simulation_job_cancellation",
        lambda job_id: {
            "database_configured": True,
            "cancelled": False,
            "cancel_requested": True,
            "item": {"id": job_id, "status": "running"},
        },
    )

    response = client.post(
        "/api/v1/simulation-jobs/11111111-1111-1111-1111-111111111111/cancel"
    )

    assert response.status_code == 200
    assert response.json()["cancel_requested"] is True


def test_delete_simulation_job_returns_success(monkeypatch):
    monkeypatch.setattr(
        api_module,
        "delete_simulation_job",
        lambda job_id: {
            "database_configured": True,
            "deleted": True,
            "deleted_files": 1,
            "result_run_id": None,
        },
    )

    response = client.delete(
        "/api/v1/simulation-jobs/11111111-1111-1111-1111-111111111111"
    )

    assert response.status_code == 200
    assert response.json()["deleted"] is True
    assert response.json()["deleted_files"] == 1


def test_delete_running_simulation_job_returns_bad_request(monkeypatch):
    monkeypatch.setattr(
        api_module,
        "delete_simulation_job",
        lambda job_id: {
            "database_configured": True,
            "deleted": False,
            "error": "Running simulation jobs cannot be deleted.",
            "status_code": 400,
        },
    )

    response = client.delete(
        "/api/v1/simulation-jobs/11111111-1111-1111-1111-111111111111"
    )

    assert response.status_code == 400
