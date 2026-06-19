import logging
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from backend.database import db_session, is_database_configured
from backend.models import SimulationJob
from backend.services.simulation_store import (
    normalize_json_value,
    sanitize_json_value,
    serialize_datetime,
    to_json_string,
)


logger = logging.getLogger(__name__)


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


def mark_simulation_job_succeeded(job_id, result_run_id):
    update_simulation_job_finished(
        job_id,
        "succeeded",
        result_run_id=result_run_id,
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
