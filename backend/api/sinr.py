import math

from fastapi import APIRouter, Depends, HTTPException, Request

from backend.constants import MAX_GRID_CELLS
from backend.api.dependencies import require_current_user
from backend.schemas.requests import (
    CoverageRequest,
    NetworkCoverageRequest,
    RSRPRequest,
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
from backend.services.rsrp_service import (
    calculate_rsrp_service,
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
    tags=["Sionna"],
    dependencies=[Depends(require_current_user)],
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
    align_request_solver_to_scene(req, scene_info)
    validate_request_positions_inside_solver(req)
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


def align_request_solver_to_scene(req, scene_info):
    solver = getattr(req, "solver", None)
    metrics = scene_info.get("metrics") or {}
    width = metrics.get("width_m")
    height = metrics.get("height_m")

    if solver is None or not is_positive_number(width) or not is_positive_number(height):
        return

    width = float(width)
    height = float(height)
    minimum_cell_size = math.ceil(
        math.sqrt((width * height) / MAX_GRID_CELLS)
    )
    cell_size = max(
        float(solver.cell_size),
        float(minimum_cell_size),
    )

    req.solver = solver.model_copy(
        update={
            "center": (0.0, 0.0, 0.0),
            "size": (width, height),
            "cell_size": cell_size,
        }
    )


def is_positive_number(value):
    try:
        return math.isfinite(float(value)) and float(value) > 0
    except (TypeError, ValueError):
        return False


def validate_request_positions_inside_solver(req):
    solver = getattr(req, "solver", None)

    if solver is None:
        return

    x_min = float(solver.center[0]) - float(solver.size[0]) / 2.0
    x_max = float(solver.center[0]) + float(solver.size[0]) / 2.0
    y_min = float(solver.center[1]) - float(solver.size[1]) / 2.0
    y_max = float(solver.center[1]) + float(solver.size[1]) / 2.0

    for label, position in iter_position_fields(req):
        error = position_bounds_error(
            label,
            position,
            x_min,
            x_max,
            y_min,
            y_max,
        )

        if error:
            raise HTTPException(
                status_code=400,
                detail={
                    "status": "failure",
                    "status_code": 400,
                    "error": error,
                },
            )


def iter_position_fields(req):
    direct_fields = (
        ("Transmitter position", "transmitter_position"),
        ("Receiver position", "receiver_position"),
        ("Interferer position", "interferer_position"),
    )

    for label, field in direct_fields:
        if hasattr(req, field):
            yield label, getattr(req, field)

    for antenna in getattr(req, "antennas", []) or []:
        antenna_id = getattr(antenna, "id", "unknown")
        yield f"Antenna {antenna_id} position", antenna.position


def position_bounds_error(label, position, x_min, x_max, y_min, y_max):
    try:
        x = float(position[0])
        y = float(position[1])
        z = float(position[2])
    except (TypeError, ValueError, IndexError):
        return f"{label} must include numeric x, y, and z coordinates."

    if not math.isfinite(x) or not math.isfinite(y) or not math.isfinite(z):
        return f"{label} must include numeric x, y, and z coordinates."

    if x_min <= x <= x_max and y_min <= y <= y_max:
        return None

    return (
        f"{label} must stay inside the selected scene "
        f"(x {format_bound(x_min)} to {format_bound(x_max)} m, "
        f"y {format_bound(y_min)} to {format_bound(y_max)} m)."
    )


def format_bound(value):
    return round(float(value), 2)


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


def log_business_event(
    event,
    level="INFO",
    **data,
):
    log_event(
        event,
        level=level,
        data=data,
    )


def log_failed_business_event(
    event,
    result,
    **data,
):
    status_code = result.get("status_code", 500)
    level = "ERROR" if status_code >= 500 else "WARNING"
    log_business_event(
        event,
        level=level,
        status_code=status_code,
        error=result.get("error"),
        **data,
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


@router.post("/rsrp-simulation")
def rsrp_simulation(req: RSRPRequest):

    with engine.lock:
        scene = engine.get_scene()

        return run_and_store(
            "rsrp_simulation",
            req,
            lambda: calculate_rsrp_service(req, scene),
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
        log_business_event(
            "simulation_history_delete_failed",
            level="ERROR",
            run_id=run_id,
            error=result.get("error"),
        )
        raise HTTPException(
            status_code=500,
            detail=result,
        )

    if (
        result.get("database_configured")
        and not result.get("deleted")
    ):
        log_business_event(
            "simulation_history_delete_failed",
            level="WARNING",
            run_id=run_id,
            status_code=404,
            error="Simulation run not found.",
        )
        raise HTTPException(
            status_code=404,
            detail="Simulation run not found.",
        )

    log_business_event(
        "simulation_history_deleted",
        run_id=run_id,
        database_configured=result.get("database_configured"),
        deleted=result.get("deleted"),
        deleted_files=result.get("deleted_files"),
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

    if str(result.get("status", "")).lower().startswith("failure"):
        log_failed_business_event(
            "scene_preview_failed",
            result,
            scene_name=req.name,
        )
        return return_or_raise(result)

    scene = result.get("scene", {})
    metrics = scene.get("metrics") or {}
    log_business_event(
        "scene_preview_created",
        scene_id=scene.get("id"),
        scene_name=scene.get("name"),
        area_km2=metrics.get("area_km2"),
        width_m=metrics.get("width_m"),
        height_m=metrics.get("height_m"),
    )

    return return_or_raise(result)


@router.post("/scenes/{scene_id}/activate")
def activate_scene_route(scene_id: str):
    result = activate_scene(scene_id)

    if str(result.get("status", "")).lower().startswith("failure"):
        log_failed_business_event(
            "scene_activation_failed",
            result,
            scene_id=scene_id,
        )
        return return_or_raise(result)

    scene = return_or_raise(result)["scene"]

    try:
        with engine.lock:
            engine.set_active_scene(scene)
    except Exception as exc:
        log_business_event(
            "scene_activation_failed",
            level="ERROR",
            scene_id=scene.get("id"),
            scene_name=scene.get("name"),
            error=str(exc),
        )
        raise

    log_business_event(
        "scene_activated",
        scene_id=scene.get("id"),
        scene_name=scene.get("name"),
    )

    return {
        "status": "success",
        "scene": scene,
    }


@router.delete("/scenes/{scene_id}")
def delete_scene_route(scene_id: str):
    result = delete_scene(scene_id)

    if str(result.get("status", "")).lower().startswith("failure"):
        log_failed_business_event(
            "scene_delete_failed",
            result,
            scene_id=scene_id,
        )
        return return_or_raise(result)

    log_business_event(
        "scene_deleted",
        scene_id=scene_id,
    )

    return return_or_raise(result)
