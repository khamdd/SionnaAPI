from contextlib import contextmanager
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.api.dependencies import require_current_user
from backend.main import app
from backend.services import impact_study_service

client = TestClient(app)
USER_ID = "11111111-1111-1111-1111-111111111111"
BASELINE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
CANDIDATE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
STUDY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc"
PROFILE_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd"


@pytest.fixture
def authenticated_user():
    app.dependency_overrides[require_current_user] = lambda: {
        "id": USER_ID,
        "username": "tester",
    }
    yield
    app.dependency_overrides.pop(require_current_user, None)


def execution_plan():
    return {
        "policy_version": "impact-policy-v1",
        "scene_id": "scene-1",
        "baseline": {"id": BASELINE_ID, "content_hash": "hash-a"},
        "candidate": {"id": CANDIDATE_ID, "content_hash": "hash-b"},
        "planned_simulations": [
            {
                "profile_id": PROFILE_ID,
                "simulation_type": "sinr",
                "baseline_request": {"value": 1, "nested": {"b": 2, "a": 1}},
                "candidate_request": {"value": 2},
            }
        ],
    }


def job(job_id, status, error_message=None):
    return SimpleNamespace(
        id=job_id,
        status=status,
        error_message=error_message,
        finished_at=datetime.now(timezone.utc),
    )


def test_child_job_specs_create_one_baseline_and_candidate_per_profile():
    scene = {"id": "scene-1", "status": "ready"}

    first = impact_study_service.build_child_job_specs(execution_plan(), scene)
    second = impact_study_service.build_child_job_specs(execution_plan(), scene)

    assert [item["scenario_role"] for item in first] == ["baseline", "candidate"]
    assert all(item["simulation_profile_id"] == PROFILE_ID for item in first)
    assert [item["input_signature"] for item in first] == [
        item["input_signature"] for item in second
    ]
    assert first[0]["input_signature"] != first[1]["input_signature"]


def test_input_signature_ignores_dictionary_key_order():
    assert impact_study_service.calculate_input_signature(
        {"b": 2, "a": {"d": 4, "c": 3}}
    ) == impact_study_service.calculate_input_signature(
        {"a": {"c": 3, "d": 4}, "b": 2}
    )


def test_partial_failure_summary_keeps_successful_child():
    jobs = [
        job("job-success", "succeeded"),
        job("job-failure", "failed", "solver failed"),
    ]
    study = SimpleNamespace(status="running", summary_json=None, finished_at=None)

    impact_study_service._reconcile_study(study, jobs)

    assert study.status == "completed_with_failures"
    assert study.summary_json["successful_job_ids"] == ["job-success"]
    assert study.summary_json["failed_jobs"] == [
        {"job_id": "job-failure", "error": "solver failed"}
    ]


def test_reconciliation_notifies_only_after_all_children_finish(monkeypatch):
    notifications = []
    monkeypatch.setattr(
        impact_study_service.notification_service,
        "ensure_impact_study_notification",
        lambda session, current_study: notifications.append(current_study.status),
    )
    monkeypatch.setattr(
        impact_study_service,
        "_queue_required_optimization_jobs",
        lambda session, current_study, jobs: [],
    )
    study = SimpleNamespace(
        id=STUDY_ID,
        created_by=USER_ID,
        scene_id="scene-1",
        status="running",
        summary_json=None,
        finished_at=None,
    )

    impact_study_service._reconcile_study(
        study,
        [job("job-success", "succeeded"), job("job-running", "running")],
        session=object(),
    )
    assert study.status == "running"
    assert notifications == []

    impact_study_service._reconcile_study(
        study,
        [job("job-success", "succeeded"), job("job-finished", "succeeded")],
        session=object(),
    )
    assert study.status == "completed"
    assert notifications == ["completed"]


def test_start_does_not_duplicate_jobs_for_started_study(monkeypatch):
    study = SimpleNamespace(
        id=STUDY_ID,
        created_by=USER_ID,
        status="queued",
    )
    existing_jobs = [SimpleNamespace(status="queued")]
    session = SimpleNamespace(scalar=lambda statement: study)

    @contextmanager
    def fake_db_session():
        yield session

    monkeypatch.setattr(impact_study_service, "is_database_configured", lambda: True)
    monkeypatch.setattr(impact_study_service, "db_session", fake_db_session)
    monkeypatch.setattr(
        impact_study_service,
        "_load_study_jobs",
        lambda current_session, current_id: existing_jobs,
    )
    monkeypatch.setattr(
        impact_study_service,
        "serialize_impact_study",
        lambda current_study, jobs: {"id": current_study.id, "job_count": len(jobs)},
    )
    monkeypatch.setattr(
        impact_study_service,
        "add_simulation_job",
        lambda *args, **kwargs: pytest.fail("no duplicate job should be added"),
    )

    result = impact_study_service.start_impact_study(STUDY_ID, USER_ID)

    assert result["already_started"] is True
    assert result["study"]["job_count"] == 1


def test_create_api_passes_authenticated_user(monkeypatch, authenticated_user):
    captured = {}

    def fake_create(request, created_by):
        captured["request"] = request
        captured["created_by"] = created_by
        return {"status": "success", "study": {"id": STUDY_ID}}

    monkeypatch.setattr(impact_study_service, "create_impact_study", fake_create)

    response = client.post(
        "/api/v1/impact-studies",
        json={
            "baseline_configuration_id": BASELINE_ID,
            "candidate_configuration_id": CANDIDATE_ID,
        },
    )

    assert response.status_code == 201
    assert response.json()["study"]["id"] == STUDY_ID
    assert captured["created_by"] == USER_ID
    assert str(captured["request"].baseline_configuration_id) == BASELINE_ID


def test_start_api_passes_authenticated_user(monkeypatch, authenticated_user):
    captured = {}

    def fake_start(study_id, user_id):
        captured.update(study_id=study_id, user_id=user_id)
        return {
            "status": "success",
            "already_started": False,
            "study": {"id": study_id, "status": "queued"},
        }

    monkeypatch.setattr(impact_study_service, "start_impact_study", fake_start)

    response = client.post(f"/api/v1/impact-studies/{STUDY_ID}/start")

    assert response.status_code == 200
    assert response.json()["study"]["status"] == "queued"
    assert captured == {"study_id": STUDY_ID, "user_id": USER_ID}


def test_comparison_api_passes_authenticated_user(monkeypatch, authenticated_user):
    captured = {}

    def fake_comparison(study_id, user_id):
        captured.update(study_id=study_id, user_id=user_id)
        return {
            "status": "success",
            "study_id": study_id,
            "study_status": "completed",
            "comparison": {"status": "complete", "profiles": []},
        }

    monkeypatch.setattr(
        impact_study_service,
        "get_impact_study_comparison",
        fake_comparison,
    )

    response = client.get(f"/api/v1/impact-studies/{STUDY_ID}/comparison")

    assert response.status_code == 200
    assert response.json()["comparison"]["status"] == "complete"
    assert captured == {"study_id": STUDY_ID, "user_id": USER_ID}


def test_suggested_configuration_api_passes_exact_ids(
    monkeypatch,
    authenticated_user,
):
    captured = {}

    def fake_create(study_id, simulation_profile_id, user_id):
        captured.update(
            study_id=study_id,
            simulation_profile_id=simulation_profile_id,
            user_id=user_id,
        )
        return {
            "status": "success",
            "already_created": False,
            "configuration": {"id": CANDIDATE_ID, "status": "draft"},
        }

    monkeypatch.setattr(
        impact_study_service,
        "create_suggested_configuration",
        fake_create,
    )

    response = client.post(
        f"/api/v1/impact-studies/{STUDY_ID}/profiles/{PROFILE_ID}/"
        "suggested-configuration"
    )

    assert response.status_code == 201
    assert response.json()["configuration"]["status"] == "draft"
    assert captured == {
        "study_id": STUDY_ID,
        "simulation_profile_id": PROFILE_ID,
        "user_id": USER_ID,
    }


def test_impact_study_api_requires_authentication():
    response = client.get("/api/v1/impact-studies")

    assert response.status_code == 401
