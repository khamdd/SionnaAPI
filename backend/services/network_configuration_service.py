import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any, Iterable

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from backend.database import db_session, is_database_configured
from backend.models import NetworkConfiguration, Scene
from backend.schemas.network_configurations import NetworkConfigurationCreateRequest
from backend.services.configuration_diff_service import compare_configuration_snapshots
from backend.services.scene_service import list_scenes
from backend.services.simulation_store import ensure_scene_reference

logger = logging.getLogger(__name__)

def normalize_antennas(antennas: Iterable[Any]) -> list[dict]:
    """Return one deterministic JSON-compatible representation for hashing/storage."""
    normalized = []
    for antenna in antennas:
        if hasattr(antenna, "model_dump"):
            antenna = antenna.model_dump(mode="json")
        normalized.append(_normalize_json_value(dict(antenna)))

    return sorted(normalized, key=lambda antenna: antenna["id"])


def calculate_content_hash(antennas: Iterable[Any]) -> tuple[list[dict], str]:
    normalized = normalize_antennas(antennas)
    canonical_json = json.dumps(
        normalized,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    digest = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()
    return normalized, digest


def create_network_configuration(
    request: NetworkConfigurationCreateRequest,
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

            # A row lock serializes version allocation for this scene.
            session.execute(
                select(Scene)
                .where(Scene.id == request.scene_id)
                .with_for_update()
            ).scalar_one()

            active = session.execute(
                select(NetworkConfiguration)
                .where(
                    NetworkConfiguration.scene_id == request.scene_id,
                    NetworkConfiguration.status == "published",
                )
                .with_for_update()
            ).scalar_one_or_none()

            parent = None
            if request.parent_configuration_id is not None:
                parent = session.get(
                    NetworkConfiguration,
                    str(request.parent_configuration_id),
                )
                parent_error = _validate_parent(parent, request.scene_id, created_by)
                if parent_error:
                    return parent_error
            elif active is not None:
                parent = active

            if request.antennas is None:
                if parent is None:
                    return _failure(
                        400,
                        "Antennas are required when no parent configuration exists.",
                    )
                antennas = parent.antennas_json
            else:
                antennas = request.antennas

            configuration = add_network_configuration_draft(
                session,
                scene_id=request.scene_id,
                antennas=antennas,
                created_by=created_by,
                parent_configuration_id=parent.id if parent is not None else None,
                source=request.source,
                source_reference=request.source_reference,
            )
            session.refresh(configuration)

            return {
                "status": "success",
                "configuration": serialize_configuration(configuration),
            }
    except IntegrityError:
        logger.exception("Network configuration creation violated a database constraint.")
        return _failure(409, "Network configuration could not be created.")
    except SQLAlchemyError:
        logger.exception("Failed to create network configuration.")
        return _failure(500, "Failed to create network configuration.")


def add_network_configuration_draft(
    session,
    *,
    scene_id: str,
    antennas: Iterable[Any],
    created_by: str,
    parent_configuration_id: str | None,
    source: str = "manual",
    source_reference: str | None = None,
) -> NetworkConfiguration:
    """Add a draft inside a caller-owned, scene-locked transaction."""
    normalized_antennas, content_hash = calculate_content_hash(antennas)
    version = session.scalar(
        select(
            func.coalesce(func.max(NetworkConfiguration.version), 0) + 1
        ).where(NetworkConfiguration.scene_id == scene_id)
    )
    configuration = NetworkConfiguration(
        scene_id=scene_id,
        version=version,
        status="draft",
        parent_configuration_id=parent_configuration_id,
        source=source,
        source_reference=source_reference,
        antennas_json=normalized_antennas,
        content_hash=content_hash,
        created_by=created_by,
    )
    session.add(configuration)
    session.flush()
    return configuration


def list_network_configurations(
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
            statement = select(NetworkConfiguration).where(
                or_(
                    NetworkConfiguration.status != "draft",
                    NetworkConfiguration.created_by == user_id,
                )
            )
            if scene_id:
                statement = statement.where(NetworkConfiguration.scene_id == scene_id)
            if status:
                statement = statement.where(NetworkConfiguration.status == status)

            configurations = session.scalars(
                statement.order_by(
                    NetworkConfiguration.created_at.desc(),
                    NetworkConfiguration.version.desc(),
                ).limit(limit)
            ).all()

            return {
                "status": "success",
                "configurations": [
                    serialize_configuration(configuration)
                    for configuration in configurations
                ],
            }
    except SQLAlchemyError:
        logger.exception("Failed to list network configurations.")
        return _failure(500, "Failed to list network configurations.")


def get_network_configuration(configuration_id: str, user_id: str) -> dict:
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable

    try:
        with db_session() as session:
            configuration = session.get(NetworkConfiguration, configuration_id)
            if configuration is None or not _can_read(configuration, user_id):
                return _failure(404, "Network configuration was not found.")

            return {
                "status": "success",
                "configuration": serialize_configuration(configuration),
            }
    except SQLAlchemyError:
        logger.exception("Failed to load network configuration.")
        return _failure(500, "Failed to load network configuration.")


def publish_network_configuration(configuration_id: str, user_id: str) -> dict:
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable

    try:
        with db_session() as session:
            configuration = session.execute(
                select(NetworkConfiguration)
                .where(NetworkConfiguration.id == configuration_id)
                .with_for_update()
            ).scalar_one_or_none()

            if configuration is None:
                return apply_publish_transition(None, None, user_id)
            if configuration.created_by != user_id or configuration.status != "draft":
                return apply_publish_transition(configuration, None, user_id)

            current = session.execute(
                select(NetworkConfiguration)
                .where(
                    NetworkConfiguration.scene_id == configuration.scene_id,
                    NetworkConfiguration.status == "published",
                )
                .with_for_update()
            ).scalar_one_or_none()

            result = apply_publish_transition(configuration, current, user_id)
            if result.get("status") == "failure":
                return result
            session.flush()
            result["configuration"] = serialize_configuration(configuration)
            return result
    except IntegrityError:
        logger.exception("Publishing violated the active-configuration constraint.")
        return _failure(409, "Another configuration was published concurrently.")
    except SQLAlchemyError:
        logger.exception("Failed to publish network configuration.")
        return _failure(500, "Failed to publish network configuration.")


def get_active_network_configuration(scene_id: str, user_id: str) -> dict:
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable

    try:
        with db_session() as session:
            configuration = session.execute(
                select(NetworkConfiguration).where(
                    NetworkConfiguration.scene_id == scene_id,
                    NetworkConfiguration.status == "published",
                )
            ).scalar_one_or_none()
            if configuration is None or not _can_read(configuration, user_id):
                return _failure(404, "No published configuration exists for this scene.")

            return {
                "status": "success",
                "configuration": serialize_configuration(configuration),
            }
    except SQLAlchemyError:
        logger.exception("Failed to load the published network configuration.")
        return _failure(500, "Failed to load the published network configuration.")


def compare_network_configurations(
    baseline_configuration_id: str,
    candidate_configuration_id: str,
    user_id: str,
) -> dict:
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable

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
            if baseline is None or not _can_read(baseline, user_id):
                return _failure(404, "Baseline network configuration was not found.")
            if candidate is None or not _can_read(candidate, user_id):
                return _failure(404, "Candidate network configuration was not found.")
            if baseline.scene_id != candidate.scene_id:
                return _failure(400, "Configurations belong to different scenes.")

            difference = compare_configuration_snapshots(
                baseline.antennas_json,
                candidate.antennas_json,
            )
            return {
                "status": "success",
                "scene_id": baseline.scene_id,
                "baseline": _configuration_identity(baseline),
                "candidate": _configuration_identity(candidate),
                "hashes_equal": baseline.content_hash == candidate.content_hash,
                **difference,
            }
    except (SQLAlchemyError, ValueError):
        logger.exception("Failed to compare network configurations.")
        return _failure(500, "Failed to compare network configurations.")


def apply_publish_transition(
    configuration: NetworkConfiguration | None,
    current: NetworkConfiguration | None,
    user_id: str,
    published_at: datetime | None = None,
) -> dict:
    """Validate and apply the immutable draft-to-published state transition."""
    if configuration is None:
        return _failure(404, "Network configuration was not found.")
    if configuration.created_by != user_id:
        return _failure(403, "Only the draft creator can publish it.")
    if configuration.status != "draft":
        return _failure(409, "Only a draft configuration can be published.")

    if current is not None and current.content_hash == configuration.content_hash:
        return {
            **_failure(
                409,
                "This draft is identical to the published configuration.",
            ),
            "error_code": "configuration_unchanged",
            "active_configuration_id": current.id,
            "automatic_study_created": False,
        }

    superseded_configuration_id = None
    if current is not None:
        current.status = "superseded"
        superseded_configuration_id = current.id

    configuration.status = "published"
    configuration.published_at = published_at or datetime.now(timezone.utc)
    return {
        "status": "success",
        "superseded_configuration_id": superseded_configuration_id,
        "content_changed": True,
    }


def serialize_configuration(configuration: NetworkConfiguration) -> dict:
    return {
        "id": str(configuration.id),
        "scene_id": configuration.scene_id,
        "version": configuration.version,
        "status": configuration.status,
        "parent_configuration_id": (
            str(configuration.parent_configuration_id)
            if configuration.parent_configuration_id
            else None
        ),
        "source": configuration.source,
        "source_reference": configuration.source_reference,
        "antennas": configuration.antennas_json,
        "content_hash": configuration.content_hash,
        "created_by": str(configuration.created_by),
        "created_at": _serialize_datetime(configuration.created_at),
        "published_at": _serialize_datetime(configuration.published_at),
    }


def _configuration_identity(configuration: NetworkConfiguration) -> dict:
    return {
        "id": str(configuration.id),
        "version": configuration.version,
        "status": configuration.status,
        "content_hash": configuration.content_hash,
    }


def _normalize_json_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _normalize_json_value(nested_value)
            for key, nested_value in value.items()
        }
    if isinstance(value, list):
        return [_normalize_json_value(item) for item in value]
    if isinstance(value, float):
        if value == 0:
            return 0
        if value.is_integer():
            return int(value)
    return value


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


def _validate_parent(
    parent: NetworkConfiguration | None,
    scene_id: str,
    user_id: str,
) -> dict | None:
    if parent is None or not _can_read(parent, user_id):
        return _failure(404, "Parent network configuration was not found.")
    if parent.scene_id != scene_id:
        return _failure(400, "Parent configuration belongs to a different scene.")
    return None


def _can_read(configuration: NetworkConfiguration, user_id: str) -> bool:
    return configuration.status != "draft" or configuration.created_by == user_id


def _database_unavailable() -> dict | None:
    if is_database_configured():
        return None
    return _failure(
        503,
        "Network configuration versioning requires a configured database.",
    )


def _failure(status_code: int, error: str) -> dict:
    return {
        "status": "failure",
        "status_code": status_code,
        "error": error,
    }


def _serialize_datetime(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None
