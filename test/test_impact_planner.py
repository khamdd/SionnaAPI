from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.api.dependencies import require_current_user
from backend.main import app
from backend.services import impact_planner


client = TestClient(app)
USER_ID = "11111111-1111-1111-1111-111111111111"
BASELINE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
CANDIDATE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"


def antenna(antenna_id, longitude):
    return {
        "id": antenna_id,
        "longitude": longitude,
        "latitude": 21.05,
        "height_m": 30,
        "enabled": True,
        "tilt": {"min": 0, "current": 4, "max": 10},
        "azimuth": 120,
        "tx_power": {"min": 10, "current": 30, "max": 46},
    }


def configuration(configuration_id, version, status):
    return SimpleNamespace(
        id=configuration_id,
        scene_id="scene-1",
        version=version,
        status=status,
        content_hash=f"hash-{version}",
        antennas_json=[
            antenna("A1", 105.82),
            antenna("A2", 105.83),
            antenna("A3", 105.84),
            antenna("A4", 105.85),
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


def network_template():
    return {
        "transmitter_pattern": "tr38901",
        "solver": solver(),
        "camera": {
            "position": [0, 0, 650],
            "look_at": [0, 0, 0],
        },
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


def rsrp_template():
    return {
        "transmitter_pattern": "tr38901",
        "solver": solver(),
        "user_count": 100,
        "user_height_m": 1.5,
        "random_seed": 42,
    }


def sinr_template(model="sionna", roles=None):
    return {
        "propagation_model": model,
        "carrier_frequency_ghz": 3.5,
        "bandwidth_mhz": 100,
        "noise_figure_db": 7,
        "transmitter_pattern": "tr38901",
        "solver": solver(),
        **({"roles": roles} if roles is not None else {}),
    }


def profile(profile_id, simulation_type, template):
    return SimpleNamespace(
        id=profile_id,
        name=profile_id,
        simulation_type=simulation_type,
        request_template_json=template,
        enabled=True,
    )


def field_difference(field="tilt.current", antenna_id="A1"):
    return {
        "changed": True,
        "changed_antennas": [antenna_id],
        "changes": [
            {
                "antenna_id": antenna_id,
                "change_type": "field_changed",
                "field": field,
                "before": 4,
                "after": 6,
            }
        ],
        "summary": {},
    }


def topology_difference(antenna_id="A4"):
    return {
        "changed": True,
        "changed_antennas": [antenna_id],
        "changes": [
            {
                "antenna_id": antenna_id,
                "change_type": "antenna_added",
                "field": "antenna",
                "before": None,
                "after": antenna(antenna_id, 105.85),
            }
        ],
        "summary": {},
    }


def plan(difference, profiles):
    return impact_planner.plan_configuration_impact(
        difference,
        profiles,
        configuration(BASELINE_ID, 1, "published"),
        configuration(CANDIDATE_ID, 2, "draft"),
        scene_info(),
    )


@pytest.fixture
def authenticated_user():
    app.dependency_overrides[require_current_user] = lambda: {
        "id": USER_ID,
        "username": "planner",
    }
    yield
    app.dependency_overrides.pop(require_current_user, None)


@pytest.mark.parametrize(
    "difference",
    [
        field_difference("tilt.current"),
        field_difference("tx_power.current"),
        field_difference("azimuth"),
        field_difference("longitude"),
        field_difference("height_m"),
        field_difference("enabled"),
        topology_difference(),
    ],
)
@pytest.mark.parametrize("simulation_type", ["network_coverage", "rsrp_simulation"])
def test_network_level_profiles_run_for_every_supported_change(
    difference,
    simulation_type,
):
    template = network_template() if simulation_type == "network_coverage" else rsrp_template()
    decision = impact_planner.evaluate_profile_impact(
        profile("profile-1", simulation_type, template),
        difference,
    )

    assert decision["action"] == "plan"


def test_tilt_only_change_skips_analytical_role_profile():
    roles = {"transmitter": "A1", "receiver": "A2", "interferer": "A3"}
    result = plan(
        field_difference("tilt.current"),
        [
            profile("coverage", "network_coverage", network_template()),
            profile("rsrp", "rsrp_simulation", rsrp_template()),
            profile("sinr-sionna", "sinr", sinr_template("sionna", roles)),
            profile("sinr-uma", "sinr", sinr_template("uma", roles)),
        ],
    )

    assert [item["profile_id"] for item in result["planned_simulations"]] == [
        "coverage",
        "rsrp",
        "sinr-sionna",
    ]
    assert result["estimated_job_count"] == 6
    assert result["skipped_simulations"][0]["profile_id"] == "sinr-uma"
    assert result["skipped_simulations"][0]["reason_code"] == (
        "propagation_model_ignores_change"
    )


def test_power_change_runs_an_analytical_role_profile():
    roles = {"transmitter": "A1", "receiver": "A2", "interferer": "A3"}
    result = plan(
        field_difference("tx_power.current"),
        [profile("sinr-friis", "sinr", sinr_template("friis", roles))],
    )

    assert result["planned_simulations"][0]["profile_id"] == "sinr-friis"
    assert result["estimated_job_count"] == 2


def test_unaffected_role_profile_is_skipped():
    roles = {"transmitter": "A1", "receiver": "A2", "interferer": "A3"}
    result = plan(
        field_difference("tilt.current", antenna_id="A4"),
        [profile("sinr", "sinr", sinr_template("sionna", roles))],
    )

    assert result["planned_simulations"] == []
    assert result["skipped_simulations"][0]["reason_code"] == (
        "unaffected_profile_roles"
    )


def test_incomplete_role_profile_is_skipped_without_failing_plan():
    result = plan(
        field_difference("tilt.current"),
        [profile("sinr", "sinr", sinr_template())],
    )

    assert result["status"] == "success"
    assert result["planned_simulations"] == []
    assert result["skipped_simulations"][0]["reason_code"] == (
        "invalid_or_incomplete_profile"
    )
    assert "Assign distinct enabled antennas" in result["skipped_simulations"][0][
        "reason"
    ]


def test_no_change_produces_no_jobs_and_explicit_skips():
    result = plan(
        {
            "changed": False,
            "changed_antennas": [],
            "changes": [],
            "summary": {},
        },
        [profile("coverage", "network_coverage", network_template())],
    )

    assert result["estimated_job_count"] == 0
    assert result["optimization"]["planned"] is False
    assert result["skipped_simulations"][0]["reason_code"] == (
        "no_meaningful_change"
    )


def test_preview_api_passes_authenticated_user(monkeypatch, authenticated_user):
    captured = {}

    def fake_preview(baseline_configuration_id, candidate_configuration_id, user_id):
        captured.update(
            baseline=baseline_configuration_id,
            candidate=candidate_configuration_id,
            user_id=user_id,
        )
        return {
            "status": "success",
            "policy_version": impact_planner.IMPACT_POLICY_VERSION,
            "planned_simulations": [],
            "skipped_simulations": [],
            "estimated_job_count": 0,
        }

    monkeypatch.setattr(impact_planner, "preview_configuration_impact", fake_preview)

    response = client.post(
        "/api/v1/configuration-impact/preview",
        json={
            "baseline_configuration_id": BASELINE_ID,
            "candidate_configuration_id": CANDIDATE_ID,
        },
    )

    assert response.status_code == 200
    assert response.json()["policy_version"] == "impact-policy-v1"
    assert captured == {
        "baseline": BASELINE_ID,
        "candidate": CANDIDATE_ID,
        "user_id": USER_ID,
    }


def test_preview_api_requires_authentication():
    response = client.post(
        "/api/v1/configuration-impact/preview",
        json={
            "baseline_configuration_id": BASELINE_ID,
            "candidate_configuration_id": CANDIDATE_ID,
        },
    )

    assert response.status_code == 401


def test_impact_preview_requires_database(monkeypatch):
    monkeypatch.setattr(impact_planner, "is_database_configured", lambda: False)

    result = impact_planner.preview_configuration_impact(
        BASELINE_ID,
        CANDIDATE_ID,
        USER_ID,
    )

    assert result["status_code"] == 503
