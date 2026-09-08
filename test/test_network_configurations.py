from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.api.dependencies import require_current_user
from backend.main import app
from backend.schemas.network_configurations import NetworkConfigurationCreateRequest
from backend.services import network_configuration_service as service


client = TestClient(app)
USER_ID = "11111111-1111-1111-1111-111111111111"
OTHER_USER_ID = "22222222-2222-2222-2222-222222222222"


def antenna(antenna_id="A1", tilt_current=4, power_current=30):
    return {
        "id": antenna_id,
        "longitude": 105.8,
        "latitude": 21.0,
        "height_m": 30,
        "enabled": True,
        "tilt": {"min": 0, "current": tilt_current, "max": 10},
        "azimuth": 120,
        "tx_power": {"min": 10, "current": power_current, "max": 46},
    }


@pytest.fixture
def authenticated_user():
    app.dependency_overrides[require_current_user] = lambda: {
        "id": USER_ID,
        "username": "planner",
    }
    yield
    app.dependency_overrides.pop(require_current_user, None)


def test_normalized_hash_ignores_antenna_order_and_number_spelling():
    first = NetworkConfigurationCreateRequest(
        scene_id="scene-1",
        antennas=[antenna("B2"), antenna("A1")],
    )
    second = NetworkConfigurationCreateRequest(
        scene_id="scene-1",
        antennas=[
            antenna("A1", tilt_current=4.0, power_current=30.0),
            antenna("B2", tilt_current=4.0, power_current=30.0),
        ],
    )

    first_snapshot, first_hash = service.calculate_content_hash(first.antennas)
    second_snapshot, second_hash = service.calculate_content_hash(second.antennas)

    assert [item["id"] for item in first_snapshot] == ["A1", "B2"]
    assert first_snapshot == second_snapshot
    assert first_hash == second_hash


def test_configuration_schema_rejects_duplicate_antenna_ids():
    with pytest.raises(ValidationError, match="antenna IDs must be unique"):
        NetworkConfigurationCreateRequest(
            scene_id="scene-1",
            antennas=[antenna("A1"), antenna(" A1 ")],
        )


def test_publish_supersedes_previous_version_without_mutating_its_content():
    published_at = datetime(2026, 9, 8, tzinfo=timezone.utc)
    version_one = SimpleNamespace(
        id="version-1",
        status="published",
        content_hash="old-hash",
        antennas_json=[antenna(tilt_current=4)],
    )
    version_two = SimpleNamespace(
        id="version-2",
        status="draft",
        content_hash="new-hash",
        created_by=USER_ID,
        antennas_json=[antenna(tilt_current=6)],
        published_at=None,
    )

    result = service.apply_publish_transition(
        version_two,
        version_one,
        USER_ID,
        published_at=published_at,
    )

    assert result == {
        "status": "success",
        "superseded_configuration_id": "version-1",
        "content_changed": True,
    }
    assert version_one.status == "superseded"
    assert version_one.antennas_json[0]["tilt"]["current"] == 4
    assert version_two.status == "published"
    assert version_two.published_at == published_at
    assert version_two.antennas_json[0]["tilt"]["current"] == 6


def test_publish_rejects_identical_content_without_changing_versions():
    version_one = SimpleNamespace(
        id="version-1",
        status="published",
        content_hash="same-hash",
    )
    version_two = SimpleNamespace(
        id="version-2",
        status="draft",
        content_hash="same-hash",
        created_by=USER_ID,
        published_at=None,
    )

    result = service.apply_publish_transition(version_two, version_one, USER_ID)

    assert result["status_code"] == 409
    assert result["error_code"] == "configuration_unchanged"
    assert result["automatic_study_created"] is False
    assert version_one.status == "published"
    assert version_two.status == "draft"


def test_publish_rejects_a_different_creator():
    draft = SimpleNamespace(
        status="draft",
        content_hash="new-hash",
        created_by=OTHER_USER_ID,
    )

    result = service.apply_publish_transition(draft, None, USER_ID)

    assert result["status_code"] == 403
    assert draft.status == "draft"


def test_create_api_accepts_a_parent_as_a_new_draft(monkeypatch, authenticated_user):
    captured = {}

    def fake_create(request, created_by):
        captured["request"] = request
        captured["created_by"] = created_by
        return {
            "status": "success",
            "configuration": {
                "id": "version-2",
                "version": 2,
                "status": "draft",
            },
        }

    monkeypatch.setattr(service, "create_network_configuration", fake_create)

    response = client.post(
        "/api/v1/network-configurations",
        json={
            "scene_id": "scene-1",
            "parent_configuration_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            "antennas": [antenna(tilt_current=6)],
        },
    )

    assert response.status_code == 201
    assert response.json()["configuration"]["status"] == "draft"
    assert captured["created_by"] == USER_ID
    assert str(captured["request"].parent_configuration_id) == (
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    )


def test_network_configuration_api_requires_authentication():
    response = client.get("/api/v1/network-configurations")

    assert response.status_code == 401


def test_network_configuration_service_requires_database(monkeypatch):
    monkeypatch.setattr(service, "is_database_configured", lambda: False)

    result = service.list_network_configurations(USER_ID)

    assert result["status_code"] == 503
