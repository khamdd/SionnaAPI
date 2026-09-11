from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.api.dependencies import require_current_user
from backend.schemas.network_configurations import (
    NetworkConfigurationCompareRequest,
    NetworkConfigurationCreateRequest,
)
from backend.services import network_configuration_service

router = APIRouter(tags=["Network configurations"])


def return_or_raise(result: dict) -> dict:
    if str(result.get("status", "")).lower().startswith("failure"):
        raise HTTPException(
            status_code=result.get("status_code", 500),
            detail=result,
        )
    return result


@router.post(
    "/network-configurations",
    status_code=status.HTTP_201_CREATED,
)
def create_network_configuration(
    request: NetworkConfigurationCreateRequest,
    user=Depends(require_current_user),
):
    return return_or_raise(
        network_configuration_service.create_network_configuration(
            request,
            created_by=user["id"],
        )
    )


@router.get("/network-configurations")
def list_network_configurations(
    scene_id: str | None = None,
    configuration_status: Literal["draft", "published", "superseded"] | None = Query(
        default=None,
        alias="status",
    ),
    limit: int = Query(default=100, ge=1, le=500),
    user=Depends(require_current_user),
):
    return return_or_raise(
        network_configuration_service.list_network_configurations(
            user_id=user["id"],
            scene_id=scene_id,
            status=configuration_status,
            limit=limit,
        )
    )


@router.post("/network-configurations/compare")
def compare_network_configurations(
    request: NetworkConfigurationCompareRequest,
    user=Depends(require_current_user),
):
    return return_or_raise(
        network_configuration_service.compare_network_configurations(
            str(request.baseline_configuration_id),
            str(request.candidate_configuration_id),
            user_id=user["id"],
        )
    )


@router.get("/network-configurations/{configuration_id}")
def get_network_configuration(
    configuration_id: UUID,
    user=Depends(require_current_user),
):
    return return_or_raise(
        network_configuration_service.get_network_configuration(
            str(configuration_id),
            user_id=user["id"],
        )
    )


@router.post("/network-configurations/{configuration_id}/publish")
def publish_network_configuration(
    configuration_id: UUID,
    user=Depends(require_current_user),
):
    return return_or_raise(
        network_configuration_service.publish_network_configuration(
            str(configuration_id),
            user_id=user["id"],
        )
    )


@router.get("/scenes/{scene_id}/active-configuration")
def get_active_network_configuration(
    scene_id: str,
    user=Depends(require_current_user),
):
    return return_or_raise(
        network_configuration_service.get_active_network_configuration(
            scene_id,
            user_id=user["id"],
        )
    )
