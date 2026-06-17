import json
import logging
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from backend.database import db_session, is_database_configured
from backend.services.simulation_store import (
    normalize_json_value,
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
        session.execute(
            text(
                """
                INSERT INTO simulation_jobs (
                    id,
                    simulation_type,
                    status,
                    scene_json,
                    request_json,
                    base_url,
                    created_by
                )
                VALUES (
                    :id,
                    :simulation_type,
                    'queued',
                    CAST(:scene_json AS JSONB),
                    CAST(:request_json AS JSONB),
                    :base_url,
                    :created_by
                )
                """
            ),
            {
                "id": job_id,
                "simulation_type": simulation_type,
                "scene_json": json.dumps(scene_info or {}, default=str),
                "request_json": to_json_string(req),
                "base_url": base_url,
                "created_by": created_by,
            },
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
            row = session.execute(
                text(
                    """
                    SELECT
                        id,
                        simulation_type,
                        status,
                        scene_json,
                        request_json,
                        result_json,
                        result_run_id,
                        error_message,
                        attempts,
                        queued_at,
                        started_at,
                        finished_at,
                        updated_at
                    FROM simulation_jobs
                    WHERE id = :job_id
                    """
                ),
                {
                    "job_id": job_id,
                },
            ).mappings().first()

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
        row = session.execute(
            text(
                """
                WITH next_job AS (
                    SELECT id
                    FROM simulation_jobs
                    WHERE status = 'queued'
                    ORDER BY queued_at
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
                UPDATE simulation_jobs
                SET
                    status = 'running',
                    started_at = now(),
                    updated_at = now(),
                    attempts = attempts + 1
                WHERE id = (
                    SELECT id
                    FROM next_job
                )
                RETURNING
                    id,
                    simulation_type,
                    scene_json,
                    request_json,
                    base_url,
                    started_at
                """
            )
        ).mappings().first()

        return dict(row) if row else None


def mark_simulation_job_succeeded(job_id, result, result_run_id=None):
    update_simulation_job_finished(
        job_id,
        "succeeded",
        result=result,
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
        session.execute(
            text(
                """
                UPDATE simulation_jobs
                SET
                    status = :status,
                    result_json = CAST(:result_json AS JSONB),
                    result_run_id = :result_run_id,
                    error_message = :error_message,
                    finished_at = now(),
                    updated_at = now()
                WHERE id = :job_id
                """
            ),
            {
                "job_id": job_id,
                "status": status,
                "result_json": json.dumps(result, allow_nan=False, default=str)
                if result is not None
                else None,
                "result_run_id": result_run_id,
                "error_message": error_message,
            },
        )
def serialize_job(row):
    if row is None:
        return None

    return {
        "id": str(row["id"]),
        "simulation_type": row["simulation_type"],
        "status": row["status"],
        "scene": normalize_json_value(row["scene_json"]),
        "request": normalize_json_value(row["request_json"]),
        "result": normalize_json_value(row["result_json"]),
        "result_run_id": str(row["result_run_id"]) if row["result_run_id"] else None,
        "error_message": row["error_message"],
        "attempts": row["attempts"],
        "queued_at": serialize_datetime(row["queued_at"]),
        "started_at": serialize_datetime(row["started_at"]),
        "finished_at": serialize_datetime(row["finished_at"]),
        "updated_at": serialize_datetime(row["updated_at"]),
    }
