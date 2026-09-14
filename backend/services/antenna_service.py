import logging
from datetime import datetime, timezone
from typing import Iterable

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from backend.database import db_session, is_database_configured
from backend.models import Antenna
from backend.services.scene_service import list_scenes

logger = logging.getLogger(__name__)


def list_antennas(*, query=None, status=None, scene_id=None, limit=1000):
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable
    bounds = _scene_bounds(scene_id)
    if scene_id and bounds is None:
        return _failure(404, "Scene was not found or has no geographic bounds.")
    try:
        with db_session() as session:
            statement = select(Antenna)
            if query:
                statement = statement.where(Antenna.code.ilike(f"%{query.strip()}%"))
            if status:
                statement = statement.where(Antenna.status == status)
            if bounds:
                statement = statement.where(
                    Antenna.longitude >= bounds["west"],
                    Antenna.longitude <= bounds["east"],
                    Antenna.latitude >= bounds["south"],
                    Antenna.latitude <= bounds["north"],
                )
            rows = session.scalars(statement.order_by(func.lower(Antenna.code)).limit(limit)).all()
            return {"status": "success", "antennas": [serialize_antenna(row) for row in rows]}
    except SQLAlchemyError:
        logger.exception("Failed to list antennas.")
        return _failure(500, "Failed to list antennas.")


def create_antenna(request, user_id):
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable
    try:
        with db_session() as session:
            antenna = Antenna(created_by=user_id, updated_by=user_id)
            _apply_values(antenna, request)
            session.add(antenna)
            session.flush()
            session.refresh(antenna)
            return {"status": "success", "antenna": serialize_antenna(antenna)}
    except IntegrityError:
        return _failure(409, f'Antenna ID "{request.id}" already exists.')
    except SQLAlchemyError:
        logger.exception("Failed to create antenna.")
        return _failure(500, "Failed to create antenna.")


def update_antenna(antenna_id, request, user_id):
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable
    try:
        with db_session() as session:
            antenna = session.get(Antenna, antenna_id)
            if antenna is None:
                return _failure(404, "Antenna was not found.")
            if request.id != antenna.code:
                return _failure(409, "Antenna ID cannot be changed after creation.")
            _apply_values(antenna, request)
            antenna.updated_by = user_id
            antenna.updated_at = datetime.now(timezone.utc)
            session.flush()
            return {"status": "success", "antenna": serialize_antenna(antenna)}
    except IntegrityError:
        return _failure(409, f'Antenna ID "{request.id}" already exists.')
    except SQLAlchemyError:
        logger.exception("Failed to update antenna.")
        return _failure(500, "Failed to update antenna.")


def set_antenna_status(antenna_id, status, user_id):
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable
    try:
        with db_session() as session:
            antenna = session.get(Antenna, antenna_id)
            if antenna is None:
                return _failure(404, "Antenna was not found.")
            antenna.status = status
            antenna.updated_by = user_id
            antenna.updated_at = datetime.now(timezone.utc)
            session.flush()
            return {"status": "success", "antenna": serialize_antenna(antenna)}
    except SQLAlchemyError:
        logger.exception("Failed to change antenna status.")
        return _failure(500, "Failed to change antenna status.")


def preview_import(request):
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable
    try:
        with db_session() as session:
            existing = {
                row.code.casefold(): row
                for row in session.scalars(select(Antenna)).all()
            }
            return {"status": "success", "preview": _classify_import(request.antennas, existing)}
    except SQLAlchemyError:
        logger.exception("Failed to preview antenna import.")
        return _failure(500, "Failed to preview antenna import.")


def batch_import(request, user_id):
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable
    try:
        with db_session() as session:
            existing = {
                row.code.casefold(): row
                for row in session.scalars(select(Antenna).with_for_update()).all()
            }
            preview = _classify_import(request.antennas, existing)
            if preview["changed"] and not request.update_existing:
                return _failure(409, "Import contains existing antennas with changed values.", preview=preview)
            created = updated = 0
            for values in request.antennas:
                antenna = existing.get(values.id.casefold())
                if antenna is None:
                    antenna = Antenna(created_by=user_id, updated_by=user_id)
                    session.add(antenna)
                    existing[values.id.casefold()] = antenna
                    created += 1
                elif _same_values(antenna, values):
                    continue
                else:
                    updated += 1
                _apply_values(antenna, values)
                antenna.status = "active"
                antenna.updated_by = user_id
                antenna.updated_at = datetime.now(timezone.utc)
            session.flush()
            return {"status": "success", "created": created, "updated": updated, "unchanged": len(preview["unchanged"])}
    except IntegrityError:
        return _failure(409, "Antenna import conflicts with the current inventory.")
    except SQLAlchemyError:
        logger.exception("Failed to import antennas.")
        return _failure(500, "Failed to import antennas.")


def resolve_antenna_ids(session, antenna_ids: Iterable[str], *, include_archived=False):
    ids = [str(value) for value in antenna_ids]
    rows = session.scalars(select(Antenna).where(Antenna.id.in_(ids))).all() if ids else []
    by_id = {str(row.id): row for row in rows}
    resolved = [by_id[value] for value in ids if value in by_id]
    missing = [value for value in ids if value not in by_id]
    archived = [row for row in resolved if row.status != "active"]
    if missing or (archived and not include_archived):
        return None
    return resolved


def serialize_antenna(antenna):
    return {
        "database_id": str(antenna.id),
        "id": antenna.code,
        "longitude": antenna.longitude,
        "latitude": antenna.latitude,
        "height_m": antenna.height_m,
        "azimuth": antenna.azimuth_deg,
        "tilt": {"min": antenna.tilt_min_deg, "current": antenna.tilt_current_deg, "max": antenna.tilt_max_deg},
        "tx_power": {"min": antenna.tx_power_min_dbm, "current": antenna.tx_power_current_dbm, "max": antenna.tx_power_max_dbm},
        "status": antenna.status,
        "created_by": str(antenna.created_by),
        "updated_by": str(antenna.updated_by),
        "created_at": antenna.created_at.isoformat() if antenna.created_at else None,
        "updated_at": antenna.updated_at.isoformat() if antenna.updated_at else None,
    }


def _classify_import(values_list, existing):
    result = {"new": [], "changed": [], "unchanged": []}
    for values in values_list:
        row = existing.get(values.id.casefold())
        serialized = values.model_dump(mode="json")
        if row is None:
            result["new"].append(serialized)
        elif _same_values(row, values):
            result["unchanged"].append(serialized)
        else:
            result["changed"].append({"before": serialize_antenna(row), "after": serialized})
    return result


def _same_values(antenna, values):
    current = serialize_antenna(antenna)
    desired = values.model_dump(mode="json")
    return all(current[key] == desired[key] for key in ("id", "longitude", "latitude", "height_m", "azimuth", "tilt", "tx_power"))


def _apply_values(antenna, values):
    antenna.code = values.id
    antenna.longitude = values.longitude
    antenna.latitude = values.latitude
    antenna.height_m = values.height_m
    antenna.azimuth_deg = values.azimuth
    antenna.tilt_min_deg = values.tilt.min
    antenna.tilt_current_deg = values.tilt.current
    antenna.tilt_max_deg = values.tilt.max
    antenna.tx_power_min_dbm = values.tx_power.min
    antenna.tx_power_current_dbm = values.tx_power.current
    antenna.tx_power_max_dbm = values.tx_power.max


def _scene_bounds(scene_id):
    if not scene_id:
        return None
    scene = next((item for item in list_scenes().get("scenes", []) if item.get("id") == scene_id), None)
    return scene.get("bounds") if scene else None


def _database_unavailable():
    return None if is_database_configured() else _failure(503, "Antenna inventory requires a configured database.")


def _failure(status_code, error, **extra):
    return {"status": "failure", "status_code": status_code, "error": error, **extra}
