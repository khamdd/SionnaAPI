import math

import numpy as np
import pytest

from backend.schemas.requests import SolverConfig
from backend.simulations.radio_calculator import (
    calculate_5g_throughput,
    calculate_interference_plus_noise_power,
    extract_linear_sinr_at_point,
    extract_signal_power_at_point,
    grid_indices_for_position,
    linear_to_db,
    watts_to_dbm,
)


class ArrayWrapper:
    def __init__(self, value):
        self.value = value

    def numpy(self):
        return self.value


class FakeRadioMap:
    def __init__(self, sinr, rss):
        self.sinr = ArrayWrapper(sinr)
        self.rss = ArrayWrapper(rss)


def test_grid_indices_for_position_maps_world_position_to_cell():
    solver = SolverConfig(
        center=(0.0, 0.0, 0.0),
        size=(100.0, 100.0),
        cell_size=10.0,
    )

    assert grid_indices_for_position(
        solver,
        (0.0, 0.0, 1.5),
        (1, 10, 10),
    ) == (5, 5)


def test_grid_indices_for_position_rejects_out_of_bounds_position():
    solver = SolverConfig(
        center=(0.0, 0.0, 0.0),
        size=(100.0, 100.0),
        cell_size=10.0,
    )

    with pytest.raises(ValueError):
        grid_indices_for_position(
            solver,
            (80.0, 0.0, 1.5),
            (1, 10, 10),
        )


def test_extract_radio_map_values_at_receiver_cell():
    sinr = np.zeros((1, 4, 4), dtype=float)
    rss = np.zeros((1, 4, 4), dtype=float)
    sinr[0, 2, 2] = 12.5
    rss[0, 2, 2] = 1e-6
    radio_map = FakeRadioMap(sinr, rss)
    solver = SolverConfig(
        center=(0.0, 0.0, 0.0),
        size=(40.0, 40.0),
        cell_size=10.0,
    )

    assert extract_linear_sinr_at_point(
        radio_map,
        solver,
        (0.0, 0.0, 1.5),
    ) == 12.5
    assert extract_signal_power_at_point(
        radio_map,
        solver,
        (0.0, 0.0, 1.5),
    ) == 1e-6


def test_power_and_sinr_conversions_handle_invalid_values():
    assert linear_to_db(10.0) == 10.0
    assert linear_to_db(0.0) == -100.0
    assert watts_to_dbm(1e-3) == 0.0
    assert watts_to_dbm(0.0) == -140.0


def test_interference_plus_noise_power_uses_signal_over_sinr():
    assert calculate_interference_plus_noise_power(
        signal_power_watts=2e-6,
        linear_sinr=4.0,
    ) == 5e-7
    assert calculate_interference_plus_noise_power(
        signal_power_watts=2e-6,
        linear_sinr=0.0,
    ) == 0.0


def test_calculate_5g_throughput_uses_bounded_shannon_mapping():
    expected = round(
        100.0
        * min(math.log2(1.0 + 15.0), 7.4)
        * 4
        * 0.82,
        2,
    )

    assert calculate_5g_throughput(15.0, 100.0, 4) == expected
    assert calculate_5g_throughput(0.0, 100.0, 4) == 0.0


def test_calculate_5g_throughput_caps_spectral_efficiency():
    assert calculate_5g_throughput(
        linear_sinr=10**9,
        bandwidth_mhz=100.0,
        layers=4,
    ) == 2427.2
