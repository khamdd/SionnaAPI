from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.services.auth_service import authenticate_access_token


bearer_scheme = HTTPBearer(auto_error=False)


def require_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
):
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail={
                "status": "failure",
                "status_code": 401,
                "error": "Missing access token.",
            },
        )

    result = authenticate_access_token(credentials.credentials)

    if result.get("status") != "success":
        raise HTTPException(
            status_code=result.get("status_code", 401),
            detail=result,
        )

    return result["user"]
