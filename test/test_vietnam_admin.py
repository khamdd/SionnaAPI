from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql

from backend.api.dependencies import require_current_user
from backend.main import app
from backend.services import vietnam_admin_service

USER_ID = "11111111-1111-1111-1111-111111111111"


class FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None


class FakeSession:
    def __init__(self, rows=None):
        self.rows = rows or []
        self.statements = []

    def execute(self, statement, params=None):
        self.statements.append((statement, params))
        return FakeResult(self.rows)

    def scalars(self, statement):
        self.statements.append((statement, None))
        return FakeResult(self.rows)


def fake_db(rows):
    session = FakeSession(rows)

    @contextmanager
    def factory():
        yield session

    return session, factory


def province():
    return SimpleNamespace(
        code="01",
        name="Hà Nội",
        name_en="Hanoi",
        full_name="Thành phố Hà Nội",
        unit_type="Thành phố Trung ương",
        center_lat=21.0,
        center_lng=105.7,
        bbox_south=20.5,
        bbox_north=21.5,
        bbox_west=105.2,
        bbox_east=106.0,
        ward_count=126,
    )


def ward(province_row=None):
    return SimpleNamespace(
        ward_code="09877",
        province_code="01",
        ward_name="An Khánh",
        ward_name_en="An Khanh",
        ward_full_name="Xã An Khánh",
        ward_type="Xã",
        search_name="an khanh",
        center_lat=20.987,
        center_lng=105.707,
        bbox_south=20.95,
        bbox_north=21.01,
        bbox_west=105.66,
        bbox_east=105.74,
    )


def test_strip_diacritics_normalizes_case_insensitive_keys():
    assert (
        vietnam_admin_service.strip_diacritics("Phường Cầu Giấy").lower()
        == "phuong cau giay"
    )


def test_list_provinces_serializes_items(monkeypatch):
    _, factory = fake_db([province()])
    monkeypatch.setattr(vietnam_admin_service, "is_database_configured", lambda: True)
    monkeypatch.setattr(vietnam_admin_service, "db_session", factory)

    result = vietnam_admin_service.list_provinces()

    assert result["status"] == "success"
    assert result["items"][0]["code"] == "01"
    assert result["items"][0]["center"]["lat"] == 21.0
    assert result["items"][0]["bbox"]["south"] == 20.5


def test_search_wards_requires_query(monkeypatch):
    monkeypatch.setattr(vietnam_admin_service, "is_database_configured", lambda: True)

    result = vietnam_admin_service.search_wards("   ")

    assert result["status_code"] == 400


def test_search_wards_normalizes_diacritics_and_filters_province(monkeypatch):
    session, factory = fake_db([(ward(), province())])
    monkeypatch.setattr(vietnam_admin_service, "is_database_configured", lambda: True)
    monkeypatch.setattr(vietnam_admin_service, "db_session", factory)

    result = vietnam_admin_service.search_wards(
        "An Khánh",
        province_code="01",
        limit=10,
    )

    assert result["status"] == "success"
    assert result["items"][0]["ward_code"] == "09877"
    assert result["items"][0]["province_name"] == "Hà Nội"

    statement, params = session.statements[0]
    compiled = str(
        statement.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )
    assert "an khanh%" in compiled
    assert "vietnam_wards.province_code = '01'" in compiled


def test_search_wards_prefix_matches_rank_before_substring(monkeypatch):
    session, factory = fake_db([(ward(), province())])
    monkeypatch.setattr(vietnam_admin_service, "is_database_configured", lambda: True)
    monkeypatch.setattr(vietnam_admin_service, "db_session", factory)

    result = vietnam_admin_service.search_wards("khanh", limit=10)

    assert result["status"] == "success"
    assert result["items"][0]["ward_code"] == "09877"

    statement, _ = session.statements[0]
    compiled = str(
        statement.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )
    assert "LIKE 'khanh%%'" in compiled
    assert "LIKE '%%khanh%%'" in compiled
    assert "CASE WHEN" in compiled.upper()


def test_search_wards_database_unavailable(monkeypatch):
    monkeypatch.setattr(
        vietnam_admin_service, "is_database_configured", lambda: False
    )

    result = vietnam_admin_service.search_wards("Cầu Giấy")

    assert result["status_code"] == 503


def test_get_ward_boundary_returns_geojson_feature(monkeypatch):
    row = SimpleNamespace(
        ward_code="09877",
        ward_name="An Khánh",
        ward_name_en="An Khanh",
        ward_type="Xã",
        center_lat=20.987,
        center_lng=105.707,
        bbox_south=20.95,
        bbox_north=21.01,
        bbox_west=105.66,
        bbox_east=105.74,
        boundary_geojson='{"type": "MultiPolygon", "coordinates": []}',
        province_code="01",
        province_name="Hà Nội",
        province_name_en="Hanoi",
    )
    _, factory = fake_db([row])
    monkeypatch.setattr(vietnam_admin_service, "is_database_configured", lambda: True)
    monkeypatch.setattr(vietnam_admin_service, "db_session", factory)

    result = vietnam_admin_service.get_ward_boundary("09877")

    assert result["status"] == "success"
    assert result["feature"]["id"] == "09877"
    assert result["feature"]["geometry"]["type"] == "MultiPolygon"
    assert result["feature"]["properties"]["province_name"] == "Hà Nội"


def test_get_ward_boundary_not_found(monkeypatch):
    _, factory = fake_db([])
    monkeypatch.setattr(vietnam_admin_service, "is_database_configured", lambda: True)
    monkeypatch.setattr(vietnam_admin_service, "db_session", factory)

    result = vietnam_admin_service.get_ward_boundary("missing")

    assert result["status_code"] == 404


def test_get_ward_boundary_without_geometry(monkeypatch):
    row = SimpleNamespace(
        ward_code="09877",
        ward_name="An Khánh",
        ward_name_en="An Khanh",
        ward_type="Xã",
        center_lat=20.987,
        center_lng=105.707,
        bbox_south=20.95,
        bbox_north=21.01,
        bbox_west=105.66,
        bbox_east=105.74,
        boundary_geojson=None,
        province_code="01",
        province_name="Hà Nội",
        province_name_en="Hanoi",
    )
    _, factory = fake_db([row])
    monkeypatch.setattr(vietnam_admin_service, "is_database_configured", lambda: True)
    monkeypatch.setattr(vietnam_admin_service, "db_session", factory)

    result = vietnam_admin_service.get_ward_boundary("09877")

    assert result["status_code"] == 404
    assert "boundary" in result["error"]


@pytest.fixture
def authenticated_user():
    app.dependency_overrides[require_current_user] = lambda: {
        "id": USER_ID,
        "username": "tester",
    }
    yield
    app.dependency_overrides.pop(require_current_user, None)


def test_vietnam_admin_apis(monkeypatch, authenticated_user):
    captured = []

    def fake_list_provinces():
        captured.append("provinces")
        return {"status": "success", "items": [{"code": "01"}]}

    def fake_search_wards(query, province_code=None, limit=50):
        captured.append(("wards", query, province_code, limit))
        return {"status": "success", "items": [{"ward_code": "09877"}]}

    def fake_boundary(ward_code):
        captured.append(("boundary", ward_code))
        return {"status": "success", "feature": {"type": "Feature"}}

    monkeypatch.setattr(
        vietnam_admin_service, "list_provinces", fake_list_provinces
    )
    monkeypatch.setattr(vietnam_admin_service, "search_wards", fake_search_wards)
    monkeypatch.setattr(
        vietnam_admin_service, "get_ward_boundary", fake_boundary
    )

    client = TestClient(app)
    assert client.get("/api/v1/vietnam/provinces").status_code == 200
    wards_response = client.get(
        "/api/v1/vietnam/wards?q=an%20khanh&province_code=01&limit=25"
    )
    assert wards_response.status_code == 200
    boundary_response = client.get("/api/v1/vietnam/wards/09877/boundary")
    assert boundary_response.status_code == 200
    assert boundary_response.headers["content-type"].startswith(
        "application/geo+json"
    )
    assert "max-age=86400" in boundary_response.headers["cache-control"]

    assert captured == [
        "provinces",
        ("wards", "an khanh", "01", 25),
        ("boundary", "09877"),
    ]


def test_vietnam_admin_api_requires_authentication():
    client = TestClient(app)
    assert client.get("/api/v1/vietnam/provinces").status_code == 401
    assert client.get("/api/v1/vietnam/wards?q=abc").status_code == 401
    assert client.get("/api/v1/vietnam/wards/09877/boundary").status_code == 401
