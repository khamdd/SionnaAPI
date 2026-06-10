from fastapi.testclient import TestClient

from backend.api import sinr as api_module
from backend.main import app


client = TestClient(app)


def test_simulation_runs_returns_empty_list_when_database_is_not_configured(
    monkeypatch,
):
    monkeypatch.setattr(
        api_module,
        "list_simulation_runs",
        lambda limit=25: {
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
