import math


NO_COVERAGE_LEVEL = "no_coverage"
OVERLAP_MIN_COUNT = 2


def extract_network_coverage_kpis(result_or_grid):
    grid = network_coverage_grid(result_or_grid)
    cells = grid.get("cells") if isinstance(grid, dict) else None

    if not isinstance(cells, list):
        cells = []

    total_cells = len(cells)
    no_coverage_cells = [
        cell
        for cell in cells
        if is_no_coverage_cell(cell)
    ]
    covered_cells = [
        cell
        for cell in cells
        if not is_no_coverage_cell(cell)
    ]
    overlap_summary = grid.get("overlap_summary") if isinstance(grid, dict) else {}

    return {
        "total_cells": total_cells,
        "covered_cells": len(covered_cells),
        "uncovered_cells": len(no_coverage_cells),
        "uncovered_area_percent": percent(len(no_coverage_cells), total_cells),
        "covered_area_percent": percent(len(covered_cells), total_cells),
        "overlap_area_percent": overlap_percent(cells, overlap_summary, total_cells),
        "average_overlap_count": average_overlap_count(cells, overlap_summary, covered_cells),
    }


def evaluate_network_coverage_objectives(result_or_grid, objectives):
    kpis = extract_network_coverage_kpis(result_or_grid)
    evaluations = [
        evaluate_objective(kpis, objective)
        for objective in objectives
    ]
    scores = [
        evaluation["score"]
        for evaluation in evaluations
    ]

    return {
        "passed": all(evaluation["passed"] for evaluation in evaluations),
        "score": math.inf if any(math.isinf(score) for score in scores) else sum(scores),
        "kpis": kpis,
        "evaluations": evaluations,
    }


def generate_network_coverage_tilt_candidates(
    base_request,
    tilt_step,
    max_candidates,
):
    antennas = list(getattr(base_request, "antennas", []) or [])
    step = numeric_value(tilt_step)

    if step is None or step <= 0:
        raise ValueError("tilt_step must be greater than 0")

    if max_candidates < 1:
        raise ValueError("max_candidates must be at least 1")

    baseline_tilts = {
        antenna.id: float(antenna.tilt.current)
        for antenna in antennas
    }
    candidates = []
    seen = set()

    add_candidate(
        candidates,
        seen,
        "baseline",
        "Current setup",
        baseline_tilts,
        baseline_tilts,
        max_candidates,
    )

    for direction, suffix, label in (
        (step, "all_up", f"All antennas +{format_step(step)} deg"),
        (-step, "all_down", f"All antennas -{format_step(step)} deg"),
    ):
        tilts = {
            antenna.id: clamp_tilt(antenna.tilt.current + direction, antenna.tilt)
            for antenna in antennas
        }
        add_candidate(
            candidates,
            seen,
            suffix,
            label,
            tilts,
            baseline_tilts,
            max_candidates,
        )

    for antenna in antennas:
        for direction, suffix, label in (
            (step, "up", f"{antenna.id} +{format_step(step)} deg"),
            (-step, "down", f"{antenna.id} -{format_step(step)} deg"),
        ):
            tilts = dict(baseline_tilts)
            tilts[antenna.id] = clamp_tilt(
                antenna.tilt.current + direction,
                antenna.tilt,
            )
            add_candidate(
                candidates,
                seen,
                f"{antenna.id}_{suffix}",
                label,
                tilts,
                baseline_tilts,
                max_candidates,
            )

    return {
        "tilt_step": step,
        "max_candidates": max_candidates,
        "generated_count": len(candidates),
        "antenna_count": len(antennas),
        "candidates": candidates,
    }


def build_network_coverage_candidate_request(base_request, candidate_tilts):
    antennas = list(getattr(base_request, "antennas", []) or [])
    antenna_by_id = {
        antenna.id: antenna
        for antenna in antennas
    }
    updated_antennas = []
    changes = []

    for antenna_id in candidate_tilts:
        if antenna_id not in antenna_by_id:
            raise ValueError(f"Unknown antenna in candidate tilts: {antenna_id}")

    for antenna in antennas:
        if antenna.id not in candidate_tilts:
            updated_antennas.append(antenna)
            continue

        next_tilt = numeric_value(candidate_tilts[antenna.id])
        if next_tilt is None:
            raise ValueError(f"Candidate tilt for {antenna.id} must be numeric")

        if next_tilt < antenna.tilt.min or next_tilt > antenna.tilt.max:
            raise ValueError(
                f"Candidate tilt for {antenna.id} must be between "
                f"{antenna.tilt.min} and {antenna.tilt.max}"
            )

        updated_tilt = antenna.tilt.model_copy(
            update={
                "current": next_tilt,
            },
        )
        updated_antennas.append(
            antenna.model_copy(
                update={
                    "tilt": updated_tilt,
                },
            )
        )

        if not math.isclose(float(antenna.tilt.current), next_tilt):
            changes.append(
                {
                    "antenna_id": antenna.id,
                    "from": float(antenna.tilt.current),
                    "to": next_tilt,
                    "delta": round(next_tilt - float(antenna.tilt.current), 6),
                }
            )

    return {
        "request": base_request.model_copy(
            update={
                "antennas": updated_antennas,
            },
        ),
        "changes": changes,
    }


def add_candidate(
    candidates,
    seen,
    candidate_id,
    label,
    tilts,
    baseline_tilts,
    max_candidates,
):
    if len(candidates) >= max_candidates:
        return

    key = tuple(
        (antenna_id, tilts[antenna_id])
        for antenna_id in sorted(tilts)
    )
    if key in seen:
        return

    changes = [
        {
            "antenna_id": antenna_id,
            "from": baseline_tilts[antenna_id],
            "to": tilts[antenna_id],
            "delta": round(tilts[antenna_id] - baseline_tilts[antenna_id], 6),
        }
        for antenna_id in sorted(tilts)
        if not math.isclose(tilts[antenna_id], baseline_tilts[antenna_id])
    ]

    seen.add(key)
    candidates.append(
        {
            "id": candidate_id,
            "label": label,
            "tilts": tilts,
            "changes": changes,
        }
    )


def clamp_tilt(value, tilt):
    return round(
        min(
            max(
                float(value),
                float(tilt.min),
            ),
            float(tilt.max),
        ),
        6,
    )


def format_step(step):
    if float(step).is_integer():
        return str(int(step))
    return str(step)


def evaluate_objective(kpis, objective):
    metric = objective_value(objective, "metric")
    operator = objective_value(objective, "operator")
    target = numeric_value(objective_value(objective, "target"))
    actual = numeric_value(kpis.get(metric))

    if target is None:
        raise ValueError("optimization objective target must be numeric")

    if actual is None:
        return {
            "metric": metric,
            "operator": operator,
            "target": target,
            "actual": None,
            "passed": False,
            "score": math.inf,
        }

    passed = compare_metric(actual, operator, target)

    return {
        "metric": metric,
        "operator": operator,
        "target": target,
        "actual": actual,
        "passed": passed,
        "score": objective_score(actual, operator, target),
    }


def compare_metric(actual, operator, target):
    if operator == "<":
        return actual < target
    if operator == "<=":
        return actual <= target
    if operator == ">":
        return actual > target
    if operator == ">=":
        return actual >= target
    if operator == "=":
        return math.isclose(actual, target)
    raise ValueError(f"Unsupported optimization operator: {operator}")


def objective_score(actual, operator, target):
    if operator in ("<", "<="):
        return max(0.0, actual - target)
    if operator in (">", ">="):
        return max(0.0, target - actual)
    if operator == "=":
        return abs(actual - target)
    raise ValueError(f"Unsupported optimization operator: {operator}")


def network_coverage_grid(result_or_grid):
    if not isinstance(result_or_grid, dict):
        return {}

    grid = result_or_grid.get("grid")
    if isinstance(grid, dict):
        return grid

    return result_or_grid


def is_no_coverage_cell(cell):
    if not isinstance(cell, dict):
        return True

    if cell.get("overlap_level") == NO_COVERAGE_LEVEL:
        return True

    overlap_count = numeric_value(cell.get("overlap_count"))
    if overlap_count is not None:
        return overlap_count <= 0

    return numeric_value(cell.get("sinr_db")) is None


def overlap_percent(cells, overlap_summary, total_cells):
    summary_value = numeric_value((overlap_summary or {}).get("overlap_percent"))
    if summary_value is not None:
        return summary_value

    overlap_cells = [
        cell
        for cell in cells
        if numeric_value(cell.get("overlap_count")) is not None
        and numeric_value(cell.get("overlap_count")) >= OVERLAP_MIN_COUNT
    ]
    return percent(len(overlap_cells), total_cells)


def average_overlap_count(cells, overlap_summary, covered_cells):
    summary_value = numeric_value((overlap_summary or {}).get("average_overlap_count"))
    if summary_value is not None:
        return summary_value

    counts = [
        numeric_value(cell.get("overlap_count"))
        for cell in covered_cells
    ]
    counts = [
        count
        for count in counts
        if count is not None and count > 0
    ]
    if not counts:
        return 0.0
    return round(sum(counts) / len(counts), 2)


def percent(part, total):
    if total <= 0:
        return 0.0
    return round((part / total) * 100.0, 2)


def numeric_value(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None

    if not math.isfinite(value):
        return None

    return value


def objective_value(objective, field):
    if isinstance(objective, dict):
        return objective.get(field)
    return getattr(objective, field)
