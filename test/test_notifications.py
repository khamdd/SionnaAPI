from contextlib import contextmanager
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.api.dependencies import require_current_user
from backend.main import app
from backend.services import notification_service


USER_ID = "11111111-1111-1111-1111-111111111111"
OTHER_USER_ID = "22222222-2222-2222-2222-222222222222"
STUDY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc"
NOTIFICATION_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd"


def passing_comparison():
    return {
        "status": "complete",
        "profiles": [
            {
                "status": "compared",
                "spatial": {"local_regression_present": False},
                "objectives": [
                    {
                        "metric": "covered_area_percent",
                        "candidate_status": "passed",
                    }
                ],
                "optimization": {"status": "not_requested"},
            }
        ],
    }


def study(status="completed", comparison=None):
    return SimpleNamespace(
        id=STUDY_ID,
        created_by=USER_ID,
        scene_id="scene-1",
        status=status,
        summary_json={
            "comparison": passing_comparison() if comparison is None else comparison
        },
    )


def notification(is_read=False):
    return SimpleNamespace(
        id=NOTIFICATION_ID,
        event_type="impact_study_completed",
        title="Impact Study completed",
        message="Done",
        payload_json={"impact_study_id": STUDY_ID},
        is_read=is_read,
        read_at=None,
        created_at=datetime(2026, 9, 9, tzinfo=timezone.utc),
    )


class CreationSession:
    def __init__(self, existing=None):
        self.existing = existing
        self.added = []
        self.flush_count = 0

    def scalar(self, statement):
        return self.existing

    def add(self, value):
        self.added.append(value)

    def flush(self):
        self.flush_count += 1


@pytest.mark.parametrize(
    ("status", "comparison", "expected_event"),
    [
        ("completed", passing_comparison(), "impact_study_completed"),
        (
            "completed",
            {"status": "complete", "profiles": []},
            "impact_study_needs_review",
        ),
        (
            "completed_with_failures",
            passing_comparison(),
            "impact_study_completed_with_failures",
        ),
        ("failed", {}, "impact_study_failed"),
    ],
)
def test_terminal_study_creates_one_notification(status, comparison, expected_event):
    session = CreationSession()

    created = notification_service.ensure_impact_study_notification(
        session,
        study(status, comparison),
    )

    assert created is session.added[0]
    assert created.event_type == expected_event
    assert created.user_id == USER_ID
    assert created.impact_study_id == STUDY_ID
    assert created.payload_json["study_status"] == status
    assert session.flush_count == 1


def test_cancelled_or_running_study_does_not_notify():
    for status in ("planned", "queued", "running", "aggregating", "cancelled"):
        session = CreationSession()
        assert (
            notification_service.ensure_impact_study_notification(
                session,
                study(status),
            )
            is None
        )
        assert session.added == []


def test_existing_study_notification_is_reused_without_duplicate():
    existing = notification()
    session = CreationSession(existing=existing)

    result = notification_service.ensure_impact_study_notification(
        session,
        study(),
    )

    assert result is existing
    assert session.added == []
    assert session.flush_count == 0


def test_mark_notification_read_is_idempotent(monkeypatch):
    item = notification()
    session = SimpleNamespace(
        scalar=lambda statement: item,
        flush=lambda: None,
    )

    @contextmanager
    def fake_db_session():
        yield session

    monkeypatch.setattr(notification_service, "is_database_configured", lambda: True)
    monkeypatch.setattr(notification_service, "db_session", fake_db_session)

    first = notification_service.mark_notification_read(NOTIFICATION_ID, USER_ID)
    second = notification_service.mark_notification_read(NOTIFICATION_ID, USER_ID)

    assert first["already_read"] is False
    assert first["notification"]["is_read"] is True
    assert second["already_read"] is True


def test_notification_for_another_user_is_not_exposed(monkeypatch):
    session = SimpleNamespace(scalar=lambda statement: None)

    @contextmanager
    def fake_db_session():
        yield session

    monkeypatch.setattr(notification_service, "is_database_configured", lambda: True)
    monkeypatch.setattr(notification_service, "db_session", fake_db_session)

    result = notification_service.mark_notification_read(
        NOTIFICATION_ID,
        OTHER_USER_ID,
    )

    assert result["status_code"] == 404


@pytest.fixture
def authenticated_user():
    app.dependency_overrides[require_current_user] = lambda: {
        "id": USER_ID,
        "username": "tester",
    }
    yield
    app.dependency_overrides.pop(require_current_user, None)


def test_notification_apis_use_authenticated_user(monkeypatch, authenticated_user):
    captured = []

    def fake_list(user_id, unread_only=False, limit=100):
        captured.append(("list", user_id, unread_only, limit))
        return {"status": "success", "items": []}

    def fake_count(user_id):
        captured.append(("count", user_id))
        return {"status": "success", "unread_count": 3}

    def fake_mark_one(notification_id, user_id):
        captured.append(("one", notification_id, user_id))
        return {
            "status": "success",
            "already_read": False,
            "notification": {"id": notification_id, "is_read": True},
        }

    def fake_mark_all(user_id):
        captured.append(("all", user_id))
        return {"status": "success", "marked_read_count": 2}

    monkeypatch.setattr(notification_service, "list_notifications", fake_list)
    monkeypatch.setattr(
        notification_service,
        "get_unread_notification_count",
        fake_count,
    )
    monkeypatch.setattr(
        notification_service,
        "mark_notification_read",
        fake_mark_one,
    )
    monkeypatch.setattr(
        notification_service,
        "mark_all_notifications_read",
        fake_mark_all,
    )

    client = TestClient(app)
    assert (
        client.get("/api/v1/notifications?unread_only=true&limit=25").status_code
        == 200
    )
    assert (
        client.get("/api/v1/notifications/unread-count").json()["unread_count"]
        == 3
    )
    assert (
        client.post(f"/api/v1/notifications/{NOTIFICATION_ID}/read").status_code
        == 200
    )
    assert client.post("/api/v1/notifications/read-all").json()["marked_read_count"] == 2
    assert captured == [
        ("list", USER_ID, True, 25),
        ("count", USER_ID),
        ("one", NOTIFICATION_ID, USER_ID),
        ("all", USER_ID),
    ]


def test_notification_api_requires_authentication():
    response = TestClient(app).get("/api/v1/notifications")

    assert response.status_code == 401
