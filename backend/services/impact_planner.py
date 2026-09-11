import hashlib
import logging
from copy import deepcopy
from typing import Any, Iterable

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from backend.database import db_session, is_database_configured
from backend.models import NetworkConfiguration, SimulationProfile
from backend.schemas.requests import OptimizationObjective
from backend.services.configuration_diff_service import compare_configuration_snapshots
from backend.services.profile_diff_service import compare_profile_templates
from backend.services.scene_service import list_scenes
from backend.services.simulation_profile_service import validate_profile_definition

logger = logging.getLogger(__name__)

IMPACT_POLICY_VERSION = "impact-policy-v2"
NETWORK_LEVEL_TYPES = {"network_coverage", "rsrp_simulation"}
ROLE_BASED_TYPES = {"coverage_map", "sinr", "throughput_comparison"}
ANALYTICAL_MODELS = {"uma", "ericsson", "friis"}
ANALYTICAL_IGNORED_CHANGES = {"tilt", "azimuth", "position", "height"}

FIELD_CHANGE_CATEGORIES = {
    "enabled": "antenna_state",
    "longitude": "position",
    "latitude": "position",
    "height_m": "height",
    "tilt.min": "tilt",
    "tilt.current": "tilt",
    "tilt.max": "tilt",
    "tx_power.min": "power",
    "tx_power.current": "power",
    "tx_power.max": "power",
    "azimuth": "azimuth",
}


def preview_configuration_impact(
    baseline_configuration_id: str,
    candidate_configuration_id: str,
    profile_pairs: Iterable[Any],
    user_id: str,
) -> dict:
    """Build a side-effect-free v2 preview from explicitly selected profile pairs."""
    return _preview_configuration_impact(
        baseline_configuration_id,
        candidate_configuration_id,
        profile_pairs=profile_pairs,
        user_id=user_id,
        allow_implicit_profiles=False,
    )


def preview_configuration_impact_legacy(
    baseline_configuration_id: str,
    candidate_configuration_id: str,
    user_id: str,
) -> dict:
    """Keep v1 study creation operational until paired persistence lands in Slice 3."""
    result = _preview_configuration_impact(
        baseline_configuration_id,
        candidate_configuration_id,
        profile_pairs=None,
        user_id=user_id,
        allow_implicit_profiles=True,
    )
    if result.get("status") == "success":
        result["policy_version"] = "impact-policy-v1"
        result["optimization"] = {
            "planned": False,
            "reason": "Impact policy v1 does not automatically run optimization.",
        }
    return result


def _preview_configuration_impact(
    baseline_configuration_id: str,
    candidate_configuration_id: str,
    profile_pairs: Iterable[Any] | None,
    user_id: str,
    allow_implicit_profiles: bool,
) -> dict:
    if not is_database_configured():
        return _failure(503, "Impact planning requires a configured database.")

    try:
        with db_session() as session:
            baseline = session.get(NetworkConfiguration, baseline_configuration_id)
            candidate = session.get(NetworkConfiguration, candidate_configuration_id)
            if baseline is None or not _can_read_configuration(baseline, user_id):
                return _failure(404, "Baseline network configuration was not found.")
            if candidate is None or not _can_read_configuration(candidate, user_id):
                return _failure(404, "Candidate network configuration was not found.")
            if baseline.scene_id != candidate.scene_id:
                return _failure(400, "Configurations belong to different scenes.")

            scene_info = _find_ready_scene(baseline.scene_id)
            if scene_info is None:
                return _failure(404, "The configuration scene was not found or ready.")

            difference = compare_configuration_snapshots(
                baseline.antennas_json,
                candidate.antennas_json,
            )
            if not difference.get("changed"):
                return _failure(
                    400,
                    "Configurations do not contain a meaningful difference.",
                    error_code="no_meaningful_configuration_change",
                )

            if allow_implicit_profiles:
                resolved_pairs = _load_legacy_profile_pairs(session, baseline.scene_id)
            else:
                resolved_pairs = _load_explicit_profile_pairs(
                    session,
                    profile_pairs,
                    user_id,
                    baseline.scene_id,
                )
                if isinstance(resolved_pairs, dict):
                    return resolved_pairs

            return plan_configuration_impact(
                difference,
                resolved_pairs,
                baseline,
                candidate,
                scene_info,
                legacy_aliases=allow_implicit_profiles,
            )
    except (SQLAlchemyError, ValueError):
        logger.exception("Failed to preview configuration impact.")
        return _failure(500, "Failed to preview configuration impact.")


def plan_configuration_impact(
    difference: dict,
    profile_pairs: Iterable[dict],
    baseline_configuration: NetworkConfiguration,
    candidate_configuration: NetworkConfiguration,
    scene_info: dict,
    *,
    legacy_aliases: bool = False,
) -> dict:
    planned_simulations = []
    skipped_simulations = []

    for ordinal, raw_pair in enumerate(profile_pairs):
        pair = _normalize_planning_pair(raw_pair, ordinal)
        baseline_profile = pair["baseline_profile"]
        candidate_profile = pair["candidate_profile"]
        profile_difference = compare_profile_templates(
            _profile_template(baseline_profile),
            _profile_template(candidate_profile),
        )
        baseline_validation = validate_profile_definition(
            baseline_profile.simulation_type,
            _profile_template(baseline_profile),
            baseline_configuration,
            scene_info,
        )
        candidate_validation = validate_profile_definition(
            candidate_profile.simulation_type,
            _profile_template(candidate_profile),
            candidate_configuration,
            scene_info,
        )
        validation_skip = _validation_skip(
            pair,
            profile_difference,
            baseline_validation,
            candidate_validation,
        )
        if validation_skip:
            skipped_simulations.append(validation_skip)
            continue

        applicability = evaluate_profile_pair_impact(
            baseline_profile,
            candidate_profile,
            difference,
            profile_difference,
        )
        if applicability["action"] == "skip":
            skipped_simulations.append(
                _skipped_pair(pair, profile_difference, applicability)
            )
            continue

        planned = {
            "pair_id": pair["pair_id"],
            "ordinal": pair["ordinal"],
            "simulation_type": baseline_profile.simulation_type,
            "baseline_profile": _profile_snapshot(baseline_profile),
            "candidate_profile": _profile_snapshot(candidate_profile),
            "profile_difference": profile_difference,
            "triggering_changes": applicability["triggering_changes"],
            "affected_antennas": applicability["affected_antennas"],
            "baseline_request": baseline_validation["request"],
            "candidate_request": candidate_validation["request"],
            "objectives": pair["objectives"],
            "comparability_warnings": _comparability_warnings(
                baseline_profile,
                profile_difference,
            ),
            "job_count": 2,
        }
        if legacy_aliases:
            planned.update(
                {
                    "profile_id": str(baseline_profile.id),
                    "profile_name": baseline_profile.name,
                    "propagation_model": _propagation_model(baseline_profile),
                }
            )
        planned_simulations.append(planned)

    estimated_job_count = sum(
        simulation["job_count"] for simulation in planned_simulations
    )
    return {
        "status": "success",
        "policy_version": IMPACT_POLICY_VERSION,
        "scene_id": baseline_configuration.scene_id,
        "baseline": _configuration_identity(baseline_configuration),
        "candidate": _configuration_identity(candidate_configuration),
        "difference": difference,
        "planned_simulations": planned_simulations,
        "skipped_simulations": skipped_simulations,
        "estimated_job_count": estimated_job_count,
        "optimization": {
            "planned": False,
            "reason": "Impact policy v2 does not automatically run optimization.",
        },
    }


def evaluate_profile_pair_impact(
    baseline_profile: SimulationProfile,
    candidate_profile: SimulationProfile,
    difference: dict,
    profile_difference: dict,
) -> dict:
    configuration_categories = classify_difference(difference)
    profile_fields = profile_difference.get("changed_fields", [])
    profiles_changed = bool(profile_difference.get("changed"))

    if not difference.get("changed") and not profiles_changed:
        return _skip(
            "no_meaningful_change",
            "No meaningful configuration or profile change was detected.",
        )
    if not configuration_categories and not profiles_changed:
        return _skip(
            "unsupported_change",
            "The detected changes are not covered by this policy version.",
        )

    affected_antennas = set(difference.get("changed_antennas", []))
    if baseline_profile.simulation_type in ROLE_BASED_TYPES:
        role_antennas = _profile_role_antennas(baseline_profile).union(
            _profile_role_antennas(candidate_profile)
        )
        affected_roles = affected_antennas.intersection(role_antennas)
        if profiles_changed:
            affected_roles.update(role_antennas)
        if not affected_roles:
            return _skip(
                "unaffected_profile_roles",
                "None of this pair's antenna roles use an affected antenna.",
            )
    elif baseline_profile.simulation_type in NETWORK_LEVEL_TYPES:
        affected_roles = affected_antennas
    else:
        return _skip(
            "unsupported_profile_type",
            "This simulation type is not covered by the current impact policy.",
        )

    triggering_configuration_categories = set(configuration_categories)
    models = {
        _propagation_model(baseline_profile),
        _propagation_model(candidate_profile),
    }
    if (
        baseline_profile.simulation_type in {"sinr", "throughput_comparison"}
        and models.issubset(ANALYTICAL_MODELS)
    ):
        triggering_configuration_categories.difference_update(
            ANALYTICAL_IGNORED_CHANGES
        )
        if not triggering_configuration_categories and not profiles_changed:
            ignored = ", ".join(sorted(configuration_categories))
            return _skip(
                "propagation_model_ignores_change",
                "The selected analytical propagation model(s) do not use the "
                f"affected fields: {ignored}.",
            )

    return {
        "action": "plan",
        "triggering_changes": {
            "configuration_changes": sorted(triggering_configuration_categories),
            "profile_changes": list(profile_fields),
        },
        "affected_antennas": sorted(affected_roles),
    }


def classify_difference(difference: dict) -> set[str]:
    categories = set()
    for change in difference.get("changes", []):
        change_type = change.get("change_type")
        if change_type in {"antenna_added", "antenna_removed"}:
            categories.add("antenna_topology")
            continue
        category = FIELD_CHANGE_CATEGORIES.get(change.get("field"))
        if category:
            categories.add(category)
    return categories


def _load_explicit_profile_pairs(
    session,
    requested_pairs: Iterable[Any] | None,
    user_id: str,
    scene_id: str,
) -> list[dict] | dict:
    requested_pairs = list(requested_pairs or [])
    if not 1 <= len(requested_pairs) <= 20:
        return _failure(
            400,
            "Select between one and 20 profile pairs.",
            error_code="invalid_profile_pair_count",
        )

    resolved_profiles: dict[str, SimulationProfile] = {}
    resolved_pairs = []
    seen_pairs = set()
    for ordinal, requested_pair in enumerate(requested_pairs):
        baseline_id = _requested_profile_id(requested_pair, "baseline_profile_id")
        candidate_id = _requested_profile_id(requested_pair, "candidate_profile_id")
        identity = (baseline_id, candidate_id)
        if identity in seen_pairs:
            return _failure(
                400,
                "Profile pairs must be unique.",
                error_code="duplicate_profile_pair",
                pair_ordinal=ordinal,
            )
        seen_pairs.add(identity)

        side_profiles = {}
        for side, profile_id in (
            ("baseline", baseline_id),
            ("candidate", candidate_id),
        ):
            profile = resolved_profiles.get(profile_id)
            if profile is None:
                profile = session.get(SimulationProfile, profile_id)
                if profile is not None:
                    resolved_profiles[profile_id] = profile
            if profile is None or not _can_read_profile(profile, user_id):
                return _failure(
                    404,
                    f"The selected {side} profile was not found.",
                    error_code="profile_not_found",
                    pair_ordinal=ordinal,
                    side=side,
                    profile_id=profile_id,
                )
            if profile.scene_id != scene_id:
                return _failure(
                    400,
                    f"The selected {side} profile belongs to a different scene.",
                    error_code="profile_scene_mismatch",
                    pair_ordinal=ordinal,
                    side=side,
                    profile_id=profile_id,
                )
            if not profile.enabled:
                return _failure(
                    409,
                    f"The selected {side} profile is not enabled.",
                    error_code="profile_not_enabled",
                    pair_ordinal=ordinal,
                    side=side,
                    profile_id=profile_id,
                )
            side_profiles[side] = profile

        if side_profiles["baseline"].simulation_type != side_profiles[
            "candidate"
        ].simulation_type:
            return _failure(
                400,
                "A profile pair must use the same simulation type on both sides.",
                error_code="profile_simulation_type_mismatch",
                pair_ordinal=ordinal,
                baseline_simulation_type=side_profiles["baseline"].simulation_type,
                candidate_simulation_type=side_profiles["candidate"].simulation_type,
            )

        simulation_type = side_profiles["baseline"].simulation_type
        try:
            objectives = _requested_objectives(requested_pair)
        except (TypeError, ValueError, ValidationError) as exc:
            return _failure(
                422,
                f"Profile-pair objectives are invalid: {exc}",
                error_code="invalid_profile_pair_objectives",
                pair_ordinal=ordinal,
            )
        if simulation_type == "network_coverage" and not 1 <= len(objectives) <= 2:
            return _failure(
                422,
                "Network Coverage pairs require one or two shared objectives.",
                error_code="invalid_profile_pair_objectives",
                pair_ordinal=ordinal,
            )
        if simulation_type != "network_coverage" and objectives:
            return _failure(
                422,
                "Shared objectives are currently supported only for Network Coverage pairs.",
                error_code="unsupported_profile_pair_objectives",
                pair_ordinal=ordinal,
            )

        resolved_pairs.append(
            {
                "pair_id": _pair_id(ordinal, baseline_id, candidate_id),
                "ordinal": ordinal,
                "baseline_profile": side_profiles["baseline"],
                "candidate_profile": side_profiles["candidate"],
                "objectives": objectives,
            }
        )
    return resolved_pairs


def _load_legacy_profile_pairs(session, scene_id: str) -> list[dict]:
    profiles = session.scalars(
        select(SimulationProfile)
        .where(
            SimulationProfile.scene_id == scene_id,
            SimulationProfile.enabled.is_(True),
        )
        .order_by(
            SimulationProfile.simulation_type,
            SimulationProfile.name,
            SimulationProfile.id,
        )
    ).all()
    return [
        {
            "pair_id": _pair_id(ordinal, str(profile.id), str(profile.id)),
            "ordinal": ordinal,
            "baseline_profile": profile,
            "candidate_profile": profile,
            "objectives": _legacy_profile_objectives(profile),
        }
        for ordinal, profile in enumerate(profiles)
    ]


def _normalize_planning_pair(raw_pair: dict, ordinal: int) -> dict:
    baseline_profile = raw_pair["baseline_profile"]
    candidate_profile = raw_pair["candidate_profile"]
    if baseline_profile.simulation_type != candidate_profile.simulation_type:
        raise ValueError("A profile pair must use the same simulation type.")
    return {
        "pair_id": raw_pair.get("pair_id")
        or _pair_id(ordinal, str(baseline_profile.id), str(candidate_profile.id)),
        "ordinal": raw_pair.get("ordinal", ordinal),
        "baseline_profile": baseline_profile,
        "candidate_profile": candidate_profile,
        "objectives": _requested_objectives(raw_pair),
    }


def _validation_skip(
    pair: dict,
    profile_difference: dict,
    baseline_validation: dict,
    candidate_validation: dict,
) -> dict | None:
    side_reasons = {}
    for label, result in (
        ("baseline", baseline_validation),
        ("candidate", candidate_validation),
    ):
        if result.get("status") == "failure":
            side_reasons[label] = {
                "reason_code": result.get("error_code", "invalid_profile"),
                "reason": result.get("skip_reason") or result.get("error"),
            }

    if not side_reasons:
        return None
    return _pair_identity(pair, profile_difference) | {
        "reason_code": "invalid_or_incomplete_profile",
        "reason": "; ".join(
            f"{side}: {details['reason']}"
            for side, details in side_reasons.items()
        ),
        "side_reasons": side_reasons,
    }


def _skipped_pair(pair: dict, profile_difference: dict, reason: dict) -> dict:
    return _pair_identity(pair, profile_difference) | {
        "reason_code": reason["reason_code"],
        "reason": reason["reason"],
        "side_reasons": {},
    }


def _pair_identity(pair: dict, profile_difference: dict) -> dict:
    return {
        "pair_id": pair["pair_id"],
        "ordinal": pair["ordinal"],
        "simulation_type": pair["baseline_profile"].simulation_type,
        "baseline_profile": _profile_snapshot(pair["baseline_profile"]),
        "candidate_profile": _profile_snapshot(pair["candidate_profile"]),
        "objectives": deepcopy(pair["objectives"]),
        "profile_difference": profile_difference,
        "comparability_warnings": _comparability_warnings(
            pair["baseline_profile"],
            profile_difference,
        ),
    }


def _profile_snapshot(profile: SimulationProfile) -> dict:
    return {
        "id": str(profile.id),
        "name": profile.name,
        "simulation_type": profile.simulation_type,
        "template": deepcopy(_profile_template(profile)),
    }


def _profile_template(profile: SimulationProfile) -> dict:
    template = profile.request_template_json
    if not isinstance(template, dict):
        return {}
    result = dict(template)
    result.pop("objectives", None)
    return result


def _profile_role_antennas(profile: SimulationProfile) -> set[str]:
    roles = _profile_template(profile).get("roles")
    if not isinstance(roles, dict):
        return set()
    return {
        str(antenna_id).strip()
        for antenna_id in roles.values()
        if str(antenna_id).strip()
    }


def _propagation_model(profile: SimulationProfile) -> str:
    if profile.simulation_type in {"sinr", "throughput_comparison"}:
        return str(_profile_template(profile).get("propagation_model", "sionna")).lower()
    return "sionna"


def _comparability_warnings(
    profile: SimulationProfile,
    profile_difference: dict,
) -> list[dict]:
    changed_fields = set(profile_difference.get("changed_fields", []))
    warnings = []
    if "propagation_model" in changed_fields:
        warnings.append(
            {
                "code": "propagation_methodology_changed",
                "message": "The scenarios use different propagation models.",
                "fields": ["propagation_model"],
            }
        )

    sampling_fields = sorted(
        changed_fields.intersection({"user_count", "random_seed"})
    )
    if profile.simulation_type == "rsrp_simulation" and sampling_fields:
        warnings.append(
            {
                "code": "sampling_changed",
                "message": "The RSRP scenarios use different sampling settings.",
                "fields": sampling_fields,
            }
        )

    grid_roots = ("solver.cell_size", "solver.center", "solver.size")
    grid_fields = sorted(
        field
        for field in changed_fields
        if any(
            field == root
            or field.startswith(f"{root}[")
            or field.startswith(f"{root}.")
            for root in grid_roots
        )
    )
    if grid_fields:
        warnings.append(
            {
                "code": "spatial_grid_changed",
                "message": (
                    "Aggregate results may remain comparable, but cell-by-cell "
                    "spatial comparison may be unavailable."
                ),
                "fields": grid_fields,
            }
        )
    return warnings


def _requested_profile_id(requested_pair: Any, field_name: str) -> str:
    if isinstance(requested_pair, dict):
        value = requested_pair.get(field_name)
    else:
        value = getattr(requested_pair, field_name, None)
    value = str(value or "").strip()
    if not value:
        raise ValueError(f"{field_name} is required")
    return value


def _requested_objectives(requested_pair: Any) -> list[dict]:
    if isinstance(requested_pair, dict):
        raw_objectives = requested_pair.get("objectives") or []
    else:
        raw_objectives = getattr(requested_pair, "objectives", None) or []
    objectives = [
        (
            objective
            if isinstance(objective, OptimizationObjective)
            else OptimizationObjective.model_validate(objective)
        )
        for objective in raw_objectives
    ]
    metrics = [objective.metric for objective in objectives]
    if len(metrics) != len(set(metrics)):
        raise ValueError("Profile-pair objective metrics must be unique.")
    return [objective.model_dump(mode="json") for objective in objectives]


def _legacy_profile_objectives(profile: SimulationProfile) -> list[dict]:
    template = profile.request_template_json
    if not isinstance(template, dict):
        return []
    try:
        return _requested_objectives({"objectives": template.get("objectives")})
    except (TypeError, ValueError, ValidationError):
        return []


def _pair_id(ordinal: int, baseline_profile_id: str, candidate_profile_id: str) -> str:
    raw_identity = f"{ordinal}:{baseline_profile_id}:{candidate_profile_id}"
    digest = hashlib.sha256(raw_identity.encode("utf-8")).hexdigest()
    return f"pair-{digest[:24]}"


def _skip(reason_code: str, reason: str) -> dict:
    return {"action": "skip", "reason_code": reason_code, "reason": reason}


def _configuration_identity(configuration: NetworkConfiguration) -> dict:
    return {
        "id": str(configuration.id),
        "version": configuration.version,
        "status": configuration.status,
        "content_hash": configuration.content_hash,
    }


def _find_ready_scene(scene_id: str) -> dict | None:
    scenes = list_scenes().get("scenes", [])
    return next(
        (
            scene
            for scene in scenes
            if scene.get("id") == scene_id and scene.get("status") == "ready"
        ),
        None,
    )


def _can_read_configuration(
    configuration: NetworkConfiguration,
    user_id: str,
) -> bool:
    return configuration.status != "draft" or configuration.created_by == user_id


def _can_read_profile(profile: SimulationProfile, user_id: str) -> bool:
    return profile.enabled or profile.created_by == user_id


def _failure(status_code: int, error: str, **details: Any) -> dict:
    return {
        "status": "failure",
        "status_code": status_code,
        "error": error,
        **details,
    }
