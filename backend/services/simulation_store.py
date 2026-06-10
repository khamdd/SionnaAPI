import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from backend.database import db_session, is_database_configured


logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
STATIC_DIR = PROJECT_ROOT / "static"


def utc_now():
    return datetime.now(timezone.utc)


def store_simulation_result(
    simulation_type,
    req,
    result,
    started_at,
    finished_at,
):
    if not is_database_configured():
        return None

    try:
        with db_session() as session:
            run_id = insert_simulation_run(
                session,
                simulation_type,
                req,
                result,
                started_at,
                finished_at,
            )

            if simulation_type == "network_coverage":
                insert_network_antenna_snapshots(
                    session,
                    run_id,
                    req,
                )

            insert_artifact_if_present(
                session,
                run_id,
                result,
            )

            return run_id

    except SQLAlchemyError:
        logger.exception("Failed to store simulation result.")
        return None


def insert_simulation_run(
    session,
    simulation_type,
    req,
    result,
    started_at,
    finished_at,
):
    solver = req.solver
    status = normalize_status(result)

    row = session.execute(
        text(
            """
            INSERT INTO simulation_runs (
                simulation_type,
                status,
                transmitter_pattern,
                max_depth,
                samples_per_tx,
                cell_size_m,
                center_x_m,
                center_y_m,
                center_z_m,
                size_x_m,
                size_y_m,
                bandwidth_mhz,
                mimo_layers,
                request_json,
                response_json,
                error_message,
                started_at,
                finished_at
            )
            VALUES (
                :simulation_type,
                :status,
                :transmitter_pattern,
                :max_depth,
                :samples_per_tx,
                :cell_size_m,
                :center_x_m,
                :center_y_m,
                :center_z_m,
                :size_x_m,
                :size_y_m,
                :bandwidth_mhz,
                :mimo_layers,
                CAST(:request_json AS JSONB),
                CAST(:response_json AS JSONB),
                :error_message,
                :started_at,
                :finished_at
            )
            RETURNING id
            """
        ),
        {
            "simulation_type": simulation_type,
            "status": status,
            "transmitter_pattern": req.transmitter_pattern,
            "max_depth": solver.max_depth,
            "samples_per_tx": solver.samples_per_tx,
            "cell_size_m": solver.cell_size,
            "center_x_m": solver.center[0],
            "center_y_m": solver.center[1],
            "center_z_m": solver.center[2],
            "size_x_m": solver.size[0],
            "size_y_m": solver.size[1],
            "bandwidth_mhz": getattr(req, "bandwidth_mhz", None),
            "mimo_layers": getattr(req, "mimo_layers", None),
            "request_json": to_json_string(req),
            "response_json": to_json_string(summarize_response(result)),
            "error_message": result.get("error"),
            "started_at": started_at,
            "finished_at": finished_at,
        },
    ).first()

    return row.id


def insert_network_antenna_snapshots(
    session,
    run_id,
    req,
):
    for antenna in req.antennas:
        session.execute(
            text(
                """
                INSERT INTO simulation_run_antennas (
                    simulation_run_id,
                    antenna_id,
                    antenna_code,
                    x_m,
                    y_m,
                    z_m,
                    azimuth_deg,
                    tilt_min_deg,
                    tilt_current_deg,
                    tilt_max_deg,
                    tx_power_min_dbm,
                    tx_power_current_dbm,
                    tx_power_max_dbm
                )
                VALUES (
                    :simulation_run_id,
                    NULL,
                    :antenna_code,
                    :x_m,
                    :y_m,
                    :z_m,
                    :azimuth_deg,
                    :tilt_min_deg,
                    :tilt_current_deg,
                    :tilt_max_deg,
                    :tx_power_min_dbm,
                    :tx_power_current_dbm,
                    :tx_power_max_dbm
                )
                """
            ),
            {
                "simulation_run_id": run_id,
                "antenna_code": antenna.id,
                "x_m": antenna.position[0],
                "y_m": antenna.position[1],
                "z_m": antenna.position[2],
                "azimuth_deg": antenna.azimuth,
                "tilt_min_deg": antenna.tilt.min,
                "tilt_current_deg": antenna.tilt.current,
                "tilt_max_deg": antenna.tilt.max,
                "tx_power_min_dbm": antenna.tx_power.min,
                "tx_power_current_dbm": antenna.tx_power.current,
                "tx_power_max_dbm": antenna.tx_power.max,
            },
        )


def insert_artifact_if_present(
    session,
    run_id,
    result,
):
    url = result.get("coverage_map_image_url")
    if not url:
        return

    file_path = static_file_path_from_url(url)

    session.execute(
        text(
            """
            INSERT INTO simulation_artifacts (
                simulation_run_id,
                artifact_type,
                file_path,
                public_url,
                size_bytes
            )
            VALUES (
                :simulation_run_id,
                'coverage_png',
                :file_path,
                :public_url,
                :size_bytes
            )
            """
        ),
        {
            "simulation_run_id": run_id,
            "file_path": str(file_path) if file_path else "",
            "public_url": url,
            "size_bytes": file_path.stat().st_size
            if file_path and file_path.exists()
            else None,
        },
    )


def normalize_status(result):
    status = str(result.get("status", "failure")).lower()
    if status == "success":
        return "success"

    return "failure"


def summarize_response(result):
    summary = dict(result)
    grid = summary.get("grid")

    if isinstance(grid, dict):
        cells = grid.get("cells") or []
        summary["grid"] = {
            "rows": grid.get("rows"),
            "cols": grid.get("cols"),
            "cell_count": len(cells),
        }

    return summary


def to_json_string(value):
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")

    return json.dumps(
        value,
        default=str,
    )


def static_file_path_from_url(url):
    parsed = urlparse(url)
    path = parsed.path or url
    marker = "/static/"

    if marker not in path:
        return None

    relative_name = path.split(marker, 1)[1]
    return STATIC_DIR / relative_name
