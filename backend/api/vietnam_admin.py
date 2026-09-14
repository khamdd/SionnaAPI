import json

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from backend.api.dependencies import require_current_user
from backend.services import vietnam_admin_service

router = APIRouter(
    tags=["Vietnam Admin Units"],
    dependencies=[Depends(require_current_user)],
)

WARD_BOUNDARY_CACHE_SECONDS = 60 * 60 * 24


def return_or_raise(result: dict) -> dict:
    if str(result.get("status", "")).lower().startswith("failure"):
        raise HTTPException(
            status_code=result.get("status_code", 500),
            detail=result,
        )
    return result


@router.get("/vietnam/provinces")
def list_provinces():
    return return_or_raise(vietnam_admin_service.list_provinces())


@router.get("/vietnam/wards")
def search_wards(
    q: str = Query(default=""),
    province_code: str | None = Query(default=None),
    limit: int = Query(
        default=vietnam_admin_service.DEFAULT_WARD_LIMIT,
        ge=1,
        le=vietnam_admin_service.MAX_WARD_LIMIT,
    ),
):
    return return_or_raise(
        vietnam_admin_service.search_wards(
            q,
            province_code=province_code,
            limit=limit,
        )
    )


@router.get("/vietnam/wards/{ward_code}/boundary")
def get_ward_boundary(ward_code: str):
    result = return_or_raise(
        vietnam_admin_service.get_ward_boundary(ward_code)
    )
    return Response(
        content=_json_bytes(result),
        media_type="application/geo+json",
        headers={
            "Cache-Control": (
                f"public, max-age={WARD_BOUNDARY_CACHE_SECONDS}, immutable"
            )
        },
    )


def _json_bytes(payload: dict) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode(
        "utf-8"
    )
