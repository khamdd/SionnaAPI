import math
from collections import Counter, defaultdict
from typing import Any, Callable, Iterable

from backend.services.optimization_service import (
    compare_metric,
    extract_network_coverage_kpis,
    is_no_coverage_cell,
    numeric_value,
)
from backend.services.simulation_job_store import load_simulation_job_result


METRIC_SPECS = {
    "covered_area_percent": ("Covered area", "%", "higher", False),
    "uncovered_area_percent": ("Uncovered area", "%", "lower", False),
    "overlap_area_percent": ("Overlap area", "%", "lower", False),
    "average_overlap_count": ("Average overlap", "antennas", "lower", True),
    "average_sinr_db": ("Average SINR", "dB", "higher", False),
    "average_signal_dbm": ("Average signal", "dBm", "higher", False),
    "average_throughput_mbps": (
        "Average throughput",
        "Mbps",
        "higher",
        True,
    ),
    "coverage_percent": ("Covered users", "%", "higher", False),
    "average_best_rsrp_dbm": ("Average best RSRP", "dBm", "higher", False),
    "sinr_db": ("SINR", "dB", "higher", False),
    "signal_power_dbm": ("Signal power", "dBm", "higher", False),
    "noise_power_dbm": ("Interference plus noise", "dBm", "lower", False),
    "base_throughput_mbps": ("Base throughput", "Mbps", "higher", True),
    "target_throughput_mbps": ("Target throughput", "Mbps", "higher", True),
}

GRID_SIMULATION_TYPES = {"network_coverage", "coverage_map"}


def build_impact_comparison(
    jobs: Iterable[Any],
    execution_plan: dict,
    result_loader: Callable[[Any], dict] = load_simulation_job_result,
) -> dict:
    jobs = list(jobs)
    jobs_by_profile = defaultdict(list)
    for job in jobs:
        profile_id = _text(_value(job, "simulation_profile_id"))
        if profile_id:
            jobs_by_profile[profile_id].append(job)

    planned = execution_plan.get("planned_simulations", [])
    profiles = []
    seen_profile_ids = set()
    for plan in planned:
        profile_id = _text(plan.get("profile_id"))
        seen_profile_ids.add(profile_id)
        profiles.append(
            compare_profile_jobs(
                plan,
                jobs_by_profile.get(profile_id, []),
                result_loader=result_loader,
            )
        )

    for profile_id in sorted(set(jobs_by_profile).difference(seen_profile_ids)):
        profiles.append(
            _profile_problem(
                {"profile_id": profile_id},
                "incompatible",
                "unexpected_profile_jobs",
                "Jobs do not belong to a profile in the saved execution plan.",
                jobs_by_profile[profile_id],
            )
        )

    profile_counts = Counter(profile["status"] for profile in profiles)
    direction_counts = Counter(
        kpi["direction"]
        for profile in profiles
        for kpi in profile.get("kpis", [])
    )
    return {
        "status": (
            "complete"
            if profiles and profile_counts.get("compared", 0) == len(profiles)
            else "complete_with_issues"
            if profiles
            else "empty"
        ),
        "profile_counts": dict(sorted(profile_counts.items())),
        "kpi_direction_counts": dict(sorted(direction_counts.items())),
        "profiles": profiles,
    }


def compare_profile_jobs(plan, jobs, result_loader=load_simulation_job_result):
    baseline_jobs = [job for job in jobs if _value(job, "scenario_role") == "baseline"]
    candidate_jobs = [job for job in jobs if _value(job, "scenario_role") == "candidate"]
    if len(baseline_jobs) != 1 or len(candidate_jobs) != 1:
        return _profile_problem(
            plan,
            "missing",
            "missing_or_duplicate_pair",
            "Exactly one baseline and one candidate job are required.",
            jobs,
        )

    baseline_job = baseline_jobs[0]
    candidate_job = candidate_jobs[0]
    expected_type = plan.get("simulation_type")
    job_types = {
        _value(baseline_job, "simulation_type"),
        _value(candidate_job, "simulation_type"),
    }
    if len(job_types) != 1 or expected_type not in job_types:
        return _profile_problem(
            plan,
            "incompatible",
            "simulation_type_mismatch",
            "Baseline and candidate jobs must use the profile simulation type.",
            jobs,
        )

    if _value(baseline_job, "status") != "succeeded" or _value(
        candidate_job, "status"
    ) != "succeeded":
        terminal_failure = any(
            _value(job, "status") in {"failed", "cancelled"}
            for job in (baseline_job, candidate_job)
        )
        return _profile_problem(
            plan,
            "failed" if terminal_failure else "pending",
            "child_job_not_successful",
            "Both child jobs must succeed before their results can be compared.",
            jobs,
        )

    baseline_loaded = result_loader(baseline_job)
    candidate_loaded = result_loader(candidate_job)
    if baseline_loaded.get("error") or candidate_loaded.get("error"):
        return _profile_problem(
            plan,
            "unavailable",
            "result_unavailable",
            baseline_loaded.get("error")
            or candidate_loaded.get("error")
            or "A complete child result is unavailable.",
            jobs,
        )

    baseline_result = baseline_loaded.get("result") or {}
    candidate_result = candidate_loaded.get("result") or {}
    compatibility_error = validate_result_compatibility(
        expected_type,
        baseline_result,
        candidate_result,
    )
    if compatibility_error:
        return _profile_problem(
            plan,
            "incompatible",
            "incompatible_results",
            compatibility_error,
            jobs,
        )

    baseline_kpis = extract_kpis(expected_type, baseline_result)
    candidate_kpis = extract_kpis(expected_type, candidate_result)
    common_metrics = [
        metric
        for metric in METRIC_SPECS
        if metric in baseline_kpis and metric in candidate_kpis
    ]
    if not common_metrics:
        return _profile_problem(
            plan,
            "incompatible",
            "no_comparable_kpis",
            "The child results do not contain compatible KPI values.",
            jobs,
        )

    objectives = plan.get("objectives") or []
    comparison = {
        "profile_id": _text(plan.get("profile_id")),
        "profile_name": plan.get("profile_name"),
        "simulation_type": expected_type,
        "status": "compared",
        "baseline_job": _job_state(baseline_job),
        "candidate_job": _job_state(candidate_job),
        "kpis": [
            compare_kpi(
                metric,
                baseline_kpis[metric],
                candidate_kpis[metric],
                objectives,
            )
            for metric in common_metrics
        ],
    }
    spatial = compare_spatial_coverage(
        baseline_result,
        candidate_result,
    )
    if spatial is not None:
        comparison["spatial"] = spatial
    return comparison


def extract_kpis(simulation_type, result):
    if simulation_type in GRID_SIMULATION_TYPES:
        grid = result.get("grid") or {}
        coverage = extract_network_coverage_kpis(grid)
        cells = grid.get("cells") if isinstance(grid, dict) else []
        return {
            **{
                key: value
                for key, value in coverage.items()
                if key
                in {
                    "covered_area_percent",
                    "uncovered_area_percent",
                    "overlap_area_percent",
                    "average_overlap_count",
                }
            },
            **_grid_averages(cells or []),
        }

    if simulation_type == "rsrp_simulation":
        summary = result.get("summary") or {}
        overlap = summary.get("overlap_summary") or result.get("overlap_summary") or {}
        return _numeric_items(
            {
                "coverage_percent": summary.get("coverage_percent"),
                "average_best_rsrp_dbm": summary.get("average_best_rsrp_dbm"),
                "overlap_area_percent": overlap.get("overlap_percent"),
                "average_overlap_count": overlap.get("average_overlap_count"),
            }
        )

    if simulation_type == "sinr":
        return _numeric_items(
            {
                "sinr_db": result.get("sinr_db"),
                "signal_power_dbm": result.get("signal_power"),
                "noise_power_dbm": result.get("noise_power"),
            }
        )

    if simulation_type == "throughput_comparison":
        comparison = result.get("comparison") or {}
        return _numeric_items(
            {
                "sinr_db": result.get("sinr_db"),
                "base_throughput_mbps": comparison.get("base_throughput_mbps"),
                "target_throughput_mbps": comparison.get(
                    "target_throughput_mbps"
                ),
            }
        )

    return {}


def compare_kpi(metric, baseline, candidate, objectives):
    label, unit, preferred_direction, relative_change = METRIC_SPECS[metric]
    baseline = float(baseline)
    candidate = float(candidate)
    delta = candidate - baseline
    if math.isclose(delta, 0.0, abs_tol=1e-9):
        direction = "unchanged"
    elif (delta > 0 and preferred_direction == "higher") or (
        delta < 0 and preferred_direction == "lower"
    ):
        direction = "improved"
    else:
        direction = "degraded"

    percentage_delta = None
    if relative_change and not math.isclose(baseline, 0.0, abs_tol=1e-12):
        percentage_delta = (delta / abs(baseline)) * 100.0

    objective = next(
        (item for item in objectives if _value(item, "metric") == metric),
        None,
    )
    return {
        "metric": metric,
        "label": label,
        "unit": unit,
        "baseline": _rounded(baseline),
        "candidate": _rounded(candidate),
        "absolute_delta": _rounded(delta),
        "percentage_delta": _rounded(percentage_delta),
        "direction": direction,
        "objective": evaluate_comparison_objective(
            objective,
            baseline,
            candidate,
        ),
    }


def evaluate_comparison_objective(objective, baseline, candidate):
    if objective is None:
        return {"status": "not_configured"}

    operator = _value(objective, "operator")
    target = numeric_value(_value(objective, "target"))
    if target is None:
        return {"status": "not_configured"}
    baseline_passed = compare_metric(baseline, operator, target)
    candidate_passed = compare_metric(candidate, operator, target)
    return {
        "status": "passed" if candidate_passed else "failed",
        "operator": operator,
        "target": _rounded(target),
        "baseline_status": "passed" if baseline_passed else "failed",
        "candidate_status": "passed" if candidate_passed else "failed",
    }


def validate_result_compatibility(simulation_type, baseline, candidate):
    if simulation_type in GRID_SIMULATION_TYPES:
        baseline_grid = baseline.get("grid") or {}
        candidate_grid = candidate.get("grid") or {}
        baseline_cells = baseline_grid.get("cells") or []
        candidate_cells = candidate_grid.get("cells") or []
        if not baseline_cells or not candidate_cells:
            return "Complete grid cells are required for comparison."
        for field in ("rows", "cols"):
            if baseline_grid.get(field) != candidate_grid.get(field):
                return f"Grid {field} values do not match."
        baseline_keys = {_cell_key(cell) for cell in baseline_cells}
        candidate_keys = {_cell_key(cell) for cell in candidate_cells}
        if baseline_keys != candidate_keys:
            return "Grid cell coordinates do not match."

    if simulation_type == "rsrp_simulation":
        for field in ("user_count", "random_seed"):
            baseline_value = baseline.get(field)
            candidate_value = candidate.get(field)
            if (
                baseline_value is not None
                and candidate_value is not None
                and baseline_value != candidate_value
            ):
                return f"RSRP {field} values do not match."

    if simulation_type in {"sinr", "throughput_comparison"}:
        if baseline.get("propagation_model") != candidate.get("propagation_model"):
            return "Propagation models do not match."
    return None


def compare_spatial_coverage(baseline, candidate):
    baseline_cells = (baseline.get("grid") or {}).get("cells") or []
    candidate_cells = (candidate.get("grid") or {}).get("cells") or []
    if not baseline_cells and not candidate_cells:
        return None
    baseline_by_key = {_cell_key(cell): cell for cell in baseline_cells}
    candidate_by_key = {_cell_key(cell): cell for cell in candidate_cells}
    if set(baseline_by_key) != set(candidate_by_key):
        return None

    newly_covered = 0
    lost_coverage = 0
    improved_sinr = 0
    degraded_sinr = 0
    for key, baseline_cell in baseline_by_key.items():
        candidate_cell = candidate_by_key[key]
        baseline_covered = not is_no_coverage_cell(baseline_cell)
        candidate_covered = not is_no_coverage_cell(candidate_cell)
        newly_covered += int(not baseline_covered and candidate_covered)
        lost_coverage += int(baseline_covered and not candidate_covered)
        baseline_sinr = numeric_value(baseline_cell.get("sinr_db"))
        candidate_sinr = numeric_value(candidate_cell.get("sinr_db"))
        if baseline_sinr is None or candidate_sinr is None:
            continue
        if math.isclose(candidate_sinr, baseline_sinr, abs_tol=1e-9):
            continue
        if candidate_sinr > baseline_sinr:
            improved_sinr += 1
        else:
            degraded_sinr += 1

    return {
        "paired_cell_count": len(baseline_by_key),
        "newly_covered_cells": newly_covered,
        "lost_coverage_cells": lost_coverage,
        "improved_sinr_cells": improved_sinr,
        "degraded_sinr_cells": degraded_sinr,
        "local_regression_present": lost_coverage > 0 or degraded_sinr > 0,
    }


def _grid_averages(cells):
    values = {}
    for metric, field in (
        ("average_sinr_db", "sinr_db"),
        ("average_signal_dbm", "signal_dbm"),
        ("average_throughput_mbps", "throughput_mbps"),
    ):
        samples = [numeric_value(cell.get(field)) for cell in cells]
        samples = [sample for sample in samples if sample is not None]
        if samples:
            values[metric] = sum(samples) / len(samples)
    return values


def _numeric_items(values):
    result = {}
    for key, value in values.items():
        numeric = numeric_value(value)
        if numeric is not None:
            result[key] = numeric
    return result


def _profile_problem(plan, status, error_code, error, jobs):
    jobs_by_role = {
        _value(job, "scenario_role"): _job_state(job)
        for job in jobs
        if _value(job, "scenario_role")
    }
    return {
        "profile_id": _text(plan.get("profile_id")),
        "profile_name": plan.get("profile_name"),
        "simulation_type": plan.get("simulation_type"),
        "status": status,
        "error_code": error_code,
        "error": error,
        "baseline_job": jobs_by_role.get("baseline"),
        "candidate_job": jobs_by_role.get("candidate"),
        "kpis": [],
    }


def _job_state(job):
    return {
        "id": _text(_value(job, "id")),
        "status": _value(job, "status"),
        "simulation_type": _value(job, "simulation_type"),
        "error": _value(job, "error_message"),
    }


def _cell_key(cell):
    if "row" in cell and "col" in cell:
        return ("grid", cell.get("row"), cell.get("col"))
    return ("position", cell.get("x"), cell.get("y"))


def _value(row, name):
    if isinstance(row, dict):
        return row.get(name)
    return getattr(row, name, None)


def _text(value):
    return str(value) if value is not None else None


def _rounded(value):
    if value is None:
        return None
    return round(float(value), 6)
