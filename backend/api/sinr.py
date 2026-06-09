from fastapi import APIRouter, Request

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

from backend.simulations.sionna_engine import (
    sionna_lock,
)

router = APIRouter(
    tags=["Sionna"]
)


@router.post("/coverage-map")
def coverage_map(req: CoverageRequest, request: Request):

    with sionna_lock:

        return calculate_coverage_map_service(
            req,
            request.base_url,
        )


@router.post("/network-coverage")
def network_coverage(req: NetworkCoverageRequest, request: Request):

    with sionna_lock:

        return calculate_network_coverage_service(
            req,
            request.base_url,
        )


@router.post("/sinr")
def calculate_sinr(req: SINRRequest):

    with sionna_lock:

        return calculate_sinr_service(req)


@router.post("/throughput-comparison")
def compare_throughput(req: ThroughputRequest):

    with sionna_lock:

        return compare_throughput_service(req)
