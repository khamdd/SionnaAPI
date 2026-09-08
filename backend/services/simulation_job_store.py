import logging
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from sqlalchemy import delete, or_, select
from sqlalchemy.exc import SQLAlchemyError

from backend.constants import STATIC_DIR
from backend.core.config import get_simulation_job_settings
from backend.database import db_session, is_database_configured
from backend.models import ImpactStudy, SimulationJob
from backend.schemas.requests import (
    CoverageRequest,
    NetworkCoverageRequest,
    NetworkCoverageOptimizationRequest,
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
    "network_coverage_optimization": NetworkCoverageOptimizationRequest,
    "coverage_map": CoverageRequest,
    "network_coverage": NetworkCoverageRequest,
    "rsrp_simulation": RSRPRequest,
    "sinr": SINRRequest,
    "throughput_comparison": ThroughputRequest,
}

JOB_RESULT_DIR_NAME = "simulation-job-results"
TERMINAL_JOB_STATUSES = {"succeeded", "failed", "cancelled"}


def create_simulation_job(
    simulation_type,
    req,
    scene_info,
    base_url=None,
    created_by=None,
    max_attempts=None,
    priority=0,
):
    if not is_database_configured():
        return None

    with db_session() as session:
        job_id = add_simulation_job(
            session,
            simulation_type,
            req,
            scene_info,
            base_url=base_url,
            created_by=created_by,
            max_attempts=max_attempts,
            priority=priority,
        )

    return job_id


def add_simulation_job(
    session,
    simulation_type,
    req,
    scene_info,
    base_url=None,
    created_by=None,
    impact_study_id=None,
    simulation_profile_id=None,
    scenario_role=None,
    input_signature=None,
    max_attempts=None,
    priority=0,
):
    """Add a queued job to an existing transaction and return its ID."""
    job_id = str(uuid4())
    if max_attempts is None:
        max_attempts = get_simulation_job_settings().max_attempts
    session.add(
        SimulationJob(
            id=job_id,
            simulation_type=simulation_type,
            status="queued",
            scene_json=sanitize_json_value(scene_info or {}),
            request_json=normalize_json_value(to_json_string(req)),
            base_url=base_url,
            created_by=created_by,
            impact_study_id=impact_study_id,
            simulation_profile_id=simulation_profile_id,
            scenario_role=scenario_role,
            input_signature=input_signature,
            max_attempts=max_attempts,
            priority=priority,
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


def claim_next_simulation_job(worker_id=None, lease_seconds=None):
    if not is_database_configured():
        return None

    settings = get_simulation_job_settings()
    worker_id = worker_id or f"in-process-{uuid4()}"
    lease_seconds = lease_seconds or settings.lease_seconds
    with db_session() as session:
        now = datetime.now(timezone.utc)
        job = session.scalar(
            select(SimulationJob)
            .where(
                SimulationJob.status == "queued",
                SimulationJob.cancel_requested.is_(False),
                SimulationJob.attempts < SimulationJob.max_attempts,
                or_(
                    SimulationJob.next_attempt_at.is_(None),
                    SimulationJob.next_attempt_at <= now,
                ),
            )
            .order_by(SimulationJob.priority.desc(), SimulationJob.queued_at)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if job is None:
            return None

        job.status = "running"
        job.started_at = now
        job.updated_at = now
        job.attempts += 1
        job.worker_id = worker_id
        job.heartbeat_at = now
        job.lease_expires_at = now + timedelta(seconds=lease_seconds)
        job.next_attempt_at = None
        job.failure_type = None
        if job.impact_study_id:
            study = session.get(ImpactStudy, job.impact_study_id)
            if study is not None and study.status == "queued":
                study.status = "running"
        session.flush()

        return {
            "id": job.id,
            "simulation_type": job.simulation_type,
            "scene_json": job.scene_json,
            "request_json": job.request_json,
            "base_url": job.base_url,
            "started_at": job.started_at,
            "attempts": job.attempts,
            "max_attempts": job.max_attempts,
            "worker_id": job.worker_id,
            "lease_expires_at": job.lease_expires_at,
        }


def heartbeat_simulation_job(job_id, worker_id, lease_seconds=None):
    settings = get_simulation_job_settings()
    lease_seconds = lease_seconds or settings.lease_seconds
    with db_session() as session:
        row = session.get(SimulationJob, job_id)
        if (
            row is None
            or row.status != "running"
            or row.worker_id != worker_id
        ):
            return False
        now = datetime.now(timezone.utc)
        row.heartbeat_at = now
        row.lease_expires_at = now + timedelta(seconds=lease_seconds)
        row.updated_at = now
        return True


def is_simulation_job_cancel_requested(job_id, worker_id=None):
    with db_session() as session:
        row = session.get(SimulationJob, job_id)
        if row is None or row.status != "running":
            return True
        if worker_id is not None and row.worker_id != worker_id:
            return True
        return bool(row.cancel_requested)


def request_simulation_job_cancellation(job_id):
    if not is_database_configured():
        return {"database_configured": False, "cancelled": False}

    impact_study_id = None
    try:
        with db_session() as session:
            row = session.scalar(
                select(SimulationJob)
                .where(SimulationJob.id == job_id)
                .with_for_update()
            )
            if row is None:
                return {
                    "database_configured": True,
                    "cancelled": False,
                    "not_found": True,
                }

            impact_study_id = row.impact_study_id
            now = datetime.now(timezone.utc)
            if row.status == "queued":
                row.status = "cancelled"
                row.cancel_requested = True
                row.failure_type = "cancelled"
                row.finished_at = now
            elif row.status == "running":
                row.cancel_requested = True
            row.updated_at = now
            session.flush()
            response = {
                "database_configured": True,
                "cancelled": row.status == "cancelled",
                "cancel_requested": bool(row.cancel_requested),
                "item": serialize_job(row),
            }
    except SQLAlchemyError:
        logger.exception("Failed to request simulation job cancellation.")
        return {
            "database_configured": True,
            "cancelled": False,
            "error": "Failed to cancel simulation job.",
        }

    _reconcile_impact_studies({impact_study_id} if impact_study_id else set())
    return response


def recover_expired_simulation_jobs(now=None):
    if not is_database_configured():
        return 0

    now = now or datetime.now(timezone.utc)
    impact_study_ids = set()
    with db_session() as session:
        rows = session.scalars(
            select(SimulationJob)
            .where(
                SimulationJob.status == "running",
                or_(
                    SimulationJob.lease_expires_at.is_(None),
                    SimulationJob.lease_expires_at < now,
                ),
            )
            .with_for_update(skip_locked=True)
        ).all()
        for row in rows:
            if row.impact_study_id:
                impact_study_ids.add(str(row.impact_study_id))
            row.worker_id = None
            row.heartbeat_at = None
            row.lease_expires_at = None
            row.updated_at = now
            if row.cancel_requested:
                row.status = "cancelled"
                row.failure_type = "cancelled"
                row.finished_at = now
            elif row.attempts >= row.max_attempts:
                row.status = "failed"
                row.failure_type = "worker_lost"
                row.error_message = "Worker lease expired after the final attempt."
                row.finished_at = now
            else:
                row.status = "queued"
                row.failure_type = "worker_lost"
                row.error_message = "Worker lease expired; job was queued for retry."
                row.next_attempt_at = now
                row.started_at = None
                row.finished_at = None

    _reconcile_impact_studies(impact_study_ids)
    return len(rows)


def update_optimization_progress(job_id, progress, worker_id=None):
    with db_session() as session:
        row = session.get(SimulationJob, job_id)
        if (
            row is not None
            and row.status == "running"
            and (worker_id is None or row.worker_id == worker_id)
        ):
            row.result_json = {"optimization_progress": progress}
            row.updated_at = datetime.now(timezone.utc)


def mark_simulation_job_succeeded(job_id, result, worker_id=None):
    kwargs = {"result": prepare_job_result(job_id, result)}
    if worker_id is not None:
        kwargs["worker_id"] = worker_id
    return update_simulation_job_finished(job_id, "succeeded", **kwargs)


def mark_simulation_job_failed(
    job_id,
    error_message,
    result=None,
    failure_type="permanent",
    worker_id=None,
):
    return update_simulation_job_finished(
        job_id,
        "failed",
        error_message=error_message,
        result=result,
        failure_type=failure_type,
        worker_id=worker_id,
    )


def mark_simulation_job_cancelled(job_id, worker_id=None):
    return update_simulation_job_finished(
        job_id,
        "cancelled",
        error_message="Simulation job was cancelled.",
        failure_type="cancelled",
        worker_id=worker_id,
    )


def handle_simulation_job_failure(
    job_id,
    error_message,
    failure_type,
    retryable,
    result=None,
    worker_id=None,
):
    settings = get_simulation_job_settings()
    impact_study_id = None
    with db_session() as session:
        job = session.scalar(
            select(SimulationJob)
            .where(SimulationJob.id == job_id)
            .with_for_update()
        )
        if not _worker_can_update(job, worker_id):
            return {"updated": False}

        impact_study_id = job.impact_study_id
        now = datetime.now(timezone.utc)
        job.result_json = sanitize_json_value(result) if result is not None else None
        job.error_message = error_message
        job.failure_type = failure_type
        job.updated_at = now
        job.worker_id = None
        job.heartbeat_at = None
        job.lease_expires_at = None

        if job.cancel_requested:
            job.status = "cancelled"
            job.failure_type = "cancelled"
            job.finished_at = now
        elif retryable and job.attempts < job.max_attempts:
            delay = calculate_retry_delay_seconds(
                job.attempts,
                settings.retry_base_seconds,
                settings.retry_max_seconds,
            )
            job.status = "queued"
            job.next_attempt_at = now + timedelta(seconds=delay)
            job.started_at = None
            job.finished_at = None
        else:
            job.status = "failed"
            job.finished_at = now
        final_status = job.status
        next_attempt_at = serialize_datetime(job.next_attempt_at)

    if final_status in TERMINAL_JOB_STATUSES:
        _reconcile_impact_studies(
            {str(impact_study_id)} if impact_study_id else set()
        )
    return {
        "updated": True,
        "status": final_status,
        "next_attempt_at": next_attempt_at,
    }


def update_simulation_job_finished(
    job_id,
    status,
    result=None,
    result_run_id=None,
    error_message=None,
    failure_type=None,
    worker_id=None,
):
    impact_study_id = None
    with db_session() as session:
        job = session.scalar(
            select(SimulationJob)
            .where(SimulationJob.id == job_id)
            .with_for_update()
        )
        if not _worker_can_update(job, worker_id):
            return False

        impact_study_id = job.impact_study_id
        now = datetime.now(timezone.utc)
        if job.cancel_requested and status != "cancelled":
            status = "cancelled"
            result = None
            result_run_id = None
            error_message = "Simulation job was cancelled."
            failure_type = "cancelled"
        job.status = status
        job.result_json = sanitize_json_value(result) if result is not None else None
        job.result_run_id = result_run_id
        job.error_message = error_message
        job.failure_type = failure_type
        job.worker_id = None
        job.heartbeat_at = None
        job.lease_expires_at = None
        job.next_attempt_at = None
        job.finished_at = now
        job.updated_at = now

    if impact_study_id:
        from backend.services.impact_study_service import reconcile_impact_study

        reconcile_impact_study(str(impact_study_id))
    return True


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

    saved_type = job["simulation_type"]
    if saved_type == "network_coverage_optimization":
        req = NetworkCoverageRequest(**result_response["result"]["optimization"]["best_request"])
        saved_type = "network_coverage"

    run_id = store_simulation_result(
        saved_type,
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
    temp_path = file_path.with_name(f".{file_path.name}.{uuid4()}.tmp")

    try:
        temp_path.write_text(
            to_json_string(result),
            encoding="utf-8",
        )
        temp_path.replace(file_path)
    except OSError:
        logger.warning(
            "Failed to write queued simulation result artifact: %s",
            file_path,
            exc_info=True,
        )
        return summary
    finally:
        temp_path.unlink(missing_ok=True)

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


def calculate_retry_delay_seconds(attempt, base_seconds=5, max_seconds=300):
    exponent = max(0, int(attempt) - 1)
    return min(int(max_seconds), int(base_seconds) * (2 ** exponent))


def _worker_can_update(job, worker_id):
    if job is None or job.status != "running":
        return False
    return worker_id is None or job.worker_id == worker_id


def _reconcile_impact_studies(study_ids):
    if not study_ids:
        return
    from backend.services.impact_study_service import reconcile_impact_study

    for study_id in study_ids:
        reconcile_impact_study(str(study_id))


def row_value(row, name):
    if isinstance(row, dict):
        return row[name]
    return getattr(row, name)


def optional_row_value(row, name, default=None):
    if isinstance(row, dict):
        return row.get(name, default)
    return getattr(row, name, default)


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
        "max_attempts": optional_row_value(row, "max_attempts", 1),
        "next_attempt_at": serialize_datetime(
            optional_row_value(row, "next_attempt_at")
        ),
        "worker_id": optional_row_value(row, "worker_id"),
        "heartbeat_at": serialize_datetime(optional_row_value(row, "heartbeat_at")),
        "lease_expires_at": serialize_datetime(
            optional_row_value(row, "lease_expires_at")
        ),
        "cancel_requested": bool(
            optional_row_value(row, "cancel_requested", False)
        ),
        "failure_type": optional_row_value(row, "failure_type"),
        "priority": optional_row_value(row, "priority", 0),
        "impact_study_id": str(optional_row_value(row, "impact_study_id"))
        if optional_row_value(row, "impact_study_id")
        else None,
        "simulation_profile_id": str(
            optional_row_value(row, "simulation_profile_id")
        )
        if optional_row_value(row, "simulation_profile_id")
        else None,
        "scenario_role": optional_row_value(row, "scenario_role"),
        "input_signature": optional_row_value(row, "input_signature"),
        "queued_at": serialize_datetime(row_value(row, "queued_at")),
        "started_at": serialize_datetime(row_value(row, "started_at")),
        "finished_at": serialize_datetime(row_value(row, "finished_at")),
        "updated_at": serialize_datetime(row_value(row, "updated_at")),
    }
