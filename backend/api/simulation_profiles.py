from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.api.dependencies import require_current_user
from backend.schemas.simulation_profiles import (
    SimulationProfileBuildRequest,
    SimulationProfileCreateRequest,
    SimulationProfileUpdateRequest,
    SimulationType,
)
from backend.services import simulation_profile_service


router = APIRouter(tags=["Simulation profiles"])


def return_or_raise(result: dict) -> dict:
    if str(result.get("status", "")).lower().startswith("failure"):
        raise HTTPException(
            status_code=result.get("status_code", 500),
            detail=result,
        )
    return result


@router.post("/simulation-profiles", status_code=status.HTTP_201_CREATED)
def create_simulation_profile(
    request: SimulationProfileCreateRequest,
    user=Depends(require_current_user),
):
    return return_or_raise(
        simulation_profile_service.create_simulation_profile(
            request,
            created_by=user["id"],
        )
    )


@router.get("/simulation-profiles")
def list_simulation_profiles(
    scene_id: str | None = None,
    simulation_type: SimulationType | None = None,
    enabled: bool | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    user=Depends(require_current_user),
):
    return return_or_raise(
        simulation_profile_service.list_simulation_profiles(
            user_id=user["id"],
            scene_id=scene_id,
            simulation_type=simulation_type,
            enabled=enabled,
            limit=limit,
        )
    )


@router.get("/simulation-profiles/{profile_id}")
def get_simulation_profile(
    profile_id: UUID,
    user=Depends(require_current_user),
):
    return return_or_raise(
        simulation_profile_service.get_simulation_profile(
            str(profile_id),
            user_id=user["id"],
        )
    )


@router.put("/simulation-profiles/{profile_id}")
def update_simulation_profile(
    profile_id: UUID,
    request: SimulationProfileUpdateRequest,
    user=Depends(require_current_user),
):
    return return_or_raise(
        simulation_profile_service.update_simulation_profile(
            str(profile_id),
            request,
            user_id=user["id"],
        )
    )


@router.delete("/simulation-profiles/{profile_id}")
def delete_simulation_profile(
    profile_id: UUID,
    user=Depends(require_current_user),
):
    return return_or_raise(
        simulation_profile_service.delete_simulation_profile(
            str(profile_id),
            user_id=user["id"],
        )
    )


@router.post("/simulation-profiles/{profile_id}/enable")
def enable_simulation_profile(
    profile_id: UUID,
    user=Depends(require_current_user),
):
    return return_or_raise(
        simulation_profile_service.set_simulation_profile_enabled(
            str(profile_id),
            enabled=True,
            user_id=user["id"],
        )
    )


@router.post("/simulation-profiles/{profile_id}/disable")
def disable_simulation_profile(
    profile_id: UUID,
    user=Depends(require_current_user),
):
    return return_or_raise(
        simulation_profile_service.set_simulation_profile_enabled(
            str(profile_id),
            enabled=False,
            user_id=user["id"],
        )
    )


@router.post("/simulation-profiles/{profile_id}/build-request")
def build_simulation_profile_request(
    profile_id: UUID,
    request: SimulationProfileBuildRequest,
    user=Depends(require_current_user),
):
    return return_or_raise(
        simulation_profile_service.build_profile_request(
            str(profile_id),
            str(request.configuration_id),
            user_id=user["id"],
        )
    )
