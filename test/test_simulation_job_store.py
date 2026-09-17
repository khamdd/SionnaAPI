import os
from contextlib import nullcontext
from datetime import datetime, timezone
from types import SimpleNamespace

from backend.services import simulation_job_store, simulation_store


def patch_static_dir(monkeypatch, tmp_path):
    monkeypatch.setattr(simulation_job_store, "STATIC_DIR", tmp_path)
    monkeypatch.setattr(simulation_store, "STATIC_DIR", tmp_path)


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


def running_job(**overrides):
    values = {
        "id": "job-1",
        "status": "running",
        "worker_id": "worker-1",
        "attempts": 1,
        "max_attempts": 3,
        "cancel_requested": False,
        "result_json": None,
        "error_message": None,
        "failure_type": None,
        "updated_at": None,
        "heartbeat_at": None,
        "lease_expires_at": None,
        "next_attempt_at": None,
        "started_at": datetime.now(timezone.utc),
        "finished_at": None,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_retry_delay_is_bounded_exponential():
    assert simulation_job_store.calculate_retry_delay_seconds(1, 5, 20) == 5
    assert simulation_job_store.calculate_retry_delay_seconds(2, 5, 20) == 10
    assert simulation_job_store.calculate_retry_delay_seconds(3, 5, 20) == 20
    assert simulation_job_store.calculate_retry_delay_seconds(8, 5, 20) == 20


def test_transient_failure_requeues_before_attempt_limit(monkeypatch):
    row = running_job()
    session = SimpleNamespace(scalar=lambda statement: row)
    monkeypatch.setattr(
        simulation_job_store,
        "db_session",
        lambda: nullcontext(session),
    )
    monkeypatch.setattr(
        simulation_job_store,
        "get_simulation_job_settings",
        lambda: SimpleNamespace(retry_base_seconds=5, retry_max_seconds=60),
    )

    result = simulation_job_store.handle_simulation_job_failure(
        row.id,
        "temporary storage failure",
        "transient",
        True,
        worker_id="worker-1",
    )

    assert result["status"] == "queued"
    assert row.status == "queued"
    assert row.next_attempt_at is not None
    assert row.worker_id is None
    assert row.finished_at is None


def test_validation_failure_does_not_retry(monkeypatch):
    row = running_job()
    session = SimpleNamespace(scalar=lambda statement: row)
    monkeypatch.setattr(
        simulation_job_store,
        "db_session",
        lambda: nullcontext(session),
    )
    monkeypatch.setattr(
        simulation_job_store,
        "get_simulation_job_settings",
        lambda: SimpleNamespace(retry_base_seconds=5, retry_max_seconds=60),
    )

    result = simulation_job_store.handle_simulation_job_failure(
        row.id,
        "invalid request",
        "validation",
        False,
        worker_id="worker-1",
    )

    assert result["status"] == "failed"
    assert row.attempts == 1
    assert row.failure_type == "validation"
    assert row.finished_at is not None


def test_stale_worker_cannot_finish_reclaimed_job(monkeypatch):
    row = running_job(worker_id="new-worker")
    session = SimpleNamespace(scalar=lambda statement: row)
    monkeypatch.setattr(
        simulation_job_store,
        "db_session",
        lambda: nullcontext(session),
    )

    updated = simulation_job_store.update_simulation_job_finished(
        row.id,
        "succeeded",
        result={"status": "success"},
        worker_id="old-worker",
    )

    assert updated is False
    assert row.status == "running"


def test_expired_lease_requeues_job(monkeypatch):
    row = running_job(
        lease_expires_at=datetime(2026, 9, 8, 9, tzinfo=timezone.utc),
    )
    rows = SimpleNamespace(all=lambda: [row])
    session = SimpleNamespace(scalars=lambda statement: rows)
    monkeypatch.setattr(simulation_job_store, "is_database_configured", lambda: True)
    monkeypatch.setattr(
        simulation_job_store,
        "db_session",
        lambda: nullcontext(session),
    )
    recovered = simulation_job_store.recover_expired_simulation_jobs(
        datetime(2026, 9, 8, 10, tzinfo=timezone.utc)
    )

    assert recovered == 1
    assert row.status == "queued"
    assert row.failure_type == "worker_lost"
    assert row.worker_id is None


def test_cancellation_race_removes_result_written_before_job_update(tmp_path, monkeypatch):
    artifact = tmp_path / "simulation-job-results" / "job-1.json"
    artifact.parent.mkdir()
    artifact.write_text("{}", encoding="utf-8")
    row = running_job(cancel_requested=True, result_json=None)
    session = SimpleNamespace(scalar=lambda statement: row)
    patch_static_dir(monkeypatch, tmp_path)
    monkeypatch.setattr(
        simulation_job_store,
        "db_session",
        lambda: nullcontext(session),
    )

    updated = simulation_job_store.update_simulation_job_finished(
        row.id,
        "succeeded",
        result={
            "status": "success",
            "full_result_url": "/static/simulation-job-results/job-1.json",
        },
        worker_id="worker-1",
    )

    assert updated is True
    assert row.status == "cancelled"
    assert row.result_json is None
    assert not artifact.exists()


def test_orphan_reconciliation_removes_unreferenced_old_files(tmp_path, monkeypatch):
    artifact_dir = tmp_path / "simulation-job-results"
    artifact_dir.mkdir()
    orphan = artifact_dir / "orphan.json"
    referenced = artifact_dir / "known.json"
    recent = artifact_dir / "recent.json"
    for artifact in (orphan, referenced, recent):
        artifact.write_text("{}", encoding="utf-8")
    old_timestamp = datetime(2026, 9, 1, tzinfo=timezone.utc).timestamp()
    os.utime(orphan, (old_timestamp, old_timestamp))
    os.utime(referenced, (old_timestamp, old_timestamp))

    session = SimpleNamespace(scalars=lambda statement: ["known"])
    patch_static_dir(monkeypatch, tmp_path)
    monkeypatch.setattr(simulation_job_store, "is_database_configured", lambda: True)
    monkeypatch.setattr(
        simulation_job_store,
        "db_session",
        lambda: nullcontext(session),
    )

    deleted = simulation_job_store.cleanup_orphaned_job_result_artifacts(
        now=datetime(2026, 9, 2, tzinfo=timezone.utc),
    )

    assert deleted == 1
    assert not orphan.exists()
    assert referenced.exists()
    assert recent.exists()
