import contextlib

import pytest
from fastapi.testclient import TestClient

from backend.api import sinr as api_module
from backend.api.dependencies import require_current_user
from backend.main import app


client = TestClient(app)


class FakeEngine:
    def __init__(self):
        self.lock = contextlib.nullcontext()
        self.scene = object()

    def get_scene(self):
        return self.scene


class FakeMetricEngine(FakeEngine):
    def get_active_scene_info(self):
        return {
            "id": "hcm",
            "name": "Ho Chi Minh",
            "metrics": {
                "width_m": 814.2,
                "height_m": 626.5,
            },
        }


@pytest.fixture(autouse=True)
def fake_sionna_engine(monkeypatch):
    monkeypatch.setattr(api_module, "engine", FakeEngine())
    monkeypatch.setattr(api_module, "is_database_configured", lambda: False)


@pytest.fixture(autouse=True)
def authenticated_user():
    app.dependency_overrides[require_current_user] = lambda: {
        "id": "00000000-0000-0000-0000-000000000001",
        "username": "test-user",
    }
    yield
    app.dependency_overrides.pop(require_current_user, None)


def failure_payload():
    return {
        "status": "failure",
        "error": "forced failure",
    }


def client_error_payload():
    return {
        "status": "failure",
        "status_code": 400,
        "error": "Receiver position sits outside the defined simulation grid boundaries.",
    }


def test_coverage_map_failure_returns_http_500(monkeypatch):
    monkeypatch.setattr(
        api_module,
        "calculate_coverage_map_service",
        lambda req, base_url, scene: failure_payload(),
    )

    response = client.post(
        "/api/v1/coverage-map",
        json={
            "tilt": 8.0,
            "transmitter_position": [0.0, 0.0, 25.0],
        },
    )

    assert response.status_code == 500
    assert response.json()["detail"]["status"] == "failure"


def test_network_coverage_failure_returns_http_500(monkeypatch):
    monkeypatch.setattr(
        api_module,
        "calculate_network_coverage_service",
        lambda req, base_url, scene: failure_payload(),
    )

    response = client.post(
        "/api/v1/network-coverage",
        json={
            "antennas": [
                {
                    "id": "A1",
                    "position": [0.0, 0.0, 25.0],
                    "tilt": {
                        "min": 2.0,
                        "current": 8.0,
                        "max": 18.0,
                    },
                    "azimuth": 45.0,
                    "tx_power": {
                        "min": 20.0,
                        "current": 30.0,
                        "max": 40.0,
                    },
                }
            ]
        },
    )

    assert response.status_code == 500
    assert response.json()["detail"]["status"] == "failure"


def test_sinr_failure_returns_http_500(monkeypatch):
    monkeypatch.setattr(
        api_module,
        "calculate_sinr_service",
        lambda req, scene: failure_payload(),
    )

    response = client.post(
        "/api/v1/sinr",
        json={
            "tilt": 8.0,
            "transmitter_position": [0.0, 0.0, 25.0],
            "receiver_position": [10.0, 10.0, 1.5],
        },
    )

    assert response.status_code == 500
    assert response.json()["detail"]["status"] == "failure"


def test_sinr_client_input_failure_returns_http_400(monkeypatch):
    monkeypatch.setattr(
        api_module,
        "calculate_sinr_service",
        lambda req, scene: client_error_payload(),
    )

    response = client.post(
        "/api/v1/sinr",
        json={
            "tilt": 8.0,
            "transmitter_position": [0.0, 0.0, 25.0],
            "receiver_position": [9999.0, 9999.0, 1.5],
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"]["status"] == "failure"


def test_scene_position_validation_uses_active_scene_size(monkeypatch):
    service_called = False
    monkeypatch.setattr(api_module, "engine", FakeMetricEngine())
    monkeypatch.setattr(
        api_module,
        "store_simulation_result",
        lambda *args, **kwargs: None,
    )

    def fake_coverage_service(req, base_url, scene):
        nonlocal service_called
        service_called = True
        return {"status": "success"}

    monkeypatch.setattr(
        api_module,
        "calculate_coverage_map_service",
        fake_coverage_service,
    )

    response = client.post(
        "/api/v1/coverage-map",
        json={
            "tilt": 8.0,
            "transmitter_position": [500.0, 0.0, 25.0],
            "solver": {
                "center": [0.0, 0.0, 0.0],
                "size": [5000.0, 5000.0],
                "cell_size": 50.0,
                "max_depth": 5,
                "samples_per_tx": 1000000,
            },
        },
    )

    assert response.status_code == 400
    assert service_called is False
    detail = response.json()["detail"]
    assert detail["status"] == "failure"
    assert "x -407.1 to 407.1 m" in detail["error"]


def test_scene_position_validation_allows_scene_edge(monkeypatch):
    monkeypatch.setattr(api_module, "engine", FakeMetricEngine())
    monkeypatch.setattr(
        api_module,
        "store_simulation_result",
        lambda *args, **kwargs: None,
    )

    def fake_coverage_service(req, base_url, scene):
        assert req.solver.size == (814.2, 626.5)
        return {"status": "success"}

    monkeypatch.setattr(
        api_module,
        "calculate_coverage_map_service",
        fake_coverage_service,
    )

    response = client.post(
        "/api/v1/coverage-map",
        json={
            "tilt": 8.0,
            "transmitter_position": [407.1, 313.25, 25.0],
        },
    )

    assert response.status_code == 200
    assert response.json()["status"] == "success"


def test_throughput_comparison_failure_returns_http_500(monkeypatch):
    monkeypatch.setattr(
        api_module,
        "compare_throughput_service",
        lambda req, scene: failure_payload(),
    )

    response = client.post(
        "/api/v1/throughput-comparison",
        json={
            "base_tilt": 8.0,
            "target_tilt": 12.0,
            "transmitter_position": [0.0, 0.0, 25.0],
            "receiver_position": [10.0, 10.0, 1.5],
        },
    )

    assert response.status_code == 500
    assert response.json()["detail"]["status"] == "failure"


def test_throughput_client_input_failure_returns_http_400(monkeypatch):
    monkeypatch.setattr(
        api_module,
        "compare_throughput_service",
        lambda req, scene: client_error_payload(),
    )

    response = client.post(
        "/api/v1/throughput-comparison",
        json={
            "base_tilt": 8.0,
            "target_tilt": 12.0,
            "transmitter_position": [0.0, 0.0, 25.0],
            "receiver_position": [9999.0, 9999.0, 1.5],
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"]["status"] == "failure"


def test_simulation_success_logs_started_and_completed(monkeypatch):
    events = []
    monkeypatch.setattr(
        api_module,
        "store_simulation_result",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        api_module,
        "log_event",
        lambda event, level="INFO", data=None: events.append((event, level, data)),
    )
    monkeypatch.setattr(
        api_module,
        "calculate_sinr_service",
        lambda req, scene: {
            "status": "success",
            "sinr_db": 12.3,
        },
    )

    response = client.post(
        "/api/v1/sinr",
        json={
            "tilt": 8.0,
            "transmitter_position": [0.0, 0.0, 25.0],
            "receiver_position": [10.0, 10.0, 1.5],
        },
    )

    assert response.status_code == 200
    assert [event[0] for event in events] == [
        "simulation_started",
        "simulation_completed",
    ]
    assert events[1][1] == "INFO"
    assert events[1][2]["simulation_type"] == "sinr"
    assert events[1][2]["scene_id"] == "munich"
    assert events[1][2]["status"] == "success"
    assert "duration_ms" in events[1][2]
    assert "request" not in events[1][2]


def test_simulation_failure_logs_failed(monkeypatch):
    events = []
    monkeypatch.setattr(
        api_module,
        "store_simulation_result",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        api_module,
        "log_event",
        lambda event, level="INFO", data=None: events.append((event, level, data)),
    )
    monkeypatch.setattr(
        api_module,
        "calculate_sinr_service",
        lambda req, scene: failure_payload(),
    )

    response = client.post(
        "/api/v1/sinr",
        json={
            "tilt": 8.0,
            "transmitter_position": [0.0, 0.0, 25.0],
            "receiver_position": [10.0, 10.0, 1.5],
        },
    )

    assert response.status_code == 500
    assert [event[0] for event in events] == [
        "simulation_started",
        "simulation_failed",
    ]
    assert events[1][1] == "ERROR"
    assert events[1][2]["simulation_type"] == "sinr"
    assert events[1][2]["status"] == "failure"
    assert events[1][2]["error"] == "forced failure"


def test_simulation_request_queues_job_when_database_is_configured(monkeypatch):
    created_jobs = []
    monkeypatch.setattr(api_module, "is_database_configured", lambda: True)
    monkeypatch.setattr(
        api_module,
        "create_simulation_job",
        lambda simulation_type, req, scene_info, base_url=None: (
            created_jobs.append(
                {
                    "simulation_type": simulation_type,
                    "scene_info": scene_info,
                    "request": req,
                    "base_url": base_url,
                }
            )
            or "11111111-1111-1111-1111-111111111111"
        ),
    )
    monkeypatch.setattr(
        api_module,
        "calculate_sinr_service",
        lambda req, scene: pytest.fail("Sionna service should not run in request"),
    )

    response = client.post(
        "/api/v1/sinr",
        json={
            "tilt": 8.0,
            "transmitter_position": [0.0, 0.0, 25.0],
            "receiver_position": [10.0, 10.0, 1.5],
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "status": "queued",
        "job_id": "11111111-1111-1111-1111-111111111111",
        "simulation_type": "sinr",
    }
    assert created_jobs[0]["simulation_type"] == "sinr"
    assert created_jobs[0]["scene_info"]["id"] == "munich"


def test_simulation_job_detail_returns_404_for_missing_job(monkeypatch):
    monkeypatch.setattr(
        api_module,
        "get_simulation_job",
        lambda job_id: {
            "database_configured": True,
            "item": None,
        },
    )

    response = client.get(
        "/api/v1/simulation-jobs/11111111-1111-1111-1111-111111111111",
    )

    assert response.status_code == 404
