import logging
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from backend.database import db_session, is_database_configured
from backend.models import NetworkConfiguration, SimulationProfile
from backend.services.configuration_diff_service import (
    compare_configuration_snapshots,
)
from backend.services.scene_service import list_scenes
from backend.services.simulation_profile_service import validate_profile_definition


logger = logging.getLogger(__name__)

IMPACT_POLICY_VERSION = "impact-policy-v1"
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
    user_id: str,
) -> dict:
    if not is_database_configured():
        return _failure(
            503,
            "Impact planning requires a configured database.",
        )

    try:
        with db_session() as session:
            baseline = session.get(
                NetworkConfiguration,
                baseline_configuration_id,
            )
            candidate = session.get(
                NetworkConfiguration,
                candidate_configuration_id,
            )
            if baseline is None or not _can_read_configuration(baseline, user_id):
                return _failure(404, "Baseline network configuration was not found.")
            if candidate is None or not _can_read_configuration(candidate, user_id):
                return _failure(404, "Candidate network configuration was not found.")
            if baseline.scene_id != candidate.scene_id:
                return _failure(400, "Configurations belong to different scenes.")

            profiles = session.scalars(
                select(SimulationProfile)
                .where(
                    SimulationProfile.scene_id == baseline.scene_id,
                    SimulationProfile.enabled.is_(True),
                )
                .order_by(
                    SimulationProfile.simulation_type,
                    SimulationProfile.name,
                    SimulationProfile.id,
                )
            ).all()
            scene_info = _find_ready_scene(baseline.scene_id)
            if scene_info is None:
                return _failure(404, "The configuration scene was not found or ready.")

            difference = compare_configuration_snapshots(
                baseline.antennas_json,
                candidate.antennas_json,
            )
            return plan_configuration_impact(
                difference,
                profiles,
                baseline,
                candidate,
                scene_info,
            )
    except (SQLAlchemyError, ValueError):
        logger.exception("Failed to preview configuration impact.")
        return _failure(500, "Failed to preview configuration impact.")


def plan_configuration_impact(
    difference: dict,
    profiles: Iterable[SimulationProfile],
    baseline_configuration: NetworkConfiguration,
    candidate_configuration: NetworkConfiguration,
    scene_info: dict,
) -> dict:
    planned_simulations = []
    skipped_simulations = []

    for profile in profiles:
        if not difference.get("changed"):
            applicability = evaluate_profile_impact(profile, difference)
            skipped_simulations.append(_skipped_profile(profile, applicability))
            continue

        baseline_validation = validate_profile_definition(
            profile.simulation_type,
            profile.request_template_json,
            baseline_configuration,
            scene_info,
        )
        candidate_validation = validate_profile_definition(
            profile.simulation_type,
            profile.request_template_json,
            candidate_configuration,
            scene_info,
        )
        validation_skip = _validation_skip(
            profile,
            baseline_validation,
            candidate_validation,
        )
        if validation_skip:
            skipped_simulations.append(validation_skip)
            continue

        applicability = evaluate_profile_impact(profile, difference)
        if applicability["action"] == "skip":
            skipped_simulations.append(_skipped_profile(profile, applicability))
            continue

        planned_simulations.append(
            {
                "profile_id": str(profile.id),
                "profile_name": profile.name,
                "simulation_type": profile.simulation_type,
                "propagation_model": _propagation_model(profile),
                "triggering_changes": applicability["triggering_changes"],
                "affected_antennas": applicability["affected_antennas"],
                "baseline_request": baseline_validation["request"],
                "candidate_request": candidate_validation["request"],
                "objectives": candidate_validation.get("objectives", []),
                "job_count": 2,
            }
        )

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
            "reason": "Impact policy v1 does not automatically run optimization.",
        },
    }


def evaluate_profile_impact(profile: SimulationProfile, difference: dict) -> dict:
    if not difference.get("changed"):
        return _skip(
            "no_meaningful_change",
            "No meaningful configuration change was detected.",
        )

    categories = classify_difference(difference)
    affected_antennas = sorted(set(difference.get("changed_antennas", [])))
    if not categories:
        return _skip(
            "unsupported_change",
            "The detected changes are not covered by this policy version.",
        )

    if profile.simulation_type in ROLE_BASED_TYPES:
        role_antennas = _profile_role_antennas(profile)
        affected_roles = sorted(set(affected_antennas).intersection(role_antennas))
        if not affected_roles:
            return _skip(
                "unaffected_profile_roles",
                "None of this profile's antenna roles use an affected antenna.",
            )
    elif profile.simulation_type in NETWORK_LEVEL_TYPES:
        affected_roles = affected_antennas
    else:
        return _skip(
            "unsupported_profile_type",
            "This simulation type is not covered by the current impact policy.",
        )

    propagation_model = _propagation_model(profile)
    if (
        profile.simulation_type in {"sinr", "throughput_comparison"}
        and propagation_model in ANALYTICAL_MODELS
    ):
        relevant_categories = categories.difference(ANALYTICAL_IGNORED_CHANGES)
        if not relevant_categories:
            ignored = ", ".join(sorted(categories))
            return _skip(
                "propagation_model_ignores_change",
                f"{propagation_model} does not use the affected fields: {ignored}.",
            )
        categories = relevant_categories

    return {
        "action": "plan",
        "triggering_changes": sorted(categories),
        "affected_antennas": affected_roles,
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


def _validation_skip(
    profile: SimulationProfile,
    baseline_validation: dict,
    candidate_validation: dict,
) -> dict | None:
    failures = []
    for label, result in (
        ("baseline", baseline_validation),
        ("candidate", candidate_validation),
    ):
        if result.get("status") == "failure":
            reason = result.get("skip_reason") or result.get("error")
            failures.append(f"{label}: {reason}")

    if not failures:
        return None
    return {
        "profile_id": str(profile.id),
        "profile_name": profile.name,
        "simulation_type": profile.simulation_type,
        "propagation_model": _propagation_model(profile),
        "reason_code": "invalid_or_incomplete_profile",
        "reason": "; ".join(failures),
    }


def _profile_role_antennas(profile: SimulationProfile) -> set[str]:
    template = (
        profile.request_template_json
        if isinstance(profile.request_template_json, dict)
        else {}
    )
    roles = template.get("roles")
    if not isinstance(roles, dict):
        return set()
    return {
        str(antenna_id).strip()
        for antenna_id in roles.values()
        if str(antenna_id).strip()
    }


def _propagation_model(profile: SimulationProfile) -> str:
    if profile.simulation_type in {"sinr", "throughput_comparison"}:
        template = (
            profile.request_template_json
            if isinstance(profile.request_template_json, dict)
            else {}
        )
        return str(
            template.get("propagation_model", "sionna")
        ).lower()
    return "sionna"


def _skipped_profile(profile: SimulationProfile, reason: dict) -> dict:
    return {
        "profile_id": str(profile.id),
        "profile_name": profile.name,
        "simulation_type": profile.simulation_type,
        "propagation_model": _propagation_model(profile),
        "reason_code": reason["reason_code"],
        "reason": reason["reason"],
    }


def _skip(reason_code: str, reason: str) -> dict:
    return {
        "action": "skip",
        "reason_code": reason_code,
        "reason": reason,
    }


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


def _failure(status_code: int, error: str, **details: Any) -> dict:
    return {
        "status": "failure",
        "status_code": status_code,
        "error": error,
        **details,
    }
