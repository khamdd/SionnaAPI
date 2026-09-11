import html
import os
import platform
import sys
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any, Iterable
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from backend.constants import STATIC_DIR
from backend.database import db_session, is_database_configured
from backend.models import ImpactStudy, NetworkConfiguration, SimulationJob
from backend.services.impact_decision_service import final_decision
from backend.services.impact_study_service import (
    TERMINAL_STUDY_STATUSES,
    _reconcile_study,
    build_study_summary,
)
from backend.services.network_configuration_service import serialize_configuration
from backend.services.simulation_job_store import (
    load_simulation_job_result,
    serialize_job,
)
from backend.services.simulation_store import normalize_json_value

REPORT_DIR = STATIC_DIR / "impact-reports"
REPORT_SCHEMA_VERSION = "impact-report-v1"
PREDICTION_NOTICE = (
    "This report contains simulated predictions, not measured live-network values. "
    "Engineering review and field validation are required before operational use."
)


def get_or_create_impact_report(study_id: str, user_id: str) -> dict:
    if not is_database_configured():
        return _failure(503, "Impact reports require a configured database.")

    try:
        safe_study_id = str(UUID(study_id))
    except (TypeError, ValueError):
        return _failure(400, "Impact study ID is invalid.")

    try:
        with db_session() as session:
            study = session.scalar(
                select(ImpactStudy)
                .where(ImpactStudy.id == safe_study_id)
                .with_for_update()
            )
            if study is None or str(study.created_by) != str(user_id):
                return _failure(404, "Impact study was not found.")

            jobs = session.scalars(
                select(SimulationJob)
                .where(SimulationJob.impact_study_id == study.id)
                .order_by(
                    SimulationJob.simulation_profile_id,
                    SimulationJob.scenario_role,
                    SimulationJob.queued_at,
                )
            ).all()
            _reconcile_study(study, jobs, session=session)
            if study.status not in TERMINAL_STUDY_STATUSES:
                return _failure(
                    409,
                    "Impact report is available after the study reaches a terminal state.",
                )

            report_path = impact_report_path(safe_study_id)
            report_url = f"/api/v1/impact-studies/{safe_study_id}/report"
            already_generated = report_path.is_file()
            if not already_generated:
                study.summary_json = build_study_summary(study, jobs)
                baseline = session.get(
                    NetworkConfiguration,
                    str(study.baseline_configuration_id),
                )
                candidate = session.get(
                    NetworkConfiguration,
                    str(study.candidate_configuration_id),
                )
                snapshot = build_report_snapshot(
                    study,
                    jobs,
                    baseline,
                    candidate,
                )
                write_impact_report(safe_study_id, render_impact_report(snapshot))

            study.report_url = report_url
            return {
                "status": "success",
                "study_id": safe_study_id,
                "report_url": report_url,
                "file_path": str(report_path),
                "filename": f"impact-study-{safe_study_id}.html",
                "already_generated": already_generated,
            }
    except OSError:
        return _failure(500, "Impact report artifact could not be written.")
    except SQLAlchemyError:
        return _failure(500, "Impact report could not be generated.")


def build_report_snapshot(study, jobs, baseline, candidate) -> dict:
    execution_plan = normalize_json_value(study.execution_plan_json) or {}
    summary = normalize_json_value(study.summary_json) or {}
    result_by_job_id = {}
    serialized_jobs = []
    for job in jobs:
        serialized = serialize_job(job)
        serialized_jobs.append(serialized)
        if serialized.get("status") != "succeeded":
            continue
        loaded = load_simulation_job_result(job)
        if loaded.get("result") is not None and not loaded.get("error"):
            result_by_job_id[serialized["id"]] = loaded["result"]

    return {
        "schema_version": REPORT_SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "study": {
            "id": str(study.id),
            "scene_id": study.scene_id,
            "creator": str(study.created_by),
            "policy_version": study.policy_version,
            "status": study.status,
            "created_at": _iso(study.created_at),
            "started_at": _iso(study.started_at),
            "finished_at": _iso(study.finished_at),
        },
        "baseline": serialize_configuration(baseline) if baseline else None,
        "candidate": serialize_configuration(candidate) if candidate else None,
        "difference": normalize_json_value(study.difference_json) or {},
        "execution_plan": execution_plan,
        "summary": summary,
        "jobs": serialized_jobs,
        "result_by_job_id": result_by_job_id,
        "runtime": runtime_metadata(),
    }


def render_impact_report(snapshot: dict) -> str:
    study = snapshot.get("study") or {}
    comparison = (snapshot.get("summary") or {}).get("comparison") or {}
    decision = final_decision(study.get("status"), comparison)
    warnings = report_warnings(snapshot, decision)
    title = f"Impact Study {study.get('id', '')}"
    sections = [
        _metadata_section(snapshot, decision),
        _configuration_section(snapshot),
        _changes_section(snapshot.get("difference") or {}),
        _simulations_section(snapshot),
        _kpi_section(comparison),
        _maps_section(snapshot),
        _spatial_section(comparison),
        _objectives_section(comparison),
        _optimization_section(comparison),
        _warnings_section(warnings),
        _environment_section(snapshot),
        _decision_section(decision),
    ]
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{_e(title)}</title>
  <style>
    :root {{ color-scheme: light; --ink:#15202b; --muted:#64748b; --line:#d8e0e8; --panel:#f7f9fb; --accent:#0f766e; }}
    * {{ box-sizing:border-box; }}
    body {{ margin:0; font:14px/1.5 Arial, sans-serif; color:var(--ink); background:#eef2f5; }}
    main {{ width:min(1180px, calc(100% - 32px)); margin:24px auto; background:white; padding:32px; box-shadow:0 8px 28px #10203018; }}
    h1 {{ margin:0 0 6px; font-size:28px; }} h2 {{ margin:30px 0 12px; font-size:18px; border-bottom:2px solid var(--line); padding-bottom:7px; }}
    .notice {{ border-left:4px solid #d97706; background:#fff7ed; padding:12px 14px; margin:18px 0; }}
    .decision {{ display:inline-block; padding:5px 10px; border-radius:999px; background:#e2e8f0; font-weight:700; text-transform:uppercase; }}
    table {{ width:100%; border-collapse:collapse; margin:8px 0 16px; }} th,td {{ border:1px solid var(--line); padding:8px; text-align:left; vertical-align:top; }} th {{ background:var(--panel); }}
    .maps {{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }} .map {{ border:1px solid var(--line); padding:12px; min-height:150px; }} .map img {{ width:100%; height:auto; }}
    .muted {{ color:var(--muted); }} code {{ overflow-wrap:anywhere; }} ul {{ padding-left:22px; }}
    @media (max-width:700px) {{ main {{ width:100%; margin:0; padding:18px; }} .maps {{ grid-template-columns:1fr; }} }}
    @media print {{ body {{ background:white; }} main {{ width:100%; margin:0; box-shadow:none; }} }}
  </style>
</head>
<body><main>
  <h1>{_e(title)}</h1>
  <div class="muted">Generated {_e(snapshot.get('generated_at'))} · {_e(snapshot.get('schema_version'))}</div>
  <div class="notice"><strong>Simulation notice:</strong> {_e(PREDICTION_NOTICE)}</div>
  {''.join(sections)}
</main></body>
</html>"""


def report_warnings(snapshot: dict, decision: str) -> list[str]:
    comparison = (snapshot.get("summary") or {}).get("comparison") or {}
    warnings = [PREDICTION_NOTICE]
    if decision == "incomplete":
        warnings.append("The study is incomplete; missing or failed results are listed below.")
    for job in snapshot.get("jobs") or []:
        if job.get("status") in {"failed", "cancelled"}:
            warnings.append(
                f"{job.get('scenario_role') or 'simulation'} job {job.get('id')} "
                f"ended as {job.get('status')}: {job.get('error_message') or 'no detail'}"
            )
    for profile in comparison.get("profiles") or []:
        if profile.get("status") != "compared":
            warnings.append(
                f"Profile {profile.get('profile_name') or profile.get('profile_id')} "
                f"was not compared: {profile.get('error') or profile.get('status')}"
            )
        if (profile.get("spatial") or {}).get("local_regression_present"):
            warnings.append(
                f"Profile {profile.get('profile_name') or profile.get('profile_id')} "
                "contains local coverage or SINR regressions."
            )
    return _unique(warnings)


def impact_report_path(study_id: str) -> Path:
    return REPORT_DIR / f"{str(UUID(study_id))}.html"


def write_impact_report(study_id: str, content: str) -> Path:
    path = impact_report_path(study_id)
    if path.is_file():
        return path
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid4()}.tmp")
    try:
        temporary.write_text(content, encoding="utf-8")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return path


def runtime_metadata() -> dict:
    return {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "code_version": os.getenv("APP_VERSION")
        or os.getenv("GIT_COMMIT_SHA")
        or "not configured",
        "gpu_devices": os.getenv("NVIDIA_VISIBLE_DEVICES")
        or os.getenv("CUDA_VISIBLE_DEVICES")
        or "not reported",
        "dependencies": {
            package: _package_version(package)
            for package in ("sionna-rt", "fastapi", "SQLAlchemy", "numpy")
        },
    }


def _metadata_section(snapshot, decision):
    study = snapshot.get("study") or {}
    rows = [
        ("Study ID", study.get("id")),
        ("Scene", study.get("scene_id")),
        ("Creator/source", study.get("creator")),
        ("Policy", study.get("policy_version")),
        ("Study status", study.get("status")),
        ("Created", study.get("created_at")),
        ("Started", study.get("started_at")),
        ("Finished", study.get("finished_at")),
        ("Decision", decision),
    ]
    return _section("1. Study metadata", _key_value_table(rows))


def _configuration_section(snapshot):
    rows = []
    for label, configuration in (
        ("Baseline", snapshot.get("baseline")),
        ("Candidate", snapshot.get("candidate")),
    ):
        configuration = configuration or {}
        rows.append(
            [
                label,
                configuration.get("id"),
                configuration.get("version"),
                configuration.get("status"),
                configuration.get("source"),
                configuration.get("content_hash"),
            ]
        )
    return _section(
        "2. Configuration versions",
        _table(
            ["Role", "ID", "Version", "Status", "Source", "Content hash"],
            rows,
        ),
    )


def _changes_section(difference):
    rows = [
        [
            change.get("antenna_id"),
            change.get("change_type"),
            change.get("field"),
            _display(change.get("before")),
            _display(change.get("after")),
        ]
        for change in difference.get("changes", [])
    ]
    body = _table(["Antenna", "Change", "Field", "Before", "After"], rows)
    if not rows:
        body = '<p class="muted">No antenna changes were recorded.</p>'
    return _section("3. Exact antenna changes", body)


def _simulations_section(snapshot):
    plan = snapshot.get("execution_plan") or {}
    jobs = snapshot.get("jobs") or []
    rows = [
        [
            job.get("simulation_profile_id"),
            job.get("simulation_type"),
            job.get("scenario_role"),
            job.get("status"),
            job.get("attempts"),
            job.get("error_message"),
        ]
        for job in jobs
    ]
    skipped = plan.get("skipped_simulations") or []
    skipped_body = "".join(
        f"<li>{_e(item.get('profile_name') or item.get('profile_id'))}: "
        f"{_e(item.get('reason'))}</li>"
        for item in skipped
    ) or '<li class="muted">None</li>'
    return _section(
        "4. Planned, executed, skipped, and failed simulations",
        f"<p>Planned profiles: {_e(len(plan.get('planned_simulations') or []))} · "
        f"Executed jobs: {_e(len(rows))}</p>"
        + _table(
            ["Profile", "Type", "Role", "Status", "Attempts", "Error"],
            rows,
        )
        + f"<h3>Skipped profiles</h3><ul>{skipped_body}</ul>",
    )


def _kpi_section(comparison):
    rows = []
    for profile in comparison.get("profiles") or []:
        for kpi in profile.get("kpis") or []:
            rows.append(
                [
                    profile.get("profile_name") or profile.get("profile_id"),
                    kpi.get("label") or kpi.get("metric"),
                    _number(kpi.get("baseline"), kpi.get("unit")),
                    _number(kpi.get("candidate"), kpi.get("unit")),
                    _number(kpi.get("absolute_delta"), kpi.get("unit")),
                    _number(kpi.get("percentage_delta"), "%"),
                    kpi.get("direction"),
                ]
            )
    body = _table(
        ["Profile", "KPI", "Baseline", "Candidate", "Delta", "Delta %", "Direction"],
        rows,
    ) if rows else '<p class="muted">No comparable KPI results are available.</p>'
    return _section("5. KPI before/after", body)


def _maps_section(snapshot):
    comparison = (snapshot.get("summary") or {}).get("comparison") or {}
    results = snapshot.get("result_by_job_id") or {}
    cards = []
    for profile in comparison.get("profiles") or []:
        for role in ("baseline", "candidate"):
            job = profile.get(f"{role}_job") or {}
            result = results.get(str(job.get("id"))) or {}
            image_url = result.get("coverage_map_image_url")
            if image_url:
                content = f'<img src="{_ea(image_url)}" alt="{_ea(role)} coverage map">'
            else:
                content = '<p class="muted">Map artifact unavailable for this result.</p>'
            cards.append(
                f'<div class="map"><strong>{_e(profile.get("profile_name") or profile.get("profile_id"))} '
                f'— {_e(role.title())}</strong>{content}</div>'
            )
    body = f'<div class="maps">{"".join(cards)}</div>' if cards else '<p class="muted">No comparable map pairs are available.</p>'
    return _section("6. Side-by-side maps", body)


def _spatial_section(comparison):
    rows = []
    for profile in comparison.get("profiles") or []:
        spatial = profile.get("spatial")
        if not spatial:
            continue
        rows.append(
            [
                profile.get("profile_name") or profile.get("profile_id"),
                spatial.get("paired_cell_count"),
                spatial.get("newly_covered_cells"),
                spatial.get("lost_coverage_cells"),
                spatial.get("improved_sinr_cells"),
                spatial.get("degraded_sinr_cells"),
            ]
        )
    body = _table(
        ["Profile", "Paired cells", "Newly covered", "Lost coverage", "SINR improved", "SINR degraded"],
        rows,
    ) if rows else '<p class="muted">Spatial comparison is not available for these profiles.</p>'
    return _section("7. Spatial coverage changes", body)


def _objectives_section(comparison):
    rows = []
    for profile in comparison.get("profiles") or []:
        for objective in profile.get("objectives") or []:
            rows.append(
                [
                    profile.get("profile_name") or profile.get("profile_id"),
                    objective.get("metric"),
                    f"{objective.get('operator')} {objective.get('target')}",
                    objective.get("baseline_status"),
                    objective.get("candidate_status"),
                    objective.get("optimized_status"),
                ]
            )
    body = _table(
        ["Profile", "Objective", "Target", "Baseline", "Candidate", "Optimized"],
        rows,
    ) if rows else '<p class="muted">No engineering objectives were configured.</p>'
    return _section("8. Engineering objectives", body)


def _optimization_section(comparison):
    rows = []
    for profile in comparison.get("profiles") or []:
        optimization = profile.get("optimization") or {}
        source = optimization.get("based_on_candidate") or {}
        rows.append(
            [
                profile.get("profile_name") or profile.get("profile_id"),
                optimization.get("status"),
                source.get("configuration_id"),
                optimization.get("objectives_passed"),
                optimization.get("tested_count"),
                optimization.get("stop_reason"),
                _display(optimization.get("suggested_settings")),
            ]
        )
    return _section(
        "9. Optimization suggestion",
        _table(
            ["Profile", "Status", "Candidate source", "Objectives passed", "Tested", "Stop reason", "Suggested settings"],
            rows,
        ) if rows else '<p class="muted">No optimization was requested.</p>',
    )


def _warnings_section(warnings):
    return _section(
        "10. Warnings and incomplete results",
        "<ul>" + "".join(f"<li>{_e(item)}</li>" for item in warnings) + "</ul>",
    )


def _environment_section(snapshot):
    runtime = snapshot.get("runtime") or {}
    jobs = snapshot.get("jobs") or []
    scene = next(
        (job.get("scene") for job in jobs if job.get("scene")),
        {"id": (snapshot.get("study") or {}).get("scene_id")},
    )
    rows = [
        ["Scene snapshot", _display(scene)],
        ["Scene version", scene.get("version", "not recorded")],
        ["Report schema", snapshot.get("schema_version")],
        ["Python", runtime.get("python")],
        ["Platform", runtime.get("platform")],
        ["Code version", runtime.get("code_version")],
        ["GPU devices", runtime.get("gpu_devices")],
    ]
    rows.extend(
        [f"Dependency: {name}", value]
        for name, value in (runtime.get("dependencies") or {}).items()
    )
    profiles = snapshot.get("execution_plan", {}).get("planned_simulations") or []
    rows.extend(
        [
            f"Profile: {profile.get('profile_name') or profile.get('profile_id')}",
            _display(
                {
                    "simulation_type": profile.get("simulation_type"),
                    "propagation_model": profile.get("propagation_model"),
                    "solver": (profile.get("candidate_request") or {}).get("solver"),
                }
            ),
        ]
        for profile in profiles
    )
    return _section("11. Scene, solver, code, dependency, and GPU versions", _key_value_table(rows))


def _decision_section(decision):
    return _section(
        "12. Final decision",
        f'<p><span class="decision">{_e(decision)}</span></p>'
        '<p class="muted">This automated status is decision support only; it is not approval to change a live network.</p>',
    )


def _section(title, body):
    return f"<section><h2>{_e(title)}</h2>{body}</section>"


def _key_value_table(rows):
    return _table(["Field", "Value"], rows)


def _table(headers: Iterable[Any], rows: Iterable[Iterable[Any]]) -> str:
    header_html = "".join(f"<th>{_e(value)}</th>" for value in headers)
    row_html = "".join(
        "<tr>" + "".join(f"<td>{_e(value)}</td>" for value in row) + "</tr>"
        for row in rows
    )
    return f"<table><thead><tr>{header_html}</tr></thead><tbody>{row_html}</tbody></table>"


def _number(value, unit):
    if value is None:
        return "—"
    return f"{value:g} {unit or ''}".strip() if isinstance(value, (int, float)) else str(value)


def _display(value):
    if value is None:
        return "—"
    if isinstance(value, dict):
        return ", ".join(f"{key}={_display(nested)}" for key, nested in value.items())
    if isinstance(value, list):
        return ", ".join(_display(item) for item in value)
    return str(value)


def _iso(value):
    return value.isoformat() if value is not None else None


def _package_version(package):
    try:
        return version(package)
    except PackageNotFoundError:
        return "not installed"


def _unique(values):
    return list(dict.fromkeys(values))


def _e(value):
    return html.escape("—" if value is None else str(value))


def _ea(value):
    return html.escape(str(value), quote=True)


def _failure(status_code: int, error: str) -> dict:
    return {"status": "failure", "status_code": status_code, "error": error}
