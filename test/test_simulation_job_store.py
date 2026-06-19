from backend.services import simulation_job_store


def test_successful_job_stores_only_run_reference(monkeypatch):
    calls = []
    monkeypatch.setattr(
        simulation_job_store,
        "update_simulation_job_finished",
        lambda *args, **kwargs: calls.append((args, kwargs)),
    )

    simulation_job_store.mark_simulation_job_succeeded(
        "job-1",
        "00000000-0000-0000-0000-000000000001",
    )

    assert calls == [
        (
            ("job-1", "succeeded"),
            {
                "result_run_id": "00000000-0000-0000-0000-000000000001",
            },
        )
    ]
