from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.api.dependencies import require_current_user
from backend.main import app
from backend.schemas.requests import (
    CoverageRequest,
    NetworkCoverageRequest,
    RSRPRequest,
    SINRRequest,
    ThroughputRequest,
)
from backend.schemas.simulation_profiles import SimulationProfileUpdateRequest
from backend.services import simulation_profile_service as service


client = TestClient(app)
USER_ID = "11111111-1111-1111-1111-111111111111"


def antenna(antenna_id, longitude, enabled=True):
    return {
        "id": antenna_id,
        "longitude": longitude,
        "latitude": 21.05,
        "height_m": 30,
        "enabled": enabled,
        "tilt": {"min": 0, "current": 4, "max": 10},
        "azimuth": 120,
        "tx_power": {"min": 10, "current": 30, "max": 46},
    }


def configuration():
    return SimpleNamespace(
        id="config-1",
        antennas_json=[
            antenna("A1", 105.82),
            antenna("A2", 105.83),
            antenna("A3", 105.84),
            antenna("OFF", 105.85, enabled=False),
        ],
    )


def scene_info():
    return {
        "id": "scene-1",
        "status": "ready",
        "bounds": {
            "south": 21.0,
            "west": 105.8,
            "north": 21.1,
            "east": 105.9,
        },
    }


def solver():
    return {
        "max_depth": 5,
        "samples_per_tx": 1_000_000,
        "cell_size": 2,
        "center": [0, 0, 0],
        "size": [400, 400],
    }


def camera():
    return {
        "position": [0, 0, 650],
        "look_at": [0, 0, 0],
    }


def network_coverage_template():
    return {
        "transmitter_pattern": "tr38901",
        "solver": solver(),
        "camera": camera(),
        "bandwidth_mhz": 100,
        "mimo_layers": 4,
        "objectives": [
            {
                "metric": "covered_area_percent",
                "operator": ">=",
                "target": 90,
            }
        ],
    }


def sinr_template(roles=None):
    template = {
        "propagation_model": "sionna",
        "carrier_frequency_ghz": 3.5,
        "bandwidth_mhz": 100,
        "noise_figure_db": 7,
        "transmitter_pattern": "tr38901",
        "solver": solver(),
    }
    if roles is not None:
        template["roles"] = roles
    return template


def role_assignments():
    return {
        "transmitter": "A1",
        "receiver": "A2",
        "interferer": "A3",
    }


@pytest.fixture
def authenticated_user():
    app.dependency_overrides[require_current_user] = lambda: {
        "id": USER_ID,
        "username": "planner",
    }
    yield
    app.dependency_overrides.pop(require_current_user, None)


def test_network_profile_builds_an_existing_request_model():
    result = service.validate_profile_definition(
        "network_coverage",
        network_coverage_template(),
        configuration(),
        scene_info(),
    )

    assert result["status"] == "success"
    request = NetworkCoverageRequest.model_validate(result["request"])
    assert [item.id for item in request.antennas] == ["A1", "A2", "A3"]
    assert all("enabled" not in item for item in result["request"]["antennas"])
    assert result["objectives"][0]["target"] == 90


def test_incomplete_profile_cannot_be_enabled():
    result = service.validate_profile_definition(
        "network_coverage",
        {"bandwidth_mhz": 100},
        configuration(),
        scene_info(),
    )

    assert result["status_code"] == 422
    assert result["error_code"] == "incomplete_profile"
    assert "solver" in result["error"]


@pytest.mark.parametrize("simulation_type", ["sinr", "throughput_comparison"])
def test_role_based_profile_is_skipped_with_reason_when_roles_are_missing(
    simulation_type,
):
    template = sinr_template()
    if simulation_type == "throughput_comparison":
        template.update(
            {
                "base_tilt": 4,
                "target_tilt": 6,
                "mimo_layers": 4,
            }
        )

    result = service.validate_profile_definition(
        simulation_type,
        template,
        configuration(),
        scene_info(),
    )

    assert result["status_code"] == 422
    assert result["error_code"] == "missing_role_profile"
    assert result["skip_reason"]


def test_sinr_profile_resolves_roles_from_configuration():
    result = service.validate_profile_definition(
        "sinr",
        sinr_template(role_assignments()),
        configuration(),
        scene_info(),
    )

    assert result["status"] == "success"
    request = SINRRequest.model_validate(result["request"])
    assert request.tilt == 4
    assert request.tx_power == 30
    assert request.transmitter_position != request.receiver_position


@pytest.mark.parametrize(
    ("simulation_type", "template", "request_model"),
    [
        (
            "coverage_map",
            {
                "transmitter_pattern": "tr38901",
                "solver": solver(),
                "camera": camera(),
                "roles": {"transmitter": "A1"},
            },
            CoverageRequest,
        ),
        (
            "rsrp_simulation",
            {
                "transmitter_pattern": "tr38901",
                "solver": solver(),
                "user_count": 100,
                "user_height_m": 1.5,
                "random_seed": 42,
            },
            RSRPRequest,
        ),
        (
            "throughput_comparison",
            {
                "propagation_model": "sionna",
                "carrier_frequency_ghz": 3.5,
                "noise_figure_db": 7,
                "base_tilt": 4,
                "target_tilt": 6,
                "transmitter_pattern": "tr38901",
                "bandwidth_mhz": 100,
                "mimo_layers": 4,
                "solver": solver(),
                "roles": role_assignments(),
            },
            ThroughputRequest,
        ),
    ],
)
def test_other_profile_types_build_existing_request_models(
    simulation_type,
    template,
    request_model,
):
    result = service.validate_profile_definition(
        simulation_type,
        template,
        configuration(),
        scene_info(),
    )

    assert result["status"] == "success"
    request_model.model_validate(result["request"])


def test_profile_cannot_override_configuration_owned_antennas():
    template = network_coverage_template()
    template["antennas"] = []

    result = service.validate_profile_definition(
        "network_coverage",
        template,
        configuration(),
        scene_info(),
    )

    assert result["status_code"] == 422
    assert result["error_code"] == "configuration_field_in_profile"


def test_profile_update_rejects_explicit_null():
    with pytest.raises(ValidationError, match="name cannot be null"):
        SimulationProfileUpdateRequest(name=None)


def test_create_profile_api_passes_authenticated_creator(
    monkeypatch,
    authenticated_user,
):
    captured = {}

    def fake_create(request, created_by):
        captured["request"] = request
        captured["created_by"] = created_by
        return {
            "status": "success",
            "profile": {
                "id": "profile-1",
                "name": request.name,
                "enabled": request.enabled,
            },
        }

    monkeypatch.setattr(service, "create_simulation_profile", fake_create)

    response = client.post(
        "/api/v1/simulation-profiles",
        json={
            "scene_id": "scene-1",
            "name": "Standard coverage",
            "simulation_type": "network_coverage",
            "request_template": network_coverage_template(),
        },
    )

    assert response.status_code == 201
    assert response.json()["profile"]["name"] == "Standard coverage"
    assert captured["created_by"] == USER_ID


def test_profile_api_requires_authentication():
    response = client.get("/api/v1/simulation-profiles")

    assert response.status_code == 401


def test_profile_service_requires_database(monkeypatch):
    monkeypatch.setattr(service, "is_database_configured", lambda: False)

    result = service.list_simulation_profiles(USER_ID)

    assert result["status_code"] == 503
