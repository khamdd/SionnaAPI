from fastapi import APIRouter, HTTPException, Request

from backend.schemas.requests import (
    CoverageRequest,
    NetworkCoverageRequest,
    SceneBoundsRequest,
    SINRRequest,
    ThroughputRequest,
)

from backend.services.coverage_service import (
    calculate_coverage_map_service,
    calculate_network_coverage_service,
)

from backend.services.sinr_service import (
    calculate_sinr_service,
)

from backend.services.throughput_service import (
    compare_throughput_service,
)

from backend.services.simulation_store import (
    delete_simulation_run,
    get_simulation_run,
    list_simulation_runs,
    store_simulation_result,
    utc_now,
)
from backend.services.scene_service import (
    activate_scene,
    create_scene_preview,
    delete_scene,
    get_active_scene,
    list_scenes,
)
from backend.services.event_logger import log_event

from backend.simulations.sionna_engine import engine

router = APIRouter(
    tags=["Sionna"]
)


def return_or_raise(result):
    status = str(
        result.get("status", "")
    ).lower()

    if status.startswith("failure"):
        raise HTTPException(
            status_code=result.get("status_code", 500),
            detail=result,
        )

    return result


def run_and_store(
    simulation_type,
    req,
    simulation_fn,
):
    started_at = utc_now()
    scene_info = get_engine_scene_info()
    log_simulation_event(
        "simulation_started",
        simulation_type,
        scene_info,
    )
    try:
        result = simulation_fn()
    except Exception as exc:
        finished_at = utc_now()
        log_simulation_event(
            "simulation_failed",
            simulation_type,
            scene_info,
            duration_ms=round(
                (finished_at - started_at).total_seconds() * 1000,
                2,
            ),
            status="exception",
            error=str(exc),
        )
        raise

    finished_at = utc_now()
    duration_ms = round(
        (finished_at - started_at).total_seconds() * 1000,
        2,
    )

    store_simulation_result(
        simulation_type,
        req,
        result,
        started_at,
        finished_at,
        scene_info=scene_info,
    )

    status = str(result.get("status", "")).lower()
    if status.startswith("failure"):
        log_simulation_event(
            "simulation_failed",
            simulation_type,
            scene_info,
            duration_ms=duration_ms,
            status=result.get("status"),
            error=result.get("error"),
        )
    else:
        log_simulation_event(
            "simulation_completed",
            simulation_type,
            scene_info,
            duration_ms=duration_ms,
            status=result.get("status"),
        )

    return return_or_raise(result)


def log_simulation_event(
    event,
    simulation_type,
    scene_info,
    **data,
):
    log_event(
        event,
        level="ERROR" if event == "simulation_failed" else "INFO",
        data={
            "simulation_type": simulation_type,
            "scene_id": scene_info.get("id"),
            "scene_name": scene_info.get("name"),
            **data,
        },
    )


def get_engine_scene_info():
    get_active_scene_info = getattr(engine, "get_active_scene_info", None)

    if get_active_scene_info is None:
        return {
            "id": "munich",
            "name": "Munich",
        }

    return get_active_scene_info()


@router.post("/coverage-map")
def coverage_map(req: CoverageRequest, request: Request):

    with engine.lock:
        scene = engine.get_scene()

        return run_and_store(
            "coverage_map",
            req,
            lambda: calculate_coverage_map_service(
                req,
                request.base_url,
                scene,
            ),
        )


@router.post("/network-coverage")
def network_coverage(req: NetworkCoverageRequest, request: Request):

    with engine.lock:
        scene = engine.get_scene()

        return run_and_store(
            "network_coverage",
            req,
            lambda: calculate_network_coverage_service(
                req,
                request.base_url,
                scene,
            ),
        )


@router.post("/sinr")
def calculate_sinr(req: SINRRequest):

    with engine.lock:
        scene = engine.get_scene()

        return run_and_store(
            "sinr",
            req,
            lambda: calculate_sinr_service(req, scene),
        )


@router.post("/throughput-comparison")
def compare_throughput(req: ThroughputRequest):

    with engine.lock:
        scene = engine.get_scene()

        return run_and_store(
            "throughput_comparison",
            req,
            lambda: compare_throughput_service(req, scene),
        )


@router.get("/simulation-runs")
def simulation_runs(limit: int = 25):
    return list_simulation_runs(limit=limit)


@router.get("/simulation-runs/{run_id}")
def simulation_run_detail(run_id: str):
    result = get_simulation_run(run_id)

    if (
        result.get("database_configured")
        and result.get("item") is None
        and not result.get("error")
    ):
        raise HTTPException(
            status_code=404,
            detail="Simulation run not found.",
        )

    return result


@router.delete("/simulation-runs/{run_id}")
def delete_simulation_run_history(run_id: str):
    result = delete_simulation_run(run_id)

    if result.get("error"):
        raise HTTPException(
            status_code=500,
            detail=result,
        )

    if (
        result.get("database_configured")
        and not result.get("deleted")
    ):
        raise HTTPException(
            status_code=404,
            detail="Simulation run not found.",
        )

    return result


@router.get("/scenes")
def scenes():
    return list_scenes()


@router.get("/scenes/active")
def active_scene():
    return get_active_scene()


@router.post("/scenes/preview")
def preview_scene(req: SceneBoundsRequest, request: Request):
    result = create_scene_preview(req, request.base_url)
    return return_or_raise(result)


@router.post("/scenes/{scene_id}/activate")
def activate_scene_route(scene_id: str):
    result = activate_scene(scene_id)
    scene = return_or_raise(result)["scene"]

    with engine.lock:
        engine.set_active_scene(scene)

    return {
        "status": "success",
        "scene": scene,
    }


@router.delete("/scenes/{scene_id}")
def delete_scene_route(scene_id: str):
    result = delete_scene(scene_id)
    return return_or_raise(result)
