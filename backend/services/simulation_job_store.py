import logging
import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from sqlalchemy import delete
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from backend.constants import STATIC_DIR
from backend.database import db_session, is_database_configured
from backend.models import SimulationJob
from backend.schemas.requests import (
    CoverageRequest,
    NetworkCoverageRequest,
    RSRPRequest,
    SINRRequest,
    ThroughputRequest,
)
from backend.services.simulation_store import (
    delete_artifact_files,
    normalize_json_value,
    sanitize_json_value,
    serialize_datetime,
    should_store_full_result_artifact,
    static_file_path_from_url,
    store_simulation_result,
    summarize_response,
    to_json_string,
    utc_now,
)


logger = logging.getLogger(__name__)

REQUEST_MODELS = {
    "coverage_map": CoverageRequest,
    "network_coverage": NetworkCoverageRequest,
    "rsrp_simulation": RSRPRequest,
    "sinr": SINRRequest,
    "throughput_comparison": ThroughputRequest,
}

JOB_RESULT_DIR_NAME = "simulation-job-results"


def create_simulation_job(
    simulation_type,
    req,
    scene_info,
    base_url=None,
    created_by=None,
):
    if not is_database_configured():
        return None

    job_id = str(uuid4())

    with db_session() as session:
        session.add(
            SimulationJob(
                id=job_id,
                simulation_type=simulation_type,
                status="queued",
                scene_json=sanitize_json_value(scene_info or {}),
                request_json=normalize_json_value(to_json_string(req)),
                base_url=base_url,
                created_by=created_by,
            )
        )

    return job_id


def get_simulation_job(job_id):
    if not is_database_configured():
        return {
            "database_configured": False,
            "item": None,
        }

    try:
        with db_session() as session:
            row = session.get(SimulationJob, job_id)

            return {
                "database_configured": True,
                "item": serialize_job(row) if row else None,
            }

    except SQLAlchemyError:
        logger.exception("Failed to load simulation job.")
        return {
            "database_configured": True,
            "item": None,
            "error": "Failed to load simulation job.",
        }


def list_simulation_jobs(limit=100):
    if not is_database_configured():
        return {
            "database_configured": False,
            "items": [],
        }

    try:
        with db_session() as session:
            rows = session.scalars(
                select(SimulationJob)
                .order_by(SimulationJob.queued_at.desc())
                .limit(limit)
            )

            return {
                "database_configured": True,
                "items": [
                    serialize_job(row)
                    for row in rows
                ],
            }

    except SQLAlchemyError:
        logger.exception("Failed to list simulation jobs.")
        return {
            "database_configured": True,
            "items": [],
            "error": "Failed to load simulation queue.",
        }


def get_simulation_job_result(job_id):
    response = get_simulation_job(job_id)

    if not response.get("database_configured"):
        return {
            "database_configured": False,
            "result": None,
        }

    job = response.get("item")
    if job is None:
        return {
            "database_configured": True,
            "result": None,
            "not_found": not response.get("error"),
            "error": response.get("error"),
        }

    result = normalize_json_value(job.get("result")) or {}
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
            "error": "Queued simulation result file is unavailable.",
        }

    try:
        return {
            "database_configured": True,
            "result": json.loads(file_path.read_text(encoding="utf-8")),
        }
    except (OSError, json.JSONDecodeError):
        logger.exception("Failed to load queued simulation result: %s", file_path)
        return {
            "database_configured": True,
            "result": None,
            "error": "Failed to load queued simulation result.",
        }


def claim_next_simulation_job():
    if not is_database_configured():
        return None

    with db_session() as session:
        job = session.scalar(
            select(SimulationJob)
            .where(SimulationJob.status == "queued")
            .order_by(SimulationJob.queued_at)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if job is None:
            return None

        now = datetime.now(timezone.utc)
        job.status = "running"
        job.started_at = now
        job.updated_at = now
        job.attempts += 1
        session.flush()

        return {
            "id": job.id,
            "simulation_type": job.simulation_type,
            "scene_json": job.scene_json,
            "request_json": job.request_json,
            "base_url": job.base_url,
            "started_at": job.started_at,
        }


def mark_simulation_job_succeeded(job_id, result):
    update_simulation_job_finished(
        job_id,
        "succeeded",
        result=prepare_job_result(job_id, result),
    )


def mark_simulation_job_failed(job_id, error_message, result=None):
    update_simulation_job_finished(
        job_id,
        "failed",
        error_message=error_message,
        result=result,
    )


def update_simulation_job_finished(
    job_id,
    status,
    result=None,
    result_run_id=None,
    error_message=None,
):
    with db_session() as session:
        job = session.get(SimulationJob, job_id)
        if job is None:
            return

        now = datetime.now(timezone.utc)
        job.status = status
        job.result_json = sanitize_json_value(result) if result is not None else None
        job.result_run_id = result_run_id
        job.error_message = error_message
        job.finished_at = now
        job.updated_at = now


def save_simulation_job_result(job_id):
    response = get_simulation_job(job_id)

    if not response.get("database_configured"):
        return {
            "database_configured": False,
            "saved": False,
        }

    job = response.get("item")
    if job is None:
        return {
            "database_configured": True,
            "saved": False,
            "not_found": not response.get("error"),
            "error": response.get("error"),
        }

    if job.get("result_run_id"):
        return {
            "database_configured": True,
            "saved": True,
            "run_id": job["result_run_id"],
            "already_saved": True,
        }

    if job.get("status") != "succeeded":
        return {
            "database_configured": True,
            "saved": False,
            "error": "Only succeeded simulation jobs can be saved.",
            "status_code": 400,
        }

    result_response = get_simulation_job_result(job_id)
    if result_response.get("error") or result_response.get("result") is None:
        return {
            "database_configured": True,
            "saved": False,
            "error": result_response.get("error") or "Simulation job result not found.",
        }

    try:
        req = REQUEST_MODELS[job["simulation_type"]](**(job.get("request") or {}))
    except (KeyError, TypeError, ValueError):
        logger.exception("Failed to rebuild simulation request for job: %s", job_id)
        return {
            "database_configured": True,
            "saved": False,
            "error": "Failed to rebuild the simulation request.",
        }

    run_id = store_simulation_result(
        job["simulation_type"],
        req,
        result_response["result"],
        parse_datetime(job.get("started_at")) or parse_datetime(job.get("queued_at")) or utc_now(),
        parse_datetime(job.get("finished_at")) or utc_now(),
        scene_info=job.get("scene"),
    )

    if run_id is None:
        return {
            "database_configured": True,
            "saved": False,
            "error": "Simulation result could not be saved.",
        }

    with db_session() as session:
        row = session.get(SimulationJob, job_id)
        if row is not None:
            row.result_run_id = run_id
            row.updated_at = datetime.now(timezone.utc)

    return {
        "database_configured": True,
        "saved": True,
        "run_id": str(run_id),
    }


def delete_simulation_job(job_id):
    if not is_database_configured():
        return {
            "database_configured": False,
            "deleted": False,
        }

    try:
        with db_session() as session:
            job = session.get(SimulationJob, job_id)
            if job is None:
                return {
                    "database_configured": True,
                    "deleted": False,
                }

            if job.status == "running":
                return {
                    "database_configured": True,
                    "deleted": False,
                    "error": "Running simulation jobs cannot be deleted.",
                    "status_code": 400,
                }

            result_json = normalize_json_value(job.result_json) or {}
            result_run_id = job.result_run_id
            files_to_delete = job_result_artifacts_to_delete(
                result_json,
                saved=bool(result_run_id),
            )
            session.execute(delete(SimulationJob).where(SimulationJob.id == job_id))

        deleted_files = delete_artifact_files(files_to_delete)
        return {
            "database_configured": True,
            "deleted": True,
            "deleted_files": deleted_files,
            "result_run_id": str(result_run_id) if result_run_id else None,
        }

    except SQLAlchemyError:
        logger.exception("Failed to delete simulation job.")
        return {
            "database_configured": True,
            "deleted": False,
            "error": "Failed to delete simulation job.",
        }


def prepare_job_result(job_id, result):
    summary = summarize_response(sanitize_json_value(result))

    if not should_store_full_result_artifact(result):
        return summary

    artifact_dir = STATIC_DIR / JOB_RESULT_DIR_NAME
    artifact_dir.mkdir(
        parents=True,
        exist_ok=True,
    )
    relative_path = Path(JOB_RESULT_DIR_NAME) / f"{job_id}.json"
    file_path = STATIC_DIR / relative_path

    try:
        file_path.write_text(
            to_json_string(result),
            encoding="utf-8",
        )
    except OSError:
        logger.warning(
            "Failed to write queued simulation result artifact: %s",
            file_path,
            exc_info=True,
        )
        return summary

    summary["full_result_url"] = f"/static/{relative_path.as_posix()}"
    summary["full_result_size_bytes"] = file_path.stat().st_size
    return summary


def job_result_artifacts_to_delete(result_json, saved=False):
    artifacts = []
    full_result_url = result_json.get("full_result_url")

    if full_result_url and is_job_result_url(full_result_url):
        artifacts.append({
            "file_path": "",
            "public_url": full_result_url,
        })

    if saved:
        return artifacts

    coverage_map_url = result_json.get("coverage_map_image_url")
    if coverage_map_url:
        artifacts.append({
            "file_path": "",
            "public_url": coverage_map_url,
        })

    return artifacts


def is_job_result_url(url):
    file_path = static_file_path_from_url(url)

    if file_path is None:
        return False

    try:
        file_path.relative_to((STATIC_DIR / JOB_RESULT_DIR_NAME).resolve())
    except ValueError:
        return False

    return True


def parse_datetime(value):
    if not value:
        return None

    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def row_value(row, name):
    if isinstance(row, dict):
        return row[name]
    return getattr(row, name)


def serialize_job(row):
    if row is None:
        return None

    return {
        "id": str(row_value(row, "id")),
        "simulation_type": row_value(row, "simulation_type"),
        "status": row_value(row, "status"),
        "scene": normalize_json_value(row_value(row, "scene_json")),
        "request": normalize_json_value(row_value(row, "request_json")),
        "result": normalize_json_value(row_value(row, "result_json")),
        "result_run_id": str(row_value(row, "result_run_id"))
        if row_value(row, "result_run_id")
        else None,
        "error_message": row_value(row, "error_message"),
        "attempts": row_value(row, "attempts"),
        "queued_at": serialize_datetime(row_value(row, "queued_at")),
        "started_at": serialize_datetime(row_value(row, "started_at")),
        "finished_at": serialize_datetime(row_value(row, "finished_at")),
        "updated_at": serialize_datetime(row_value(row, "updated_at")),
    }
