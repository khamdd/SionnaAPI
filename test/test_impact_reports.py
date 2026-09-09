from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.api.dependencies import require_current_user
from backend.main import app
from backend.services import impact_report_service


USER_ID = "11111111-1111-1111-1111-111111111111"
STUDY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc"


def comparison(objective_status="passed", local_regression=False):
    return {
        "status": "complete",
        "profiles": [
            {
                "profile_id": "profile-1",
                "profile_name": "Coverage profile",
                "simulation_type": "network_coverage",
                "status": "compared",
                "baseline_job": {"id": "base-job", "status": "succeeded"},
                "candidate_job": {"id": "candidate-job", "status": "succeeded"},
                "kpis": [
                    {
                        "metric": "covered_area_percent",
                        "label": "Covered area",
                        "unit": "%",
                        "baseline": 80,
                        "candidate": 95,
                        "absolute_delta": 15,
                        "percentage_delta": None,
                        "direction": "improved",
                    }
                ],
                "spatial": {
                    "paired_cell_count": 10,
                    "newly_covered_cells": 2,
                    "lost_coverage_cells": 0,
                    "improved_sinr_cells": 4,
                    "degraded_sinr_cells": int(local_regression),
                    "local_regression_present": local_regression,
                },
                "objectives": [
                    {
                        "metric": "covered_area_percent",
                        "operator": ">=",
                        "target": 90,
                        "baseline_status": "failed",
                        "candidate_status": objective_status,
                        "optimized_status": "not_run",
                    }
                ],
                "optimization": {
                    "status": "not_requested",
                    "based_on_candidate": {
                        "configuration_id": "candidate-config",
                        "content_hash": "candidate-hash",
                    },
                },
            }
        ],
    }


def snapshot(study_status="completed", current_comparison=None):
    return {
        "schema_version": "impact-report-v1",
        "generated_at": "2026-09-09T08:00:00+00:00",
        "study": {
            "id": STUDY_ID,
            "scene_id": "<unsafe-scene>",
            "creator": USER_ID,
            "policy_version": "impact-policy-v1",
            "status": study_status,
            "created_at": "2026-09-09T07:00:00+00:00",
            "started_at": "2026-09-09T07:10:00+00:00",
            "finished_at": "2026-09-09T07:30:00+00:00",
        },
        "baseline": {
            "id": "baseline-config",
            "version": 1,
            "status": "superseded",
            "source": "manual",
            "content_hash": "base-hash",
        },
        "candidate": {
            "id": "candidate-config",
            "version": 2,
            "status": "published",
            "source": "manual",
            "content_hash": "candidate-hash",
        },
        "difference": {
            "changes": [
                {
                    "antenna_id": "A1",
                    "change_type": "field_changed",
                    "field": "tilt.current",
                    "before": 4,
                    "after": 6,
                }
            ]
        },
        "execution_plan": {
            "planned_simulations": [
                {
                    "profile_id": "profile-1",
                    "profile_name": "Coverage profile",
                    "simulation_type": "network_coverage",
                    "propagation_model": "sionna",
                    "candidate_request": {
                        "solver": {"max_depth": 5, "cell_size": 2}
                    },
                }
            ],
            "skipped_simulations": [],
        },
        "summary": {"comparison": current_comparison or comparison()},
        "jobs": [
            {
                "id": "base-job",
                "simulation_profile_id": "profile-1",
                "simulation_type": "network_coverage",
                "scenario_role": "baseline",
                "status": "succeeded",
                "attempts": 1,
                "error_message": None,
            },
            {
                "id": "candidate-job",
                "simulation_profile_id": "profile-1",
                "simulation_type": "network_coverage",
                "scenario_role": "candidate",
                "status": "succeeded",
                "attempts": 1,
                "error_message": None,
            },
        ],
        "result_by_job_id": {
            "base-job": {"coverage_map_image_url": "/static/base.png"},
            "candidate-job": {"coverage_map_image_url": "/static/candidate.png"},
        },
        "runtime": {
            "python": "3.11",
            "platform": "test",
            "code_version": "abc123",
            "gpu_devices": "0",
            "dependencies": {"sionna-rt": "2.0.1"},
        },
    }


def test_rendered_report_has_all_sections_notice_maps_and_escaped_content():
    report = impact_report_service.render_impact_report(snapshot())

    for number in range(1, 13):
        assert f"{number}. " in report
    assert "simulated predictions, not measured live-network values" in report
    assert "/static/base.png" in report
    assert "/static/candidate.png" in report
    assert "&lt;unsafe-scene&gt;" in report
    assert "<unsafe-scene>" not in report
    assert ">pass<" in report


@pytest.mark.parametrize(
    ("study_status", "current_comparison", "expected"),
    [
        ("completed", comparison("passed"), "pass"),
        ("completed", comparison("failed"), "fail"),
        ("completed", {"status": "complete", "profiles": []}, "review"),
        ("completed_with_failures", comparison("passed"), "incomplete"),
        ("completed", comparison("passed", local_regression=True), "review"),
    ],
)
def test_final_decision_is_deterministic(
    study_status,
    current_comparison,
    expected,
):
    assert impact_report_service.final_decision(
        study_status,
        current_comparison,
    ) == expected


def test_partial_report_identifies_failed_job_and_profile():
    data = snapshot(study_status="completed_with_failures")
    data["jobs"][1].update(status="failed", error_message="solver failed")
    data["summary"]["comparison"]["status"] = "complete_with_issues"
    data["summary"]["comparison"]["profiles"][0].update(
        status="failed",
        error="Candidate simulation failed.",
    )

    report = impact_report_service.render_impact_report(data)

    assert "solver failed" in report
    assert "Candidate simulation failed." in report
    assert ">incomplete<" in report


def test_report_artifact_is_idempotent_and_survives_reuse(tmp_path, monkeypatch):
    monkeypatch.setattr(impact_report_service, "REPORT_DIR", tmp_path)

    first = impact_report_service.write_impact_report(STUDY_ID, "first report")
    second = impact_report_service.write_impact_report(STUDY_ID, "replacement")

    assert first == second
    assert first.read_text(encoding="utf-8") == "first report"


def test_report_api_returns_download(monkeypatch, tmp_path):
    report_path = tmp_path / "report.html"
    report_path.write_text("<html>report</html>", encoding="utf-8")
    captured = {}

    def fake_report(study_id, user_id):
        captured.update(study_id=study_id, user_id=user_id)
        return {
            "status": "success",
            "file_path": str(report_path),
            "filename": "impact-study.html",
            "already_generated": False,
        }

    monkeypatch.setattr(
        impact_report_service,
        "get_or_create_impact_report",
        fake_report,
    )
    app.dependency_overrides[require_current_user] = lambda: {
        "id": USER_ID,
        "username": "tester",
    }
    try:
        response = TestClient(app).get(
            f"/api/v1/impact-studies/{STUDY_ID}/report"
        )
    finally:
        app.dependency_overrides.pop(require_current_user, None)

    assert response.status_code == 200
    assert response.text == "<html>report</html>"
    assert "attachment" in response.headers["content-disposition"]
    assert response.headers["x-impact-report-generated"] == "true"
    assert captured == {"study_id": STUDY_ID, "user_id": USER_ID}
