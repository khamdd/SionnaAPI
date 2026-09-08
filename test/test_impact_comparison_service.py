from types import SimpleNamespace

from backend.services.impact_comparison_service import build_impact_comparison


def job(
    job_id,
    role,
    result=None,
    *,
    status="succeeded",
    simulation_type="network_coverage",
    profile_id="profile-1",
    error=None,
):
    return SimpleNamespace(
        id=job_id,
        scenario_role=role,
        simulation_profile_id=profile_id,
        simulation_type=simulation_type,
        status=status,
        result_json=result,
        error_message=error,
    )


def load_result(current_job):
    return {"result": current_job.result_json or {}, "error": None}


def grid_result(cells):
    return {
        "grid": {
            "rows": 1,
            "cols": len(cells),
            "cell_count": len(cells),
            "cells": cells,
        }
    }


def coverage_cell(col, *, covered, sinr, throughput=10.0):
    return {
        "row": 0,
        "col": col,
        "x": float(col),
        "y": 0.0,
        "overlap_count": 1 if covered else 0,
        "overlap_level": "single" if covered else "no_coverage",
        "sinr_db": sinr,
        "signal_dbm": -80.0 if covered else None,
        "throughput_mbps": throughput if covered else 0.0,
    }


def plan(simulation_type="network_coverage", objectives=None):
    return {
        "planned_simulations": [
            {
                "profile_id": "profile-1",
                "profile_name": "Main profile",
                "simulation_type": simulation_type,
                "objectives": objectives or [],
            }
        ]
    }


def test_grid_comparison_reports_kpi_deltas_objective_and_spatial_changes():
    baseline = grid_result(
        [
            coverage_cell(0, covered=True, sinr=5.0),
            coverage_cell(1, covered=False, sinr=None),
        ]
    )
    candidate = grid_result(
        [
            coverage_cell(0, covered=True, sinr=4.0),
            coverage_cell(1, covered=True, sinr=8.0),
        ]
    )

    result = build_impact_comparison(
        [job("base", "baseline", baseline), job("next", "candidate", candidate)],
        plan(objectives=[{"metric": "covered_area_percent", "operator": ">=", "target": 75}]),
        result_loader=load_result,
    )

    profile = result["profiles"][0]
    covered = next(
        item for item in profile["kpis"] if item["metric"] == "covered_area_percent"
    )
    assert result["status"] == "complete"
    assert profile["status"] == "compared"
    assert covered == {
        "metric": "covered_area_percent",
        "label": "Covered area",
        "unit": "%",
        "baseline": 50.0,
        "candidate": 100.0,
        "absolute_delta": 50.0,
        "percentage_delta": None,
        "direction": "improved",
        "objective": {
            "status": "passed",
            "operator": ">=",
            "target": 75.0,
            "baseline_status": "failed",
            "candidate_status": "passed",
        },
    }
    assert profile["spatial"] == {
        "paired_cell_count": 2,
        "newly_covered_cells": 1,
        "lost_coverage_cells": 0,
        "improved_sinr_cells": 0,
        "degraded_sinr_cells": 1,
        "local_regression_present": True,
    }


def test_identical_sinr_results_are_unchanged():
    result = {"propagation_model": "friis", "sinr_db": 12.5, "signal_power": -72.0, "noise_power": -95.0}

    comparison = build_impact_comparison(
        [
            job("base", "baseline", result, simulation_type="sinr"),
            job("next", "candidate", result, simulation_type="sinr"),
        ],
        plan("sinr"),
        result_loader=load_result,
    )

    assert {item["direction"] for item in comparison["profiles"][0]["kpis"]} == {
        "unchanged"
    }


def test_failed_and_missing_pairs_are_explicit():
    failed = build_impact_comparison(
        [
            job("base", "baseline", status="failed", error="solver failed"),
            job("next", "candidate", status="succeeded"),
        ],
        plan(),
        result_loader=load_result,
    )
    missing = build_impact_comparison(
        [job("base", "baseline")],
        plan(),
        result_loader=load_result,
    )

    assert failed["profiles"][0]["status"] == "failed"
    assert failed["profiles"][0]["baseline_job"]["error"] == "solver failed"
    assert missing["profiles"][0]["status"] == "missing"
    assert missing["profiles"][0]["candidate_job"] is None


def test_mismatched_grid_results_are_incompatible():
    baseline = grid_result([coverage_cell(0, covered=True, sinr=5.0)])
    candidate = grid_result([coverage_cell(1, covered=True, sinr=6.0)])

    comparison = build_impact_comparison(
        [job("base", "baseline", baseline), job("next", "candidate", candidate)],
        plan(),
        result_loader=load_result,
    )

    profile = comparison["profiles"][0]
    assert profile["status"] == "incompatible"
    assert profile["error_code"] == "incompatible_results"


def test_throughput_comparison_includes_meaningful_percentage_delta():
    baseline = {
        "propagation_model": "friis",
        "comparison": {"base_throughput_mbps": 10, "target_throughput_mbps": 20},
    }
    candidate = {
        "propagation_model": "friis",
        "comparison": {"base_throughput_mbps": 15, "target_throughput_mbps": 30},
    }

    comparison = build_impact_comparison(
        [
            job("base", "baseline", baseline, simulation_type="throughput_comparison"),
            job("next", "candidate", candidate, simulation_type="throughput_comparison"),
        ],
        plan("throughput_comparison"),
        result_loader=load_result,
    )

    kpis = {item["metric"]: item for item in comparison["profiles"][0]["kpis"]}
    assert kpis["base_throughput_mbps"]["percentage_delta"] == 50.0
    assert kpis["target_throughput_mbps"]["percentage_delta"] == 50.0


def test_completed_optimization_exposes_candidate_source_and_objectives():
    baseline = grid_result([coverage_cell(0, covered=True, sinr=5.0)])
    candidate = grid_result([coverage_cell(0, covered=False, sinr=None)])
    optimized_request = {
        "antennas": [
            {
                "id": "A1",
                "longitude": 105.8,
                "latitude": 21.0,
                "height_m": 30,
                "tilt": {"min": 0, "current": 2, "max": 10},
                "azimuth": 45,
                "tx_power": {"min": 20, "current": 35, "max": 40},
            }
        ]
    }
    optimization_result = {
        "optimization": {
            "best": {
                "id": "candidate-1",
                "settings": {"A1": {"tilt": 2, "tx_power": 35, "azimuth": 45}},
                "evaluation": {
                    "passed": True,
                    "evaluations": [
                        {
                            "metric": "covered_area_percent",
                            "operator": ">=",
                            "target": 100,
                            "actual": 100,
                            "passed": True,
                        }
                    ],
                },
            },
            "best_request": optimized_request,
            "stop_reason": "targets_met",
            "tested_count": 2,
        }
    }
    execution_plan = plan(
        objectives=[
            {"metric": "covered_area_percent", "operator": ">=", "target": 100}
        ]
    )
    execution_plan["candidate"] = {"id": "candidate-config", "content_hash": "hash"}

    comparison = build_impact_comparison(
        [
            job("base", "baseline", baseline),
            job("next", "candidate", candidate),
            job(
                "opt",
                "optimization",
                optimization_result,
                simulation_type="network_coverage_optimization",
            ),
        ],
        execution_plan,
        result_loader=load_result,
    )

    profile = comparison["profiles"][0]
    assert profile["optimization"]["status"] == "completed"
    assert profile["optimization"]["objectives_passed"] is True
    assert profile["optimization"]["based_on_candidate"] == {
        "configuration_id": "candidate-config",
        "content_hash": "hash",
    }
    assert profile["objectives"][0]["candidate_status"] == "failed"
    assert profile["objectives"][0]["optimized_status"] == "passed"
