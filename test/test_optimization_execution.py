from contextlib import nullcontext
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.api import sinr as api
from backend.services import simulation_job_store as store
from backend.services import simulation_worker as worker
from test.test_optimization_service import coverage_result, optimization_request


def scene_info():
    return {"id": "scene-1", "bounds": {"west": 105.7, "east": 105.9, "south": 20.9, "north": 21.1}}


def test_endpoint_queues_snapshot_and_rejects_different_scene(monkeypatch):
    monkeypatch.setattr(api, "engine", SimpleNamespace(lock=nullcontext()))
    monkeypatch.setattr(api, "get_engine_scene_info", scene_info)
    monkeypatch.setattr(api, "is_database_configured", lambda: True)
    calls = []
    monkeypatch.setattr(api, "create_simulation_job", lambda *args, **kwargs: calls.append(args) or "job-1")
    req = optimization_request(scene_id="scene-1")
    response = api.optimize_network_coverage(req, SimpleNamespace(base_url="http://localhost/"))
    assert response["job_id"] == "job-1"
    assert calls[0][0] == "network_coverage_optimization"
    assert calls[0][1].base_request.antennas[0].longitude == 105.8
    with pytest.raises(HTTPException) as exc:
        api.optimize_network_coverage(optimization_request(scene_id="other"), SimpleNamespace())
    assert exc.value.status_code == 409


def test_worker_converts_each_candidate_and_reports_progress(monkeypatch):
    monkeypatch.setattr(worker, "get_worker_scene", lambda _: object())
    calls, progress, results, failures = [], [], [], []
    def simulate(req, base_url, scene):
        calls.append(req)
        assert len(req.antennas[0].position) == 3
        return coverage_result(5 if len(calls) == 1 else 10)
    monkeypatch.setattr(worker, "calculate_network_coverage_service", simulate)
    monkeypatch.setattr(worker, "update_optimization_progress", lambda job_id, value: progress.append(value))
    monkeypatch.setattr(worker, "mark_simulation_job_succeeded", lambda job_id, result: results.append(result))
    monkeypatch.setattr(worker, "mark_simulation_job_failed", lambda *args, **kwargs: failures.append(args))
    worker.run_simulation_job({"id": "job-1", "simulation_type": "network_coverage_optimization",
                               "scene_json": scene_info(), "request_json": optimization_request().model_dump()})
    assert not failures
    assert len(calls) == 2
    assert progress[-1]["completed"] == 2
    assert results[0]["optimization"]["best_request"]["antennas"][0]["tilt"]["current"] == 0


def test_save_uses_winning_request_as_network_coverage(monkeypatch):
    req = optimization_request()
    winner = req.base_request.model_dump()
    winner["antennas"][0]["tilt"]["current"] = 7
    result = {**coverage_result(10), "optimization": {"best_request": winner}}
    job = {"id": "job-1", "simulation_type": "network_coverage_optimization", "status": "succeeded",
           "request": req.model_dump(), "scene": scene_info()}
    monkeypatch.setattr(store, "get_simulation_job", lambda _: {"database_configured": True, "item": job})
    monkeypatch.setattr(store, "get_simulation_job_result", lambda _: {"result": result})
    calls = []
    monkeypatch.setattr(store, "store_simulation_result", lambda *args, **kwargs: calls.append(args) or "run-1")
    row = SimpleNamespace(result_run_id=None)
    monkeypatch.setattr(store, "db_session", lambda: nullcontext(SimpleNamespace(get=lambda *args: row)))
    assert store.save_simulation_job_result("job-1")["saved"]
    assert calls[0][0] == "network_coverage"
    assert calls[0][1].antennas[0].tilt.current == 7
    assert row.result_run_id == "run-1"
