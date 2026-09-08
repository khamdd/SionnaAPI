from types import SimpleNamespace

import pytest

from backend.services import simulation_worker


def test_exception_classification_controls_retries():
    assert simulation_worker.classify_exception(OSError("disk unavailable")) == (
        "transient",
        True,
    )
    assert simulation_worker.classify_exception(ValueError("bad request")) == (
        "validation",
        False,
    )
    assert simulation_worker.classify_exception(RuntimeError("solver failed")) == (
        "simulation",
        False,
    )
    assert simulation_worker.classify_exception(
        simulation_worker.JobExecutionTimeout("too slow")
    ) == ("timeout", True)


def test_cancellation_checkpoint_stops_remaining_work(monkeypatch):
    monkeypatch.setattr(
        simulation_worker,
        "is_simulation_job_cancel_requested",
        lambda job_id, worker_id: True,
    )

    with pytest.raises(simulation_worker.JobCancellationRequested):
        simulation_worker._ensure_job_active(
            "job-1",
            "worker-1",
            SimpleNamespace(lease_lost=False),
        )


def test_lost_lease_stops_stale_worker_without_database_check(monkeypatch):
    monkeypatch.setattr(
        simulation_worker,
        "is_simulation_job_cancel_requested",
        lambda *args: pytest.fail("database should not be checked"),
    )

    with pytest.raises(simulation_worker.JobLeaseLost):
        simulation_worker._ensure_job_active(
            "job-1",
            "worker-1",
            SimpleNamespace(lease_lost=True),
        )
