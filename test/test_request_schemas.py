import pytest
from pydantic import ValidationError

from backend.constants import DEFAULT_TRANSMITTER_PATTERN
from backend.schemas.requests import (
    CoverageRequest,
    NetworkCoverageOptimizationRequest,
    NetworkCoverageRequest,
    RangeValue,
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

    assert request.interferer_position is None
    assert request.azimuth == 0.0
    assert request.interferer_azimuth == 0.0
    assert request.tx_power == 30.0
    assert request.transmitter_pattern == DEFAULT_TRANSMITTER_PATTERN
    assert request.solver.max_depth == 5


def test_solver_config_rejects_non_positive_cell_size():
    with pytest.raises(ValidationError):
        SolverConfig(cell_size=0.0)


def test_solver_config_requires_integer_cell_size_at_least_two_meters():
    with pytest.raises(ValidationError):
        SolverConfig(cell_size=1)

    with pytest.raises(ValidationError):
        SolverConfig(cell_size=2.5)

    request = SolverConfig(cell_size=3)
    assert request.cell_size == 3


def test_solver_config_allows_large_grids_without_cell_count_limit():
    request = SolverConfig(size=(5000.0, 5000.0), cell_size=2)

    assert request.cell_size == 2


def test_coverage_request_uses_default_solver_without_camera_input():
    request = CoverageRequest(
        tilt=8.0,
        transmitter_position=(8.5, 21.0, 27.0),
    )

    assert "camera" not in request.model_dump()
    assert "camera" not in CoverageRequest.model_fields
    assert "camera" not in NetworkCoverageRequest.model_fields
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


def test_scene_bounds_request_accepts_a_ward_boundary_inside_scene_bounds():
    request = SceneBoundsRequest(
        name="Ward scene",
        south=21.0,
        west=105.8,
        north=21.01,
        east=105.81,
        ward_boundary={
            "type": "Feature",
            "properties": {
                "ward_code": "00166",
                "ward_name": "Cầu Giấy",
                "ward_full_name": "Phường Cầu Giấy",
            },
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [105.8, 21.0],
                    [105.81, 21.0],
                    [105.81, 21.01],
                    [105.8, 21.0],
                ]],
            },
        },
    )

    assert request.ward_boundary.properties.ward_code == "00166"


def test_scene_bounds_request_rejects_ward_boundary_outside_scene_bounds():
    with pytest.raises(ValidationError, match="ward boundary must stay inside"):
        SceneBoundsRequest(
            south=21.0,
            west=105.8,
            north=21.01,
            east=105.81,
            ward_boundary={
                "type": "Feature",
                "properties": {
                    "ward_code": "00166",
                    "ward_name": "Cầu Giấy",
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [105.8, 21.0],
                        [105.82, 21.0],
                        [105.81, 21.01],
                        [105.8, 21.0],
                    ]],
                },
            },
        )


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


def test_network_coverage_optimization_request_rejects_more_than_four_objectives():
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
                {
                    "metric": "average_overlap_count",
                    "operator": "<=",
                    "target": 3.0,
                },
                {
                    "kind": "percentile",
                    "measurement": "sinr_db",
                    "percentile": 10,
                    "operator": ">=",
                    "target": 5.0,
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


def optimization_base_request():
    return {
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


def test_network_coverage_optimization_request_accepts_guardrails_and_limits():
    request = NetworkCoverageOptimizationRequest(
        base_request=optimization_base_request(),
        objectives=[
            {
                "metric": "uncovered_area_percent",
                "operator": "<=",
                "target": 2.0,
            },
        ],
        eligible_antenna_ids=["A1"],
        max_tilt_change=4.0,
        max_power_change=6.0,
        max_azimuth_change=45.0,
        max_changed_antennas=1,
        prevent_total_power_increase=True,
        guardrails=[
            {
                "metric": "covered_area_percent",
                "max_regression": 2.0,
            },
            {
                "metric": "average_overlap_count",
            },
        ],
    )

    assert request.eligible_antenna_ids == ["A1"]
    assert request.max_changed_antennas == 1
    assert request.prevent_total_power_increase is True
    assert [guardrail.metric for guardrail in request.guardrails] == [
        "covered_area_percent",
        "average_overlap_count",
    ]
    assert request.guardrails[1].max_regression == 0.0


def test_network_coverage_optimization_request_rejects_duplicate_guardrails():
    with pytest.raises(ValidationError):
        NetworkCoverageOptimizationRequest(
            base_request=optimization_base_request(),
            objectives=[
                {
                    "metric": "uncovered_area_percent",
                    "operator": "<=",
                    "target": 2.0,
                },
            ],
            guardrails=[
                {
                    "metric": "covered_area_percent",
                    "max_regression": 2.0,
                },
                {
                    "metric": "covered_area_percent",
                    "max_regression": 5.0,
                },
            ],
        )


def test_network_coverage_optimization_request_rejects_unknown_eligible_antennas():
    with pytest.raises(ValidationError):
        NetworkCoverageOptimizationRequest(
            base_request=optimization_base_request(),
            objectives=[
                {
                    "metric": "uncovered_area_percent",
                    "operator": "<=",
                    "target": 2.0,
                },
            ],
            eligible_antenna_ids=["A1", "A2"],
        )


def test_network_coverage_optimization_request_serialization_omits_default_guardrails():
    request = NetworkCoverageOptimizationRequest(
        base_request=optimization_base_request(),
        objectives=[
            {
                "metric": "uncovered_area_percent",
                "operator": "<=",
                "target": 2.0,
            },
        ],
    )

    data = request.model_dump(mode="json")

    for key in (
        "eligible_antenna_ids",
        "max_tilt_change",
        "max_power_change",
        "max_azimuth_change",
        "max_changed_antennas",
        "prevent_total_power_increase",
        "guardrails",
    ):
        assert key not in data


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
