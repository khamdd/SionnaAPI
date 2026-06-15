import numpy as np
from sionna.rt import PlanarArray, RadioMapSolver

from backend.constants import (
    MIN_NEIGHBOR_SIGNAL_DBM,
    NEIGHBOR_SIGNAL_WINDOW_DB,
)
from backend.schemas.requests import RSRPRequest
from backend.simulations.antenna_factory import remove_entity, sync_transmitter
from backend.simulations.radio_calculator import watts_to_dbm


def calculate_rsrp_service(req: RSRPRequest, scene):
    antenna_names = [
        f"tx_{antenna.id}"
        for antenna in req.antennas
    ]

    try:
        scene.tx_array = PlanarArray(
            num_rows=1,
            num_cols=1,
            pattern=req.transmitter_pattern,
            polarization="V",
        )

        for antenna, name in zip(req.antennas, antenna_names):
            sync_transmitter(
                scene,
                name,
                antenna.position,
                antenna.tilt.current,
                antenna.tx_power.current,
                azimuth_deg=antenna.azimuth,
                configure_tx_array=False,
            )

        radio_map = execute_rsrp_radio_map(req.solver, scene)
        users = generate_user_positions(req)
        result = build_rsrp_result(radio_map, req, users)

        return {
            "status": "success",
            "users": result["users"],
            "antenna_summary": result["antenna_summary"],
            "summary": result["summary"],
            "solver": solver_metadata(req.solver),
            "user_count": req.user_count,
            "user_height_m": req.user_height_m,
            "random_seed": req.random_seed,
            "transmitter_pattern": req.transmitter_pattern,
            "antennas": [
                antenna.model_dump()
                for antenna in req.antennas
            ],
        }

    except Exception as e:
        return {
            "status": "failure",
            "error": str(e),
        }

    finally:
        for name in antenna_names:
            remove_entity(scene, name)


def execute_rsrp_radio_map(solver, scene):
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


def generate_user_positions(req: RSRPRequest):
    rng = np.random.default_rng(req.random_seed)
    center_x, center_y, _ = req.solver.center
    size_x, size_y = req.solver.size
    x_min = center_x - size_x / 2.0
    y_min = center_y - size_y / 2.0

    xs = rng.uniform(
        x_min,
        x_min + size_x,
        req.user_count,
    )
    ys = rng.uniform(
        y_min,
        y_min + size_y,
        req.user_count,
    )

    return [
        {
            "id": f"U{index + 1:04d}",
            "position": [
                round(float(x), 2),
                round(float(y), 2),
                req.user_height_m,
            ],
        }
        for index, (x, y) in enumerate(zip(xs, ys))
    ]


def build_rsrp_result(radio_map, req: RSRPRequest, users):
    rss = np.asarray(
        radio_map.rss.numpy(),
        dtype=float,
    )

    if rss.ndim != 3:
        raise ValueError("Expected radio map RSS matrix with shape (tx, rows, cols).")

    antenna_stats = {
        antenna.id: {
            "all_values": [],
            "serving_values": [],
            "served_user_count": 0,
        }
        for antenna in req.antennas
    }

    analyzed_users = [
        analyze_user_rsrp(
            rss,
            req,
            user,
            antenna_stats,
        )
        for user in users
    ]

    return {
        "users": analyzed_users,
        "antenna_summary": summarize_antennas(req, antenna_stats),
        "summary": summarize_users(analyzed_users),
    }


def analyze_user_rsrp(rss, req: RSRPRequest, user, antenna_stats):
    row, col = grid_index_for_position(req.solver, user["position"])
    rsrp_values = []

    for index, antenna in enumerate(req.antennas):
        rsrp_dbm = watts_to_dbm(float(rss[index, row, col]))
        value = {
            "antenna": antenna.id,
            "rsrp_dbm": round(rsrp_dbm, 2),
        }
        rsrp_values.append(value)

        if rsrp_dbm >= MIN_NEIGHBOR_SIGNAL_DBM:
            antenna_stats[antenna.id]["all_values"].append(rsrp_dbm)

    serving = max(
        rsrp_values,
        key=lambda item: item["rsrp_dbm"],
    )
    serving_stats = antenna_stats[serving["antenna"]]
    serving_stats["served_user_count"] += 1

    if serving["rsrp_dbm"] >= MIN_NEIGHBOR_SIGNAL_DBM:
        serving_stats["serving_values"].append(serving["rsrp_dbm"])

    neighbors = build_rsrp_neighbors(
        rsrp_values,
        serving,
    )

    return {
        "id": user["id"],
        "position": user["position"],
        "grid": {
            "row": row,
            "col": col,
        },
        "serving_antenna": serving["antenna"],
        "rsrp_dbm": serving["rsrp_dbm"],
        "quality": rsrp_quality(serving["rsrp_dbm"]),
        "neighbors": neighbors,
        "measurements": sorted(
            rsrp_values,
            key=lambda item: item["rsrp_dbm"],
            reverse=True,
        ),
    }


def grid_index_for_position(solver, position):
    size_x, size_y = solver.size
    center_x, center_y, _ = solver.center
    cell_size = solver.cell_size
    x_min = center_x - size_x / 2.0
    y_min = center_y - size_y / 2.0
    col_count = max(int(np.ceil(size_x / cell_size)), 1)
    row_count = max(int(np.ceil(size_y / cell_size)), 1)

    col = int((position[0] - x_min) / cell_size)
    row = int((position[1] - y_min) / cell_size)

    return (
        int(np.clip(row, 0, row_count - 1)),
        int(np.clip(col, 0, col_count - 1)),
    )


def build_rsrp_neighbors(rsrp_values, serving):
    if serving["rsrp_dbm"] < MIN_NEIGHBOR_SIGNAL_DBM:
        return []

    neighbors = []

    for value in rsrp_values:
        if value["antenna"] == serving["antenna"]:
            continue

        if value["rsrp_dbm"] < MIN_NEIGHBOR_SIGNAL_DBM:
            continue

        weaker_than_serving_db = serving["rsrp_dbm"] - value["rsrp_dbm"]
        if weaker_than_serving_db > NEIGHBOR_SIGNAL_WINDOW_DB:
            continue

        neighbors.append(
            {
                "antenna": value["antenna"],
                "rsrp_dbm": value["rsrp_dbm"],
                "weaker_than_serving_db": round(weaker_than_serving_db, 2),
            }
        )

    return sorted(
        neighbors,
        key=lambda item: item["rsrp_dbm"],
        reverse=True,
    )


def summarize_antennas(req: RSRPRequest, antenna_stats):
    return [
        {
            "antenna": antenna.id,
            "average_rsrp_dbm": average_dbm(stats["all_values"]),
            "average_serving_rsrp_dbm": average_dbm(stats["serving_values"]),
            "served_user_count": stats["served_user_count"],
            "measured_user_count": len(stats["all_values"]),
        }
        for antenna in req.antennas
        for stats in [antenna_stats[antenna.id]]
    ]


def summarize_users(users):
    valid_values = [
        user["rsrp_dbm"]
        for user in users
        if user["rsrp_dbm"] >= MIN_NEIGHBOR_SIGNAL_DBM
    ]

    return {
        "user_count": len(users),
        "covered_user_count": len(valid_values),
        "coverage_percent": round((len(valid_values) / len(users)) * 100, 2)
        if users else 0.0,
        "average_best_rsrp_dbm": average_dbm(valid_values),
        "quality_counts": {
            quality: sum(1 for user in users if user["quality"] == quality)
            for quality in ("excellent", "good", "fair", "poor", "no_coverage")
        },
    }


def average_dbm(values):
    if not values:
        return None

    linear_mw = 10 ** (np.asarray(values, dtype=float) / 10.0)
    average_mw = float(np.mean(linear_mw))

    if average_mw <= 0:
        return None

    return round(float(10.0 * np.log10(average_mw)), 2)


def rsrp_quality(rsrp_dbm):
    if rsrp_dbm >= -80:
        return "excellent"
    if rsrp_dbm >= -90:
        return "good"
    if rsrp_dbm >= -100:
        return "fair"
    if rsrp_dbm >= MIN_NEIGHBOR_SIGNAL_DBM:
        return "poor"
    return "no_coverage"


def solver_metadata(solver):
    return {
        "cell_size": solver.cell_size,
        "center": solver.center,
        "size": solver.size,
    }
