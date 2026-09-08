from copy import deepcopy

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.api.dependencies import require_current_user
from backend.main import app
from backend.schemas.network_configurations import NetworkConfigurationCompareRequest
from backend.services import configuration_diff_service as diff_service
from backend.services import network_configuration_service


client = TestClient(app)
USER_ID = "11111111-1111-1111-1111-111111111111"
BASELINE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
CANDIDATE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"


def antenna(antenna_id="A1"):
    return {
        "id": antenna_id,
        "longitude": 105.8,
        "latitude": 21.0,
        "height_m": 30,
        "enabled": True,
        "tilt": {"min": 0, "current": 4, "max": 10},
        "azimuth": 120,
        "tx_power": {"min": 10, "current": 30, "max": 46},
    }


def set_path(value, field_path, replacement):
    target = value
    parts = field_path.split(".")
    for part in parts[:-1]:
        target = target[part]
    target[parts[-1]] = replacement


@pytest.fixture
def authenticated_user():
    app.dependency_overrides[require_current_user] = lambda: {
        "id": USER_ID,
        "username": "planner",
    }
    yield
    app.dependency_overrides.pop(require_current_user, None)


@pytest.mark.parametrize(
    ("field_path", "candidate_value"),
    [
        ("enabled", False),
        ("longitude", 105.81),
        ("latitude", 21.01),
        ("height_m", 31),
        ("tilt.min", 1),
        ("tilt.current", 5),
        ("tilt.max", 11),
        ("tx_power.min", 11),
        ("tx_power.current", 31),
        ("tx_power.max", 45),
        ("azimuth", 121),
    ],
)
def test_every_supported_antenna_field_is_reported(field_path, candidate_value):
    baseline = antenna()
    candidate = deepcopy(baseline)
    set_path(candidate, field_path, candidate_value)

    result = diff_service.compare_configuration_snapshots(
        [baseline],
        [candidate],
    )

    assert result["changed"] is True
    assert result["changed_antennas"] == ["A1"]
    assert result["changes"] == [
        {
            "antenna_id": "A1",
            "change_type": "field_changed",
            "field": field_path,
            "before": set_path_value(baseline, field_path),
            "after": candidate_value,
        }
    ]


def set_path_value(value, field_path):
    target = value
    for part in field_path.split("."):
        target = target[part]
    return target


def test_order_and_numeric_formatting_do_not_create_false_changes():
    baseline = [antenna("B2"), antenna("A1")]
    candidate = [deepcopy(baseline[1]), deepcopy(baseline[0])]
    for item in candidate:
        item["height_m"] = 30.0
        item["tilt"] = {"min": 0.0, "current": 4.0000, "max": 10.0}
        item["tx_power"]["current"] = 30.0

    result = diff_service.compare_configuration_snapshots(baseline, candidate)

    assert result["changed"] is False
    assert result["changed_antennas"] == []
    assert result["changes"] == []


def test_adding_then_removing_a_draft_change_restores_the_original_hash():
    original = [antenna("A1")]
    draft = [antenna("A1"), antenna("A2")]

    _, original_hash = network_configuration_service.calculate_content_hash(original)
    _, changed_hash = network_configuration_service.calculate_content_hash(draft)
    draft.pop()
    _, restored_hash = network_configuration_service.calculate_content_hash(draft)

    assert changed_hash != original_hash
    assert restored_hash == original_hash


def test_added_and_removed_antennas_are_reported_in_stable_order():
    result = diff_service.compare_configuration_snapshots(
        [antenna("A2"), antenna("A1")],
        [antenna("A3"), antenna("A2")],
    )

    assert result["changed_antennas"] == ["A1", "A3"]
    assert [change["change_type"] for change in result["changes"]] == [
        "antenna_removed",
        "antenna_added",
    ]
    assert result["summary"] == {
        "antennas_added": 1,
        "antennas_removed": 1,
        "antennas_changed": 0,
        "fields_changed": 0,
    }


def test_duplicate_antenna_ids_are_rejected():
    with pytest.raises(ValueError, match="Duplicate antenna ID"):
        diff_service.compare_configuration_snapshots(
            [antenna("A1"), antenna("A1")],
            [],
        )


def test_compare_request_requires_two_different_versions():
    with pytest.raises(ValidationError, match="must be different"):
        NetworkConfigurationCompareRequest(
            baseline_configuration_id=BASELINE_ID,
            candidate_configuration_id=BASELINE_ID,
        )


def test_compare_api_passes_authenticated_user(monkeypatch, authenticated_user):
    captured = {}

    def fake_compare(baseline_configuration_id, candidate_configuration_id, user_id):
        captured.update(
            baseline=baseline_configuration_id,
            candidate=candidate_configuration_id,
            user_id=user_id,
        )
        return {
            "status": "success",
            "changed": False,
            "changed_antennas": [],
            "changes": [],
        }

    monkeypatch.setattr(
        network_configuration_service,
        "compare_network_configurations",
        fake_compare,
    )

    response = client.post(
        "/api/v1/network-configurations/compare",
        json={
            "baseline_configuration_id": BASELINE_ID,
            "candidate_configuration_id": CANDIDATE_ID,
        },
    )

    assert response.status_code == 200
    assert response.json()["changed"] is False
    assert captured == {
        "baseline": BASELINE_ID,
        "candidate": CANDIDATE_ID,
        "user_id": USER_ID,
    }


def test_compare_api_requires_authentication():
    response = client.post(
        "/api/v1/network-configurations/compare",
        json={
            "baseline_configuration_id": BASELINE_ID,
            "candidate_configuration_id": CANDIDATE_ID,
        },
    )

    assert response.status_code == 401
