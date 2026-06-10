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


def list_simulation_runs(limit=25):
    if not is_database_configured():
        return {
            "database_configured": False,
            "items": [],
        }

    try:
        with db_session() as session:
            rows = session.execute(
                text(
                    """
                    SELECT
                        id,
                        simulation_type,
                        status,
                        transmitter_pattern,
                        cell_size_m,
                        bandwidth_mhz,
                        mimo_layers,
                        coverage_map_image_url,
                        error_message,
                        started_at,
                        finished_at,
                        created_at
                    FROM simulation_runs
                    ORDER BY created_at DESC
                    LIMIT :limit
                    """
                ),
                {
                    "limit": limit,
                },
            ).mappings()

            return {
                "database_configured": True,
                "items": [
                    serialize_run_summary(row)
                    for row in rows
                ],
            }

    except SQLAlchemyError:
        logger.exception("Failed to list simulation runs.")
        return {
            "database_configured": True,
            "items": [],
            "error": "Failed to load simulation history.",
        }


def get_simulation_run(run_id):
    if not is_database_configured():
        return {
            "database_configured": False,
            "item": None,
        }

    try:
        with db_session() as session:
            run = session.execute(
                text(
                    """
                    SELECT
                        id,
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
                        coverage_map_image_url,
                        error_message,
                        started_at,
                        finished_at,
                        created_at
                    FROM simulation_runs
                    WHERE id = :run_id
                    """
                ),
                {
                    "run_id": run_id,
                },
            ).mappings().first()

            if run is None:
                return {
                    "database_configured": True,
                    "item": None,
                }

            antennas = session.execute(
                text(
                    """
                    SELECT
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
                    FROM simulation_run_antennas
                    WHERE simulation_run_id = :run_id
                    ORDER BY antenna_code
                    """
                ),
                {
                    "run_id": run_id,
                },
            ).mappings()

            artifacts = session.execute(
                text(
                    """
                    SELECT
                        artifact_type,
                        file_path,
                        public_url,
                        size_bytes,
                        created_at,
                        expires_at
                    FROM simulation_artifacts
                    WHERE simulation_run_id = :run_id
                    ORDER BY created_at DESC
                    """
                ),
                {
                    "run_id": run_id,
                },
            ).mappings()

            return {
                "database_configured": True,
                "item": serialize_run_detail(
                    run,
                    antennas,
                    artifacts,
                ),
            }

    except SQLAlchemyError:
        logger.exception("Failed to load simulation run.")
        return {
            "database_configured": True,
            "item": None,
            "error": "Failed to load simulation detail.",
        }


def delete_simulation_run(run_id):
    if not is_database_configured():
        return {
            "database_configured": False,
            "deleted": False,
        }

    try:
        with db_session() as session:
            artifacts = session.execute(
                text(
                    """
                    SELECT
                        file_path,
                        public_url
                    FROM simulation_artifacts
                    WHERE simulation_run_id = :run_id
                    """
                ),
                {
                    "run_id": run_id,
                },
            ).mappings().all()

            deleted = session.execute(
                text(
                    """
                    DELETE FROM simulation_runs
                    WHERE id = :run_id
                    RETURNING id
                    """
                ),
                {
                    "run_id": run_id,
                },
            ).first()

        if deleted is None:
            return {
                "database_configured": True,
                "deleted": False,
            }

        deleted_files = delete_artifact_files(artifacts)

        return {
            "database_configured": True,
            "deleted": True,
            "deleted_files": deleted_files,
        }

    except SQLAlchemyError:
        logger.exception("Failed to delete simulation run.")
        return {
            "database_configured": True,
            "deleted": False,
            "error": "Failed to delete simulation history.",
        }


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
                coverage_map_image_url,
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
                :coverage_map_image_url,
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
            "coverage_map_image_url": result.get("coverage_map_image_url"),
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
    return safe_static_path(relative_name)


def static_file_path_from_stored_path(file_path):
    if not file_path:
        return None

    return safe_static_path(Path(file_path))


def safe_static_path(path):
    candidate = Path(path)
    if not candidate.is_absolute():
        candidate = STATIC_DIR / candidate

    try:
        resolved_static = STATIC_DIR.resolve()
        resolved_candidate = candidate.resolve()
        resolved_candidate.relative_to(resolved_static)
    except ValueError:
        return None

    return resolved_candidate


def delete_artifact_files(artifacts):
    deleted_files = 0

    for artifact in artifacts:
        path = (
            static_file_path_from_stored_path(artifact["file_path"])
            or static_file_path_from_url(artifact["public_url"])
        )

        if path is None or not path.exists() or not path.is_file():
            continue

        try:
            path.unlink()
        except OSError:
            logger.warning(
                "Failed to delete simulation artifact file: %s",
                path,
                exc_info=True,
            )
        else:
            deleted_files += 1

    return deleted_files


def serialize_run_summary(row):
    return {
        "id": str(row["id"]),
        "simulation_type": row["simulation_type"],
        "status": row["status"],
        "transmitter_pattern": row["transmitter_pattern"],
        "cell_size_m": row["cell_size_m"],
        "bandwidth_mhz": row["bandwidth_mhz"],
        "mimo_layers": row["mimo_layers"],
        "coverage_map_image_url": row["coverage_map_image_url"],
        "error_message": row["error_message"],
        "started_at": serialize_datetime(row["started_at"]),
        "finished_at": serialize_datetime(row["finished_at"]),
        "created_at": serialize_datetime(row["created_at"]),
    }


def serialize_run_detail(
    run,
    antennas,
    artifacts,
):
    return {
        **serialize_run_summary(run),
        "solver": {
            "max_depth": run["max_depth"],
            "samples_per_tx": run["samples_per_tx"],
            "cell_size_m": run["cell_size_m"],
            "center": [
                run["center_x_m"],
                run["center_y_m"],
                run["center_z_m"],
            ],
            "size": [
                run["size_x_m"],
                run["size_y_m"],
            ],
        },
        "request_json": normalize_json_value(run["request_json"]),
        "response_json": normalize_json_value(run["response_json"]),
        "antennas": [
            serialize_antenna_snapshot(row)
            for row in antennas
        ],
        "artifacts": [
            serialize_artifact(row)
            for row in artifacts
        ],
    }


def serialize_antenna_snapshot(row):
    return {
        "antenna_code": row["antenna_code"],
        "position": [
            row["x_m"],
            row["y_m"],
            row["z_m"],
        ],
        "azimuth_deg": row["azimuth_deg"],
        "tilt": {
            "min": row["tilt_min_deg"],
            "current": row["tilt_current_deg"],
            "max": row["tilt_max_deg"],
        },
        "tx_power": {
            "min": row["tx_power_min_dbm"],
            "current": row["tx_power_current_dbm"],
            "max": row["tx_power_max_dbm"],
        },
    }


def serialize_artifact(row):
    return {
        "artifact_type": row["artifact_type"],
        "file_path": row["file_path"],
        "public_url": row["public_url"],
        "size_bytes": row["size_bytes"],
        "created_at": serialize_datetime(row["created_at"]),
        "expires_at": serialize_datetime(row["expires_at"]),
    }


def serialize_datetime(value):
    if value is None:
        return None

    return value.isoformat()


def normalize_json_value(value):
    if isinstance(value, str):
        return json.loads(value)

    return value
