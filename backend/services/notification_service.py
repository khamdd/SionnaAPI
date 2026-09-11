import logging
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.exc import SQLAlchemyError

from backend.database import db_session, is_database_configured
from backend.models import ImpactStudy, Notification
from backend.services.impact_decision_service import final_decision
from backend.services.simulation_store import normalize_json_value, serialize_datetime

logger = logging.getLogger(__name__)

NOTIFIABLE_STUDY_STATUSES = {
    "completed",
    "completed_with_failures",
    "failed",
}


def ensure_impact_study_notification(session, study: ImpactStudy) -> Notification | None:
    """Add at most one terminal notification for an Impact Study."""
    if study.status not in NOTIFIABLE_STUDY_STATUSES:
        return None

    existing = session.scalar(
        select(Notification).where(
            Notification.user_id == study.created_by,
            Notification.impact_study_id == study.id,
        )
    )
    if existing is not None:
        return existing

    comparison = (normalize_json_value(study.summary_json) or {}).get(
        "comparison"
    ) or {}
    decision = final_decision(study.status, comparison)
    event_type, title, message = _notification_content(study.status, decision)
    notification = Notification(
        user_id=str(study.created_by),
        impact_study_id=str(study.id),
        event_type=event_type,
        title=title,
        message=message,
        payload_json={
            "impact_study_id": str(study.id),
            "scene_id": study.scene_id,
            "study_status": study.status,
            "decision": decision,
            "study_url": f"/api/v1/impact-studies/{study.id}",
            "report_url": f"/api/v1/impact-studies/{study.id}/report",
        },
    )
    session.add(notification)
    session.flush()
    return notification


def list_notifications(
    user_id: str,
    *,
    unread_only: bool = False,
    limit: int = 100,
) -> dict:
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable

    try:
        with db_session() as session:
            statement = select(Notification).where(Notification.user_id == user_id)
            if unread_only:
                statement = statement.where(Notification.is_read.is_(False))
            notifications = session.scalars(
                statement.order_by(
                    Notification.created_at.desc(),
                    Notification.id.desc(),
                ).limit(limit)
            ).all()
            return {
                "status": "success",
                "items": [serialize_notification(item) for item in notifications],
            }
    except SQLAlchemyError:
        logger.exception("Failed to list notifications.")
        return _failure(500, "Failed to list notifications.")


def get_unread_notification_count(user_id: str) -> dict:
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable

    try:
        with db_session() as session:
            count = session.scalar(
                select(func.count(Notification.id)).where(
                    Notification.user_id == user_id,
                    Notification.is_read.is_(False),
                )
            )
            return {"status": "success", "unread_count": int(count or 0)}
    except SQLAlchemyError:
        logger.exception("Failed to count unread notifications.")
        return _failure(500, "Failed to count unread notifications.")


def mark_notification_read(notification_id: str, user_id: str) -> dict:
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable

    safe_notification_id = _uuid_or_none(notification_id)
    if safe_notification_id is None:
        return _failure(400, "Notification ID is invalid.")

    try:
        with db_session() as session:
            notification = session.scalar(
                select(Notification)
                .where(
                    Notification.id == safe_notification_id,
                    Notification.user_id == user_id,
                )
                .with_for_update()
            )
            if notification is None:
                return _failure(404, "Notification was not found.")

            already_read = bool(notification.is_read)
            if not already_read:
                notification.is_read = True
                notification.read_at = datetime.now(timezone.utc)
                session.flush()
            return {
                "status": "success",
                "already_read": already_read,
                "notification": serialize_notification(notification),
            }
    except SQLAlchemyError:
        logger.exception("Failed to mark notification as read.")
        return _failure(500, "Failed to mark notification as read.")


def mark_all_notifications_read(user_id: str) -> dict:
    unavailable = _database_unavailable()
    if unavailable:
        return unavailable

    try:
        with db_session() as session:
            result = session.execute(
                update(Notification)
                .where(
                    Notification.user_id == user_id,
                    Notification.is_read.is_(False),
                )
                .values(is_read=True, read_at=datetime.now(timezone.utc))
            )
            return {
                "status": "success",
                "marked_read_count": int(result.rowcount or 0),
            }
    except SQLAlchemyError:
        logger.exception("Failed to mark notifications as read.")
        return _failure(500, "Failed to mark notifications as read.")


def serialize_notification(notification: Notification) -> dict:
    return {
        "id": str(notification.id),
        "event_type": notification.event_type,
        "title": notification.title,
        "message": notification.message,
        "payload": normalize_json_value(notification.payload_json) or {},
        "is_read": bool(notification.is_read),
        "read_at": serialize_datetime(notification.read_at),
        "created_at": serialize_datetime(notification.created_at),
    }


def _notification_content(study_status: str, decision: str) -> tuple[str, str, str]:
    if study_status == "failed":
        return (
            "impact_study_failed",
            "Impact Study failed",
            "The Impact Study could not complete. Review its failed jobs and warnings.",
        )
    if study_status == "completed_with_failures":
        return (
            "impact_study_completed_with_failures",
            "Impact Study completed with failures",
            "The Impact Study finished with partial results that require review.",
        )
    if decision != "pass":
        return (
            "impact_study_needs_review",
            "Impact Study needs review",
            "The Impact Study completed, but its objectives or spatial results "
            "require engineering review.",
        )
    return (
        "impact_study_completed",
        "Impact Study completed",
        "The Impact Study completed and its configured objectives passed "
        "without a detected local regression.",
    )


def _uuid_or_none(value: str) -> str | None:
    try:
        return str(UUID(value))
    except (TypeError, ValueError):
        return None


def _database_unavailable() -> dict | None:
    if is_database_configured():
        return None
    return _failure(503, "Notifications require a configured database.")


def _failure(status_code: int, error: str) -> dict:
    return {
        "status": "failure",
        "status_code": status_code,
        "error": error,
    }
