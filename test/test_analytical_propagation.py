import math

import pytest

from backend.schemas.requests import SINRRequest, ThroughputRequest
from backend.services.pathgain_model import PathGainModel
from backend.services.sinr_service import calculate_sinr_service
from backend.services.throughput_service import compare_throughput_service


def test_uma_uses_frequency_and_receiver_height_inside_nlos_loss():
    model = PathGainModel(
        distance_m=1000.0,
        antenna_height=25.0,
        ue_height=1.5,
        fc_hz=3.5e9,
    )

    expected_nlos_gain = -(
        13.45
        + 39.08 * math.log10(1000.0)
        + 20.0 * math.log10(3.5)
    )

    assert model._uma_urban_macro() == pytest.approx(expected_nlos_gain)


def test_ericsson_uses_receiver_height_correction():
    model = PathGainModel(
        distance_m=1000.0,
        antenna_height=25.0,
        ue_height=1.5,
        fc_hz=1800e6,
    )
    log_frequency = math.log10(1800.0)
    expected_gain = -(
        36.2
        + 30.2 * math.log10(1.0)
        + 12.0 * math.log10(25.0)
        + 0.1 * math.log10(25.0) * math.log10(1.0)
        - 3.2 * math.log10(11.75 * 1.5) ** 2
        + 44.49 * log_frequency
        - 4.78 * log_frequency**2
    )

    assert model._ericsson_channel() == pytest.approx(expected_gain)


@pytest.mark.parametrize("propagation_model", ["uma", "ericsson", "friis"])
def test_analytical_sinr_runs_selected_model_without_a_scene(propagation_model):
    req = SINRRequest(
        propagation_model=propagation_model,
        tilt=8.0,
        transmitter_position=(0.0, 0.0, 25.0),
        receiver_position=(100.0, 0.0, 1.5),
        interferer_position=(300.0, 0.0, 25.0),
    )

    result = calculate_sinr_service(req, scene=None)

    assert result["status"] == "success"
    assert result["propagation_model"] == propagation_model
    assert math.isfinite(result["sinr_db"])
    assert math.isfinite(result["signal_power"])


def test_analytical_throughput_runs_selected_model_and_ignores_tilt():
    req = ThroughputRequest(
        propagation_model="friis",
        base_tilt=4.0,
        target_tilt=14.0,
        transmitter_position=(0.0, 0.0, 25.0),
        receiver_position=(100.0, 0.0, 1.5),
        interferer_position=(300.0, 0.0, 25.0),
    )

    result = compare_throughput_service(req, scene=None)

    assert result["status"] == "success"
    assert result["propagation_model"] == "friis"
    assert (
        result["comparison"]["base_throughput_mbps"]
        == result["comparison"]["target_throughput_mbps"]
    )
    assert result["comparison"]["delta_mbps"] == 0.0
