import json
from contextlib import contextmanager
from types import SimpleNamespace

from backend.services import simulation_store


def test_insert_simulation_run_stores_summarized_response_json():
    session = CapturingSession()
    req = SimpleNamespace(
        solver=SimpleNamespace(
            max_depth=2,
            samples_per_tx=20000,
            cell_size=5.0,
            center=(0.0, 0.0, 0.0),
            size=(100.0, 80.0),
        ),
        transmitter_pattern="tr38901",
    )
    result = {
        "status": "success",
        "grid": {
            "rows": 2,
            "cols": 2,
            "cells": [
                {
                    "row": 0,
                    "col": 0,
                    "sinr_db": 10.0,
                },
            ],
            "overlap_summary": {
                "overlap_percent": 50.0,
            },
        },
    }

    simulation_store.insert_simulation_run(
        session,
        "network_coverage",
        req,
        result,
        simulation_store.utc_now(),
        simulation_store.utc_now(),
        scene_info={"id": "hcm"},
    )

    stored_response = json.loads(session.last_params["response_json"])

    assert "cells" not in stored_response["grid"]
    assert stored_response["grid"] == {
        "rows": 2,
        "cols": 2,
        "cell_count": 1,
        "overlap_summary": {
            "overlap_percent": 50.0,
        },
    }


def test_full_result_file_url_is_attached_for_heavy_result(tmp_path, monkeypatch):
    session = CapturingSession()
    monkeypatch.setattr(simulation_store, "STATIC_DIR", tmp_path)
    result = {
        "status": "success",
        "grid": {
            "rows": 1,
            "cols": 1,
            "cells": [
                {
                    "row": 0,
                    "col": 0,
                },
            ],
        },
    }

    public_url = simulation_store.attach_full_result_file_if_heavy(
        session,
        "00000000-0000-0000-0000-000000000001",
        result,
    )

    artifact_path = tmp_path / "simulation-results" / "00000000-0000-0000-0000-000000000001.json"

    assert artifact_path.exists()
    assert json.loads(artifact_path.read_text(encoding="utf-8")) == result
    assert public_url == "/static/simulation-results/00000000-0000-0000-0000-000000000001.json"
    assert session.last_params["public_url"] == "/static/simulation-results/00000000-0000-0000-0000-000000000001.json"
    assert session.last_bind_names >= {
        "simulation_run_id",
        "public_url",
        "size_bytes",
    }


def test_full_result_file_is_skipped_for_small_result(tmp_path, monkeypatch):
    session = CapturingSession()
    monkeypatch.setattr(simulation_store, "STATIC_DIR", tmp_path)

    public_url = simulation_store.attach_full_result_file_if_heavy(
        session,
        "00000000-0000-0000-0000-000000000001",
        {
            "status": "success",
            "sinr_db": 12.0,
        },
    )

    assert public_url is None
    assert session.last_params is None
    assert not (tmp_path / "simulation-results").exists()


def test_delete_artifact_files_removes_full_result_url(tmp_path, monkeypatch):
    monkeypatch.setattr(simulation_store, "STATIC_DIR", tmp_path)
    artifact_path = tmp_path / "simulation-results" / "run-1.json"
    artifact_path.parent.mkdir()
    artifact_path.write_text("{}", encoding="utf-8")

    deleted = simulation_store.delete_artifact_files([
        {
            "file_path": "",
            "public_url": "/static/simulation-results/run-1.json",
        }
    ])

    assert deleted == 1
    assert not artifact_path.exists()


def test_get_simulation_run_result_loads_full_result_file(tmp_path, monkeypatch):
    artifact_path = tmp_path / "simulation-results" / "run-1.json"
    artifact_path.parent.mkdir()
    artifact_path.write_text(
        json.dumps({"status": "success", "grid": {"cells": [{"row": 0}]}}),
        encoding="utf-8",
    )
    session = ResultSession({
        "response_json": {
            "status": "success",
            "full_result_url": "/static/simulation-results/run-1.json",
        },
    })
    monkeypatch.setattr(simulation_store, "STATIC_DIR", tmp_path)
    monkeypatch.setattr(simulation_store, "is_database_configured", lambda: True)
    monkeypatch.setattr(simulation_store, "db_session", fake_db_session(session))

    response = simulation_store.get_simulation_run_result("run-1")

    assert response["database_configured"] is True
    assert response["result"] == {
        "status": "success",
        "grid": {"cells": [{"row": 0}]},
    }


def test_get_simulation_run_result_returns_small_database_result(monkeypatch):
    session = ResultSession({
        "response_json": {
            "status": "success",
            "sinr_db": 12.5,
        },
    })
    monkeypatch.setattr(simulation_store, "is_database_configured", lambda: True)
    monkeypatch.setattr(simulation_store, "db_session", fake_db_session(session))

    response = simulation_store.get_simulation_run_result("run-1")

    assert response["result"] == {
        "status": "success",
        "sinr_db": 12.5,
    }


def fake_db_session(session):
    @contextmanager
    def context():
        yield session

    return context


class ResultSession:
    def __init__(self, row):
        self.row = row

    def execute(self, query, params=None):
        return ResultRows(self.row)


class ResultRows:
    def __init__(self, row):
        self.row = row

    def mappings(self):
        return self

    def first(self):
        return self.row


class CapturingSession:
    def __init__(self):
        self.last_params = None
        self.last_bind_names = set()

    def execute(self, query, params=None):
        self.last_params = params
        self.last_bind_names = set(query.compile().params)
        return CapturingResult()


class CapturingResult:
    def first(self):
        return SimpleNamespace(id="00000000-0000-0000-0000-000000000001")
