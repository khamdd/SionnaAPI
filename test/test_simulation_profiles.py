from contextlib import contextmanager
from datetime import datetime, timezone
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
from backend.schemas.simulation_profiles import (
    SimulationProfileCreateRequest,
    SimulationProfileEnableRequest,
    SimulationProfileUpdateRequest,
)
from backend.services import simulation_profile_service as service


client = TestClient(app)
USER_ID = "11111111-1111-1111-1111-111111111111"
PROFILE_ID = "22222222-2222-2222-2222-222222222222"
CONFIGURATION_ID = "33333333-3333-3333-3333-333333333333"


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


def configuration(
    configuration_id="config-1",
    *,
    scene_id="scene-1",
    status="published",
    created_by=USER_ID,
    antennas=None,
):
    return SimpleNamespace(
        id=configuration_id,
        scene_id=scene_id,
        status=status,
        created_by=created_by,
        version=2,
        content_hash="config-hash",
        antennas_json=antennas or [
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


def network_coverage_template():
    return {
        "transmitter_pattern": "tr38901",
        "solver": solver(),
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


def test_camera_is_not_a_supported_profile_field():
    template = network_coverage_template()
    template["camera"] = {
        "position": [0, 0, 650],
        "look_at": [0, 0, 0],
    }

    result = service.validate_profile_definition(
        "network_coverage",
        template,
        configuration(),
        scene_info(),
    )

    assert result["status_code"] == 422
    assert result["error_code"] == "unknown_profile_field"
    assert "camera" in result["error"]


def test_profile_update_rejects_explicit_null():
    with pytest.raises(ValidationError, match="name cannot be null"):
        SimulationProfileUpdateRequest(name=None)


def test_profiles_must_be_created_disabled():
    with pytest.raises(ValidationError, match="Input should be False"):
        SimulationProfileCreateRequest(
            scene_id="scene-1",
            name="Coverage",
            simulation_type="network_coverage",
            enabled=True,
            request_template=network_coverage_template(),
        )


def test_enable_request_requires_a_configuration_id():
    with pytest.raises(ValidationError, match="configuration_id"):
        SimulationProfileEnableRequest()


def saved_profile(*, enabled=False, template=None):
    return SimpleNamespace(
        id=PROFILE_ID,
        scene_id="scene-1",
        name="Candidate SINR",
        simulation_type="sinr",
        enabled=enabled,
        request_template_json=template or sinr_template(role_assignments()),
        created_by=USER_ID,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )


def service_session(profile, selected_configuration):
    class Result:
        def scalar_one_or_none(self):
            return profile

    class Session:
        def execute(self, statement):
            return Result()

        def get(self, model, item_id):
            if item_id == CONFIGURATION_ID:
                return selected_configuration
            return None

        def flush(self):
            return None

    @contextmanager
    def session_context():
        yield Session()

    return session_context


def test_profile_can_be_enabled_against_a_draft_only_antenna(
    monkeypatch,
):
    roles = {
        "transmitter": "A1",
        "receiver": "A2",
        "interferer": "A4",
    }
    profile = saved_profile(template=sinr_template(roles))
    draft = configuration(
        CONFIGURATION_ID,
        status="draft",
        antennas=[
            antenna("A1", 105.82),
            antenna("A2", 105.83),
            antenna("A4", 105.84),
        ],
    )
    monkeypatch.setattr(service, "is_database_configured", lambda: True)
    monkeypatch.setattr(service, "db_session", service_session(profile, draft))
    monkeypatch.setattr(service, "_find_ready_scene", lambda scene_id: scene_info())

    result = service.set_simulation_profile_enabled(
        PROFILE_ID,
        enabled=True,
        user_id=USER_ID,
        configuration_id=CONFIGURATION_ID,
    )

    assert result["status"] == "success"
    assert result["profile"]["enabled"] is True
    assert result["validated_configuration"] == {
        "id": CONFIGURATION_ID,
        "version": 2,
        "status": "draft",
        "content_hash": "config-hash",
    }


def test_profile_enablement_rejects_an_incompatible_selected_configuration(
    monkeypatch,
):
    roles = {
        "transmitter": "A1",
        "receiver": "A2",
        "interferer": "A4",
    }
    profile = saved_profile(template=sinr_template(roles))
    incompatible = configuration(
        CONFIGURATION_ID,
        antennas=[
            antenna("A1", 105.82),
            antenna("A2", 105.83),
            antenna("A3", 105.84),
        ],
    )
    monkeypatch.setattr(service, "is_database_configured", lambda: True)
    monkeypatch.setattr(
        service,
        "db_session",
        service_session(profile, incompatible),
    )
    monkeypatch.setattr(service, "_find_ready_scene", lambda scene_id: scene_info())

    result = service.set_simulation_profile_enabled(
        PROFILE_ID,
        enabled=True,
        user_id=USER_ID,
        configuration_id=CONFIGURATION_ID,
    )

    assert result["status_code"] == 422
    assert result["error_code"] == "invalid_role_profile"
    assert profile.enabled is False


@pytest.mark.parametrize(
    ("selected_configuration", "expected_code"),
    [
        (
            configuration(
                CONFIGURATION_ID,
                status="draft",
                created_by="44444444-4444-4444-4444-444444444444",
            ),
            "validation_configuration_not_found",
        ),
        (
            configuration(CONFIGURATION_ID, scene_id="scene-2"),
            "validation_configuration_scene_mismatch",
        ),
    ],
)
def test_profile_enablement_enforces_configuration_visibility_and_scene(
    monkeypatch,
    selected_configuration,
    expected_code,
):
    profile = saved_profile()
    monkeypatch.setattr(service, "is_database_configured", lambda: True)
    monkeypatch.setattr(
        service,
        "db_session",
        service_session(profile, selected_configuration),
    )

    result = service.set_simulation_profile_enabled(
        PROFILE_ID,
        enabled=True,
        user_id=USER_ID,
        configuration_id=CONFIGURATION_ID,
    )

    assert result["error_code"] == expected_code
    assert profile.enabled is False


def test_enabled_profile_simulation_settings_require_disable_first(monkeypatch):
    profile = saved_profile(enabled=True)
    monkeypatch.setattr(service, "is_database_configured", lambda: True)
    monkeypatch.setattr(
        service,
        "db_session",
        service_session(profile, configuration(CONFIGURATION_ID)),
    )

    result = service.update_simulation_profile(
        PROFILE_ID,
        SimulationProfileUpdateRequest(request_template=sinr_template()),
        USER_ID,
    )

    assert result["status_code"] == 409
    assert result["error_code"] == "enabled_profile_must_be_disabled"


def test_enabled_profile_name_can_change_without_revalidation(monkeypatch):
    profile = saved_profile(enabled=True)
    monkeypatch.setattr(service, "is_database_configured", lambda: True)
    monkeypatch.setattr(
        service,
        "db_session",
        service_session(profile, configuration(CONFIGURATION_ID)),
    )

    result = service.update_simulation_profile(
        PROFILE_ID,
        SimulationProfileUpdateRequest(name="Renamed profile"),
        USER_ID,
    )

    assert result["status"] == "success"
    assert result["profile"]["name"] == "Renamed profile"
    assert result["profile"]["enabled"] is True


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


def test_enable_profile_api_passes_selected_configuration(
    monkeypatch,
    authenticated_user,
):
    captured = {}

    def fake_enable(
        profile_id,
        enabled,
        user_id,
        configuration_id=None,
    ):
        captured.update(
            profile_id=profile_id,
            enabled=enabled,
            user_id=user_id,
            configuration_id=configuration_id,
        )
        return {
            "status": "success",
            "profile": {"id": profile_id, "enabled": enabled},
        }

    monkeypatch.setattr(service, "set_simulation_profile_enabled", fake_enable)

    response = client.post(
        f"/api/v1/simulation-profiles/{PROFILE_ID}/enable",
        json={"configuration_id": CONFIGURATION_ID},
    )

    assert response.status_code == 200
    assert captured == {
        "profile_id": PROFILE_ID,
        "enabled": True,
        "user_id": USER_ID,
        "configuration_id": CONFIGURATION_ID,
    }


def test_profile_api_requires_authentication():
    response = client.get("/api/v1/simulation-profiles")

    assert response.status_code == 401


def test_profile_service_requires_database(monkeypatch):
    monkeypatch.setattr(service, "is_database_configured", lambda: False)

    result = service.list_simulation_profiles(USER_ID)

    assert result["status_code"] == 503
