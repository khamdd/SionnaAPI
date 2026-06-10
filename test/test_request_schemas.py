import pytest
from pydantic import ValidationError

from backend.constants import DEFAULT_TRANSMITTER_PATTERN
from backend.schemas.requests import (
    CoverageRequest,
    NetworkCoverageRequest,
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
    assert request.solver.size == (400.0, 400.0)


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
            "position": (float(i), float(i), 30.0),
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
