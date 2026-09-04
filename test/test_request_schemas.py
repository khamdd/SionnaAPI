import pytest
from pydantic import ValidationError
from backend.schemas.requests import RangeValue

from backend.constants import DEFAULT_TRANSMITTER_PATTERN
from backend.schemas.requests import (
    CoverageRequest,
    NetworkCoverageOptimizationCandidateRequest,
    NetworkCoverageOptimizationEvaluationRequest,
    NetworkCoverageOptimizationRequest,
    NetworkCoverageRequest,
    SceneBoundsRequest,
    SINRRequest,
    SolverConfig,
    ThroughputRequest,
)


def test_sinr_request_accepts_required_fields_and_defaults():
    request = SINRRequest(
        tilt=8.0,
        transmitter_position=(8.5, 21.0, 27.0),
        receiver_position=(45.0, 90.0, 1.5),
    )

    assert request.interferer_position == (120.0, 100.0, 25.0)
    assert request.tx_power == 30.0
    assert request.transmitter_pattern == DEFAULT_TRANSMITTER_PATTERN
    assert request.solver.max_depth == 5


def test_solver_config_rejects_non_positive_cell_size():
    with pytest.raises(ValidationError):
        SolverConfig(cell_size=0.0)


def test_coverage_request_uses_default_camera_and_solver():
    request = CoverageRequest(
        tilt=8.0,
        transmitter_position=(8.5, 21.0, 27.0),
    )

    assert request.camera.look_at == (0.0, 0.0, 10.0)
    assert request.azimuth == 0.0
    assert request.solver.size == (400.0, 400.0)


def test_coverage_request_rejects_invalid_azimuth():
    with pytest.raises(ValidationError):
        CoverageRequest(
            tilt=8.0,
            azimuth=361.0,
            transmitter_position=(8.5, 21.0, 27.0),
        )


def test_throughput_request_rejects_invalid_bandwidth_and_layers():
    base = {
        "base_tilt": 8.0,
        "target_tilt": 12.0,
        "transmitter_position": (8.5, 21.0, 27.0),
        "receiver_position": (45.0, 90.0, 1.5),
    }

    with pytest.raises(ValidationError):
        ThroughputRequest(**base, bandwidth_mhz=0.0)

    with pytest.raises(ValidationError):
        ThroughputRequest(**base, mimo_layers=0)


def test_network_coverage_request_accepts_up_to_ten_antennas():
    antennas = [
            {
                "id": f"A{i}",
                "longitude": 105.8 + (i * 0.0001),
                "latitude": 21.0 + (i * 0.0001),
                "height_m": 30.0,
                "tilt": {
                "min": 2.0,
                "current": 8.0,
                "max": 18.0,
            },
            "azimuth": 45.0,
            "tx_power": {
                "min": 20.0,
                "current": 30.0,
                "max": 40.0,
            },
        }
        for i in range(10)
    ]

    request = NetworkCoverageRequest(antennas=antennas)

    assert len(request.antennas) == 10
    assert request.transmitter_pattern == DEFAULT_TRANSMITTER_PATTERN
    assert request.solver.cell_size == 2.0


def test_scene_bounds_request_accepts_more_than_ten_fixed_antennas():
    antennas = [
        {
            "id": f"A{i}",
            "longitude": 105.8 + (i * 0.0001),
            "latitude": 21.0 + (i * 0.0001),
            "height_m": 30.0,
            "tilt": {
                "min": 2.0,
                "current": 8.0,
                "max": 18.0,
            },
            "azimuth": 45.0,
            "tx_power": {
                "min": 20.0,
                "current": 30.0,
                "max": 40.0,
            },
        }
        for i in range(12)
    ]

    request = SceneBoundsRequest(
        name="Large antenna inventory",
        fixed_antennas=antennas,
        south=21.0,
        west=105.8,
        north=21.01,
        east=105.81,
    )

    assert len(request.fixed_antennas) == 12


def test_network_coverage_request_rejects_invalid_azimuth():
    with pytest.raises(ValidationError):
        NetworkCoverageRequest(
            antennas=[
                {
                    "id": "A1",
                    "position": (0.0, 0.0, 30.0),
                    "tilt": {
                        "min": 2.0,
                        "current": 8.0,
                        "max": 18.0,
                    },
                    "azimuth": 361.0,
                    "tx_power": {
                        "min": 20.0,
                        "current": 30.0,
                        "max": 40.0,
                    },
                }
            ]
        )


def test_network_coverage_request_rejects_per_antenna_pattern():
    with pytest.raises(ValidationError):
        NetworkCoverageRequest(
            antennas=[
                {
                    "id": "A1",
                    "position": (0.0, 0.0, 30.0),
                    "tilt": {
                        "min": 2.0,
                        "current": 8.0,
                        "max": 18.0,
                    },
                    "azimuth": 45.0,
                    "tx_power": {
                        "min": 20.0,
                        "current": 30.0,
                        "max": 40.0,
                    },
                    "pattern": "iso",
                }
            ]
        )


def test_network_coverage_optimization_request_accepts_two_objectives():
    request = NetworkCoverageOptimizationRequest(
        scene_id="scene-1",
        base_request={
            "antennas": [
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
        },
        objectives=[
            {
                "metric": "uncovered_area_percent",
                "operator": "<=",
                "target": 2.0,
            },
            {
                "metric": "overlap_area_percent",
                "operator": "<=",
                "target": 25.0,
            },
        ],
    )

    assert len(request.objectives) == 2
    assert request.variables[0].field == "tilt"
    assert request.variables[0].scope == "enabled_antennas"


def test_network_coverage_optimization_request_rejects_more_than_two_objectives():
    base_request = {
        "antennas": [
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
    }

    with pytest.raises(ValidationError):
        NetworkCoverageOptimizationRequest(
            base_request=base_request,
            objectives=[
                {
                    "metric": "uncovered_area_percent",
                    "operator": "<=",
                    "target": 2.0,
                },
                {
                    "metric": "covered_area_percent",
                    "operator": ">=",
                    "target": 98.0,
                },
                {
                    "metric": "overlap_area_percent",
                    "operator": "<=",
                    "target": 25.0,
                },
            ],
        )


def test_network_coverage_optimization_request_rejects_duplicate_objectives():
    base_request = {
        "antennas": [
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
    }

    with pytest.raises(ValidationError):
        NetworkCoverageOptimizationRequest(
            base_request=base_request,
            objectives=[
                {
                    "metric": "uncovered_area_percent",
                    "operator": "<=",
                    "target": 2.0,
                },
                {
                    "metric": "uncovered_area_percent",
                    "operator": "<=",
                    "target": 4.0,
                },
            ],
        )


def test_network_coverage_optimization_evaluation_request_accepts_grid_result():
    request = NetworkCoverageOptimizationEvaluationRequest(
        result={
            "grid": {
                "cells": [],
            },
        },
        objectives=[
            {
                "metric": "uncovered_area_percent",
                "operator": "<=",
                "target": 2.0,
            },
        ],
    )

    assert request.result["grid"]["cells"] == []
    assert request.objectives[0].metric == "uncovered_area_percent"


def test_network_coverage_optimization_evaluation_request_rejects_duplicate_metrics():
    with pytest.raises(ValidationError):
        NetworkCoverageOptimizationEvaluationRequest(
            result={
                "grid": {
                    "cells": [],
                },
            },
            objectives=[
                {
                    "metric": "uncovered_area_percent",
                    "operator": "<=",
                    "target": 2.0,
                },
                {
                    "metric": "uncovered_area_percent",
                    "operator": "<=",
                    "target": 4.0,
                },
            ],
        )


def test_network_coverage_optimization_candidate_request_accepts_preview_settings():
    request = NetworkCoverageOptimizationCandidateRequest(
        base_request={
            "antennas": [
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
        },
        tilt_step=2.0,
        max_candidates=12,
    )

    assert request.tilt_step == 2.0
    assert request.max_candidates == 12


def test_network_coverage_optimization_candidate_request_rejects_invalid_settings():
    base_request = {
        "antennas": [
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
    }

    with pytest.raises(ValidationError):
        NetworkCoverageOptimizationCandidateRequest(
            base_request=base_request,
            tilt_step=0.0,
        )

    with pytest.raises(ValidationError):
        NetworkCoverageOptimizationCandidateRequest(
            base_request=base_request,
            max_candidates=101,
        )

def test_range_value_accepts_current_inside_bounds():
    value = RangeValue(
        min=2.0,
        current=8.0,
        max=18.0,
    )

    assert value.current == 8.0


def test_range_value_rejects_current_below_min():
    with pytest.raises(ValidationError):
        RangeValue(
            min=2.0,
            current=1.0,
            max=18.0,
        )


def test_range_value_rejects_current_above_max():
    with pytest.raises(ValidationError):
        RangeValue(
            min=2.0,
            current=20.0,
            max=18.0,
        )


def test_range_value_rejects_min_above_max():
    with pytest.raises(ValidationError):
        RangeValue(
            min=20.0,
            current=18.0,
            max=10.0,
        )
