from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.api.dependencies import require_current_user
from backend.schemas.impact_studies import ImpactStudyCreateRequest
from backend.services import impact_study_service


router = APIRouter(tags=["Impact studies"])

ImpactStudyStatus = Literal[
    "planned",
    "queued",
    "running",
    "aggregating",
    "completed",
    "completed_with_failures",
    "cancelled",
    "failed",
]


def return_or_raise(result: dict) -> dict:
    if str(result.get("status", "")).lower().startswith("failure"):
        raise HTTPException(
            status_code=result.get("status_code", 500),
            detail=result,
        )
    return result


@router.post("/impact-studies", status_code=status.HTTP_201_CREATED)
def create_impact_study(
    request: ImpactStudyCreateRequest,
    user=Depends(require_current_user),
):
    return return_or_raise(
        impact_study_service.create_impact_study(request, created_by=user["id"])
    )


@router.get("/impact-studies")
def list_impact_studies(
    scene_id: str | None = None,
    study_status: ImpactStudyStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=500),
    user=Depends(require_current_user),
):
    return return_or_raise(
        impact_study_service.list_impact_studies(
            user_id=user["id"],
            scene_id=scene_id,
            status=study_status,
            limit=limit,
        )
    )


@router.get("/impact-studies/{study_id}")
def get_impact_study(
    study_id: UUID,
    user=Depends(require_current_user),
):
    return return_or_raise(
        impact_study_service.get_impact_study(str(study_id), user_id=user["id"])
    )


@router.get("/impact-studies/{study_id}/comparison")
def get_impact_study_comparison(
    study_id: UUID,
    user=Depends(require_current_user),
):
    return return_or_raise(
        impact_study_service.get_impact_study_comparison(
            str(study_id),
            user_id=user["id"],
        )
    )


@router.post("/impact-studies/{study_id}/start")
def start_impact_study(
    study_id: UUID,
    user=Depends(require_current_user),
):
    return return_or_raise(
        impact_study_service.start_impact_study(str(study_id), user_id=user["id"])
    )


@router.post("/impact-studies/{study_id}/cancel")
def cancel_impact_study(
    study_id: UUID,
    user=Depends(require_current_user),
):
    return return_or_raise(
        impact_study_service.cancel_impact_study(str(study_id), user_id=user["id"])
    )
