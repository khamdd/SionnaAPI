import logging
import threading
import time

from backend.database import is_database_configured
from backend.schemas.requests import (
    CoverageRequest,
    NetworkCoverageRequest,
    NetworkCoverageOptimizationRequest,
    RSRPRequest,
    SINRRequest,
    ThroughputRequest,
)
from backend.services.coverage_service import (
    calculate_coverage_map_service,
    calculate_network_coverage_service,
)
from backend.services.coordinate_service import with_runtime_antenna_positions
from backend.services.rsrp_service import calculate_rsrp_service
from backend.services.simulation_job_store import (
    claim_next_simulation_job,
    mark_simulation_job_failed,
    mark_simulation_job_succeeded,
    update_optimization_progress,
)
from backend.services.sinr_service import calculate_sinr_service
from backend.services.throughput_service import compare_throughput_service


logger = logging.getLogger(__name__)

REQUEST_MODELS = {
    "network_coverage_optimization": NetworkCoverageOptimizationRequest,
    "coverage_map": CoverageRequest,
    "network_coverage": NetworkCoverageRequest,
    "rsrp_simulation": RSRPRequest,
    "sinr": SINRRequest,
    "throughput_comparison": ThroughputRequest,
}

_worker_thread = None
_stop_event = threading.Event()
_scene_cache = {}


def start_simulation_worker():
    global _worker_thread

    if not is_database_configured():
        logger.info("Simulation worker disabled because DATABASE_URL is not configured.")
        return

    if _worker_thread and _worker_thread.is_alive():
        return

    _stop_event.clear()
    _worker_thread = threading.Thread(
        target=simulation_worker_loop,
        name="simulation-worker",
        daemon=True,
    )
    _worker_thread.start()
    logger.info("Simulation worker started.")


def stop_simulation_worker(timeout=5.0):
    _stop_event.set()

    if _worker_thread and _worker_thread.is_alive():
        _worker_thread.join(timeout=timeout)


def simulation_worker_loop(poll_interval=1.0):
    while not _stop_event.is_set():
        try:
            job = claim_next_simulation_job()

            if job is None:
                _stop_event.wait(poll_interval)
                continue

            run_simulation_job(job)

        except Exception:
            logger.exception("Simulation worker loop failed.")
            _stop_event.wait(poll_interval)


def run_simulation_job(job):
    job_id = str(job["id"])
    simulation_type = job["simulation_type"]
    scene_info = job.get("scene_json") or {}
    request_json = job.get("request_json") or {}
    try:
        req = build_request(simulation_type, request_json)
        scene = get_worker_scene(scene_info)
        if simulation_type == "network_coverage_optimization":
            from backend.services.optimization_service import run_network_coverage_optimization
            result = run_network_coverage_optimization(
                req,
                lambda candidate: calculate_network_coverage_service(
                    with_runtime_antenna_positions(candidate, scene_info), job.get("base_url"), scene,
                ),
                progress=lambda value: update_optimization_progress(job_id, value),
            )
        else:
            runtime_req = with_runtime_antenna_positions(req, scene_info)
            result = execute_simulation(simulation_type, runtime_req, scene, job.get("base_url"))
        if is_failure_result(result):
            mark_simulation_job_failed(
                job_id,
                result.get("error") or "Simulation failed.",
                result=result,
            )
            return

        mark_simulation_job_succeeded(
            job_id,
            result,
        )

    except Exception as exc:
        logger.exception("Simulation job failed: %s", job_id)
        mark_simulation_job_failed(
            job_id,
            str(exc),
            result={
                "status": "failure",
                "error": str(exc),
            },
        )


def build_request(simulation_type, request_json):
    model = REQUEST_MODELS[simulation_type]
    return model(**request_json)


def execute_simulation(simulation_type, req, scene, base_url):
    if simulation_type == "coverage_map":
        return calculate_coverage_map_service(req, base_url, scene)

    if simulation_type == "network_coverage":
        return calculate_network_coverage_service(req, base_url, scene)

    if simulation_type == "rsrp_simulation":
        return calculate_rsrp_service(req, scene)

    if simulation_type == "sinr":
        return calculate_sinr_service(req, scene)

    if simulation_type == "throughput_comparison":
        return compare_throughput_service(req, scene)

    raise ValueError(f"Unsupported simulation type: {simulation_type}")


def get_worker_scene(scene_info):
    scene_id = scene_info.get("id")
    scene_path = scene_info.get("scene_path")
    if not scene_id or not scene_path:
        raise ValueError("No active scene is selected.")

    cache_key = (scene_id, scene_path)

    if cache_key not in _scene_cache:
        _scene_cache.clear()
        _scene_cache[cache_key] = load_scene(scene_path)

    return _scene_cache[cache_key]


def load_scene(scene_path):
    from sionna.rt import load_scene as sionna_load_scene

    if not scene_path:
        raise ValueError("No active scene is selected.")

    return sionna_load_scene(scene_path, merge_shapes=True)


def is_failure_result(result):
    return str(result.get("status", "")).lower().startswith("failure")
