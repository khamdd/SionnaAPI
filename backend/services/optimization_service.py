import itertools
import math


NO_COVERAGE_LEVEL = "no_coverage"
OVERLAP_MIN_COUNT = 2


def run_network_coverage_optimization(req, simulate, progress=None):
    """Deterministic global exploration followed by diverse beam refinement."""
    trials = []
    baseline = best = best_result = best_request = best_rank = None
    stop_reason = "search_space_exhausted"
    beam_width = min(12, max(2, math.ceil(math.sqrt(req.max_candidates))))
    baseline_settings = {
        antenna.id: antenna_settings(antenna)
        for antenna in req.base_request.antennas
    }
    baseline_candidate = parameter_candidate(
        "baseline", "Current setup", baseline_settings, baseline_settings,
    )
    dimensions = optimization_dimensions(req)
    search_space_size = math.prod(len(dimension[2]) for dimension in dimensions)
    planned_total = min(req.max_candidates, search_space_size)
    exhaustive = search_space_size <= req.max_candidates
    seen = {settings_signature(baseline_settings)}
    frontier = []
    rounds_completed = 0
    global_tested = 0

    def run_candidate(candidate):
        nonlocal baseline, best, best_result, best_request, best_rank, stop_reason
        candidate_request = build_network_coverage_candidate_request(
            req.base_request, candidate.get("settings") or candidate["tilts"],
        )["request"]
        if progress:
            progress({"completed": len(trials), "total": planned_total, "current": candidate["label"]})
        try:
            result = simulate(candidate_request)
            if result.get("status") != "success" or not result.get("grid", {}).get("cells"):
                raise ValueError(result.get("error") or "Simulation returned no coverage cells")
            evaluation = evaluate_network_coverage_objectives(result, req.objectives)
        except Exception as exc:
            if candidate["id"] == "baseline":
                raise ValueError(f"Starting setup failed: {exc}") from exc
            trials.append({**candidate, "error": str(exc)})
            return None
        trial = {**candidate, "evaluation": evaluation}
        trials.append(trial)
        if baseline is None:
            baseline = trial
        rank = optimization_rank(evaluation)
        if best_rank is None or rank < best_rank:
            best, best_result, best_request, best_rank = trial, result, candidate_request, rank
        if evaluation["passed"]:
            stop_reason = "targets_met"
        return {"trial": trial, "rank": rank}

    baseline_node = run_candidate(baseline_candidate)
    global_nodes = [baseline_node]

    if stop_reason != "targets_met" and len(trials) < planned_total:
        if exhaustive:
            global_limit = planned_total - len(trials)
            global_candidates = exhaustive_parameter_candidates(
                dimensions, baseline_settings, seen, global_limit,
            )
        else:
            global_total = max(
                beam_width * 4,
                math.ceil(req.max_candidates * 0.4),
            )
            global_limit = min(
                req.max_candidates - len(trials),
                global_total - len(trials),
            )
            global_candidates = deterministic_global_candidates(
                dimensions, baseline_settings, seen, global_limit,
            )

        for candidate in global_candidates:
            node = run_candidate(candidate)
            if node is not None:
                global_nodes.append(node)
            if stop_reason == "targets_met" or len(trials) >= planned_total:
                break
    global_tested = len(trials)

    if (
        not exhaustive
        and stop_reason != "targets_met"
        and len(trials) < req.max_candidates
    ):
        frontier = select_diverse_beam(global_nodes, beam_width, dimensions)

    while frontier and stop_reason != "targets_met" and len(trials) < req.max_candidates:
        rounds_completed += 1
        layer = []
        candidates = interleaved_beam_candidates(
            frontier,
            req,
            baseline_settings,
            seen,
            round_number=rounds_completed,
            limit=req.max_candidates - len(trials),
            local_radius=min(3, rounds_completed + 1),
        )
        if not candidates:
            break
        for candidate in candidates:
            node = run_candidate(candidate)
            if node is not None:
                layer.append(node)
            if stop_reason == "targets_met" or len(trials) >= req.max_candidates:
                break
        if stop_reason == "targets_met":
            break
        frontier = select_diverse_beam(layer, beam_width, dimensions)

    if stop_reason != "targets_met" and len(trials) >= req.max_candidates:
        stop_reason = "budget_exhausted"
    if progress:
        progress({"completed": len(trials), "total": planned_total, "current": "Finished"})
    return {
        **best_result,
        "optimization": {
            "baseline": baseline, "best": best, "trials": trials,
            "stop_reason": stop_reason, "tested_count": len(trials),
            "budget_limit": req.max_candidates,
            "planned_total": planned_total,
            "search_strategy": (
                "deterministic_exhaustive_search"
                if exhaustive
                else "deterministic_global_beam_search"
            ),
            "search_space_size": search_space_size,
            "global_tested": global_tested,
            "local_tested": len(trials) - global_tested,
            "beam_width": beam_width,
            "rounds_completed": rounds_completed,
            "best_request": best_request.model_dump(mode="json"),
            "base_request": req.base_request.model_dump(mode="json"),
            "objectives": [objective.model_dump() for objective in req.objectives],
        },
    }


def optimization_rank(evaluation):
    """Rank passing configurations first, then the smallest normalized shortfall."""
    normalized_gap = sum(
        item["score"] / (10 if item["metric"] == "average_overlap_count" else 100)
        for item in evaluation["evaluations"]
    )
    return (
        not evaluation["passed"],
        normalized_gap,
        sum(not item["passed"] for item in evaluation["evaluations"]),
    )


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


def generate_network_coverage_parameter_candidates(req):
    antennas = list(getattr(req.base_request, "antennas", []) or [])
    variables = {variable.field for variable in getattr(req, "variables", [])}
    baseline = {
        antenna.id: antenna_settings(antenna)
        for antenna in antennas
    }
    candidates = []
    seen = set()

    add_parameter_candidate(
        candidates,
        seen,
        "baseline",
        "Current setup",
        baseline,
        baseline,
        req.max_candidates,
    )

    for field in ("tilt", "tx_power", "azimuth"):
        if field not in variables:
            continue
        for antenna in antennas:
            for value in candidate_values_for_field(antenna, field, req):
                settings = copy_settings(baseline)
                settings[antenna.id][field] = value
                add_parameter_candidate(
                    candidates,
                    seen,
                    f"{antenna.id}_{field}_{format_setting_value(value)}",
                    f"{antenna.id} {field_label(field)} {format_setting_value(value)}",
                    settings,
                    baseline,
                    req.max_candidates,
                )
                if len(candidates) >= req.max_candidates:
                    break
            if len(candidates) >= req.max_candidates:
                break
        if len(candidates) >= req.max_candidates:
            break

    return {
        "tilt_step": req.tilt_step,
        "power_step": req.power_step,
        "azimuth_step": req.azimuth_step,
        "max_candidates": req.max_candidates,
        "generated_count": len(candidates),
        "antenna_count": len(antennas),
        "candidates": candidates,
    }


def optimization_dimensions(req):
    variables = {variable.field for variable in getattr(req, "variables", [])}
    dimensions = []
    for antenna in list(getattr(req.base_request, "antennas", []) or []):
        for field in ("tilt", "tx_power", "azimuth"):
            if field not in variables:
                continue
            values = sorted(set(candidate_values_for_field(antenna, field, req)))
            dimensions.append((antenna.id, field, values))
    return dimensions


def exhaustive_parameter_candidates(
    dimensions,
    baseline_settings,
    seen,
    limit,
):
    candidates = []
    value_lists = [dimension[2] for dimension in dimensions]
    for combination in itertools.product(*value_lists):
        settings = copy_settings(baseline_settings)
        for (antenna_id, field, _), value in zip(dimensions, combination):
            settings[antenna_id][field] = value
        signature = settings_signature(settings)
        if signature in seen:
            continue
        seen.add(signature)
        candidates.append(parameter_candidate(
            f"global_exhaustive_{len(candidates) + 1}",
            f"Global exhaustive setup {len(candidates) + 1}",
            settings,
            baseline_settings,
        ))
        if len(candidates) >= limit:
            break
    return candidates


def deterministic_global_candidates(
    dimensions,
    baseline_settings,
    seen,
    limit,
):
    """Create space-filling full configurations without random sampling."""
    candidates = []

    def add_values(values, label):
        settings = copy_settings(baseline_settings)
        for (antenna_id, field, _), value in zip(dimensions, values):
            settings[antenna_id][field] = value
        signature = settings_signature(settings)
        if signature in seen:
            return
        seen.add(signature)
        candidates.append(parameter_candidate(
            f"global_{len(candidates) + 1}",
            label,
            settings,
            baseline_settings,
        ))

    anchors = [
        [values[0] for _, _, values in dimensions],
        [values[-1] for _, _, values in dimensions],
        [values[len(values) // 2] for _, _, values in dimensions],
        [values[-1] if index % 2 else values[0]
         for index, (_, _, values) in enumerate(dimensions)],
        [values[0] if index % 2 else values[-1]
         for index, (_, _, values) in enumerate(dimensions)],
    ]
    for index, values in enumerate(anchors, start=1):
        add_values(values, f"Global range anchor {index}")
        if len(candidates) >= limit:
            return candidates

    primes = first_primes(len(dimensions))
    sample_index = 1
    max_attempts = max(1000, limit * 100)
    while len(candidates) < limit and sample_index <= max_attempts:
        values = []
        for dimension_index, (_, _, dimension_values) in enumerate(dimensions):
            fraction = radical_inverse(sample_index, primes[dimension_index])
            value_index = min(
                int(fraction * len(dimension_values)),
                len(dimension_values) - 1,
            )
            values.append(dimension_values[value_index])
        add_values(values, f"Global exploration {sample_index}")
        sample_index += 1
    return candidates


def first_primes(count):
    primes = []
    candidate = 2
    while len(primes) < count:
        if all(candidate % prime for prime in primes if prime * prime <= candidate):
            primes.append(candidate)
        candidate += 1
    return primes


def radical_inverse(index, base):
    result = 0.0
    fraction = 1.0 / base
    while index:
        result += fraction * (index % base)
        index //= base
        fraction /= base
    return result


def select_diverse_beam(nodes, beam_width, dimensions):
    """Keep good configurations while preventing the whole beam from clustering."""
    ranked = sorted(nodes, key=lambda node: node["rank"])
    if len(ranked) <= beam_width:
        return ranked
    pool = ranked[:min(len(ranked), beam_width * 10)]
    selected = [pool.pop(0)]
    while pool and len(selected) < beam_width:
        best_index = max(
            range(len(pool)),
            key=lambda index: (
                min(
                    settings_distance(
                        pool[index]["trial"]["settings"],
                        chosen["trial"]["settings"],
                        dimensions,
                    )
                    for chosen in selected
                ),
                -index,
            ),
        )
        selected.append(pool.pop(best_index))
    return selected


def settings_distance(left, right, dimensions):
    if not dimensions:
        return 0.0
    distance = 0.0
    for antenna_id, field, values in dimensions:
        span = float(values[-1]) - float(values[0])
        if math.isclose(span, 0.0):
            continue
        distance += abs(
            float(left[antenna_id][field]) - float(right[antenna_id][field])
        ) / span
    return distance / len(dimensions)


def interleaved_beam_candidates(
    frontier,
    req,
    baseline_settings,
    seen,
    round_number,
    limit,
    local_radius,
):
    """Expand beam parents fairly so one antenna or field cannot consume the budget."""
    parent_mutations = []
    for parent_index, node in enumerate(frontier):
        mutations = list(parameter_mutations(
            node["trial"]["settings"], req, local_radius=local_radius,
        ))
        if mutations:
            stride = max(1, math.ceil(len(mutations) / len(frontier)))
            offset = (parent_index * stride) % len(mutations)
            mutations = mutations[offset:] + mutations[:offset]
        parent_mutations.append(mutations)
    candidates = []
    candidate_number = 0
    max_mutations = max((len(items) for items in parent_mutations), default=0)

    for mutation_index in range(max_mutations):
        for parent_index, mutations in enumerate(parent_mutations):
            if mutation_index >= len(mutations):
                continue
            antenna_id, field, value = mutations[mutation_index]
            parent_settings = frontier[parent_index]["trial"]["settings"]
            settings = copy_settings(parent_settings)
            settings[antenna_id][field] = value
            signature = settings_signature(settings)
            if signature in seen:
                continue
            seen.add(signature)
            candidate_number += 1
            candidates.append(parameter_candidate(
                f"beam_r{round_number}_{candidate_number}",
                f"Round {round_number}: {antenna_id} {field_label(field)} {format_setting_value(value)}",
                settings,
                baseline_settings,
            ))
            if len(candidates) >= limit:
                return candidates
    return candidates


def parameter_mutations(settings, req, local_radius=2):
    """Yield deterministic, near-to-far mutations interleaved across all dimensions."""
    variables = {variable.field for variable in getattr(req, "variables", [])}
    antennas = list(getattr(req.base_request, "antennas", []) or [])
    dimensions = []
    for antenna in antennas:
        for field in ("tilt", "tx_power", "azimuth"):
            if field not in variables:
                continue
            current = settings[antenna.id][field]
            legal_values = sorted(set(candidate_values_for_field(antenna, field, req)))
            values = nearby_parameter_values(legal_values, current, local_radius)
            dimensions.append((antenna.id, field, values))

    max_values = max((len(values) for _, _, values in dimensions), default=0)
    for value_index in range(max_values):
        for antenna_id, field, values in dimensions:
            if value_index < len(values):
                yield antenna_id, field, values[value_index]


def nearby_parameter_values(values, current, radius):
    current_index = min(
        range(len(values)),
        key=lambda index: abs(float(values[index]) - float(current)),
    )
    nearby = []
    for offset in range(1, radius + 1):
        for index in (current_index + offset, current_index - offset):
            if 0 <= index < len(values):
                nearby.append(values[index])
    return nearby


def parameter_candidate(candidate_id, label, settings, baseline_settings):
    changes = []
    for antenna_id in sorted(settings):
        for field in ("tilt", "tx_power", "azimuth"):
            before = baseline_settings[antenna_id][field]
            after = settings[antenna_id][field]
            if math.isclose(before, after):
                continue
            changes.append({
                "antenna_id": antenna_id,
                "field": field,
                "from": before,
                "to": after,
                "delta": round(after - before, 6),
            })
    return {
        "id": candidate_id,
        "label": label,
        "tilts": {
            antenna_id: values["tilt"]
            for antenna_id, values in settings.items()
        },
        "settings": copy_settings(settings),
        "changes": changes,
    }


def settings_signature(settings):
    return tuple(
        (
            antenna_id,
            settings[antenna_id]["tilt"],
            settings[antenna_id]["tx_power"],
            settings[antenna_id]["azimuth"],
        )
        for antenna_id in sorted(settings)
    )


def build_network_coverage_candidate_request(base_request, candidate_settings):
    antennas = list(getattr(base_request, "antennas", []) or [])
    antenna_by_id = {
        antenna.id: antenna
        for antenna in antennas
    }
    updated_antennas = []
    changes = []

    for antenna_id in candidate_settings:
        if antenna_id not in antenna_by_id:
            raise ValueError(f"Unknown antenna in candidate settings: {antenna_id}")

    for antenna in antennas:
        if antenna.id not in candidate_settings:
            updated_antennas.append(antenna)
            continue

        raw_settings = candidate_settings[antenna.id]
        if not isinstance(raw_settings, dict):
            raw_settings = {"tilt": raw_settings}

        next_tilt = numeric_value(raw_settings.get("tilt", antenna.tilt.current))
        next_power = numeric_value(raw_settings.get("tx_power", antenna.tx_power.current))
        next_azimuth = numeric_value(raw_settings.get("azimuth", antenna.azimuth))
        if next_tilt is None:
            raise ValueError(f"Candidate tilt for {antenna.id} must be numeric")
        if next_power is None:
            raise ValueError(f"Candidate power for {antenna.id} must be numeric")
        if next_azimuth is None:
            raise ValueError(f"Candidate azimuth for {antenna.id} must be numeric")

        if next_tilt < antenna.tilt.min or next_tilt > antenna.tilt.max:
            raise ValueError(
                f"Candidate tilt for {antenna.id} must be between "
                f"{antenna.tilt.min} and {antenna.tilt.max}"
            )
        if next_power < antenna.tx_power.min or next_power > antenna.tx_power.max:
            raise ValueError(
                f"Candidate power for {antenna.id} must be between "
                f"{antenna.tx_power.min} and {antenna.tx_power.max}"
            )
        if next_azimuth < 0 or next_azimuth > 360:
            raise ValueError(f"Candidate azimuth for {antenna.id} must be between 0 and 360")

        updated_tilt = antenna.tilt.model_copy(
            update={
                "current": next_tilt,
            },
        )
        updated_power = antenna.tx_power.model_copy(
            update={
                "current": next_power,
            },
        )
        updated_antennas.append(
            antenna.model_copy(
                update={
                    "tilt": updated_tilt,
                    "tx_power": updated_power,
                    "azimuth": next_azimuth,
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
        if not math.isclose(float(antenna.tx_power.current), next_power):
            changes.append(
                {
                    "antenna_id": antenna.id,
                    "field": "tx_power",
                    "from": float(antenna.tx_power.current),
                    "to": next_power,
                    "delta": round(next_power - float(antenna.tx_power.current), 6),
                }
            )
        if not math.isclose(float(antenna.azimuth), next_azimuth):
            changes.append(
                {
                    "antenna_id": antenna.id,
                    "field": "azimuth",
                    "from": float(antenna.azimuth),
                    "to": next_azimuth,
                    "delta": round(next_azimuth - float(antenna.azimuth), 6),
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


def add_parameter_candidate(
    candidates,
    seen,
    candidate_id,
    label,
    settings,
    baseline_settings,
    max_candidates,
):
    if len(candidates) >= max_candidates:
        return

    key = tuple(
        (
            antenna_id,
            settings[antenna_id]["tilt"],
            settings[antenna_id]["tx_power"],
            settings[antenna_id]["azimuth"],
        )
        for antenna_id in sorted(settings)
    )
    if key in seen:
        return

    changes = []
    for antenna_id in sorted(settings):
        for field in ("tilt", "tx_power", "azimuth"):
            before = baseline_settings[antenna_id][field]
            after = settings[antenna_id][field]
            if math.isclose(before, after):
                continue
            changes.append(
                {
                    "antenna_id": antenna_id,
                    "field": field,
                    "from": before,
                    "to": after,
                    "delta": round(after - before, 6),
                }
            )

    seen.add(key)
    candidates.append(
        {
            "id": candidate_id,
            "label": label,
            "tilts": {
                antenna_id: values["tilt"]
                for antenna_id, values in settings.items()
            },
            "settings": copy_settings(settings),
            "changes": changes,
        }
    )


def antenna_settings(antenna):
    return {
        "tilt": float(antenna.tilt.current),
        "tx_power": float(antenna.tx_power.current),
        "azimuth": float(antenna.azimuth),
    }


def copy_settings(settings):
    return {
        antenna_id: dict(values)
        for antenna_id, values in settings.items()
    }


def candidate_values_for_field(antenna, field, req):
    if field == "tilt":
        return ranged_values(antenna.tilt.min, antenna.tilt.max, req.tilt_step, antenna.tilt.current)
    if field == "tx_power":
        return ranged_values(antenna.tx_power.min, antenna.tx_power.max, req.power_step, antenna.tx_power.current)
    if field == "azimuth":
        return ranged_values(0.0, 360.0, req.azimuth_step, antenna.azimuth, include_upper=False)
    return []


def ranged_values(minimum, maximum, step, current, include_upper=True):
    values = [round(float(current), 6)]
    minimum = float(minimum)
    maximum = float(maximum)
    step = float(step)
    current = float(current)
    max_rings = math.ceil(max(abs(current - minimum), abs(maximum - current)) / step)
    for ring in range(1, max_rings + 1):
        for value in (current + (step * ring), current - (step * ring)):
            if value < minimum or value > maximum:
                continue
            if not include_upper and math.isclose(value, maximum):
                continue
            values.append(round(value, 6))
    if include_upper and not any(math.isclose(item, maximum) for item in values):
        values.append(round(maximum, 6))
    if not any(math.isclose(item, minimum) for item in values):
        values.append(round(minimum, 6))
    values = list(dict.fromkeys(values))
    return values


def field_label(field):
    return {
        "tilt": "tilt",
        "tx_power": "power",
        "azimuth": "azimuth",
    }.get(field, field)


def format_setting_value(value):
    return format_step(value).replace(".", "_")


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
    overlap_cells = [
        cell
        for cell in cells
        if numeric_value(cell.get("overlap_count")) is not None
        and numeric_value(cell.get("overlap_count")) >= OVERLAP_MIN_COUNT
    ]
    if cells:
        return percent(len(overlap_cells), total_cells)

    summary_value = numeric_value((overlap_summary or {}).get("overlap_percent"))
    return summary_value if summary_value is not None else 0.0


def average_overlap_count(cells, overlap_summary, covered_cells):
    counts = [
        numeric_value(cell.get("overlap_count"))
        for cell in covered_cells
    ]
    counts = [
        count
        for count in counts
        if count is not None and count > 0
    ]
    if counts:
        return sum(counts) / len(counts)

    summary_value = numeric_value((overlap_summary or {}).get("average_overlap_count"))
    return summary_value if summary_value is not None else 0.0


def percent(part, total):
    if total <= 0:
        return 0.0
    return (part / total) * 100.0


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
