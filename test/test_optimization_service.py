import math

import pytest

from backend.services.optimization_service import (
    evaluate_network_coverage_objectives,
    evaluate_objective,
    extract_network_coverage_kpis,
    generate_network_coverage_tilt_candidates,
)
from backend.schemas.requests import NetworkCoverageRequest


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
    assert kpis["poor_sinr_area_percent"] == 25.0
    assert kpis["minimum_sinr_db"] == -2.0
    assert kpis["median_throughput_mbps"] == 60.0
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
        "median_throughput_mbps": 45.0,
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
            "metric": "median_throughput_mbps",
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
        {"minimum_sinr_db": None},
        {
            "metric": "minimum_sinr_db",
            "operator": ">=",
            "target": 0.0,
        },
    )

    assert evaluation["passed"] is False
    assert math.isinf(evaluation["score"])


def test_generate_network_coverage_tilt_candidates_respects_ranges():
    request = NetworkCoverageRequest(
        antennas=[
            {
                "id": "A1",
                "longitude": 105.8,
                "latitude": 21.0,
                "height_m": 30.0,
                "tilt": {
                    "min": 0.0,
                    "current": 2.0,
                    "max": 4.0,
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
                    "min": 1.0,
                    "current": 1.0,
                    "max": 3.0,
                },
                "azimuth": 90.0,
                "tx_power": {
                    "min": 20.0,
                    "current": 30.0,
                    "max": 40.0,
                },
            },
        ],
    )

    preview = generate_network_coverage_tilt_candidates(
        request,
        tilt_step=2.0,
        max_candidates=20,
    )

    assert preview["generated_count"] == 5
    assert preview["candidates"][0] == {
        "id": "baseline",
        "label": "Current setup",
        "tilts": {
            "A1": 2.0,
            "A2": 1.0,
        },
        "changes": [],
    }
    assert preview["candidates"][1]["tilts"] == {
        "A1": 4.0,
        "A2": 3.0,
    }
    assert preview["candidates"][2]["tilts"] == {
        "A1": 0.0,
        "A2": 1.0,
    }
    assert all(
        0.0 <= candidate["tilts"]["A1"] <= 4.0
        and 1.0 <= candidate["tilts"]["A2"] <= 3.0
        for candidate in preview["candidates"]
    )


def test_generate_network_coverage_tilt_candidates_applies_max_candidates():
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
            }
        ],
    )

    preview = generate_network_coverage_tilt_candidates(
        request,
        tilt_step=1.0,
        max_candidates=2,
    )

    assert [candidate["id"] for candidate in preview["candidates"]] == [
        "baseline",
        "all_up",
    ]
