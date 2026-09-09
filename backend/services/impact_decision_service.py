def final_decision(study_status: str | None, comparison: dict) -> str:
    """Return the conservative decision shared by reports and notifications."""
    if study_status != "completed" or comparison.get("status") not in {
        "complete",
        "empty",
    }:
        return "incomplete"

    profiles = comparison.get("profiles") or []
    if any(profile.get("status") != "compared" for profile in profiles):
        return "incomplete"

    objective_states = []
    local_regression = False
    for profile in profiles:
        local_regression = local_regression or bool(
            (profile.get("spatial") or {}).get("local_regression_present")
        )
        optimization = profile.get("optimization") or {}
        optimized_states = {
            item.get("metric"): item.get("status")
            for item in optimization.get("objective_results", [])
        }
        for objective in profile.get("objectives", []):
            objective_states.append(
                optimized_states.get(objective.get("metric"))
                if optimization.get("status") == "completed"
                else objective.get("candidate_status")
            )

    if any(state == "failed" for state in objective_states):
        return "fail"
    if objective_states and all(state == "passed" for state in objective_states):
        return "review" if local_regression else "pass"
    return "review"
