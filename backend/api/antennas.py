from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.api.dependencies import require_current_user
from backend.schemas.antennas import (
    AntennaBatchImportRequest,
    AntennaCreateRequest,
    AntennaImportPreviewRequest,
    AntennaUpdateRequest,
)
from backend.services import antenna_service

router = APIRouter(tags=["Antennas"])


def return_or_raise(result):
    if str(result.get("status", "")).lower().startswith("failure"):
        raise HTTPException(status_code=result.get("status_code", 500), detail=result)
    return result


@router.get("/antennas")
def list_antennas(
    q: str | None = Query(default=None, max_length=255),
    antenna_status: Literal["active", "archived"] | None = Query(default=None, alias="status"),
    scene_id: str | None = None,
    limit: int = Query(default=1000, ge=1, le=5000),
    _user=Depends(require_current_user),
):
    return return_or_raise(antenna_service.list_antennas(query=q, status=antenna_status, scene_id=scene_id, limit=limit))


@router.post("/antennas", status_code=status.HTTP_201_CREATED)
def create_antenna(request: AntennaCreateRequest, user=Depends(require_current_user)):
    return return_or_raise(antenna_service.create_antenna(request, user["id"]))


@router.put("/antennas/{antenna_id}")
def update_antenna(antenna_id: UUID, request: AntennaUpdateRequest, user=Depends(require_current_user)):
    return return_or_raise(antenna_service.update_antenna(str(antenna_id), request, user["id"]))


@router.post("/antennas/{antenna_id}/archive")
def archive_antenna(antenna_id: UUID, user=Depends(require_current_user)):
    return return_or_raise(antenna_service.set_antenna_status(str(antenna_id), "archived", user["id"]))


@router.post("/antennas/{antenna_id}/restore")
def restore_antenna(antenna_id: UUID, user=Depends(require_current_user)):
    return return_or_raise(antenna_service.set_antenna_status(str(antenna_id), "active", user["id"]))


@router.post("/antennas/import-preview")
def preview_import(request: AntennaImportPreviewRequest, _user=Depends(require_current_user)):
    return return_or_raise(antenna_service.preview_import(request))


@router.post("/antennas/import")
def import_antennas(request: AntennaBatchImportRequest, user=Depends(require_current_user)):
    return return_or_raise(antenna_service.batch_import(request, user["id"]))
