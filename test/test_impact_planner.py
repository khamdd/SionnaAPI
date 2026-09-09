from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.api.dependencies import require_current_user
from backend.main import app
from backend.schemas.configuration_impact import ConfigurationImpactPreviewRequest
from backend.services import impact_planner


client = TestClient(app)
USER_ID = "11111111-1111-1111-1111-111111111111"
BASELINE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
CANDIDATE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
BASELINE_PROFILE_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc"
CANDIDATE_PROFILE_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd"


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
        created_by=USER_ID,
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


def profile(
    profile_id,
    simulation_type,
    template,
    *,
    scene_id="scene-1",
    enabled=True,
    created_by=USER_ID,
):
    return SimpleNamespace(
        id=profile_id,
        name=profile_id,
        simulation_type=simulation_type,
        request_template_json=template,
        enabled=enabled,
        scene_id=scene_id,
        created_by=created_by,
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


def profile_pair(baseline_profile, candidate_profile=None, ordinal=0):
    return {
        "ordinal": ordinal,
        "baseline_profile": baseline_profile,
        "candidate_profile": candidate_profile or baseline_profile,
    }


def plan(difference, pairs):
    return impact_planner.plan_configuration_impact(
        difference,
        pairs,
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
    selected_profile = profile("profile-1", simulation_type, template)
    decision = impact_planner.evaluate_profile_pair_impact(
        selected_profile,
        selected_profile,
        difference,
        {"changed": False, "changed_fields": []},
    )

    assert decision["action"] == "plan"


def test_tilt_only_change_skips_analytical_role_profile():
    roles = {"transmitter": "A1", "receiver": "A2", "interferer": "A3"}
    result = plan(
        field_difference("tilt.current"),
        [
            profile_pair(profile("coverage", "network_coverage", network_template())),
            profile_pair(profile("rsrp", "rsrp_simulation", rsrp_template()), ordinal=1),
            profile_pair(
                profile("sinr-sionna", "sinr", sinr_template("sionna", roles)),
                ordinal=2,
            ),
            profile_pair(
                profile("sinr-uma", "sinr", sinr_template("uma", roles)),
                ordinal=3,
            ),
        ],
    )

    assert [
        item["baseline_profile"]["id"] for item in result["planned_simulations"]
    ] == [
        "coverage",
        "rsrp",
        "sinr-sionna",
    ]
    assert result["estimated_job_count"] == 6
    assert result["skipped_simulations"][0]["baseline_profile"]["id"] == "sinr-uma"
    assert result["skipped_simulations"][0]["reason_code"] == (
        "propagation_model_ignores_change"
    )


def test_power_change_runs_an_analytical_role_profile():
    roles = {"transmitter": "A1", "receiver": "A2", "interferer": "A3"}
    result = plan(
        field_difference("tx_power.current"),
        [profile_pair(profile("sinr-friis", "sinr", sinr_template("friis", roles)))],
    )

    assert result["planned_simulations"][0]["baseline_profile"]["id"] == "sinr-friis"
    assert result["estimated_job_count"] == 2


def test_unaffected_role_profile_is_skipped():
    roles = {"transmitter": "A1", "receiver": "A2", "interferer": "A3"}
    result = plan(
        field_difference("tilt.current", antenna_id="A4"),
        [profile_pair(profile("sinr", "sinr", sinr_template("sionna", roles)))],
    )

    assert result["planned_simulations"] == []
    assert result["skipped_simulations"][0]["reason_code"] == (
        "unaffected_profile_roles"
    )


def test_incomplete_role_profile_is_skipped_without_failing_plan():
    result = plan(
        field_difference("tilt.current"),
        [profile_pair(profile("sinr", "sinr", sinr_template()))],
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
        [profile_pair(profile("coverage", "network_coverage", network_template()))],
    )

    assert result["estimated_job_count"] == 0
    assert result["optimization"]["planned"] is False
    assert result["skipped_simulations"][0]["reason_code"] == (
        "no_meaningful_change"
    )


def test_same_profile_on_both_sides_builds_a_valid_pair():
    selected_profile = profile("coverage", "network_coverage", network_template())

    result = plan(
        field_difference("tilt.current"),
        [profile_pair(selected_profile)],
    )

    planned = result["planned_simulations"][0]
    assert planned["baseline_profile"]["id"] == "coverage"
    assert planned["candidate_profile"]["id"] == "coverage"
    assert planned["profile_difference"]["changed"] is False
    assert planned["pair_id"].startswith("pair-")
    assert result["policy_version"] == "impact-policy-v2"


def test_different_same_type_profiles_build_independent_requests_and_objectives():
    baseline_template = network_template()
    candidate_template = network_template()
    candidate_template["bandwidth_mhz"] = 80
    candidate_template["objectives"][0]["target"] = 95

    result = plan(
        field_difference("tilt.current"),
        [
            profile_pair(
                profile("baseline-profile", "network_coverage", baseline_template),
                profile("candidate-profile", "network_coverage", candidate_template),
            )
        ],
    )

    planned = result["planned_simulations"][0]
    assert planned["baseline_request"]["bandwidth_mhz"] == 100
    assert planned["candidate_request"]["bandwidth_mhz"] == 80
    assert planned["baseline_objectives"][0]["target"] == 90
    assert planned["candidate_objectives"][0]["target"] == 95
    assert planned["profile_difference"]["changed_fields"] == [
        "bandwidth_mhz",
        "objectives[0].target",
    ]


def test_profile_change_triggers_analytical_pair_when_configuration_change_is_ignored():
    roles = {"transmitter": "A1", "receiver": "A2", "interferer": "A3"}
    baseline_template = sinr_template("uma", roles)
    candidate_template = sinr_template("uma", roles)
    candidate_template["bandwidth_mhz"] = 80

    result = plan(
        field_difference("tilt.current"),
        [
            profile_pair(
                profile("baseline-profile", "sinr", baseline_template),
                profile("candidate-profile", "sinr", candidate_template),
            )
        ],
    )

    triggering = result["planned_simulations"][0]["triggering_changes"]
    assert triggering["configuration_changes"] == []
    assert triggering["profile_changes"] == ["bandwidth_mhz"]


def test_invalid_candidate_request_is_a_side_specific_skip():
    baseline_roles = {"transmitter": "A1", "receiver": "A2", "interferer": "A3"}
    candidate_roles = {"transmitter": "A1", "receiver": "A2", "interferer": "A9"}

    result = plan(
        field_difference("tilt.current"),
        [
            profile_pair(
                profile("baseline-profile", "sinr", sinr_template("sionna", baseline_roles)),
                profile("candidate-profile", "sinr", sinr_template("sionna", candidate_roles)),
            )
        ],
    )

    skipped = result["skipped_simulations"][0]
    assert set(skipped["side_reasons"]) == {"candidate"}
    assert skipped["baseline_objectives"] == []
    assert skipped["candidate_objectives"] == []
    assert skipped["comparability_warnings"] == []
    assert skipped["side_reasons"]["candidate"]["reason_code"] == (
        "invalid_role_profile"
    )


def test_explicit_pair_loader_rejects_type_scene_visibility_and_enabled_errors():
    class Session:
        def __init__(self, profiles):
            self.profiles = profiles

        def get(self, model, profile_id):
            return self.profiles.get(profile_id)

    valid = profile(BASELINE_PROFILE_ID, "sinr", sinr_template())
    cases = [
        (
            profile(CANDIDATE_PROFILE_ID, "network_coverage", network_template()),
            "profile_simulation_type_mismatch",
        ),
        (
            profile(
                CANDIDATE_PROFILE_ID,
                "sinr",
                sinr_template(),
                scene_id="scene-2",
            ),
            "profile_scene_mismatch",
        ),
        (
            profile(
                CANDIDATE_PROFILE_ID,
                "sinr",
                sinr_template(),
                enabled=False,
                created_by="22222222-2222-2222-2222-222222222222",
            ),
            "profile_not_found",
        ),
        (
            profile(
                CANDIDATE_PROFILE_ID,
                "sinr",
                sinr_template(),
                enabled=False,
            ),
            "profile_not_enabled",
        ),
    ]

    for candidate, error_code in cases:
        result = impact_planner._load_explicit_profile_pairs(
            Session(
                {
                    BASELINE_PROFILE_ID: valid,
                    CANDIDATE_PROFILE_ID: candidate,
                }
            ),
            [
                {
                    "baseline_profile_id": BASELINE_PROFILE_ID,
                    "candidate_profile_id": CANDIDATE_PROFILE_ID,
                }
            ],
            USER_ID,
            "scene-1",
        )
        assert result["status"] == "failure"
        assert result["error_code"] == error_code


def test_explicit_pair_loader_preserves_order_and_loads_only_selected_profiles():
    class Session:
        def __init__(self, profiles):
            self.profiles = profiles
            self.loaded_ids = []

        def get(self, model, profile_id):
            self.loaded_ids.append(profile_id)
            return self.profiles.get(profile_id)

    first = profile(BASELINE_PROFILE_ID, "network_coverage", network_template())
    second = profile(CANDIDATE_PROFILE_ID, "network_coverage", network_template())
    session = Session(
        {
            BASELINE_PROFILE_ID: first,
            CANDIDATE_PROFILE_ID: second,
            "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee": profile(
                "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
                "network_coverage",
                network_template(),
            ),
        }
    )

    result = impact_planner._load_explicit_profile_pairs(
        session,
        [
            {
                "baseline_profile_id": CANDIDATE_PROFILE_ID,
                "candidate_profile_id": BASELINE_PROFILE_ID,
            },
            {
                "baseline_profile_id": BASELINE_PROFILE_ID,
                "candidate_profile_id": BASELINE_PROFILE_ID,
            },
        ],
        USER_ID,
        "scene-1",
    )

    assert [pair["ordinal"] for pair in result] == [0, 1]
    assert result[0]["baseline_profile"] is second
    assert result[0]["candidate_profile"] is first
    assert session.loaded_ids == [CANDIDATE_PROFILE_ID, BASELINE_PROFILE_ID]


def test_preview_schema_rejects_duplicate_pairs():
    pair = {
        "baseline_profile_id": BASELINE_PROFILE_ID,
        "candidate_profile_id": CANDIDATE_PROFILE_ID,
    }

    with pytest.raises(ValidationError, match="profile pairs must be unique"):
        ConfigurationImpactPreviewRequest(
            baseline_configuration_id=BASELINE_ID,
            candidate_configuration_id=CANDIDATE_ID,
            profile_pairs=[pair, pair],
        )


def test_preview_api_passes_authenticated_user(monkeypatch, authenticated_user):
    captured = {}

    def fake_preview(
        baseline_configuration_id,
        candidate_configuration_id,
        profile_pairs,
        user_id,
    ):
        captured.update(
            baseline=baseline_configuration_id,
            candidate=candidate_configuration_id,
            profile_pairs=[
                pair.model_dump(mode="json") for pair in profile_pairs
            ],
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
            "profile_pairs": [
                {
                    "baseline_profile_id": BASELINE_PROFILE_ID,
                    "candidate_profile_id": CANDIDATE_PROFILE_ID,
                }
            ],
        },
    )

    assert response.status_code == 200
    assert response.json()["policy_version"] == "impact-policy-v2"
    assert captured == {
        "baseline": BASELINE_ID,
        "candidate": CANDIDATE_ID,
        "profile_pairs": [
            {
                "baseline_profile_id": BASELINE_PROFILE_ID,
                "candidate_profile_id": CANDIDATE_PROFILE_ID,
            }
        ],
        "user_id": USER_ID,
    }


def test_preview_api_requires_authentication():
    response = client.post(
        "/api/v1/configuration-impact/preview",
        json={
            "baseline_configuration_id": BASELINE_ID,
            "candidate_configuration_id": CANDIDATE_ID,
            "profile_pairs": [
                {
                    "baseline_profile_id": BASELINE_PROFILE_ID,
                    "candidate_profile_id": CANDIDATE_PROFILE_ID,
                }
            ],
        },
    )

    assert response.status_code == 401


def test_impact_preview_requires_database(monkeypatch):
    monkeypatch.setattr(impact_planner, "is_database_configured", lambda: False)

    result = impact_planner.preview_configuration_impact(
        BASELINE_ID,
        CANDIDATE_ID,
        [
            {
                "baseline_profile_id": BASELINE_PROFILE_ID,
                "candidate_profile_id": CANDIDATE_PROFILE_ID,
            }
        ],
        USER_ID,
    )

    assert result["status_code"] == 503
