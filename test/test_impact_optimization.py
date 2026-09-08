from contextlib import contextmanager
from types import SimpleNamespace

from backend.schemas.impact_studies import ImpactStudyCreateRequest
from backend.services import impact_study_service


STUDY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc"
PROFILE_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd"
CANDIDATE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
USER_ID = "11111111-1111-1111-1111-111111111111"


def candidate_request():
    return {
        "antennas": [
            {
                "id": "A1",
                "longitude": 105.8,
                "latitude": 21.0,
                "height_m": 30,
                "tilt": {"min": 0, "current": 5, "max": 10},
                "azimuth": 45,
                "tx_power": {"min": 20, "current": 30, "max": 40},
            }
        ]
    }


def execution_plan(mode="if_objectives_fail"):
    return {
        "policy_version": "impact-policy-v1",
        "scene_id": "scene-1",
        "candidate": {"id": CANDIDATE_ID, "content_hash": "candidate-hash"},
        "optimization_policy": {
            "mode": mode,
            "tilt_step": 2,
            "power_step": 2,
            "azimuth_step": 30,
            "max_candidates": 25,
            "variables": [
                {"field": "tilt", "scope": "enabled_antennas"},
                {"field": "tx_power", "scope": "enabled_antennas"},
            ],
        },
        "planned_simulations": [
            {
                "profile_id": PROFILE_ID,
                "simulation_type": "network_coverage",
                "candidate_request": candidate_request(),
                "objectives": [
                    {
                        "metric": "covered_area_percent",
                        "operator": ">=",
                        "target": 95,
                    }
                ],
            }
        ],
    }


def child_job(role, status="succeeded"):
    return SimpleNamespace(
        id=f"{role}-job",
        simulation_profile_id=PROFILE_ID,
        scenario_role=role,
        simulation_type="network_coverage",
        status=status,
        scene_json={"id": "scene-1"},
        base_url="http://backend/",
        error_message=None,
        finished_at=None,
    )


class QueueSession:
    def __init__(self):
        self.jobs = {}

    def flush(self):
        return None

    def get(self, model, job_id):
        return self.jobs[job_id]


def failed_candidate_comparison(*args, **kwargs):
    return {
        "profiles": [
            {
                "profile_id": PROFILE_ID,
                "status": "compared",
                "kpis": [
                    {
                        "objective": {
                            "status": "failed",
                            "candidate_status": "failed",
                        }
                    }
                ],
            }
        ]
    }


def test_optimization_policy_defaults_to_disabled_and_validates_duplicates():
    request = ImpactStudyCreateRequest(
        baseline_configuration_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        candidate_configuration_id=CANDIDATE_ID,
    )

    assert request.optimization_policy.mode == "disabled"


def test_failed_candidate_queues_existing_resumable_optimization(monkeypatch):
    study = SimpleNamespace(
        id=STUDY_ID,
        scene_id="scene-1",
        candidate_configuration_id=CANDIDATE_ID,
        policy_version="impact-policy-v1",
        execution_plan_json=execution_plan(),
        created_by=USER_ID,
    )
    jobs = [child_job("baseline"), child_job("candidate")]
    session = QueueSession()
    captured = {}

    monkeypatch.setattr(
        impact_study_service,
        "build_impact_comparison",
        failed_candidate_comparison,
    )

    def fake_add(current_session, simulation_type, request, scene, **kwargs):
        captured.update(
            simulation_type=simulation_type,
            request=request,
            scene=scene,
            kwargs=kwargs,
        )
        job_id = "optimization-job"
        current_session.jobs[job_id] = SimpleNamespace(id=job_id, status="queued")
        return job_id

    monkeypatch.setattr(impact_study_service, "add_simulation_job", fake_add)

    queued = impact_study_service._queue_required_optimization_jobs(
        session,
        study,
        jobs,
    )

    assert [job.id for job in queued] == ["optimization-job"]
    assert captured["simulation_type"] == "network_coverage_optimization"
    assert captured["request"].base_request.antennas[0].tilt.current == 5
    assert captured["request"].max_candidates == 25
    assert captured["kwargs"]["scenario_role"] == "optimization"
    assert captured["kwargs"]["simulation_profile_id"] == PROFILE_ID
    assert captured["kwargs"]["input_signature"]


def test_disabled_policy_never_queues_optimization(monkeypatch):
    study = SimpleNamespace(
        execution_plan_json=execution_plan(mode="disabled"),
    )
    monkeypatch.setattr(
        impact_study_service,
        "add_simulation_job",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            AssertionError("optimization must stay disabled")
        ),
    )

    assert impact_study_service._queue_required_optimization_jobs(
        QueueSession(),
        study,
        [child_job("baseline"), child_job("candidate")],
    ) == []


def test_reconcile_waits_for_new_optimization_job(monkeypatch):
    study = SimpleNamespace(
        status="running",
        summary_json=None,
        finished_at=None,
    )
    optimization_job = child_job("optimization", status="queued")
    monkeypatch.setattr(
        impact_study_service,
        "_queue_required_optimization_jobs",
        lambda session, current_study, jobs: [optimization_job],
    )
    monkeypatch.setattr(
        impact_study_service,
        "build_study_summary",
        lambda current_study, jobs: {"total_jobs": len(jobs)},
    )

    jobs = [child_job("baseline"), child_job("candidate")]
    impact_study_service._reconcile_study(study, jobs, session=object())

    assert study.status == "queued"
    assert study.finished_at is None
    assert study.summary_json["total_jobs"] == 3


def test_apply_suggestion_changes_only_optimization_fields():
    original = candidate_request()["antennas"]
    suggested = candidate_request()["antennas"]
    suggested[0]["longitude"] = 1.0
    suggested[0]["height_m"] = 999
    suggested[0]["tilt"]["current"] = 2
    suggested[0]["tx_power"]["current"] = 35
    suggested[0]["azimuth"] = 90

    result = impact_study_service._apply_suggested_antenna_settings(
        original,
        suggested,
    )

    assert result[0]["longitude"] == 105.8
    assert result[0]["height_m"] == 30
    assert result[0]["tilt"]["current"] == 2
    assert result[0]["tx_power"]["current"] == 35
    assert result[0]["azimuth"] == 90


def test_suggested_configuration_is_draft_child_of_exact_candidate(monkeypatch):
    study = SimpleNamespace(
        id=STUDY_ID,
        scene_id="scene-1",
        candidate_configuration_id=CANDIDATE_ID,
        execution_plan_json=execution_plan(),
        created_by=USER_ID,
    )
    optimization_job = SimpleNamespace(
        id="eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        simulation_profile_id=PROFILE_ID,
        scenario_role="optimization",
        status="succeeded",
    )
    candidate = SimpleNamespace(
        id=CANDIDATE_ID,
        scene_id="scene-1",
        antennas_json=candidate_request()["antennas"],
        content_hash="candidate-hash",
    )
    created = SimpleNamespace(id="new-draft", status="draft")
    captured = {}

    class Result:
        def scalar_one(self):
            return SimpleNamespace(id="scene-1")

    class Session:
        def __init__(self):
            self.scalar_calls = 0

        def scalar(self, statement):
            self.scalar_calls += 1
            return study if self.scalar_calls == 1 else None

        def get(self, model, row_id):
            return candidate

        def execute(self, statement):
            return Result()

        def refresh(self, row):
            return None

    @contextmanager
    def fake_db_session():
        yield Session()

    optimized = candidate_request()
    optimized["antennas"][0]["tilt"]["current"] = 2
    monkeypatch.setattr(impact_study_service, "is_database_configured", lambda: True)
    monkeypatch.setattr(impact_study_service, "db_session", fake_db_session)
    monkeypatch.setattr(
        impact_study_service,
        "_load_study_jobs",
        lambda session, study_id: [optimization_job],
    )
    monkeypatch.setattr(impact_study_service, "_reconcile_study", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        impact_study_service,
        "load_simulation_job_result",
        lambda job: {
            "result": {"optimization": {"best_request": optimized}},
            "error": None,
        },
    )

    def fake_add(session, **kwargs):
        captured.update(kwargs)
        return created

    monkeypatch.setattr(
        impact_study_service,
        "add_network_configuration_draft",
        fake_add,
    )
    monkeypatch.setattr(
        impact_study_service,
        "serialize_configuration",
        lambda configuration: {
            "id": configuration.id,
            "status": configuration.status,
            "parent_configuration_id": captured["parent_configuration_id"],
        },
    )

    result = impact_study_service.create_suggested_configuration(
        STUDY_ID,
        PROFILE_ID,
        USER_ID,
    )

    assert result["status"] == "success"
    assert result["configuration"]["status"] == "draft"
    assert captured["parent_configuration_id"] == CANDIDATE_ID
    assert captured["antennas"][0]["tilt"]["current"] == 2
    assert result["based_on_candidate_configuration_id"] == CANDIDATE_ID
