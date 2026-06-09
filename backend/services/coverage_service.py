from pathlib import Path
from uuid import uuid4

import numpy as np
from sionna.rt import Camera, PlanarArray, RadioMapSolver, Transmitter

from backend.simulations.antenna_factory import remove_entity, sync_transmitter
from backend.simulations.radio_calculator import (
    calculate_5g_throughput,
    linear_to_db,
    watts_to_dbm,
)
from backend.simulations.sionna_engine import scene


PROJECT_ROOT = Path(__file__).resolve().parents[2]
STATIC_DIR = PROJECT_ROOT / "static"


def calculate_coverage_map_service(req, base_url):
    try:
        solver = req.solver
        camera_cfg = req.camera
        tilt_rad = req.tilt * np.pi / 180

        remove_entity(scene, "tx0")

        scene.tx_array = PlanarArray(
            num_rows=1,
            num_cols=1,
            pattern=req.transmitter_pattern,
            polarization="V",
        )

        tx = Transmitter(
            name="tx0",
            position=list(req.transmitter_position),
            orientation=[
                0.0,
                tilt_rad,
                0.0,
            ],
            power_dbm=req.tx_power,
        )
        scene.add(tx)

        radio_map_solver = RadioMapSolver()
        radio_map = radio_map_solver(
            scene,
            max_depth=solver.max_depth,
            samples_per_tx=solver.samples_per_tx,
            cell_size=(
                solver.cell_size,
                solver.cell_size,
            ),
            center=list(solver.center),
            size=list(solver.size),
            orientation=[0, 0, 0],
        )

        STATIC_DIR.mkdir(
            parents=True,
            exist_ok=True,
        )

        filename = f"{uuid4()}.png"
        filepath = STATIC_DIR / filename

        camera = Camera(
            position=list(camera_cfg.position),
            look_at=list(camera_cfg.look_at),
        )

        scene.render_to_file(
            camera=camera,
            filename=str(filepath),
            resolution=[
                1024,
                768,
            ],
            radio_map=radio_map,
        )

        return {
            "status": "success",
            "coverage_map_image_url": (
                f"{str(base_url).rstrip('/')}/static/{filename}"
            ),
        }

    except Exception as e:
        return {
            "status": "failure",
            "coverage_map_image_url": "",
            "error": str(e),
        }

    finally:
        remove_entity(scene, "tx0")


def calculate_network_coverage_service(req, base_url):
    antenna_names = [
        f"tx_{antenna.id}"
        for antenna in req.antennas
    ]

    try:
        for antenna, name in zip(req.antennas, antenna_names):
            sync_transmitter(
                scene,
                name,
                antenna.position,
                antenna.tilt.current,
                antenna.tx_power.current,
                pattern=antenna.pattern,
                azimuth_deg=antenna.azimuth,
            )

        radio_map = execute_network_radio_map(
            req.solver,
        )

        image_url = render_network_coverage_image(
            radio_map,
            req.camera,
            base_url,
        )

        grid = build_network_grid(
            radio_map,
            req,
        )

        return {
            "status": "success",
            "coverage_map_image_url": image_url,
            "grid": grid,
            "solver": {
                "cell_size": req.solver.cell_size,
                "center": req.solver.center,
                "size": req.solver.size,
            },
            "antennas": [
                antenna.model_dump()
                for antenna in req.antennas
            ],
        }

    except Exception as e:
        return {
            "status": "failure",
            "coverage_map_image_url": "",
            "error": str(e),
        }

    finally:
        for name in antenna_names:
            remove_entity(scene, name)


def execute_network_radio_map(solver):
    radio_map_solver = RadioMapSolver()
    return radio_map_solver(
        scene,
        max_depth=solver.max_depth,
        samples_per_tx=solver.samples_per_tx,
        cell_size=(
            solver.cell_size,
            solver.cell_size,
        ),
        center=list(solver.center),
        size=list(solver.size),
        orientation=[0, 0, 0],
    )


def render_network_coverage_image(
    radio_map,
    camera_cfg,
    base_url,
):
    STATIC_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    filename = f"{uuid4()}.png"
    filepath = STATIC_DIR / filename
    camera = Camera(
        position=list(camera_cfg.position),
        look_at=list(camera_cfg.look_at),
    )

    scene.render_to_file(
        camera=camera,
        filename=str(filepath),
        resolution=[
            1200,
            900,
        ],
        radio_map=radio_map,
    )

    return f"{str(base_url).rstrip('/')}/static/{filename}"


def build_network_grid(
    radio_map,
    req,
):
    sinr = np.asarray(
        radio_map.sinr.numpy(),
        dtype=float,
    )
    rss = np.asarray(
        radio_map.rss.numpy(),
        dtype=float,
    )

    if sinr.ndim != 3 or rss.ndim != 3:
        raise ValueError(
            "Expected radio map SINR/RSS matrices with shape (tx, rows, cols)."
        )

    finite_sinr = np.where(
        np.isfinite(sinr),
        sinr,
        -np.inf,
    )

    best_tx_index = np.argmax(
        finite_sinr,
        axis=0,
    )
    rows = sinr.shape[1]
    cols = sinr.shape[2]
    x_min = req.solver.center[0] - req.solver.size[0] / 2.0
    y_min = req.solver.center[1] - req.solver.size[1] / 2.0

    cells = []
    for row in range(rows):
        for col in range(cols):
            tx_idx = int(best_tx_index[row, col])
            linear_sinr = float(sinr[tx_idx, row, col])
            signal_watts = float(rss[tx_idx, row, col])

            cells.append(
                {
                    "row": row,
                    "col": col,
                    "x": round(
                        x_min + (col + 0.5) * req.solver.cell_size,
                        2,
                    ),
                    "y": round(
                        y_min + (row + 0.5) * req.solver.cell_size,
                        2,
                    ),
                    "serving_antenna": req.antennas[tx_idx].id,
                    "sinr_db": round(
                        linear_to_db(linear_sinr),
                        2,
                    ),
                    "signal_dbm": round(
                        watts_to_dbm(signal_watts),
                        2,
                    ),
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
        "cells": cells,
    }
