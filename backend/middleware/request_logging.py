import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware

from backend.services.event_logger import log_event


SKIPPED_PATH_PREFIXES = (
    "/static",
    "/docs",
    "/redoc",
    "/openapi.json",
)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path
        if should_skip_path(path):
            return await call_next(request)

        started_at = time.perf_counter()
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())

        try:
            response = await call_next(request)
        except Exception as exc:
            log_http_request(
                event="http_request_failed",
                level="ERROR",
                request=request,
                request_id=request_id,
                status_code=500,
                duration_ms=elapsed_ms(started_at),
                error=str(exc),
            )
            raise

        response.headers["x-request-id"] = request_id
        log_http_request(
            event="http_request",
            level=level_for_status(response.status_code),
            request=request,
            request_id=request_id,
            status_code=response.status_code,
            duration_ms=elapsed_ms(started_at),
        )
        return response


def should_skip_path(path):
    return path.startswith(SKIPPED_PATH_PREFIXES)


def elapsed_ms(started_at):
    return round(
        (time.perf_counter() - started_at) * 1000,
        2,
    )


def level_for_status(status_code):
    if status_code >= 500:
        return "ERROR"
    if status_code >= 400:
        return "WARNING"
    return "INFO"


def log_http_request(
    event,
    level,
    request,
    request_id,
    status_code,
    duration_ms,
    error=None,
):
    data = {
        "request_id": request_id,
        "method": request.method,
        "path": request.url.path,
        "status_code": status_code,
        "duration_ms": duration_ms,
    }

    client = request.client
    if client:
        data["client_host"] = client.host

    if error:
        data["error"] = error

    log_event(
        event,
        level=level,
        data=data,
    )
