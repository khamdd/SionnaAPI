from datetime import datetime, timezone

from backend.services import simulation_job_store


def test_successful_job_stores_result_without_run_reference(monkeypatch):
    calls = []
    monkeypatch.setattr(
        simulation_job_store,
        "update_simulation_job_finished",
        lambda *args, **kwargs: calls.append((args, kwargs)),
    )

    simulation_job_store.mark_simulation_job_succeeded(
        "job-1",
        {
            "status": "success",
            "sinr_db": 12.5,
        },
    )

    assert calls == [
        (
            ("job-1", "succeeded"),
            {
                "result": {
                    "status": "success",
                    "sinr_db": 12.5,
                },
            },
        )
    ]


def test_serialize_job_includes_impact_study_linkage():
    timestamp = datetime(2026, 9, 8, 10, tzinfo=timezone.utc)
    serialized = simulation_job_store.serialize_job(
        {
            "id": "job-1",
            "simulation_type": "sinr",
            "status": "queued",
            "scene_json": {},
            "request_json": {},
            "result_json": None,
            "result_run_id": None,
            "error_message": None,
            "attempts": 0,
            "impact_study_id": "study-1",
            "simulation_profile_id": "profile-1",
            "scenario_role": "baseline",
            "input_signature": "signature-1",
            "queued_at": timestamp,
            "started_at": None,
            "finished_at": None,
            "updated_at": timestamp,
        }
    )

    assert serialized["impact_study_id"] == "study-1"
    assert serialized["simulation_profile_id"] == "profile-1"
    assert serialized["scenario_role"] == "baseline"
    assert serialized["input_signature"] == "signature-1"
