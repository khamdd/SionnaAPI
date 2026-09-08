import logging
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any

from pydantic import ValidationError
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from backend.database import db_session, is_database_configured
from backend.models import NetworkConfiguration, SimulationProfile
from backend.schemas.requests import (
    CoverageRequest,
    NetworkCoverageRequest,
    OptimizationObjective,
    RSRPRequest,
    SINRRequest,
    ThroughputRequest,
)
from backend.schemas.simulation_profiles import (
    SimulationProfileCreateRequest,
    SimulationProfileUpdateRequest,
)
from backend.services.coordinate_service import lng_lat_to_scene_position
from backend.services.scene_service import list_scenes
from backend.services.simulation_store import ensure_scene_reference


logger = logging.getLogger(__name__)

REQUEST_MODELS = {
    "network_coverage": NetworkCoverageRequest,
    "coverage_map": CoverageRequest,
    "rsrp_simulation": RSRPRequest,
    "sinr": SINRRequest,
    "throughput_comparison": ThroughputRequest,
}

ROLE_SIMULATION_TYPES = {
    "coverage_map": ("transmitter",),
    "sinr": ("transmitter", "receiver", "interferer"),
    "throughput_comparison": ("transmitter", "receiver", "interferer"),
}

CONFIGURATION_OWNED_FIELDS = {
    "network_coverage": {"antennas"},
    "rsrp_simulation": {"antennas"},
    "coverage_map": {
        "tilt",
        "azimuth",
        "transmitter_position",
        "tx_power",
    },
    "sinr": {
        "tilt",
        "transmitter_position",
        "receiver_position",
        "interferer_position",
        "interferer_tilt",
        "tx_power",
        "interferer_tx_power",
    },
    "throughput_comparison": {
        "transmitter_position",
        "receiver_position",
        "interferer_position",
        "interferer_tilt",
        "tx_power",
        "interferer_tx_power",
    },
}

REQUIRED_TEMPLATE_FIELDS = {
    "network_coverage": {
        "transmitter_pattern",
        "solver",
        "camera",
        "bandwidth_mhz",
        "mimo_layers",
        "objectives",
    },
    "coverage_map": {"transmitter_pattern", "solver", "camera"},
    "rsrp_simulation": {
        "transmitter_pattern",
        "solver",
        "user_count",
        "user_height_m",
        "random_seed",
    },
    "sinr": {
        "propagation_model",
        "carrier_frequency_ghz",
        "bandwidth_mhz",
        "noise_figure_db",
        "transmitter_pattern",
        "solver",
    },
    "throughput_comparison": {
        "propagation_model",
        "carrier_frequency_ghz",
        "noise_figure_db",
        "base_tilt",
        "target_tilt",
        "transmitter_pattern",
        "bandwidth_mhz",
        "mimo_layers",
        "solver",
    },
}

REQUIRED_NESTED_FIELDS = {
    "solver": {"max_depth", "samples_per_tx", "cell_size", "center", "size"},
    "camera": {"position", "look_at"},
}


def create_simulation_profile(
    request: SimulationProfileCreateRequest,
    created_by: str,
) -> dict:
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable

    scene_info = _find_ready_scene(request.scene_id)
    if scene_info is None:
        return _failure(404, "Scene was not found or is not ready.")

    try:
        with db_session() as session:
            ensure_scene_reference(session, scene_info)
            session.flush()

            if request.enabled:
                active = _get_active_configuration(session, request.scene_id)
                validation = validate_profile_definition(
                    request.simulation_type,
                    request.request_template,
                    active,
                    scene_info,
                )
                if validation.get("status") == "failure":
                    return validation

            profile = SimulationProfile(
                scene_id=request.scene_id,
                name=request.name,
                simulation_type=request.simulation_type,
                enabled=request.enabled,
                request_template_json=request.request_template,
                created_by=created_by,
            )
            session.add(profile)
            session.flush()
            session.refresh(profile)
            return {
                "status": "success",
                "profile": serialize_profile(profile),
            }
    except IntegrityError:
        logger.exception("Simulation profile creation violated a database constraint.")
        return _failure(409, "A profile with this name already exists for the scene.")
    except SQLAlchemyError:
        logger.exception("Failed to create simulation profile.")
        return _failure(500, "Failed to create simulation profile.")


def list_simulation_profiles(
    user_id: str,
    scene_id: str | None = None,
    simulation_type: str | None = None,
    enabled: bool | None = None,
    limit: int = 100,
) -> dict:
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable

    try:
        with db_session() as session:
            statement = select(SimulationProfile).where(
                or_(
                    SimulationProfile.enabled.is_(True),
                    SimulationProfile.created_by == user_id,
                )
            )
            if scene_id:
                statement = statement.where(SimulationProfile.scene_id == scene_id)
            if simulation_type:
                statement = statement.where(
                    SimulationProfile.simulation_type == simulation_type
                )
            if enabled is not None:
                statement = statement.where(SimulationProfile.enabled.is_(enabled))

            profiles = session.scalars(
                statement.order_by(
                    SimulationProfile.updated_at.desc(),
                    SimulationProfile.name,
                ).limit(limit)
            ).all()
            return {
                "status": "success",
                "profiles": [serialize_profile(profile) for profile in profiles],
            }
    except SQLAlchemyError:
        logger.exception("Failed to list simulation profiles.")
        return _failure(500, "Failed to list simulation profiles.")


def get_simulation_profile(profile_id: str, user_id: str) -> dict:
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable

    try:
        with db_session() as session:
            profile = session.get(SimulationProfile, profile_id)
            if profile is None or not _can_read(profile, user_id):
                return _failure(404, "Simulation profile was not found.")
            return {
                "status": "success",
                "profile": serialize_profile(profile),
            }
    except SQLAlchemyError:
        logger.exception("Failed to load simulation profile.")
        return _failure(500, "Failed to load simulation profile.")


def update_simulation_profile(
    profile_id: str,
    request: SimulationProfileUpdateRequest,
    user_id: str,
) -> dict:
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable

    try:
        with db_session() as session:
            profile = session.execute(
                select(SimulationProfile)
                .where(SimulationProfile.id == profile_id)
                .with_for_update()
            ).scalar_one_or_none()
            access_error = _owner_error(profile, user_id)
            if access_error:
                return access_error

            candidate = SimpleNamespace(
                simulation_type=(
                    request.simulation_type
                    if "simulation_type" in request.model_fields_set
                    else profile.simulation_type
                ),
                request_template_json=(
                    request.request_template
                    if "request_template" in request.model_fields_set
                    else profile.request_template_json
                ),
                enabled=(
                    request.enabled
                    if "enabled" in request.model_fields_set
                    else profile.enabled
                ),
            )

            if candidate.enabled:
                scene_info = _find_ready_scene(profile.scene_id)
                active = _get_active_configuration(session, profile.scene_id)
                validation = validate_profile_definition(
                    candidate.simulation_type,
                    candidate.request_template_json,
                    active,
                    scene_info,
                )
                if validation.get("status") == "failure":
                    return validation

            if "name" in request.model_fields_set:
                profile.name = request.name
            if "simulation_type" in request.model_fields_set:
                profile.simulation_type = request.simulation_type
            if "enabled" in request.model_fields_set:
                profile.enabled = request.enabled
            if "request_template" in request.model_fields_set:
                profile.request_template_json = request.request_template
            profile.updated_at = datetime.now(timezone.utc)
            session.flush()

            return {
                "status": "success",
                "profile": serialize_profile(profile),
            }
    except IntegrityError:
        logger.exception("Simulation profile update violated a database constraint.")
        return _failure(409, "A profile with this name already exists for the scene.")
    except SQLAlchemyError:
        logger.exception("Failed to update simulation profile.")
        return _failure(500, "Failed to update simulation profile.")


def set_simulation_profile_enabled(
    profile_id: str,
    enabled: bool,
    user_id: str,
) -> dict:
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable

    try:
        with db_session() as session:
            profile = session.execute(
                select(SimulationProfile)
                .where(SimulationProfile.id == profile_id)
                .with_for_update()
            ).scalar_one_or_none()
            access_error = _owner_error(profile, user_id)
            if access_error:
                return access_error

            if enabled:
                scene_info = _find_ready_scene(profile.scene_id)
                active = _get_active_configuration(session, profile.scene_id)
                validation = validate_profile_definition(
                    profile.simulation_type,
                    profile.request_template_json,
                    active,
                    scene_info,
                )
                if validation.get("status") == "failure":
                    return validation

            profile.enabled = enabled
            profile.updated_at = datetime.now(timezone.utc)
            session.flush()
            return {
                "status": "success",
                "profile": serialize_profile(profile),
            }
    except SQLAlchemyError:
        logger.exception("Failed to change simulation profile state.")
        return _failure(500, "Failed to change simulation profile state.")


def delete_simulation_profile(profile_id: str, user_id: str) -> dict:
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable

    try:
        with db_session() as session:
            profile = session.get(SimulationProfile, profile_id)
            access_error = _owner_error(profile, user_id)
            if access_error:
                return access_error
            session.delete(profile)
            return {
                "status": "success",
                "deleted": True,
                "profile_id": profile_id,
            }
    except SQLAlchemyError:
        logger.exception("Failed to delete simulation profile.")
        return _failure(500, "Failed to delete simulation profile.")


def build_profile_request(
    profile_id: str,
    configuration_id: str,
    user_id: str,
) -> dict:
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable

    try:
        with db_session() as session:
            profile = session.get(SimulationProfile, profile_id)
            if profile is None or not _can_read(profile, user_id):
                return _failure(404, "Simulation profile was not found.")

            configuration = session.get(NetworkConfiguration, configuration_id)
            if configuration is None or not _can_read_configuration(
                configuration,
                user_id,
            ):
                return _failure(404, "Network configuration was not found.")
            if configuration.scene_id != profile.scene_id:
                return _failure(400, "Profile and configuration use different scenes.")

            scene_info = _find_ready_scene(profile.scene_id)
            result = validate_profile_definition(
                profile.simulation_type,
                profile.request_template_json,
                configuration,
                scene_info,
            )
            if result.get("status") == "failure":
                return result

            return {
                "status": "success",
                "profile_id": str(profile.id),
                "configuration_id": str(configuration.id),
                "simulation_type": profile.simulation_type,
                "request": result["request"],
                "objectives": result["objectives"],
            }
    except SQLAlchemyError:
        logger.exception("Failed to build a request from a simulation profile.")
        return _failure(500, "Failed to build a request from the profile.")


def validate_profile_definition(
    simulation_type: str,
    request_template: dict[str, Any],
    configuration: NetworkConfiguration | None,
    scene_info: dict | None,
) -> dict:
    if configuration is None:
        return _failure(
            409,
            "A published network configuration is required before enabling a profile.",
            error_code="active_configuration_required",
        )
    if scene_info is None:
        return _failure(404, "The profile scene was not found or is not ready.")

    request_model = REQUEST_MODELS.get(simulation_type)
    if request_model is None:
        return _failure(422, "Unsupported simulation profile type.")
    if not isinstance(request_template, dict):
        return _failure(422, "request_template must be a JSON object.")

    template = dict(request_template)
    missing_fields = _missing_template_fields(simulation_type, template)
    if missing_fields:
        return _failure(
            422,
            "Profile template is incomplete; missing: "
            + ", ".join(missing_fields),
            error_code="incomplete_profile",
        )

    reserved = CONFIGURATION_OWNED_FIELDS[simulation_type].intersection(template)
    if reserved:
        return _failure(
            422,
            "Profile template contains configuration-owned fields: "
            + ", ".join(sorted(reserved)),
            error_code="configuration_field_in_profile",
        )

    try:
        objectives = _validate_objectives(simulation_type, template)
        if simulation_type in {"network_coverage", "rsrp_simulation"}:
            template["antennas"] = _enabled_request_antennas(configuration)
        else:
            roles = template.pop("roles", None)
            role_result = _resolve_roles(
                simulation_type,
                roles,
                configuration,
                scene_info,
            )
            if isinstance(role_result, dict) and role_result.get("status") == "failure":
                return role_result
            _apply_role_fields(simulation_type, template, role_result)

        unknown_fields = set(template).difference(request_model.model_fields)
        if unknown_fields:
            return _failure(
                422,
                "Profile template contains unknown fields: "
                + ", ".join(sorted(unknown_fields)),
                error_code="unknown_profile_field",
            )

        request = request_model.model_validate(template)
        return {
            "status": "success",
            "request": request.model_dump(mode="json"),
            "objectives": objectives,
        }
    except (TypeError, ValueError, ValidationError) as exc:
        return _failure(
            422,
            f"Profile cannot build a valid {simulation_type} request: {exc}",
            error_code="invalid_profile",
        )


def serialize_profile(profile: SimulationProfile) -> dict:
    return {
        "id": str(profile.id),
        "scene_id": profile.scene_id,
        "name": profile.name,
        "simulation_type": profile.simulation_type,
        "enabled": profile.enabled,
        "request_template": profile.request_template_json,
        "created_by": str(profile.created_by),
        "created_at": _serialize_datetime(profile.created_at),
        "updated_at": _serialize_datetime(profile.updated_at),
    }


def _enabled_request_antennas(configuration: NetworkConfiguration) -> list[dict]:
    antennas = []
    for antenna in configuration.antennas_json:
        if antenna.get("enabled", True) is False:
            continue
        request_antenna = dict(antenna)
        request_antenna.pop("enabled", None)
        antennas.append(request_antenna)
    return antennas


def _validate_objectives(simulation_type: str, template: dict) -> list[dict]:
    raw_objectives = template.pop("objectives", None)
    if simulation_type != "network_coverage":
        if raw_objectives is not None:
            raise ValueError("objectives are currently supported only for network coverage")
        return []
    if not isinstance(raw_objectives, list) or not 1 <= len(raw_objectives) <= 2:
        raise ValueError("network coverage profiles require one or two objectives")

    objectives = [
        OptimizationObjective.model_validate(objective)
        for objective in raw_objectives
    ]
    metrics = [objective.metric for objective in objectives]
    if len(metrics) != len(set(metrics)):
        raise ValueError("profile objectives must use unique metrics")
    return [objective.model_dump(mode="json") for objective in objectives]


def _missing_template_fields(simulation_type: str, template: dict) -> list[str]:
    missing = [
        field_name
        for field_name in sorted(REQUIRED_TEMPLATE_FIELDS[simulation_type])
        if field_name not in template
    ]
    for parent_field, nested_fields in REQUIRED_NESTED_FIELDS.items():
        if parent_field not in REQUIRED_TEMPLATE_FIELDS[simulation_type]:
            continue
        nested_value = template.get(parent_field)
        if not isinstance(nested_value, dict):
            if parent_field in template:
                missing.append(f"{parent_field} (object required)")
            continue
        missing.extend(
            f"{parent_field}.{field_name}"
            for field_name in sorted(nested_fields)
            if field_name not in nested_value
        )
    return missing


def _resolve_roles(
    simulation_type: str,
    roles: Any,
    configuration: NetworkConfiguration,
    scene_info: dict,
) -> dict:
    required_roles = ROLE_SIMULATION_TYPES[simulation_type]
    label = simulation_type.replace("_", " ").upper()
    if not isinstance(roles, dict):
        return _role_failure(label, required_roles)

    role_ids = [str(roles.get(role, "")).strip() for role in required_roles]
    if any(not role_id for role_id in role_ids) or len(set(role_ids)) != len(role_ids):
        return _role_failure(label, required_roles)

    antennas_by_id = {
        antenna["id"]: antenna
        for antenna in configuration.antennas_json
        if antenna.get("enabled", True) is not False
    }
    if any(role_id not in antennas_by_id for role_id in role_ids):
        return _failure(
            422,
            f"{label} skipped: one or more role antennas are missing or disabled.",
            error_code="invalid_role_profile",
            skip_reason="Role antennas must exist and be enabled in the selected configuration.",
        )

    bounds = scene_info.get("bounds")
    if not bounds:
        return _failure(
            422,
            f"{label} skipped: scene bounds are unavailable.",
            error_code="scene_bounds_required",
            skip_reason="Geographic antenna positions cannot be converted without scene bounds.",
        )

    return {
        role: {
            "antenna": antennas_by_id[role_id],
            "position": lng_lat_to_scene_position(
                antennas_by_id[role_id]["longitude"],
                antennas_by_id[role_id]["latitude"],
                antennas_by_id[role_id]["height_m"],
                bounds,
            ),
        }
        for role, role_id in zip(required_roles, role_ids)
    }


def _apply_role_fields(simulation_type: str, payload: dict, roles: dict) -> None:
    transmitter = roles["transmitter"]
    transmitter_antenna = transmitter["antenna"]
    payload["transmitter_position"] = transmitter["position"]
    payload["tilt"] = transmitter_antenna["tilt"]["current"]
    payload["tx_power"] = transmitter_antenna["tx_power"]["current"]

    if simulation_type == "coverage_map":
        payload["azimuth"] = transmitter_antenna["azimuth"]
        return

    interferer = roles["interferer"]
    interferer_antenna = interferer["antenna"]
    payload["receiver_position"] = roles["receiver"]["position"]
    payload["interferer_position"] = interferer["position"]
    payload["interferer_tilt"] = interferer_antenna["tilt"]["current"]
    payload["interferer_tx_power"] = interferer_antenna["tx_power"]["current"]

    if simulation_type == "throughput_comparison":
        payload.pop("tilt", None)


def _role_failure(label: str, required_roles: tuple[str, ...]) -> dict:
    role_text = ", ".join(required_roles)
    return _failure(
        422,
        f"{label} skipped: a valid role profile is required.",
        error_code="missing_role_profile",
        skip_reason=f"Assign distinct enabled antennas for: {role_text}.",
    )


def _get_active_configuration(session, scene_id: str):
    return session.execute(
        select(NetworkConfiguration).where(
            NetworkConfiguration.scene_id == scene_id,
            NetworkConfiguration.status == "published",
        )
    ).scalar_one_or_none()


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


def _can_read(profile: SimulationProfile, user_id: str) -> bool:
    return profile.enabled or profile.created_by == user_id


def _can_read_configuration(
    configuration: NetworkConfiguration,
    user_id: str,
) -> bool:
    return configuration.status != "draft" or configuration.created_by == user_id


def _owner_error(profile: SimulationProfile | None, user_id: str) -> dict | None:
    if profile is None:
        return _failure(404, "Simulation profile was not found.")
    if profile.created_by != user_id:
        return _failure(403, "Only the profile creator can change it.")
    return None


def _database_unavailable() -> dict | None:
    if is_database_configured():
        return None
    return _failure(
        503,
        "Saved simulation profiles require a configured database.",
    )


def _failure(status_code: int, error: str, **details) -> dict:
    return {
        "status": "failure",
        "status_code": status_code,
        "error": error,
        **details,
    }


def _serialize_datetime(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None
