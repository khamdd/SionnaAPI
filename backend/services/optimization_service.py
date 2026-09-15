import itertools
import math

from backend.services.network_coverage_kpis import (
    calculate_percentile,
    calculate_threshold_area_percent,
)
from backend.services.network_coverage_kpis import (
    extract_network_coverage_kpis as extract_network_coverage_kpis,
)
from backend.services.network_coverage_kpis import (
    is_no_coverage_cell as is_no_coverage_cell,
)
from backend.services.network_coverage_kpis import (
    network_coverage_grid as network_coverage_grid,
)
from backend.services.network_coverage_kpis import (
    numeric_value as numeric_value,
)


def run_network_coverage_optimization(req, simulate, progress=None):
    """Deterministic global exploration followed by diverse beam refinement."""
    trials = []
    baseline = baseline_result = best = best_result = best_request = best_rank = None
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
    pruned_branches = 0
    refinement_stalled = False

    def run_candidate(candidate):
        nonlocal baseline, baseline_result, best, best_result, best_request, best_rank
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
            baseline_kpis = (
                baseline["evaluation"]["kpis"] if baseline is not None else evaluation["kpis"]
            )
            guardrail_evaluations = evaluate_guardrails(
                evaluation["kpis"], req.guardrails, baseline_kpis,
            )
            evaluation["guardrails"] = guardrail_evaluations
            evaluation["objectives_passed"] = evaluation["passed"]
            evaluation["guardrails_passed"] = all(
                item["passed"] for item in guardrail_evaluations
            )
            evaluation["passed"] = (
                evaluation["objectives_passed"] and evaluation["guardrails_passed"]
            )
        except Exception as exc:
            if candidate["id"] == "baseline":
                raise ValueError(f"Starting setup failed: {exc}") from exc
            trials.append({**candidate, "error": str(exc)})
            return None
        trial = {
            **candidate,
            "evaluation": evaluation,
            "change_cost": candidate_change_cost(candidate),
        }
        trials.append(trial)
        if baseline is None:
            baseline = trial
            baseline_result = result
        rank = optimization_rank(evaluation, trial)
        if best_rank is None or rank < best_rank:
            best, best_result, best_request, best_rank = trial, result, candidate_request, rank
        return {"trial": trial, "rank": rank}

    baseline_node = run_candidate(baseline_candidate)
    global_nodes = [baseline_node]

    if len(trials) < planned_total:
        if exhaustive:
            global_limit = planned_total - len(trials)
            global_candidates = exhaustive_parameter_candidates(
                dimensions, baseline_settings, seen, global_limit, req,
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
                dimensions, baseline_settings, seen, global_limit, req,
            )

        for candidate in global_candidates:
            node = run_candidate(candidate)
            if node is not None:
                global_nodes.append(node)
            if len(trials) >= planned_total:
                break
    global_tested = len(trials)

    if (
        not exhaustive
        and len(trials) < req.max_candidates
    ):
        frontier = select_diverse_beam(global_nodes, beam_width, dimensions)

    while frontier and len(trials) < req.max_candidates:
        rounds_completed += 1
        layer = []
        round_limit = min(
            req.max_candidates - len(trials),
            beam_width * 3,
        )
        candidates = interleaved_beam_candidates(
            frontier,
            req,
            baseline_settings,
            seen,
            round_number=rounds_completed,
            limit=round_limit,
            local_radius=min(3, rounds_completed + 1),
        )
        if not candidates:
            break
        for candidate in candidates:
            node = run_candidate(candidate)
            if node is not None:
                layer.append(node)
            if len(trials) >= req.max_candidates:
                break
        parent_refinement_ranks = {
            node["trial"]["id"]: refinement_rank(node["trial"])
            for node in frontier
        }
        improving_nodes = [
            node for node in layer
            if refinement_rank(node["trial"]) < parent_refinement_ranks.get(
                node["trial"].get("parent_id"), refinement_rank(node["trial"]),
            )
        ]
        improving_parent_ids = {
            node["trial"].get("parent_id")
            for node in improving_nodes
        }
        pruned_branches += sum(
            node["trial"]["id"] not in improving_parent_ids
            for node in frontier
        )
        if not improving_nodes:
            refinement_stalled = True
            break
        frontier = select_diverse_beam(improving_nodes, beam_width, dimensions)

    if best["evaluation"]["passed"]:
        stop_reason = "targets_met"
    elif len(trials) >= req.max_candidates:
        stop_reason = "budget_exhausted"
    elif refinement_stalled:
        stop_reason = "refinement_stalled"
    successful_trials = [trial for trial in trials if "evaluation" in trial]
    ranked_trials = sorted(
        successful_trials,
        key=lambda trial: optimization_rank(trial["evaluation"], trial),
    )
    alternatives = [trial for trial in ranked_trials if trial["id"] != best["id"]][:3]
    if progress:
        progress({"completed": len(trials), "total": planned_total, "current": "Finished"})
    return {
        **best_result,
        "optimization": {
            "baseline": baseline, "best": best, "trials": trials,
            "recommended_candidate": best,
            "alternatives": alternatives,
            "recommendation_reason": recommendation_reason(best),
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
            "pruned_branches": pruned_branches,
            "budget_saved": max(0, req.max_candidates - len(trials)),
            "best_request": best_request.model_dump(mode="json"),
            "base_request": req.base_request.model_dump(mode="json"),
            "objectives": [objective.model_dump() for objective in req.objectives],
            "guardrails": [guardrail.model_dump() for guardrail in req.guardrails],
            "comparison": {
                "baseline_grid": baseline_result.get("grid"),
            },
        },
    }


def optimization_rank(evaluation, candidate=None):
    """Rank goal fit first, then prefer fewer and smaller operational changes."""
    normalized_gap = sum(
        item["score"] / item.get("normalization_scale", 100)
        for item in evaluation["evaluations"]
    )
    change_cost = (candidate or {}).get("change_cost") or {
        "changed_antennas": 0,
        "normalized_magnitude": 0.0,
    }
    return (
        not evaluation.get("guardrails_passed", True),
        not evaluation.get("objectives_passed", evaluation["passed"]),
        normalized_gap,
        sum(not item["passed"] for item in evaluation["evaluations"]),
        change_cost["changed_antennas"],
        change_cost["normalized_magnitude"],
    )


def refinement_rank(candidate):
    """Rank branch progress without operational-change tie breakers."""
    return optimization_rank(candidate["evaluation"], candidate)[:4]


def candidate_change_cost(candidate):
    changes = candidate.get("changes") or []
    changed_antennas = {change["antenna_id"] for change in changes}
    normalized_magnitude = 0.0
    for change in changes:
        field = change.get("field") or "tilt"
        delta = abs(float(change.get("delta", 0)))
        if field == "azimuth":
            delta = min(delta, 360.0 - delta)
        normalized_magnitude += delta / {
            "tilt": 20.0,
            "tx_power": 20.0,
            "azimuth": 180.0,
        }.get(field, 1.0)
    return {
        "changed_antennas": len(changed_antennas),
        "normalized_magnitude": round(normalized_magnitude, 6),
    }


def recommendation_reason(candidate):
    if candidate["id"] == "baseline":
        return "The starting setup ranked highest, so no antenna changes are recommended."
    if candidate["evaluation"]["passed"]:
        return (
            "This setup meets every target and ranked best after preferring fewer "
            "changed antennas and smaller setting adjustments."
        )
    if not candidate["evaluation"].get("guardrails_passed", True):
        return (
            "No tested setup satisfied every safety guardrail. This is the "
            "highest-ranked result, but it should not be applied without review."
        )
    return (
        "No tested setup met every target. This setup has the smallest combined "
        "target shortfall, then the lowest change cost."
    )


def evaluate_guardrails(kpis, guardrails, baseline_kpis):
    lower_is_better = {
        "uncovered_area_percent",
        "overlap_area_percent",
        "average_overlap_count",
    }
    evaluations = []
    for guardrail in guardrails:
        metric = objective_value(guardrail, "metric")
        maximum = numeric_value(objective_value(guardrail, "max_regression"))
        baseline = numeric_value(baseline_kpis.get(metric))
        actual = numeric_value(kpis.get(metric))
        if baseline is None or actual is None:
            regression = None
            passed = False
        else:
            regression = max(
                0.0,
                actual - baseline if metric in lower_is_better else baseline - actual,
            )
            passed = regression <= maximum
        evaluations.append({
            "metric": metric,
            "baseline": baseline,
            "actual": actual,
            "max_regression": maximum,
            "regression": regression,
            "passed": passed,
        })
    return evaluations


def evaluate_network_coverage_objectives(result_or_grid, objectives):
    kpis = extract_network_coverage_kpis(result_or_grid)
    evaluations = [
        evaluate_objective(kpis, objective, result_or_grid)
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


def optimization_dimensions(req):
    variables = {variable.field for variable in getattr(req, "variables", [])}
    eligible = set(req.eligible_antenna_ids or [])
    dimensions = []
    for antenna in list(getattr(req.base_request, "antennas", []) or []):
        if eligible and antenna.id not in eligible:
            continue
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
    req=None,
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
        if req is not None and not candidate_settings_allowed(settings, baseline_settings, req):
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
    req=None,
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
        if req is not None and not candidate_settings_allowed(settings, baseline_settings, req):
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
            if not candidate_settings_allowed(settings, baseline_settings, req):
                continue
            seen.add(signature)
            candidate_number += 1
            candidates.append(parameter_candidate(
                f"beam_r{round_number}_{candidate_number}",
                f"Round {round_number}: {antenna_id} {field_label(field)} {format_setting_value(value)}",
                settings,
                baseline_settings,
            ))
            candidates[-1]["parent_id"] = frontier[parent_index]["trial"]["id"]
            if len(candidates) >= limit:
                return candidates
    return candidates


def parameter_mutations(settings, req, local_radius=2):
    """Yield deterministic, near-to-far mutations interleaved across all dimensions."""
    variables = {variable.field for variable in getattr(req, "variables", [])}
    eligible = set(req.eligible_antenna_ids or [])
    antennas = list(getattr(req.base_request, "antennas", []) or [])
    dimensions = []
    for antenna in antennas:
        if eligible and antenna.id not in eligible:
            continue
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
        values = ranged_values(antenna.tilt.min, antenna.tilt.max, req.tilt_step, antenna.tilt.current)
        return limit_parameter_change(values, antenna.tilt.current, req.max_tilt_change)
    if field == "tx_power":
        values = ranged_values(antenna.tx_power.min, antenna.tx_power.max, req.power_step, antenna.tx_power.current)
        return limit_parameter_change(values, antenna.tx_power.current, req.max_power_change)
    if field == "azimuth":
        values = ranged_values(0.0, 360.0, req.azimuth_step, antenna.azimuth, include_upper=False)
        return limit_parameter_change(values, antenna.azimuth, req.max_azimuth_change, circular=True)
    return []


def limit_parameter_change(values, current, maximum, circular=False):
    if maximum is None:
        return values
    kept = []
    for value in values:
        distance = abs(float(value) - float(current))
        if circular:
            distance = min(distance, 360.0 - distance)
        if distance <= maximum:
            kept.append(value)
    return kept


def candidate_settings_allowed(settings, baseline_settings, req):
    changed = {
        antenna_id
        for antenna_id, values in settings.items()
        if any(
            not math.isclose(values[field], baseline_settings[antenna_id][field])
            for field in ("tilt", "tx_power", "azimuth")
        )
    }
    if req.max_changed_antennas is not None and len(changed) > req.max_changed_antennas:
        return False
    if req.prevent_total_power_increase:
        candidate_power = total_transmit_power_mw(settings)
        baseline_power = total_transmit_power_mw(baseline_settings)
        if candidate_power > baseline_power and not math.isclose(
            candidate_power, baseline_power, rel_tol=1e-9, abs_tol=1e-12,
        ):
            return False
    return True


def total_transmit_power_mw(settings):
    """Return aggregate configured transmit power after converting dBm to mW."""
    return math.fsum(
        10 ** (float(values["tx_power"]) / 10.0)
        for values in settings.values()
    )


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


def format_step(step):
    if float(step).is_integer():
        return str(int(step))
    return str(step)


def evaluate_objective(kpis, objective, result_or_grid=None):
    kind = objective_value(objective, "kind") or "aggregate"
    metric = objective_value(objective, "metric")
    operator = objective_value(objective, "operator")
    target = numeric_value(objective_value(objective, "target"))

    if target is None:
        raise ValueError("optimization objective target must be numeric")

    details = {"kind": kind}
    normalization_scale = 100
    if kind == "threshold_area":
        measurement = objective_value(objective, "measurement")
        threshold_operator = objective_value(objective, "threshold_operator")
        threshold = objective_value(objective, "threshold")
        grid = network_coverage_grid(result_or_grid)
        cells = grid.get("cells") if isinstance(grid, dict) else []
        threshold_result = calculate_threshold_area_percent(
            cells, measurement, threshold_operator, threshold,
        )
        metric = f"{measurement}_threshold_area_percent"
        actual = threshold_result["area_percent"]
        details.update({
            "measurement": measurement,
            "threshold_operator": threshold_operator,
            "threshold": numeric_value(threshold),
            **threshold_result,
        })
    elif kind == "percentile":
        measurement = objective_value(objective, "measurement")
        percentile_value = objective_value(objective, "percentile")
        grid = network_coverage_grid(result_or_grid)
        cells = grid.get("cells") if isinstance(grid, dict) else []
        actual = calculate_percentile(cells, measurement, percentile_value)
        metric = f"{measurement}_p{int(percentile_value)}"
        normalization_scale = 100 if measurement == "throughput_mbps" else 10
        details.update({
            "measurement": measurement,
            "percentile": int(percentile_value),
        })
    else:
        actual = numeric_value(kpis.get(metric))
        normalization_scale = 10 if metric == "average_overlap_count" else 100

    if actual is None:
        return {
            **details,
            "metric": metric,
            "operator": operator,
            "target": target,
            "actual": None,
            "passed": False,
            "score": math.inf,
            "normalization_scale": normalization_scale,
        }

    passed = compare_metric(actual, operator, target)

    return {
        **details,
        "metric": metric,
        "operator": operator,
        "target": target,
        "actual": actual,
        "passed": passed,
        "score": objective_score(actual, operator, target),
        "normalization_scale": normalization_scale,
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


def objective_value(objective, field):
    if isinstance(objective, dict):
        return objective.get(field)
    return getattr(objective, field)
