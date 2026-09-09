import hashlib
import json
import logging
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Iterable
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from backend.database import db_session, is_database_configured
from backend.models import ImpactStudy, NetworkConfiguration, Scene, SimulationJob
from backend.schemas.impact_studies import ImpactStudyCreateRequest
from backend.schemas.network_configurations import NetworkConfigurationAntenna
from backend.schemas.requests import NetworkCoverageOptimizationRequest
from backend.services import impact_planner, notification_service
from backend.services.impact_comparison_service import build_impact_comparison
from backend.services.network_configuration_service import (
    add_network_configuration_draft,
    calculate_content_hash,
    serialize_configuration,
)
from backend.services.scene_service import list_scenes
from backend.services.simulation_job_store import (
    add_simulation_job,
    load_simulation_job_result,
    serialize_job,
)
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

    optimization_policy = request.optimization_policy.model_dump(mode="json")
    optimizable_profiles = [
        simulation["profile_id"]
        for simulation in plan.get("planned_simulations", [])
        if simulation.get("simulation_type") == "network_coverage"
        and simulation.get("objectives")
    ]
    plan["optimization_policy"] = optimization_policy
    plan["optimization"] = {
        "mode": optimization_policy["mode"],
        "conditional": optimization_policy["mode"] == "if_objectives_fail",
        "eligible_profile_ids": optimizable_profiles,
        "potential_job_count": len(optimizable_profiles),
    }

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
                statement.order_by(ImpactStudy.created_at.desc())
                .limit(limit)
                .with_for_update()
            ).all()
            items = []
            for study in studies:
                jobs = _load_study_jobs(session, study.id)
                _reconcile_study(study, jobs, session=session)
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
            study = session.scalar(
                select(ImpactStudy)
                .where(ImpactStudy.id == study_id)
                .with_for_update()
            )
            if study is None or study.created_by != user_id:
                return _failure(404, "Impact study was not found.")
            jobs = _load_study_jobs(session, study.id)
            _reconcile_study(study, jobs, session=session)
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
                _reconcile_study(study, jobs, session=session)
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
                study.summary_json = build_study_summary(study, [])
                notification_service.ensure_impact_study_notification(session, study)
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
            study.summary_json = build_study_summary(study, jobs)
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
            _reconcile_study(
                study,
                _load_study_jobs(session, study.id),
                session=session,
            )
    except SQLAlchemyError:
        logger.exception("Failed to reconcile impact study: %s", study_id)


def get_impact_study_comparison(study_id: str, user_id: str) -> dict:
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
            _reconcile_study(study, jobs, session=session)
            comparison = build_impact_comparison(
                jobs,
                normalize_json_value(study.execution_plan_json) or {},
            )
            if study.status in TERMINAL_STUDY_STATUSES:
                summary = build_child_job_summary(jobs)
                summary["comparison"] = comparison
                study.summary_json = sanitize_json_value(summary)
            return {
                "status": "success",
                "study_id": str(study.id),
                "study_status": study.status,
                "comparison": comparison,
            }
    except SQLAlchemyError:
        logger.exception("Failed to compare impact study results.")
        return _failure(500, "Failed to compare impact study results.")


def create_suggested_configuration(
    study_id: str,
    simulation_profile_id: str,
    user_id: str,
) -> dict:
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
            _reconcile_study(study, jobs, session=session)
            optimization_jobs = [
                job
                for job in jobs
                if str(job.simulation_profile_id) == simulation_profile_id
                and job.scenario_role == "optimization"
            ]
            if len(optimization_jobs) != 1:
                return _failure(
                    404,
                    "A single optimization job was not found for this profile.",
                )
            optimization_job = optimization_jobs[0]
            if optimization_job.status != "succeeded":
                return _failure(
                    409,
                    "The optimization job must succeed before creating a draft.",
                )

            loaded = load_simulation_job_result(optimization_job)
            if loaded.get("error") or loaded.get("result") is None:
                return _failure(
                    409,
                    loaded.get("error") or "Optimization result is unavailable.",
                )
            optimization = loaded["result"].get("optimization") or {}
            best_request = optimization.get("best_request")
            if not isinstance(best_request, dict):
                return _failure(409, "Optimization produced no suggested request.")

            execution_plan = normalize_json_value(study.execution_plan_json) or {}
            candidate_identity = execution_plan.get("candidate") or {}
            candidate_id = str(study.candidate_configuration_id)
            if str(candidate_identity.get("id")) != candidate_id:
                return _failure(
                    409,
                    "The saved optimization source does not match the study candidate.",
                )
            candidate = session.get(NetworkConfiguration, candidate_id)
            if candidate is None or candidate.scene_id != study.scene_id:
                return _failure(404, "Candidate network configuration was not found.")

            source_reference = (
                f"impact-study:{study.id}:profile:{simulation_profile_id}:"
                f"optimization-job:{optimization_job.id}"
            )
            existing = session.scalar(
                select(NetworkConfiguration).where(
                    NetworkConfiguration.created_by == user_id,
                    NetworkConfiguration.source_reference == source_reference,
                )
            )
            if existing is not None:
                return {
                    "status": "success",
                    "already_created": True,
                    "based_on_candidate_configuration_id": candidate_id,
                    "optimization_job_id": str(optimization_job.id),
                    "configuration": serialize_configuration(existing),
                }

            try:
                antennas = _apply_suggested_antenna_settings(
                    candidate.antennas_json,
                    best_request.get("antennas"),
                )
            except (TypeError, ValueError) as exc:
                return _failure(409, str(exc))
            _, suggested_hash = calculate_content_hash(antennas)
            if suggested_hash == candidate.content_hash:
                return _failure(
                    409,
                    "Optimization did not produce settings different from the candidate.",
                )

            session.execute(
                select(Scene)
                .where(Scene.id == study.scene_id)
                .with_for_update()
            ).scalar_one()
            configuration = add_network_configuration_draft(
                session,
                scene_id=study.scene_id,
                antennas=antennas,
                created_by=user_id,
                parent_configuration_id=candidate_id,
                source="manual",
                source_reference=source_reference,
            )
            session.refresh(configuration)
            return {
                "status": "success",
                "already_created": False,
                "based_on_candidate_configuration_id": candidate_id,
                "optimization_job_id": str(optimization_job.id),
                "configuration": serialize_configuration(configuration),
            }
    except IntegrityError:
        logger.exception("Suggested configuration creation violated a constraint.")
        return _failure(409, "Suggested configuration could not be created.")
    except SQLAlchemyError:
        logger.exception("Failed to create suggested configuration.")
        return _failure(500, "Failed to create suggested configuration.")


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


def build_study_summary(study: ImpactStudy, jobs: Iterable[Any]) -> dict:
    jobs = list(jobs)
    summary = build_child_job_summary(jobs)
    summary["comparison"] = build_impact_comparison(
        jobs,
        normalize_json_value(getattr(study, "execution_plan_json", None)) or {},
    )
    return sanitize_json_value(summary)


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


def _reconcile_study(
    study: ImpactStudy,
    jobs: list[SimulationJob],
    session=None,
) -> None:
    if study.status == "cancelled":
        return
    if not jobs:
        if session is not None:
            notification_service.ensure_impact_study_notification(session, study)
        return

    statuses = {job.status for job in jobs}
    if statuses.issubset(TERMINAL_JOB_STATUSES):
        if session is not None:
            queued_jobs = _queue_required_optimization_jobs(session, study, jobs)
            if queued_jobs:
                jobs.extend(queued_jobs)
                study.status = "queued"
                study.finished_at = None
                study.summary_json = build_study_summary(study, jobs)
                return
        study.status = "aggregating"
        study.summary_json = build_study_summary(study, jobs)
        study.status = (
            "completed_with_failures"
            if statuses.intersection({"failed", "cancelled"})
            else "completed"
        )
        study.finished_at = max(
            (job.finished_at for job in jobs if job.finished_at is not None),
            default=datetime.now(timezone.utc),
        )
        if session is not None:
            notification_service.ensure_impact_study_notification(session, study)
    elif "running" in statuses:
        study.status = "running"
    else:
        study.status = "queued"


def _queue_required_optimization_jobs(session, study, jobs):
    execution_plan = normalize_json_value(study.execution_plan_json) or {}
    policy = execution_plan.get("optimization_policy") or {}
    if policy.get("mode", "disabled") != "if_objectives_fail":
        return []

    comparison = build_impact_comparison(jobs, execution_plan)
    comparisons_by_profile = {
        profile.get("profile_id"): profile
        for profile in comparison.get("profiles", [])
    }
    existing_profiles = {
        str(job.simulation_profile_id)
        for job in jobs
        if job.scenario_role == "optimization"
    }
    jobs_by_profile_role = {
        (str(job.simulation_profile_id), job.scenario_role): job
        for job in jobs
    }
    queued_ids = []
    for simulation in execution_plan.get("planned_simulations", []):
        profile_id = str(simulation.get("profile_id"))
        objectives = simulation.get("objectives") or []
        profile_comparison = comparisons_by_profile.get(profile_id) or {}
        if (
            simulation.get("simulation_type") != "network_coverage"
            or not objectives
            or profile_id in existing_profiles
            or profile_comparison.get("status") != "compared"
            or not _candidate_failed_objectives(profile_comparison)
        ):
            continue

        candidate_job = jobs_by_profile_role.get((profile_id, "candidate"))
        if candidate_job is None:
            continue
        optimization_request = NetworkCoverageOptimizationRequest(
            scene_id=study.scene_id,
            base_request=simulation["candidate_request"],
            tilt_step=policy.get("tilt_step", 2.0),
            power_step=policy.get("power_step", 2.0),
            azimuth_step=policy.get("azimuth_step", 30.0),
            max_candidates=policy.get("max_candidates", 300),
            objectives=objectives,
            variables=policy.get("variables"),
        )
        candidate_identity = execution_plan.get("candidate") or {}
        input_signature = calculate_input_signature(
            {
                "policy_version": study.policy_version,
                "optimization_policy": policy,
                "candidate_configuration_id": str(
                    study.candidate_configuration_id
                ),
                "candidate_content_hash": candidate_identity.get("content_hash"),
                "simulation_profile_id": profile_id,
                "scenario_role": "optimization",
                "request": optimization_request.model_dump(mode="json"),
            }
        )
        queued_ids.append(
            add_simulation_job(
                session,
                "network_coverage_optimization",
                optimization_request,
                normalize_json_value(candidate_job.scene_json) or {},
                base_url=candidate_job.base_url,
                created_by=str(study.created_by),
                impact_study_id=str(study.id),
                simulation_profile_id=profile_id,
                scenario_role="optimization",
                input_signature=input_signature,
            )
        )

    if not queued_ids:
        return []
    session.flush()
    return [session.get(SimulationJob, job_id) for job_id in queued_ids]


def _candidate_failed_objectives(profile_comparison):
    configured = [
        kpi.get("objective") or {}
        for kpi in profile_comparison.get("kpis", [])
        if (kpi.get("objective") or {}).get("status") != "not_configured"
    ]
    return bool(configured) and any(
        objective.get("candidate_status") == "failed"
        for objective in configured
    )


def _apply_suggested_antenna_settings(candidate_antennas, suggested_antennas):
    if not isinstance(suggested_antennas, list) or not suggested_antennas:
        raise ValueError("Optimization produced no suggested antenna settings.")

    antennas = deepcopy(candidate_antennas)
    antennas_by_id = {str(antenna.get("id")): antenna for antenna in antennas}
    for suggested in suggested_antennas:
        antenna_id = str(suggested.get("id"))
        antenna = antennas_by_id.get(antenna_id)
        if antenna is None:
            raise ValueError(
                f"Suggested antenna {antenna_id} is absent from the candidate version."
            )
        try:
            antenna["tilt"]["current"] = suggested["tilt"]["current"]
            antenna["tx_power"]["current"] = suggested["tx_power"]["current"]
            antenna["azimuth"] = suggested["azimuth"]
        except (KeyError, TypeError) as exc:
            raise ValueError(
                f"Suggested settings for antenna {antenna_id} are incomplete."
            ) from exc

    return [
        NetworkConfigurationAntenna.model_validate(antenna).model_dump(mode="json")
        for antenna in antennas
    ]


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
