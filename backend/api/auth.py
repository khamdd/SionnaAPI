from fastapi import APIRouter, HTTPException

from backend.schemas.auth import AuthRequest
from backend.services.auth_service import create_user, login_user


router = APIRouter(
    tags=["Auth"]
)


def return_or_raise(result):
    if result.get("status") == "success":
        return result

    raise HTTPException(
        status_code=result.get("status_code", 500),
        detail=result,
    )


@router.post("/auth/register")
def register(req: AuthRequest):
    return return_or_raise(
        create_user(
            req.username,
            req.password,
        )
    )


@router.post("/auth/login")
def login(req: AuthRequest):
    return return_or_raise(
        login_user(
            req.username,
            req.password,
        )
    )
