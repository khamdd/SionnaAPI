from fastapi.testclient import TestClient

from backend.api import sinr as api_module
from backend.main import app


client = TestClient(app)


def capture_events(monkeypatch):
    events = []
    monkeypatch.setattr(
        api_module,
        "log_event",
        lambda event, level="INFO", data=None: events.append((event, level, data)),
    )
    return events


def test_scene_preview_success_logs_business_event(monkeypatch):
    events = capture_events(monkeypatch)
    monkeypatch.setattr(
        api_module,
        "create_scene_preview",
        lambda req, base_url: {
            "status": "success",
            "scene": {
                "id": "scene-1",
                "name": req.name,
                "metrics": {
                    "area_km2": 0.25,
                    "width_m": 500,
                    "height_m": 500,
                },
            },
        },
    )

    response = client.post(
        "/api/v1/scenes/preview",
        json={
            "name": "District 1",
            "south": 10.0,
            "west": 106.0,
            "north": 10.01,
            "east": 106.01,
        },
    )

    assert response.status_code == 200
    assert events == [
        (
            "scene_preview_created",
            "INFO",
            {
                "scene_id": "scene-1",
                "scene_name": "District 1",
                "area_km2": 0.25,
                "width_m": 500,
                "height_m": 500,
            },
        )
    ]


def test_scene_preview_failure_logs_business_event(monkeypatch):
    events = capture_events(monkeypatch)
    monkeypatch.setattr(
        api_module,
        "create_scene_preview",
        lambda req, base_url: {
            "status": "failure",
            "status_code": 409,
            "error": "Only 3 imported scenes are allowed.",
        },
    )

    response = client.post(
        "/api/v1/scenes/preview",
        json={
            "name": "Too many",
            "south": 10.0,
            "west": 106.0,
            "north": 10.01,
            "east": 106.01,
        },
    )

    assert response.status_code == 409
    assert events == [
        (
            "scene_preview_failed",
            "WARNING",
            {
                "status_code": 409,
                "error": "Only 3 imported scenes are allowed.",
                "scene_name": "Too many",
            },
        )
    ]


def test_scene_activate_success_logs_after_engine_update(monkeypatch):
    events = capture_events(monkeypatch)
    activated = []
    monkeypatch.setattr(
        api_module,
        "activate_scene",
        lambda scene_id: {
            "status": "success",
            "scene": {
                "id": scene_id,
                "name": "Hanoi",
            },
        },
    )
    monkeypatch.setattr(
        api_module.engine,
        "set_active_scene",
        lambda scene: activated.append(scene),
    )

    response = client.post("/api/v1/scenes/scene-1/activate")

    assert response.status_code == 200
    assert activated[0]["id"] == "scene-1"
    assert events == [
        (
            "scene_activated",
            "INFO",
            {
                "scene_id": "scene-1",
                "scene_name": "Hanoi",
            },
        )
    ]


def test_delete_history_success_logs_business_event(monkeypatch):
    events = capture_events(monkeypatch)
    monkeypatch.setattr(
        api_module,
        "delete_simulation_run",
        lambda run_id: {
            "database_configured": True,
            "deleted": True,
            "deleted_files": 2,
        },
    )

    response = client.delete(
        "/api/v1/simulation-runs/00000000-0000-0000-0000-000000000000"
    )

    assert response.status_code == 200
    assert events == [
        (
            "simulation_history_deleted",
            "INFO",
            {
                "run_id": "00000000-0000-0000-0000-000000000000",
                "database_configured": True,
                "deleted": True,
                "deleted_files": 2,
            },
        )
    ]
