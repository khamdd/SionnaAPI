import math

import pytest

from backend.services.optimization_service import (
    run_network_coverage_optimization,
    build_network_coverage_candidate_request,
    evaluate_network_coverage_objectives,
    evaluate_objective,
    extract_network_coverage_kpis,
)
from backend.schemas.requests import NetworkCoverageRequest
from backend.schemas.requests import NetworkCoverageOptimizationRequest


def optimization_request(**kwargs):
    return NetworkCoverageOptimizationRequest(
        base_request=NetworkCoverageRequest(antennas=[{
            "id": "A1", "longitude": 105.8, "latitude": 21.0, "height_m": 30,
            "tilt": {"min": 0, "current": 5, "max": 10}, "azimuth": 45,
            "tx_power": {"min": 20, "current": 30, "max": 40},
        }]),
        objectives=[{"metric": "uncovered_area_percent", "operator": "<=", "target": 0}],
        **kwargs,
    )


def coverage_result(covered):
    return {"status": "success", "grid": {"cells": [
        {"overlap_count": 1 if index < covered else 0} for index in range(10)
    ]}}


def test_search_runs_fresh_baseline_stops_at_target_and_preserves_request():
    req = optimization_request()
    original = req.model_dump()
    calls = []
    progress = []
    def simulate(candidate):
        calls.append(candidate)
        return coverage_result(5 if len(calls) == 1 else 10)
    result = run_network_coverage_optimization(req, simulate, progress.append)
    assert len(calls) == 2
    assert calls[0].antennas[0].tilt.current == 5
    assert calls[1].antennas[0].tilt.current == 0
    assert calls[1].antennas[0].tx_power.current == 20
    assert calls[1].antennas[0].azimuth == 0
    assert req.model_dump() == original
    assert result["optimization"]["stop_reason"] == "targets_met"
    assert result["optimization"]["best"]["settings"]["A1"]["tilt"] == 0
    assert progress[-1]["completed"] == 2


def test_search_keeps_baseline_when_other_settings_are_worse_or_equal():
    req = optimization_request(max_candidates=3)
    outputs = iter([coverage_result(8), coverage_result(6), coverage_result(8)])
    result = run_network_coverage_optimization(req, lambda _: next(outputs))
    assert result["optimization"]["best"]["id"] == "baseline"
    assert result["optimization"]["tested_count"] == 3


def test_search_baseline_failure_aborts_but_candidate_failure_is_reported():
    req = optimization_request(max_candidates=3)
    with pytest.raises(ValueError, match="Starting setup failed"):
        run_network_coverage_optimization(req, lambda _: {"status": "failure", "error": "solver failed"})
    outputs = iter([coverage_result(5), {"status": "failure", "error": "bad candidate"}, coverage_result(9)])
    result = run_network_coverage_optimization(req, lambda _: next(outputs))
    assert result["optimization"]["trials"][1]["error"] == "bad candidate"
    assert result["optimization"]["best"]["id"] != "baseline"
    assert result["optimization"]["best"]["evaluation"]["kpis"]["covered_cells"] == 9


def test_search_limit_includes_baseline_and_rejects_empty_grid():
    result = run_network_coverage_optimization(optimization_request(max_candidates=1), lambda _: coverage_result(5))
    assert result["optimization"]["tested_count"] == 1
    with pytest.raises(ValueError, match="no coverage cells"):
        run_network_coverage_optimization(optimization_request(), lambda _: {"status": "success", "grid": {"cells": []}})


def test_optimization_rejects_invalid_target_and_unbounded_search():
    from pydantic import ValidationError
    req = optimization_request().model_dump()
    req["objectives"][0]["target"] = float("nan")
    with pytest.raises(ValidationError):
        NetworkCoverageOptimizationRequest(**req)
    with pytest.raises(ValidationError):
        optimization_request(max_candidates=5001)


def test_search_normalizes_conflicting_objectives_and_does_not_claim_success():
    payload = optimization_request().model_dump()
    payload["objectives"] = [
        {"metric": "covered_area_percent", "operator": ">=", "target": 100},
        {"metric": "average_overlap_count", "operator": "<=", "target": 1},
    ]
    req = NetworkCoverageOptimizationRequest(**payload)
    baseline = coverage_result(8)  # normalized shortfall .20
    candidate = coverage_result(9)
    for cell in candidate["grid"]["cells"]:
        if cell["overlap_count"] > 0:
            cell["overlap_count"] = 3
    outputs = iter([baseline, candidate, coverage_result(7)])
    result = run_network_coverage_optimization(req, lambda _: next(outputs))
    assert result["optimization"]["best"]["id"] == "baseline"
    assert not result["optimization"]["best"]["evaluation"]["passed"]


def test_search_uses_unrounded_coverage_percent_for_ranking():
    payload = optimization_request(max_candidates=3).model_dump()
    payload["base_request"]["antennas"][0]["tilt"] = {
        "min": 1,
        "current": 8,
        "max": 14,
    }
    payload["objectives"] = [
        {"metric": "covered_area_percent", "operator": ">=", "target": 90},
    ]
    req = NetworkCoverageOptimizationRequest(**payload)

    def result_with_covered_cells(covered):
        total = 29568
        return {
            "status": "success",
            "grid": {
                "cells": [
                    {"overlap_count": 1 if index < covered else 0}
                    for index in range(total)
                ],
            },
        }

    outputs = iter([
        result_with_covered_cells(8263),
        result_with_covered_cells(8265),
        result_with_covered_cells(8260),
    ])

    result = run_network_coverage_optimization(req, lambda _: next(outputs))

    assert result["optimization"]["best"]["evaluation"]["kpis"]["covered_cells"] == 8265
    assert result["optimization"]["baseline"]["evaluation"]["kpis"]["covered_area_percent"] == pytest.approx(27.9457521645)
    assert result["optimization"]["best"]["evaluation"]["kpis"]["covered_area_percent"] == pytest.approx(27.9525162340)


def test_search_can_optimize_power_and_azimuth():
    payload = optimization_request(max_candidates=20).model_dump()
    payload["tilt_step"] = 5
    payload["power_step"] = 5
    payload["azimuth_step"] = 45
    payload["variables"] = [
        {"field": "tx_power", "scope": "enabled_antennas"},
        {"field": "azimuth", "scope": "enabled_antennas"},
    ]
    payload["objectives"] = [
        {"metric": "covered_area_percent", "operator": ">=", "target": 100},
    ]
    req = NetworkCoverageOptimizationRequest(**payload)
    calls = []

    def simulate(candidate):
        calls.append(candidate)
        antenna = candidate.antennas[0]
        if antenna.tx_power.current == 35:
            return coverage_result(9)
        if antenna.azimuth == 90:
            return coverage_result(10)
        return coverage_result(5)

    result = run_network_coverage_optimization(req, simulate)

    assert result["optimization"]["best"]["settings"]["A1"]["azimuth"] == 90
    assert result["optimization"]["best_request"]["antennas"][0]["azimuth"] == 90


def test_beam_search_builds_a_combination_across_rounds():
    payload = optimization_request(max_candidates=30).model_dump()
    payload["power_step"] = 5
    payload["azimuth_step"] = 45
    payload["variables"] = [
        {"field": "tx_power", "scope": "enabled_antennas"},
        {"field": "azimuth", "scope": "enabled_antennas"},
    ]
    payload["objectives"] = [
        {"metric": "covered_area_percent", "operator": ">=", "target": 100},
    ]
    req = NetworkCoverageOptimizationRequest(**payload)
    calls = []

    def simulate(candidate):
        calls.append(candidate)
        antenna = candidate.antennas[0]
        if antenna.tx_power.current == 35 and antenna.azimuth == 90:
            return coverage_result(10)
        if antenna.tx_power.current == 35:
            return coverage_result(8)
        if antenna.azimuth == 90:
            return coverage_result(7)
        return coverage_result(5)

    result = run_network_coverage_optimization(req, simulate)

    assert result["optimization"]["stop_reason"] == "targets_met"
    assert result["optimization"]["search_strategy"] == "deterministic_global_beam_search"
    assert result["optimization"]["rounds_completed"] >= 1
    assert result["optimization"]["best"]["settings"]["A1"]["tx_power"] == 35
    assert result["optimization"]["best"]["settings"]["A1"]["azimuth"] == 90
    assert any(
        call.antennas[0].tx_power.current == 35 and call.antennas[0].azimuth == 90
        for call in calls
    )


def test_beam_search_uses_full_budget_when_combinations_remain():
    req = optimization_request(max_candidates=50)

    result = run_network_coverage_optimization(req, lambda _: coverage_result(5))

    assert result["optimization"]["tested_count"] == 50
    assert result["optimization"]["budget_limit"] == 50
    assert result["optimization"]["stop_reason"] == "budget_exhausted"
    assert result["optimization"]["global_tested"] > 1
    assert result["optimization"]["local_tested"] > 0
    assert any(
        len(trial.get("changes", [])) >= 2
        for trial in result["optimization"]["trials"]
    )


def test_global_exploration_finds_distant_mixed_range_combination():
    payload = optimization_request(max_candidates=30).model_dump()
    payload["power_step"] = 5
    payload["azimuth_step"] = 45
    payload["variables"] = [
        {"field": "tx_power", "scope": "enabled_antennas"},
        {"field": "azimuth", "scope": "enabled_antennas"},
    ]
    payload["objectives"] = [
        {"metric": "covered_area_percent", "operator": ">=", "target": 100},
    ]
    req = NetworkCoverageOptimizationRequest(**payload)

    def simulate(candidate):
        antenna = candidate.antennas[0]
        if antenna.tx_power.current == 20 and antenna.azimuth == 315:
            return coverage_result(10)
        return coverage_result(5)

    result = run_network_coverage_optimization(req, simulate)

    assert result["optimization"]["stop_reason"] == "targets_met"
    assert result["optimization"]["rounds_completed"] == 0
    assert result["optimization"]["best"]["settings"]["A1"]["tx_power"] == 20
    assert result["optimization"]["best"]["settings"]["A1"]["azimuth"] == 315


def test_search_strict_target_equality_is_not_success():
    payload = optimization_request(max_candidates=1).model_dump()
    payload["objectives"] = [{"metric": "uncovered_area_percent", "operator": "<", "target": 20}]
    result = run_network_coverage_optimization(NetworkCoverageOptimizationRequest(**payload), lambda _: coverage_result(8))
    assert result["optimization"]["stop_reason"] == "budget_exhausted"
    assert not result["optimization"]["best"]["evaluation"]["passed"]


def test_extract_network_coverage_kpis_summarizes_grid_metrics():
    grid = {
        "cells": [
            {
                "sinr_db": 12.0,
                "throughput_mbps": 100.0,
                "overlap_count": 1,
                "overlap_level": "single_coverage",
            },
            {
                "sinr_db": -2.0,
                "throughput_mbps": 20.0,
                "overlap_count": 2,
                "overlap_level": "normal_overlap",
            },
            {
                "sinr_db": 4.0,
                "throughput_mbps": 60.0,
                "overlap_count": 3,
                "overlap_level": "high_overlap",
            },
            {
                "sinr_db": None,
                "throughput_mbps": 0.0,
                "overlap_count": 0,
                "overlap_level": "no_coverage",
            },
        ],
        "overlap_summary": {
            "overlap_percent": 50.0,
            "average_overlap_count": 2.0,
        },
    }

    kpis = extract_network_coverage_kpis({"grid": grid})

    assert kpis["total_cells"] == 4
    assert kpis["covered_cells"] == 3
    assert kpis["uncovered_cells"] == 1
    assert kpis["uncovered_area_percent"] == 25.0
    assert kpis["covered_area_percent"] == 75.0
    assert kpis["overlap_area_percent"] == 50.0
    assert kpis["average_overlap_count"] == 2.0


def test_extract_network_coverage_kpis_computes_overlap_without_summary():
    grid = {
        "cells": [
            {"sinr_db": 8.0, "throughput_mbps": 80.0, "overlap_count": 1},
            {"sinr_db": 6.0, "throughput_mbps": 60.0, "overlap_count": 2},
            {"sinr_db": 3.0, "throughput_mbps": 30.0, "overlap_count": 3},
            {"sinr_db": None, "throughput_mbps": None, "overlap_count": 0},
        ],
    }

    kpis = extract_network_coverage_kpis(grid)

    assert kpis["overlap_area_percent"] == 50.0
    assert kpis["average_overlap_count"] == pytest.approx(2.0)


def test_evaluate_objective_handles_threshold_operators():
    kpis = {
        "uncovered_area_percent": 1.8,
        "covered_area_percent": 45.0,
    }

    uncovered = evaluate_objective(
        kpis,
        {
            "metric": "uncovered_area_percent",
            "operator": "<=",
            "target": 2.0,
        },
    )
    throughput = evaluate_objective(
        kpis,
        {
            "metric": "covered_area_percent",
            "operator": ">=",
            "target": 50.0,
        },
    )

    assert uncovered["passed"] is True
    assert uncovered["score"] == 0.0
    assert throughput["passed"] is False
    assert throughput["score"] == 5.0


def test_evaluate_network_coverage_objectives_returns_combined_result():
    result = {
        "grid": {
            "cells": [
                {"sinr_db": 8.0, "throughput_mbps": 80.0, "overlap_count": 1},
                {"sinr_db": None, "throughput_mbps": None, "overlap_count": 0},
            ],
        },
    }

    evaluation = evaluate_network_coverage_objectives(
        result,
        [
            {
                "metric": "uncovered_area_percent",
                "operator": "<=",
                "target": 40.0,
            },
            {
                "metric": "covered_area_percent",
                "operator": ">=",
                "target": 70.0,
            },
        ],
    )

    assert evaluation["passed"] is False
    assert evaluation["score"] == 30.0
    assert evaluation["kpis"]["uncovered_area_percent"] == 50.0


def test_evaluate_objective_marks_missing_kpi_as_not_passed():
    evaluation = evaluate_objective(
        {"average_overlap_count": None},
        {
            "metric": "average_overlap_count",
            "operator": "<=",
            "target": 0.0,
        },
    )

    assert evaluation["passed"] is False
    assert math.isinf(evaluation["score"])


def test_build_network_coverage_candidate_request_updates_tilts_only():
    request = NetworkCoverageRequest(
        antennas=[
            {
                "id": "A1",
                "longitude": 105.8,
                "latitude": 21.0,
                "height_m": 30.0,
                "tilt": {
                    "min": 0.0,
                    "current": 8.0,
                    "max": 20.0,
                },
                "azimuth": 45.0,
                "tx_power": {
                    "min": 20.0,
                    "current": 30.0,
                    "max": 40.0,
                },
            },
            {
                "id": "A2",
                "longitude": 105.801,
                "latitude": 21.001,
                "height_m": 30.0,
                "tilt": {
                    "min": 0.0,
                    "current": 4.0,
                    "max": 12.0,
                },
                "azimuth": 90.0,
                "tx_power": {
                    "min": 20.0,
                    "current": 32.0,
                    "max": 40.0,
                },
            },
        ],
        bandwidth_mhz=80.0,
        mimo_layers=2,
    )

    preview = build_network_coverage_candidate_request(
        request,
        {
            "A1": 10.0,
            "A2": 4.0,
        },
    )

    candidate_request = preview["request"]
    assert candidate_request.antennas[0].tilt.current == 10.0
    assert candidate_request.antennas[0].azimuth == 45.0
    assert candidate_request.antennas[0].tx_power.current == 30.0
    assert candidate_request.antennas[1].tilt.current == 4.0
    assert candidate_request.bandwidth_mhz == 80.0
    assert candidate_request.mimo_layers == 2
    assert preview["changes"] == [
        {
            "antenna_id": "A1",
            "from": 8.0,
            "to": 10.0,
            "delta": 2.0,
        }
    ]


def test_build_network_coverage_candidate_request_rejects_unknown_antenna():
    request = NetworkCoverageRequest(
        antennas=[
            {
                "id": "A1",
                "longitude": 105.8,
                "latitude": 21.0,
                "height_m": 30.0,
                "tilt": {
                    "min": 0.0,
                    "current": 8.0,
                    "max": 20.0,
                },
                "azimuth": 45.0,
                "tx_power": {
                    "min": 20.0,
                    "current": 30.0,
                    "max": 40.0,
                },
            },
        ],
    )

    with pytest.raises(ValueError, match="Unknown antenna"):
        build_network_coverage_candidate_request(request, {"A2": 10.0})


def test_build_network_coverage_candidate_request_rejects_out_of_range_tilt():
    request = NetworkCoverageRequest(
        antennas=[
            {
                "id": "A1",
                "longitude": 105.8,
                "latitude": 21.0,
                "height_m": 30.0,
                "tilt": {
                    "min": 0.0,
                    "current": 8.0,
                    "max": 20.0,
                },
                "azimuth": 45.0,
                "tx_power": {
                    "min": 20.0,
                    "current": 30.0,
                    "max": 40.0,
                },
            },
        ],
    )

    with pytest.raises(ValueError, match="between 0.0 and 20.0"):
        build_network_coverage_candidate_request(request, {"A1": 25.0})
