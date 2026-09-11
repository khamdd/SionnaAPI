from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.api.dependencies import require_current_user
from backend.services import notification_service

router = APIRouter(tags=["Notifications"])


def return_or_raise(result: dict) -> dict:
    if str(result.get("status", "")).lower().startswith("failure"):
        raise HTTPException(
            status_code=result.get("status_code", 500),
            detail=result,
        )
    return result


@router.get("/notifications")
def list_notifications(
    unread_only: bool = False,
    limit: int = Query(default=100, ge=1, le=500),
    user=Depends(require_current_user),
):
    return return_or_raise(
        notification_service.list_notifications(
            user["id"],
            unread_only=unread_only,
            limit=limit,
        )
    )


@router.get("/notifications/unread-count")
def get_unread_notification_count(user=Depends(require_current_user)):
    return return_or_raise(
        notification_service.get_unread_notification_count(user["id"])
    )


@router.post("/notifications/read-all")
def mark_all_notifications_read(user=Depends(require_current_user)):
    return return_or_raise(
        notification_service.mark_all_notifications_read(user["id"])
    )


@router.post("/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: UUID,
    user=Depends(require_current_user),
):
    return return_or_raise(
        notification_service.mark_notification_read(
            str(notification_id),
            user["id"],
        )
    )
