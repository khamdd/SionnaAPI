import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any, Iterable
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from backend.database import db_session, is_database_configured
from backend.models import ImpactStudy, SimulationJob
from backend.schemas.impact_studies import ImpactStudyCreateRequest
from backend.services import impact_planner
from backend.services.scene_service import list_scenes
from backend.services.simulation_job_store import add_simulation_job, serialize_job
from backend.services.simulation_store import (
    normalize_json_value,
    sanitize_json_value,
    serialize_datetime,
)


logger = logging.getLogger(__name__)

TERMINAL_STUDY_STATUSES = {
    "completed",
    "completed_with_failures",
    "cancelled",
    "failed",
}
TERMINAL_JOB_STATUSES = {"succeeded", "failed", "cancelled"}


def create_impact_study(
    request: ImpactStudyCreateRequest,
    created_by: str,
) -> dict:
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable

    plan = impact_planner.preview_configuration_impact(
        str(request.baseline_configuration_id),
        str(request.candidate_configuration_id),
        user_id=created_by,
    )
    if _is_failure(plan):
        return plan

    try:
        with db_session() as session:
            study = ImpactStudy(
                id=str(uuid4()),
                scene_id=plan["scene_id"],
                baseline_configuration_id=str(request.baseline_configuration_id),
                candidate_configuration_id=str(request.candidate_configuration_id),
                policy_version=plan["policy_version"],
                status="planned",
                difference_json=sanitize_json_value(plan.get("difference") or {}),
                execution_plan_json=sanitize_json_value(plan),
                created_by=created_by,
            )
            session.add(study)
            session.flush()
            session.refresh(study)
            return {
                "status": "success",
                "study": serialize_impact_study(study, []),
            }
    except (IntegrityError, SQLAlchemyError):
        logger.exception("Failed to create impact study.")
        return _failure(500, "Failed to create impact study.")


def list_impact_studies(
    user_id: str,
    scene_id: str | None = None,
    status: str | None = None,
    limit: int = 100,
) -> dict:
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable

    try:
        with db_session() as session:
            statement = select(ImpactStudy).where(ImpactStudy.created_by == user_id)
            if scene_id:
                statement = statement.where(ImpactStudy.scene_id == scene_id)
            if status:
                statement = statement.where(ImpactStudy.status == status)

            studies = session.scalars(
                statement.order_by(ImpactStudy.created_at.desc()).limit(limit)
            ).all()
            items = []
            for study in studies:
                jobs = _load_study_jobs(session, study.id)
                _reconcile_study(study, jobs)
                items.append(serialize_impact_study(study, jobs))
            return {"status": "success", "items": items}
    except SQLAlchemyError:
        logger.exception("Failed to list impact studies.")
        return _failure(500, "Failed to list impact studies.")


def get_impact_study(study_id: str, user_id: str) -> dict:
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable

    try:
        with db_session() as session:
            study = session.get(ImpactStudy, study_id)
            if study is None or study.created_by != user_id:
                return _failure(404, "Impact study was not found.")
            jobs = _load_study_jobs(session, study.id)
            _reconcile_study(study, jobs)
            return {
                "status": "success",
                "study": serialize_impact_study(study, jobs),
            }
    except SQLAlchemyError:
        logger.exception("Failed to load impact study.")
        return _failure(500, "Failed to load impact study.")


def start_impact_study(study_id: str, user_id: str) -> dict:
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable

    try:
        with db_session() as session:
            study = session.scalar(
                select(ImpactStudy)
                .where(ImpactStudy.id == study_id)
                .with_for_update()
            )
            if study is None or study.created_by != user_id:
                return _failure(404, "Impact study was not found.")

            jobs = _load_study_jobs(session, study.id)
            if study.status != "planned" or jobs:
                _reconcile_study(study, jobs)
                return {
                    "status": "success",
                    "already_started": True,
                    "study": serialize_impact_study(study, jobs),
                }

            scene_info = _find_ready_scene(study.scene_id)
            if scene_info is None:
                return _failure(404, "The impact study scene was not found or ready.")

            specs = build_child_job_specs(
                study.execution_plan_json,
                scene_info,
            )
            now = datetime.now(timezone.utc)
            for spec in specs:
                add_simulation_job(
                    session,
                    spec["simulation_type"],
                    spec["request"],
                    scene_info,
                    created_by=user_id,
                    impact_study_id=study.id,
                    simulation_profile_id=spec["simulation_profile_id"],
                    scenario_role=spec["scenario_role"],
                    input_signature=spec["input_signature"],
                )

            study.started_at = now
            if specs:
                study.status = "queued"
            else:
                study.status = "completed"
                study.finished_at = now
                study.summary_json = build_child_job_summary([])
            session.flush()
            jobs = _load_study_jobs(session, study.id)
            return {
                "status": "success",
                "already_started": False,
                "study": serialize_impact_study(study, jobs),
            }
    except IntegrityError:
        logger.exception("Impact study jobs already exist.")
        return _failure(409, "Impact study has already been started.")
    except SQLAlchemyError:
        logger.exception("Failed to start impact study.")
        return _failure(500, "Failed to start impact study.")


def cancel_impact_study(study_id: str, user_id: str) -> dict:
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable

    try:
        with db_session() as session:
            study = session.scalar(
                select(ImpactStudy)
                .where(ImpactStudy.id == study_id)
                .with_for_update()
            )
            if study is None or study.created_by != user_id:
                return _failure(404, "Impact study was not found.")
            if study.status == "cancelled":
                jobs = _load_study_jobs(session, study.id)
                return {
                    "status": "success",
                    "already_cancelled": True,
                    "study": serialize_impact_study(study, jobs),
                }
            if study.status in TERMINAL_STUDY_STATUSES:
                return _failure(409, "A finished impact study cannot be cancelled.")

            now = datetime.now(timezone.utc)
            session.execute(
                update(SimulationJob)
                .where(
                    SimulationJob.impact_study_id == study.id,
                    SimulationJob.status == "queued",
                )
                .values(
                    status="cancelled",
                    cancel_requested=True,
                    failure_type="cancelled",
                    finished_at=now,
                    updated_at=now,
                )
            )
            session.execute(
                update(SimulationJob)
                .where(
                    SimulationJob.impact_study_id == study.id,
                    SimulationJob.status == "running",
                )
                .values(cancel_requested=True, updated_at=now)
            )
            study.status = "cancelled"
            study.finished_at = now
            session.flush()
            jobs = _load_study_jobs(session, study.id)
            study.summary_json = build_child_job_summary(jobs)
            return {
                "status": "success",
                "already_cancelled": False,
                "study": serialize_impact_study(study, jobs),
            }
    except SQLAlchemyError:
        logger.exception("Failed to cancel impact study.")
        return _failure(500, "Failed to cancel impact study.")


def reconcile_impact_study(study_id: str) -> None:
    """Refresh a parent study after a worker finishes one of its child jobs."""
    if not is_database_configured():
        return
    try:
        with db_session() as session:
            study = session.scalar(
                select(ImpactStudy)
                .where(ImpactStudy.id == study_id)
                .with_for_update()
            )
            if study is None:
                return
            _reconcile_study(study, _load_study_jobs(session, study.id))
    except SQLAlchemyError:
        logger.exception("Failed to reconcile impact study: %s", study_id)


def build_child_job_specs(execution_plan: dict, scene_info: dict) -> list[dict]:
    specs = []
    for simulation in execution_plan.get("planned_simulations", []):
        for scenario_role in ("baseline", "candidate"):
            request = simulation.get(f"{scenario_role}_request")
            if not isinstance(request, dict):
                continue
            configuration = execution_plan.get(scenario_role) or {}
            signature_payload = {
                "policy_version": execution_plan.get("policy_version"),
                "scene": scene_info,
                "configuration_id": configuration.get("id"),
                "configuration_content_hash": configuration.get("content_hash"),
                "simulation_profile_id": simulation.get("profile_id"),
                "simulation_type": simulation.get("simulation_type"),
                "scenario_role": scenario_role,
                "request": request,
            }
            specs.append(
                {
                    "simulation_profile_id": str(simulation["profile_id"]),
                    "simulation_type": simulation["simulation_type"],
                    "scenario_role": scenario_role,
                    "request": request,
                    "input_signature": calculate_input_signature(signature_payload),
                }
            )
    return specs


def calculate_input_signature(value: Any) -> str:
    canonical = json.dumps(
        sanitize_json_value(value),
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def build_child_job_summary(jobs: Iterable[Any]) -> dict:
    jobs = list(jobs)
    counts: dict[str, int] = {}
    successful_job_ids = []
    failed_jobs = []
    cancelled_job_ids = []
    for job in jobs:
        status = str(_value(job, "status"))
        job_id = str(_value(job, "id"))
        counts[status] = counts.get(status, 0) + 1
        if status == "succeeded":
            successful_job_ids.append(job_id)
        elif status == "failed":
            failed_jobs.append(
                {
                    "job_id": job_id,
                    "error": _value(job, "error_message"),
                }
            )
        elif status == "cancelled":
            cancelled_job_ids.append(job_id)

    return {
        "total_jobs": len(jobs),
        "status_counts": dict(sorted(counts.items())),
        "successful_job_ids": successful_job_ids,
        "failed_jobs": failed_jobs,
        "cancelled_job_ids": cancelled_job_ids,
    }


def serialize_impact_study(study: ImpactStudy, jobs: Iterable[Any]) -> dict:
    return {
        "id": str(study.id),
        "scene_id": study.scene_id,
        "baseline_configuration_id": str(study.baseline_configuration_id),
        "candidate_configuration_id": str(study.candidate_configuration_id),
        "policy_version": study.policy_version,
        "status": study.status,
        "difference": normalize_json_value(study.difference_json),
        "execution_plan": normalize_json_value(study.execution_plan_json),
        "summary": normalize_json_value(study.summary_json),
        "report_url": study.report_url,
        "created_by": str(study.created_by),
        "created_at": serialize_datetime(study.created_at),
        "started_at": serialize_datetime(study.started_at),
        "finished_at": serialize_datetime(study.finished_at),
        "jobs": [serialize_job(job) for job in jobs],
    }


def _reconcile_study(study: ImpactStudy, jobs: list[SimulationJob]) -> None:
    if study.status == "cancelled" or not jobs:
        return

    statuses = {job.status for job in jobs}
    if statuses.issubset(TERMINAL_JOB_STATUSES):
        study.status = "aggregating"
        study.summary_json = build_child_job_summary(jobs)
        study.status = (
            "completed_with_failures"
            if statuses.intersection({"failed", "cancelled"})
            else "completed"
        )
        study.finished_at = max(
            (job.finished_at for job in jobs if job.finished_at is not None),
            default=datetime.now(timezone.utc),
        )
    elif "running" in statuses or statuses.intersection(TERMINAL_JOB_STATUSES):
        study.status = "running"
    else:
        study.status = "queued"


def _load_study_jobs(session, study_id: str) -> list[SimulationJob]:
    return session.scalars(
        select(SimulationJob)
        .where(SimulationJob.impact_study_id == study_id)
        .order_by(
            SimulationJob.simulation_profile_id,
            SimulationJob.scenario_role,
            SimulationJob.queued_at,
        )
    ).all()


def _find_ready_scene(scene_id: str) -> dict | None:
    return next(
        (
            scene
            for scene in list_scenes().get("scenes", [])
            if scene.get("id") == scene_id and scene.get("status") == "ready"
        ),
        None,
    )


def _value(row: Any, name: str) -> Any:
    if isinstance(row, dict):
        return row.get(name)
    return getattr(row, name, None)


def _database_unavailable() -> dict | None:
    if is_database_configured():
        return None
    return _failure(503, "Impact studies require a configured database.")


def _is_failure(result: dict) -> bool:
    return str(result.get("status", "")).lower().startswith("failure")


def _failure(status_code: int, error: str) -> dict:
    return {
        "status": "failure",
        "status_code": status_code,
        "error": error,
    }
