from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.api.auth import router as auth_router
from backend.api.sinr import router as sinr_router
from backend.middleware.request_logging import RequestLoggingMiddleware
from backend.services.simulation_worker import (
    start_simulation_worker,
    stop_simulation_worker,
)


@asynccontextmanager
async def lifespan(app):
    start_simulation_worker()
    try:
        yield
    finally:
        stop_simulation_worker()


app = FastAPI(
    title="SionnaAPI",
    lifespan=lifespan,
)

app.add_middleware(RequestLoggingMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

project_root = Path(__file__).resolve().parents[1]
static_dir = project_root / "static"

app.mount(
    "/static",
    StaticFiles(
        directory=str(static_dir),
        check_dir=False,
    ),
    name="static",
)

app.include_router(
    auth_router,
    prefix="/api/v1"
)

app.include_router(
    sinr_router,
    prefix="/api/v1"
)
