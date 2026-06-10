import contextlib

import pytest
from fastapi.testclient import TestClient

from backend.api import sinr as api_module
from backend.main import app


client = TestClient(app)


class FakeEngine:
    def __init__(self):
        self.lock = contextlib.nullcontext()
        self.scene = object()

    def get_scene(self):
        return self.scene


@pytest.fixture(autouse=True)
def fake_sionna_engine(monkeypatch):
    monkeypatch.setattr(api_module, "engine", FakeEngine())


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
