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


@router.post("/coverage-map")
def coverage_map(req: CoverageRequest, request: Request):

    with engine.lock:
        scene = engine.get_scene()

        return return_or_raise(
            calculate_coverage_map_service(
                req,
                request.base_url,
                scene,
            )
        )


@router.post("/network-coverage")
def network_coverage(req: NetworkCoverageRequest, request: Request):

    with engine.lock:
        scene = engine.get_scene()

        return return_or_raise(
            calculate_network_coverage_service(
                req,
                request.base_url,
                scene,
            )
        )


@router.post("/sinr")
def calculate_sinr(req: SINRRequest):

    with engine.lock:
        scene = engine.get_scene()

        return return_or_raise(
            calculate_sinr_service(req, scene)
        )


@router.post("/throughput-comparison")
def compare_throughput(req: ThroughputRequest):

    with engine.lock:
        scene = engine.get_scene()

        return return_or_raise(
            compare_throughput_service(req, scene)
        )
