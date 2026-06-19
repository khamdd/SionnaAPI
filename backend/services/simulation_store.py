import json
import logging
import math
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import delete, func, inspect, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError

from backend.constants import (
    DEFAULT_SCENE_BOUNDS,
    DEFAULT_SCENE_ID,
    DEFAULT_SCENE_NAME,
    SCENE_REGISTRY_PATH,
    STATIC_DIR,
)
from backend.database import db_session, is_database_configured
from backend.models import (
    Scene,
    SimulationArtifact,
    SimulationJob,
    SimulationRun,
    SimulationRunAntenna,
)


logger = logging.getLogger(__name__)


def utc_now():
    return datetime.now(timezone.utc)


def store_simulation_result(
    simulation_type,
    req,
    result,
    started_at,
    finished_at,
    scene_info=None,
):
    if not is_database_configured():
        return None

    try:
        with db_session() as session:
            ensure_scene_reference(session, scene_info)
            run_id = insert_simulation_run(
                session,
                simulation_type,
                req,
                result,
                started_at,
                finished_at,
                scene_info,
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
            attach_full_result_file_if_heavy(
                session,
                run_id,
                result,
            )

            return run_id

    except (SQLAlchemyError, TypeError, ValueError):
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
            rows = session.scalars(
                select(SimulationRun)
                .order_by(SimulationRun.created_at.desc())
                .limit(limit)
            )

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
            area_box = func.box3d(SimulationRun.area_geom)
            run = session.execute(
                select(
                    SimulationRun.id,
                    SimulationRun.simulation_type,
                    SimulationRun.status,
                    SimulationRun.transmitter_pattern,
                    SimulationRun.scene_id,
                    SimulationRun.max_depth,
                    SimulationRun.samples_per_tx,
                    SimulationRun.cell_size_m,
                    func.ST_X(SimulationRun.center_position).label("center_x_m"),
                    func.ST_Y(SimulationRun.center_position).label("center_y_m"),
                    func.ST_Z(SimulationRun.center_position).label("center_z_m"),
                    (
                        func.ST_XMax(area_box) - func.ST_XMin(area_box)
                    ).label("size_x_m"),
                    (
                        func.ST_YMax(area_box) - func.ST_YMin(area_box)
                    ).label("size_y_m"),
                    SimulationRun.bandwidth_mhz,
                    SimulationRun.mimo_layers,
                    SimulationRun.request_json,
                    SimulationRun.response_json,
                    SimulationRun.coverage_map_image_url,
                    SimulationRun.error_message,
                    SimulationRun.started_at,
                    SimulationRun.finished_at,
                    SimulationRun.created_at,
                ).where(SimulationRun.id == run_id)
            ).mappings().first()

            if run is None:
                return {
                    "database_configured": True,
                    "item": None,
                }

            antennas = session.execute(
                select(
                    SimulationRunAntenna.antenna_code,
                    func.ST_X(SimulationRunAntenna.scene_position).label("x_m"),
                    func.ST_Y(SimulationRunAntenna.scene_position).label("y_m"),
                    func.ST_Z(SimulationRunAntenna.scene_position).label("z_m"),
                    SimulationRunAntenna.azimuth_deg,
                    SimulationRunAntenna.tilt_min_deg,
                    SimulationRunAntenna.tilt_current_deg,
                    SimulationRunAntenna.tilt_max_deg,
                    SimulationRunAntenna.tx_power_min_dbm,
                    SimulationRunAntenna.tx_power_current_dbm,
                    SimulationRunAntenna.tx_power_max_dbm,
                )
                .where(SimulationRunAntenna.simulation_run_id == run_id)
                .order_by(SimulationRunAntenna.antenna_code)
            ).mappings()

            artifacts = session.scalars(
                select(SimulationArtifact)
                .where(SimulationArtifact.simulation_run_id == run_id)
                .order_by(SimulationArtifact.created_at.desc())
            )

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


def get_simulation_run_result(run_id):
    if not is_database_configured():
        return {
            "database_configured": False,
            "result": None,
        }

    try:
        with db_session() as session:
            run = session.get(SimulationRun, run_id)
            if run is None:
                return {
                    "database_configured": True,
                    "result": None,
                }
            response_json = run.response_json

        result = normalize_json_value(response_json) or {}
        full_result_url = result.get("full_result_url")

        if not full_result_url:
            return {
                "database_configured": True,
                "result": result,
            }

        file_path = static_file_path_from_url(full_result_url)
        if file_path is None or not file_path.is_file():
            return {
                "database_configured": True,
                "result": None,
                "error": "Saved simulation result file is unavailable.",
            }

        try:
            full_result = json.loads(file_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            logger.exception(
                "Failed to load full simulation result: %s",
                file_path,
            )
            return {
                "database_configured": True,
                "result": None,
                "error": "Failed to load saved simulation result.",
            }

        return {
            "database_configured": True,
            "result": full_result,
        }

    except SQLAlchemyError:
        logger.exception("Failed to load simulation result.")
        return {
            "database_configured": True,
            "result": None,
            "error": "Failed to load saved simulation result.",
        }


def delete_simulation_run(run_id):
    if not is_database_configured():
        return {
            "database_configured": False,
            "deleted": False,
        }

    try:
        with db_session() as session:
            run = session.get(SimulationRun, run_id)

            if run is None:
                return {
                    "database_configured": True,
                    "deleted": False,
                }

            artifacts = session.scalars(
                select(SimulationArtifact).where(
                    SimulationArtifact.simulation_run_id == run_id
                )
            ).all()
            files_to_delete = [
                {
                    "file_path": artifact.file_path,
                    "public_url": artifact.public_url,
                }
                for artifact in artifacts
            ]
            response_json = normalize_json_value(run.response_json) or {}
            full_result_url = response_json.get("full_result_url")

            if full_result_url:
                files_to_delete.append(
                    {
                        "file_path": "",
                        "public_url": full_result_url,
                    }
                )

            deleted_jobs = session.execute(
                delete(SimulationJob).where(SimulationJob.result_run_id == run_id)
            ).rowcount
            session.delete(run)

        deleted_files = delete_artifact_files(files_to_delete)

        return {
            "database_configured": True,
            "deleted": True,
            "deleted_files": deleted_files,
            "deleted_jobs": deleted_jobs,
        }

    except SQLAlchemyError:
        logger.exception("Failed to delete simulation run.")
        return {
            "database_configured": True,
            "deleted": False,
            "error": "Failed to delete simulation history.",
        }


def ensure_scene_reference(session, scene_info=None):
    """Keep only the minimal scene reference required by simulation history.

    Full scene metadata and local asset paths intentionally live in
    static/scenes/scenes.json. The PostgreSQL scenes row is only an ID/name
    catalog entry used by the simulation_runs.scene_id foreign key.
    """
    scene_info = scene_info or {}
    if not inspect(session.bind).has_table(Scene.__tablename__):
        return

    scene_id = scene_info.get("id", DEFAULT_SCENE_ID)
    scene_name = scene_info.get("name") or (
        DEFAULT_SCENE_NAME if scene_id == DEFAULT_SCENE_ID else scene_id
    )

    statement = insert(Scene).values(id=scene_id, name=scene_name)
    session.execute(
        statement.on_conflict_do_update(
            index_elements=[Scene.id],
            set_={"name": statement.excluded.name},
        )
    )


def mark_scene_reference_deleted(scene_id):
    """Keep historical scene references, but mark removed scenes as deleted."""
    if not is_database_configured():
        return {
            "database_configured": False,
            "updated": False,
        }

    try:
        with db_session() as session:
            if not inspect(session.bind).has_table(Scene.__tablename__):
                return {
                    "database_configured": True,
                    "updated": False,
                }

            scene = session.get(Scene, scene_id)
            if scene is not None:
                scene.status = "deleted"
                scene.updated_at = func.now()

        return {
            "database_configured": True,
            "updated": scene is not None,
        }
    except SQLAlchemyError:
        logger.exception("Failed to mark scene reference as deleted.")
        return {
            "database_configured": True,
            "updated": False,
            "error": "Failed to update the scene status in the database.",
        }


def insert_simulation_run(
    session,
    simulation_type,
    req,
    result,
    started_at,
    finished_at,
    scene_info=None,
):
    solver = req.solver
    status = normalize_status(result)
    scene_info = scene_info or {}

    run = SimulationRun(
        simulation_type=simulation_type,
        status=status,
        transmitter_pattern=req.transmitter_pattern,
        scene_id=scene_info.get("id", DEFAULT_SCENE_ID),
        max_depth=solver.max_depth,
        samples_per_tx=solver.samples_per_tx,
        cell_size_m=solver.cell_size,
        center_position=func.ST_SetSRID(func.ST_MakePoint(*solver.center), 0),
        area_geom=func.ST_MakeEnvelope(
            solver.center[0] - solver.size[0] / 2.0,
            solver.center[1] - solver.size[1] / 2.0,
            solver.center[0] + solver.size[0] / 2.0,
            solver.center[1] + solver.size[1] / 2.0,
            0,
        ),
        bandwidth_mhz=getattr(req, "bandwidth_mhz", None),
        mimo_layers=getattr(req, "mimo_layers", None),
        request_json=normalize_json_value(to_json_string(req)),
        response_json=summarize_response(sanitize_json_value(result)),
        coverage_map_image_url=result.get("coverage_map_image_url"),
        error_message=result.get("error"),
        started_at=started_at,
        finished_at=finished_at,
    )
    session.add(run)
    session.flush()

    return run.id


def insert_network_antenna_snapshots(
    session,
    run_id,
    req,
):
    for antenna in req.antennas:
        session.add(
            SimulationRunAntenna(
                simulation_run_id=run_id,
                antenna_id=None,
                antenna_code=antenna.id,
                scene_position=func.ST_SetSRID(
                    func.ST_MakePoint(*antenna.position),
                    0,
                ),
                azimuth_deg=antenna.azimuth,
                tilt_min_deg=antenna.tilt.min,
                tilt_current_deg=antenna.tilt.current,
                tilt_max_deg=antenna.tilt.max,
                tx_power_min_dbm=antenna.tx_power.min,
                tx_power_current_dbm=antenna.tx_power.current,
                tx_power_max_dbm=antenna.tx_power.max,
            )
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

    session.add(
        SimulationArtifact(
            simulation_run_id=run_id,
            artifact_type="coverage_png",
            file_path=str(file_path) if file_path else "",
            public_url=url,
            size_bytes=file_path.stat().st_size
            if file_path and file_path.exists()
            else None,
        )
    )


def attach_full_result_file_if_heavy(
    session,
    run_id,
    result,
):
    if not should_store_full_result_artifact(result):
        return None

    artifact_dir = STATIC_DIR / "simulation-results"
    artifact_dir.mkdir(
        parents=True,
        exist_ok=True,
    )
    relative_path = Path("simulation-results") / f"{run_id}.json"
    file_path = STATIC_DIR / relative_path

    try:
        file_path.write_text(
            to_json_string(result),
            encoding="utf-8",
        )
    except OSError:
        logger.warning(
            "Failed to write full simulation result artifact: %s",
            file_path,
            exc_info=True,
        )
        return None

    public_url = f"/static/{relative_path.as_posix()}"
    run = session.get(SimulationRun, run_id)
    if run is None:
        file_path.unlink(missing_ok=True)
        return None

    response_json = dict(run.response_json or {})
    response_json["full_result_url"] = public_url
    response_json["full_result_size_bytes"] = file_path.stat().st_size
    run.response_json = response_json
    return public_url


def should_store_full_result_artifact(result):
    grid = result.get("grid")

    if isinstance(grid, dict) and isinstance(grid.get("cells"), list):
        return len(grid["cells"]) > 0

    users = result.get("users")

    return isinstance(users, list) and len(users) > 0


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
            key: value
            for key, value in grid.items()
            if key != "cells"
        }
        summary["grid"]["cell_count"] = grid.get("cell_count") or len(cells)

    users = summary.get("users")

    if isinstance(users, list):
        summary["users"] = {
            "count": len(users),
        }

    return summary


def to_json_string(value):
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")

    return json.dumps(
        sanitize_json_value(value),
        allow_nan=False,
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
    scene_id = row_value(row, "scene_id")
    scene_info = resolve_scene_info(scene_id)

    return {
        "id": str(row_value(row, "id")),
        "simulation_type": row_value(row, "simulation_type"),
        "status": row_value(row, "status"),
        "transmitter_pattern": row_value(row, "transmitter_pattern"),
        "scene_id": scene_id,
        "scene_name": scene_info["name"],
        "scene_bounds": scene_info["bounds"],
        "cell_size_m": row_value(row, "cell_size_m"),
        "bandwidth_mhz": row_value(row, "bandwidth_mhz"),
        "mimo_layers": row_value(row, "mimo_layers"),
        "coverage_map_image_url": row_value(row, "coverage_map_image_url"),
        "error_message": row_value(row, "error_message"),
        "started_at": serialize_datetime(row_value(row, "started_at")),
        "finished_at": serialize_datetime(row_value(row, "finished_at")),
        "created_at": serialize_datetime(row_value(row, "created_at")),
    }


def serialize_run_detail(
    run,
    antennas,
    artifacts,
):
    return {
        **serialize_run_summary(run),
        "solver": {
            "max_depth": row_value(run, "max_depth"),
            "samples_per_tx": row_value(run, "samples_per_tx"),
            "cell_size_m": row_value(run, "cell_size_m"),
            "center": [
                row_value(run, "center_x_m"),
                row_value(run, "center_y_m"),
                row_value(run, "center_z_m"),
            ],
            "size": [
                row_value(run, "size_x_m"),
                row_value(run, "size_y_m"),
            ],
        },
        "request_json": normalize_json_value(row_value(run, "request_json")),
        "response_json": normalize_json_value(row_value(run, "response_json")),
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
        "artifact_type": row_value(row, "artifact_type"),
        "file_path": row_value(row, "file_path"),
        "public_url": row_value(row, "public_url"),
        "size_bytes": row_value(row, "size_bytes"),
        "created_at": serialize_datetime(row_value(row, "created_at")),
        "expires_at": serialize_datetime(row_value(row, "expires_at")),
    }


def row_value(row, name):
    if isinstance(row, dict):
        return row[name]
    try:
        return row[name]
    except (KeyError, TypeError):
        return getattr(row, name)


def serialize_datetime(value):
    if value is None:
        return None

    return value.isoformat()


def normalize_json_value(value):
    if value is None:
        return None

    if isinstance(value, str):
        return json.loads(value)

    return value


def sanitize_json_value(value):
    if isinstance(value, float):
        return value if math.isfinite(value) else None

    if isinstance(value, dict):
        return {
            key: sanitize_json_value(item)
            for key, item in value.items()
        }

    if isinstance(value, (list, tuple)):
        return [
            sanitize_json_value(item)
            for item in value
        ]

    return value


def resolve_scene_info(scene_id):
    fallback = {
        "name": DEFAULT_SCENE_NAME if scene_id == DEFAULT_SCENE_ID else scene_id,
        "bounds": DEFAULT_SCENE_BOUNDS if scene_id == DEFAULT_SCENE_ID else None,
    }

    if not scene_id or not SCENE_REGISTRY_PATH.exists():
        return fallback

    try:
        registry = json.loads(SCENE_REGISTRY_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback

    for scene in registry.get("scenes", []):
        if scene.get("id") == scene_id:
            return {
                "name": scene.get("name") or fallback["name"],
                "bounds": scene.get("bounds") or fallback["bounds"],
            }

    return fallback
