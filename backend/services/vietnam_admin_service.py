import json
import logging
import unicodedata

from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError

from backend.database import db_session, is_database_configured
from backend.models import VietnamProvince, VietnamWard

logger = logging.getLogger(__name__)

DEFAULT_WARD_LIMIT = 50
MAX_WARD_LIMIT = 200


def strip_diacritics(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    return "".join(char for char in decomposed if unicodedata.category(char) != "Mn")


def list_provinces() -> dict:
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable

    try:
        with db_session() as session:
            provinces = session.scalars(
                select(VietnamProvince).order_by(VietnamProvince.code)
            ).all()
            return {
                "status": "success",
                "items": [serialize_province(item) for item in provinces],
            }
    except SQLAlchemyError:
        logger.exception("Failed to list Vietnam provinces.")
        return _failure(500, "Failed to list Vietnam provinces.")


def search_wards(
    query: str,
    province_code: str | None = None,
    limit: int = DEFAULT_WARD_LIMIT,
) -> dict:
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable

    normalized = strip_diacritics(query or "").strip().lower()
    if not normalized:
        return _failure(400, "A ward search query is required.")

    try:
        with db_session() as session:
            statement = (
                select(VietnamWard, VietnamProvince)
                .join(
                    VietnamProvince,
                    VietnamWard.province_code == VietnamProvince.code,
                )
                .where(VietnamWard.search_name.like(f"{_escape_like(normalized)}%"))
            )
            if province_code:
                statement = statement.where(
                    VietnamWard.province_code == province_code
                )
            statement = statement.order_by(
                VietnamWard.province_code,
                VietnamWard.search_name,
            ).limit(limit)

            rows = session.execute(statement).all()
            return {
                "status": "success",
                "items": [serialize_ward(ward, province) for ward, province in rows],
            }
    except SQLAlchemyError:
        logger.exception("Failed to search Vietnam wards.")
        return _failure(500, "Failed to search Vietnam wards.")


def get_ward_boundary(ward_code: str) -> dict:
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable

    try:
        with db_session() as session:
            row = session.execute(
                text(
                    "SELECT "
                    "w.ward_code, w.ward_name, w.ward_name_en, w.ward_type, "
                    "w.center_lat, w.center_lng, "
                    "w.bbox_south, w.bbox_north, w.bbox_west, w.bbox_east, "
                    "ST_AsGeoJSON(w.boundary) AS boundary_geojson, "
                    "p.code AS province_code, p.name AS province_name, "
                    "p.name_en AS province_name_en "
                    "FROM vietnam_wards w "
                    "JOIN vietnam_provinces p ON p.code = w.province_code "
                    "WHERE w.ward_code = :ward_code"
                ),
                {"ward_code": ward_code},
            ).first()
            if row is None:
                return _failure(404, "Ward was not found.")
            if not row.boundary_geojson:
                return _failure(404, "Ward boundary is not available.")

            return {
                "status": "success",
                "feature": {
                    "type": "Feature",
                    "id": row.ward_code,
                    "properties": serialize_ward_row(row),
                    "geometry": json.loads(row.boundary_geojson),
                },
            }
    except SQLAlchemyError:
        logger.exception("Failed to load ward boundary.")
        return _failure(500, "Failed to load ward boundary.")


def serialize_province(province) -> dict:
    return {
        "code": province.code,
        "name": province.name,
        "name_en": province.name_en,
        "full_name": province.full_name,
        "unit_type": province.unit_type,
        "center": {
            "lat": province.center_lat,
            "lng": province.center_lng,
        },
        "bbox": {
            "south": province.bbox_south,
            "north": province.bbox_north,
            "west": province.bbox_west,
            "east": province.bbox_east,
        },
        "ward_count": province.ward_count,
    }


def serialize_ward(ward, province) -> dict:
    return {
        "ward_code": ward.ward_code,
        "ward_name": ward.ward_name,
        "ward_name_en": ward.ward_name_en,
        "ward_full_name": ward.ward_full_name,
        "ward_type": ward.ward_type,
        "province_code": province.code,
        "province_name": province.name,
        "province_name_en": province.name_en,
        "center": {
            "lat": ward.center_lat,
            "lng": ward.center_lng,
        },
        "bbox": {
            "south": ward.bbox_south,
            "north": ward.bbox_north,
            "west": ward.bbox_west,
            "east": ward.bbox_east,
        },
    }


def serialize_ward_row(row) -> dict:
    return {
        "ward_code": row.ward_code,
        "ward_name": row.ward_name,
        "ward_name_en": row.ward_name_en,
        "ward_type": row.ward_type,
        "province_code": row.province_code,
        "province_name": row.province_name,
        "province_name_en": row.province_name_en,
        "center": {
            "lat": row.center_lat,
            "lng": row.center_lng,
        },
        "bbox": {
            "south": row.bbox_south,
            "north": row.bbox_north,
            "west": row.bbox_west,
            "east": row.bbox_east,
        },
    }


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _database_unavailable() -> dict | None:
    if is_database_configured():
        return None
    return _failure(503, "Vietnam admin data requires a configured database.")


def _failure(status_code: int, error: str) -> dict:
    return {
        "status": "failure",
        "status_code": status_code,
        "error": error,
    }
