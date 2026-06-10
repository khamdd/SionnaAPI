import math

import numpy as np
from sionna.rt import RadioMapSolver

from backend.exceptions import ClientInputError


def execute_radio_map(scene, solver_cfg):

    solver = RadioMapSolver()

    return solver(
        scene,
        max_depth=solver_cfg.max_depth,
        samples_per_tx=solver_cfg.samples_per_tx,
        cell_size=(
            solver_cfg.cell_size,
            solver_cfg.cell_size,
        ),
        center=list(solver_cfg.center),
        size=list(solver_cfg.size),
        orientation=[0, 0, 0],
    )


def extract_linear_sinr_at_point(
    radio_map,
    solver_cfg,
    rx_pos,
):
    sinr_matrix = radio_map.sinr.numpy()
    row, col = grid_indices_for_position(
        solver_cfg,
        rx_pos,
        sinr_matrix.shape,
    )

    return float(
        sinr_matrix[0, row, col]
    )


def extract_signal_power_at_point(
    radio_map,
    solver_cfg,
    rx_pos,
):
    rss_matrix = radio_map.rss.numpy()
    row, col = grid_indices_for_position(
        solver_cfg,
        rx_pos,
        rss_matrix.shape,
    )

    return float(
        rss_matrix[0, row, col]
    )


def grid_indices_for_position(
    solver_cfg,
    position,
    matrix_shape,
):
    if len(matrix_shape) != 3:
        raise ValueError(
            "Expected radio map matrix with shape (tx, rows, cols)."
        )

    x_min = (
        solver_cfg.center[0]
        - (solver_cfg.size[0] / 2.0)
    )

    y_min = (
        solver_cfg.center[1]
        - (solver_cfg.size[1] / 2.0)
    )

    col = int(
        (position[0] - x_min)
        / solver_cfg.cell_size
    )

    row = int(
        (position[1] - y_min)
        / solver_cfg.cell_size
    )

    if not (
        0 <= row < matrix_shape[1]
        and 0 <= col < matrix_shape[2]
    ):
        raise ClientInputError(
            "Receiver position sits outside the defined simulation grid boundaries."
        )

    return row, col


def linear_to_db(value):
    if value <= 0 or not np.isfinite(value):
        return -100.0

    return float(
        10 * np.log10(value)
    )


def watts_to_dbm(value):
    if value <= 0 or not np.isfinite(value):
        return -140.0

    return float(
        10 * np.log10(value / 0.001)
    )


def calculate_interference_plus_noise_power(
    signal_power_watts,
    linear_sinr,
):
    if (
        signal_power_watts <= 0
        or linear_sinr <= 0
        or not math.isfinite(signal_power_watts)
        or not math.isfinite(linear_sinr)
    ):
        return 0.0

    return signal_power_watts / linear_sinr


def calculate_5g_throughput(
    linear_sinr,
    bandwidth_mhz,
    layers,
):
    if linear_sinr <= 0 or not math.isfinite(linear_sinr):
        return 0.0

    spectral_efficiency = min(
        math.log2(1.0 + linear_sinr),
        7.4,
    )

    control_overhead_factor = 0.82

    return round(
        bandwidth_mhz
        * spectral_efficiency
        * layers
        * control_overhead_factor,
        2,
    )
