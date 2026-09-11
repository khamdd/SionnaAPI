import math
import threading
from pathlib import Path

import numpy as np

from backend.constants import (
    MIN_NEIGHBOR_SIGNAL_DBM,
    NEIGHBOR_SIGNAL_WINDOW_DB,
)
from backend.schemas.requests import CoverageRequest, NetworkCoverageRequest
from backend.simulations.overlap import build_overlap_info, summarize_overlap

DEFAULT_FREQUENCY_HZ = 3.5e9
DEFAULT_BANDWIDTH_MHZ = 100.0
NO_COVERAGE_DBM = -140.0
RECEIVER_HEIGHT_ABOVE_GROUND_M = 1.5
NOISE_FIGURE_DB = 7.0
SPEED_OF_LIGHT_MPS = 299_792_458.0

_scene_cache = {}
_scene_lock = threading.RLock()


def execute_differt_simulation(simulation_type, req, base_url, scene_info):
    if simulation_type == "coverage_map":
        return calculate_differt_coverage_map_service(req, base_url, scene_info)

    if simulation_type == "network_coverage":
        return calculate_differt_network_coverage_service(req, base_url, scene_info)

    raise ValueError(
        f"DiffeRT currently supports coverage map and network coverage only, not {simulation_type}."
    )


def calculate_differt_coverage_map_service(
    req: CoverageRequest,
    base_url,
    scene_info,
):
    try:
        antennas = [
            {
                "id": "TX",
                "position": tuple(req.transmitter_position),
                "tx_power_dbm": float(req.tx_power),
                "frequency_hz": DEFAULT_FREQUENCY_HZ,
            }
        ]
        received_power_dbm, receivers = trace_differt_received_power(
            req.solver,
            antennas,
            scene_info,
        )
        grid = build_single_transmitter_grid(
            received_power_dbm,
            receivers,
            req,
        )

        return {
            "status": "success",
            "simulation_engine": "differt",
            "coverage_map_image_url": "",
            "grid": grid,
            "solver": solver_metadata(req.solver),
            "antennas": [
                {
                    "id": "TX",
                    "position": req.transmitter_position,
                    "azimuth": 0,
                },
            ],
        }

    except Exception as exc:
        return {
            "status": "failure",
            "coverage_map_image_url": "",
            "error": str(exc),
        }


def calculate_differt_network_coverage_service(
    req: NetworkCoverageRequest,
    base_url,
    scene_info,
):
    try:
        antennas = [
            {
                "id": antenna.id,
                "position": tuple(antenna.position),
                "tx_power_dbm": float(antenna.tx_power.current),
                "frequency_hz": DEFAULT_FREQUENCY_HZ,
            }
            for antenna in req.antennas
        ]
        received_power_dbm, receivers = trace_differt_received_power(
            req.solver,
            antennas,
            scene_info,
        )
        grid = build_network_grid(
            received_power_dbm,
            receivers,
            req,
        )

        return {
            "status": "success",
            "simulation_engine": "differt",
            "coverage_map_image_url": "",
            "grid": grid,
            "solver": solver_metadata(req.solver),
            "transmitter_pattern": req.transmitter_pattern,
            "antennas": [
                antenna.model_dump()
                for antenna in req.antennas
            ],
        }

    except Exception as exc:
        return {
            "status": "failure",
            "coverage_map_image_url": "",
            "error": str(exc),
        }


def trace_differt_received_power(solver, antennas, scene_info):
    scene = load_differt_scene(scene_info)
    receivers = build_receiver_grid(solver, scene)
    tx_positions = np.asarray(
        [
            antenna["position"]
            for antenna in antennas
        ],
        dtype=np.float64,
    )

    equinox, jnp = import_differt_runtime_arrays()
    scene = equinox.tree_at(
        lambda value: value.transmitters,
        scene,
        jnp.asarray(tx_positions, dtype=jnp.float32),
    )
    scene = equinox.tree_at(
        lambda value: value.receivers,
        scene,
        jnp.asarray(receivers, dtype=jnp.float32),
    )

    paths = scene.trace_paths(order=0)
    expected_shape = (
        len(antennas),
        *receivers.shape[:-1],
    )
    los_mask = extract_los_mask(paths, expected_shape)
    distances = tx_receiver_distances(tx_positions, receivers)
    frequencies = parameter_array(
        [
            antenna["frequency_hz"]
            for antenna in antennas
        ],
        receivers.shape[:-1],
    )
    tx_power_dbm = parameter_array(
        [
            antenna["tx_power_dbm"]
            for antenna in antennas
        ],
        receivers.shape[:-1],
    )
    fspl_db = 20.0 * np.log10(
        (4.0 * np.pi * distances * frequencies) / SPEED_OF_LIGHT_MPS
    )

    return (
        np.where(los_mask, tx_power_dbm - fspl_db, NO_COVERAGE_DBM),
        receivers,
    )


def load_differt_scene(scene_info):
    scene_path = resolve_differt_scene_path(scene_info)
    cache_key = str(scene_path)

    with _scene_lock:
        if cache_key not in _scene_cache:
            if len(_scene_cache) > 2:
                _scene_cache.clear()

            Scene = import_differt_scene()
            _scene_cache[cache_key] = Scene.load_xml(str(scene_path))

        return _scene_cache[cache_key]


def resolve_differt_scene_path(scene_info):
    scene_path = (scene_info or {}).get("scene_path")

    if not scene_path:
        raise ValueError(
            "DiffeRT requires an imported XML scene. Choose an imported scene before running DiffeRT."
        )

    path = Path(scene_path)

    if not path.is_file():
        raise ValueError(f"DiffeRT scene file is unavailable: {path}")

    return path


def import_differt_scene():
    try:
        from differt.geometry import Scene
    except ImportError as exc:
        raise RuntimeError(
            "DiffeRT is not installed in the backend Python environment."
        ) from exc

    return Scene


def import_differt_runtime_arrays():
    try:
        import equinox
        import jax.numpy as jnp
    except ImportError as exc:
        raise RuntimeError(
            "DiffeRT requires equinox and jax in the backend Python environment."
        ) from exc

    return equinox, jnp


def build_receiver_grid(solver, scene):
    rows = max(1, int(math.ceil(float(solver.size[1]) / float(solver.cell_size))))
    cols = max(1, int(math.ceil(float(solver.size[0]) / float(solver.cell_size))))
    x_min = float(solver.center[0]) - float(solver.size[0]) / 2.0
    y_min = float(solver.center[1]) - float(solver.size[1]) / 2.0
    z_min = float(np.asarray(scene.mesh.bounding_box)[0, 2])
    z = z_min + RECEIVER_HEIGHT_ABOVE_GROUND_M
    xs = x_min + (np.arange(cols, dtype=np.float64) + 0.5) * float(solver.cell_size)
    ys = y_min + (np.arange(rows, dtype=np.float64) + 0.5) * float(solver.cell_size)
    grid_x, grid_y = np.meshgrid(xs, ys)
    grid_z = np.full_like(grid_x, z, dtype=np.float64)

    return np.stack(
        [
            grid_x,
            grid_y,
            grid_z,
        ],
        axis=-1,
    )


def extract_los_mask(paths, expected_shape):
    mask = np.asarray(paths.mask)

    if mask.dtype != np.bool_:
        threshold = float(getattr(paths, "confidence_threshold", 0.5))
        mask = mask >= threshold

    if mask.shape == expected_shape:
        return mask

    expected_ndim = len(expected_shape)
    if (
        mask.ndim >= expected_ndim
        and tuple(mask.shape[:expected_ndim]) == tuple(expected_shape)
    ):
        remaining = int(np.prod(mask.shape[expected_ndim:]))
        return np.any(
            mask.reshape(*expected_shape, remaining),
            axis=-1,
        )

    raise ValueError(
        f"Unexpected DiffeRT LOS mask shape. Expected {expected_shape}, received {mask.shape}."
    )


def tx_receiver_distances(tx_positions, receivers):
    tx_shape = (
        tx_positions.shape[0],
        *([1] * len(receivers.shape[:-1])),
        3,
    )
    distances = np.linalg.norm(
        receivers[None, ...] - tx_positions.reshape(tx_shape),
        axis=-1,
    )

    return np.maximum(distances, 0.1)


def parameter_array(values, receiver_grid_shape):
    return np.asarray(values, dtype=np.float64).reshape(
        len(values),
        *([1] * len(receiver_grid_shape)),
    )


def build_network_grid(received_power_dbm, receivers, req: NetworkCoverageRequest):
    received_power_watts = dbm_to_watts(received_power_dbm)
    best_tx_index = np.argmax(received_power_dbm, axis=0)
    rows, cols = received_power_dbm.shape[1:]
    noise_watts = noise_power_watts(req.bandwidth_mhz)
    cells = []

    for row in range(rows):
        for col in range(cols):
            tx_idx = int(best_tx_index[row, col])
            serving_signal_dbm = float(received_power_dbm[tx_idx, row, col])
            signal_watts = float(received_power_watts[tx_idx, row, col])
            interference_watts = max(
                0.0,
                float(np.sum(received_power_watts[:, row, col])) - signal_watts,
            )
            linear_sinr = signal_watts / max(
                interference_watts + noise_watts,
                1e-30,
            )
            neighbors = build_cell_neighbors(
                received_power_dbm,
                req,
                tx_idx,
                row,
                col,
                serving_signal_dbm,
            )
            overlap = build_overlap_info(
                req.antennas[tx_idx].id,
                serving_signal_dbm,
                neighbors,
            )

            cells.append(
                {
                    "row": row,
                    "col": col,
                    "x": round(float(receivers[row, col, 0]), 2),
                    "y": round(float(receivers[row, col, 1]), 2),
                    "serving_antenna": req.antennas[tx_idx].id,
                    "sinr_db": round(linear_to_db(linear_sinr), 2),
                    "signal_dbm": round(serving_signal_dbm, 2),
                    "neighbors": neighbors,
                    "overlap_antennas": overlap["antennas"],
                    "overlap_count": overlap["count"],
                    "overlap_level": overlap["level"],
                    "throughput_mbps": calculate_5g_throughput(
                        linear_sinr,
                        req.bandwidth_mhz,
                        req.mimo_layers,
                    ),
                }
            )

    return {
        "rows": rows,
        "cols": cols,
        "cell_count": len(cells),
        "cells": cells,
        "overlap_summary": summarize_overlap(cells),
    }


def build_single_transmitter_grid(received_power_dbm, receivers, req: CoverageRequest):
    rows, cols = received_power_dbm.shape[1:]
    noise_watts = noise_power_watts(DEFAULT_BANDWIDTH_MHZ)
    cells = []

    for row in range(rows):
        for col in range(cols):
            signal_dbm = float(received_power_dbm[0, row, col])
            signal_watts = float(dbm_to_watts(signal_dbm))
            linear_sinr = signal_watts / max(noise_watts, 1e-30)
            overlap = build_overlap_info(
                "TX",
                signal_dbm,
                [],
            )

            cells.append(
                {
                    "row": row,
                    "col": col,
                    "x": round(float(receivers[row, col, 0]), 2),
                    "y": round(float(receivers[row, col, 1]), 2),
                    "serving_antenna": "TX",
                    "sinr_db": round(linear_to_db(linear_sinr), 2),
                    "signal_dbm": round(signal_dbm, 2),
                    "neighbors": [],
                    "overlap_antennas": overlap["antennas"],
                    "overlap_count": overlap["count"],
                    "overlap_level": overlap["level"],
                    "throughput_mbps": None,
                }
            )

    return {
        "rows": rows,
        "cols": cols,
        "cell_count": len(cells),
        "cells": cells,
        "overlap_summary": summarize_overlap(cells),
    }


def build_cell_neighbors(
    received_power_dbm,
    req: NetworkCoverageRequest,
    serving_tx_idx,
    row,
    col,
    serving_signal_dbm,
):
    if serving_signal_dbm < MIN_NEIGHBOR_SIGNAL_DBM:
        return []

    neighbors = []

    for candidate_idx, antenna in enumerate(req.antennas):
        if candidate_idx == serving_tx_idx:
            continue

        candidate_signal_dbm = float(received_power_dbm[candidate_idx, row, col])

        if candidate_signal_dbm < MIN_NEIGHBOR_SIGNAL_DBM:
            continue

        weaker_than_serving_db = serving_signal_dbm - candidate_signal_dbm

        if weaker_than_serving_db > NEIGHBOR_SIGNAL_WINDOW_DB:
            continue

        neighbors.append(
            {
                "antenna": antenna.id,
                "signal_dbm": round(candidate_signal_dbm, 2),
                "sinr_db": None,
                "weaker_than_serving_db": round(weaker_than_serving_db, 2),
            }
        )

    return sorted(
        neighbors,
        key=lambda item: item["signal_dbm"],
        reverse=True,
    )


def dbm_to_watts(value):
    return np.power(
        10.0,
        (np.asarray(value, dtype=np.float64) - 30.0) / 10.0,
    )


def watts_to_dbm(value):
    if value <= 0 or not math.isfinite(float(value)):
        return NO_COVERAGE_DBM

    return 10.0 * math.log10(float(value) / 0.001)


def noise_power_watts(bandwidth_mhz):
    bandwidth_hz = max(float(bandwidth_mhz), 1e-9) * 1_000_000.0
    noise_dbm = -174.0 + 10.0 * math.log10(bandwidth_hz) + NOISE_FIGURE_DB
    return float(dbm_to_watts(noise_dbm))


def linear_to_db(value):
    if value <= 0 or not math.isfinite(float(value)):
        return -100.0

    return 10.0 * math.log10(float(value))


def calculate_5g_throughput(linear_sinr, bandwidth_mhz, layers):
    if linear_sinr <= 0 or not math.isfinite(float(linear_sinr)):
        return 0.0

    spectral_efficiency = min(
        math.log2(1.0 + float(linear_sinr)),
        7.4,
    )

    return round(
        float(bandwidth_mhz) * spectral_efficiency * int(layers) * 0.82,
        2,
    )


def solver_metadata(solver):
    return {
        "cell_size": solver.cell_size,
        "center": solver.center,
        "size": solver.size,
    }
