from fastapi import APIRouter, HTTPException, Request

from backend.schemas.requests import (
    CoverageRequest,
    NetworkCoverageRequest,
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
    result = simulation_fn()
    finished_at = utc_now()

    store_simulation_result(
        simulation_type,
        req,
        result,
        started_at,
        finished_at,
    )

    return return_or_raise(result)


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
