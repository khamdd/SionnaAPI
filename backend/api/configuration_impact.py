from fastapi import APIRouter, Depends, HTTPException

from backend.api.dependencies import require_current_user
from backend.schemas.configuration_impact import ConfigurationImpactPreviewRequest
from backend.services import impact_planner

router = APIRouter(tags=["Configuration impact"])


def return_or_raise(result: dict) -> dict:
    if str(result.get("status", "")).lower().startswith("failure"):
        raise HTTPException(
            status_code=result.get("status_code", 500),
            detail=result,
        )
    return result


@router.post("/configuration-impact/preview")
def preview_configuration_impact(
    request: ConfigurationImpactPreviewRequest,
    user=Depends(require_current_user),
):
    return return_or_raise(
        impact_planner.preview_configuration_impact(
            str(request.baseline_configuration_id),
            str(request.candidate_configuration_id),
            request.profile_pairs,
            user_id=user["id"],
        )
    )
