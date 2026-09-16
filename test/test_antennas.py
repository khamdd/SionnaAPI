from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.api.dependencies import require_current_user
from backend.main import app
from backend.schemas.antennas import AntennaCreateRequest, AntennaImportPreviewRequest
from backend.services import antenna_service

USER_ID = "11111111-1111-1111-1111-111111111111"
ANTENNA_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
client = TestClient(app)


def values(code="A1", power=30):
    return {
        "id": code,
        "longitude": 105.8,
        "latitude": 21.0,
        "height_m": 30,
        "azimuth": 120,
        "tilt": {"min": 0, "current": 4, "max": 10},
        "tx_power": {"min": 10, "current": power, "max": 46},
    }


def record(code="A1", power=30, status="active"):
    return SimpleNamespace(
        id=ANTENNA_ID,
        code=code,
        longitude=105.8,
        latitude=21.0,
        height_m=30,
        azimuth_deg=120,
        tilt_min_deg=0,
        tilt_current_deg=4,
        tilt_max_deg=10,
        tx_power_min_dbm=10,
        tx_power_current_dbm=power,
        tx_power_max_dbm=46,
        status=status,
        created_by=USER_ID,
        updated_by=USER_ID,
        created_at=None,
        updated_at=None,
    )


@pytest.fixture
def authenticated_user():
    app.dependency_overrides[require_current_user] = lambda: {
        "id": USER_ID,
        "username": "planner",
    }
    yield
    app.dependency_overrides.pop(require_current_user, None)


def test_antenna_schema_validates_ranges():
    payload = values()
    payload["tilt"] = {"min": 10, "current": 4, "max": 5}
    with pytest.raises(ValidationError):
        AntennaCreateRequest.model_validate(payload)


def test_import_preview_classifies_new_changed_and_unchanged():
    request = AntennaImportPreviewRequest(
        antennas=[values("A1"), values("A2", power=31), values("A3")]
    )
    existing = {"a1": record("A1"), "a2": record("A2", power=30)}

    preview = antenna_service._classify_import(request.antennas, existing)

    assert [item["id"] for item in preview["new"]] == ["A3"]
    assert [item["id"] for item in preview["unchanged"]] == ["A1"]
    assert preview["changed"][0]["after"]["id"] == "A2"


def test_create_antenna_api_uses_authenticated_user(monkeypatch, authenticated_user):
    captured = {}

    def fake_create(request, user_id):
        captured["request"] = request
        captured["user_id"] = user_id
        return {"status": "success", "antenna": {"database_id": ANTENNA_ID, **values()}}

    monkeypatch.setattr(antenna_service, "create_antenna", fake_create)
    response = client.post("/api/v1/antennas", json=values())

    assert response.status_code == 201
    assert captured["user_id"] == USER_ID
    assert captured["request"].id == "A1"


def test_antenna_api_requires_authentication():
    response = client.get("/api/v1/antennas")
    assert response.status_code == 401
