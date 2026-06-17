import logging
import threading
import time

from backend.database import is_database_configured
from backend.schemas.requests import (
    CoverageRequest,
    NetworkCoverageRequest,
    RSRPRequest,
    SINRRequest,
    ThroughputRequest,
)
from backend.services.coverage_service import (
    calculate_coverage_map_service,
    calculate_network_coverage_service,
)
from backend.services.rsrp_service import calculate_rsrp_service
from backend.services.simulation_job_store import (
    claim_next_simulation_job,
    mark_simulation_job_failed,
    mark_simulation_job_succeeded,
)
from backend.services.simulation_store import store_simulation_result, utc_now
from backend.services.sinr_service import calculate_sinr_service
from backend.services.throughput_service import compare_throughput_service


logger = logging.getLogger(__name__)

REQUEST_MODELS = {
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
    started_at = utc_now()

    try:
        req = build_request(simulation_type, request_json)
        scene = get_worker_scene(scene_info)
        result = execute_simulation(
            simulation_type,
            req,
            scene,
            job.get("base_url"),
        )
        finished_at = utc_now()
        run_id = store_simulation_result(
            simulation_type,
            req,
            result,
            started_at,
            finished_at,
            scene_info=scene_info,
        )

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
            result_run_id=run_id,
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
    scene_id = scene_info.get("id") or "munich"
    scene_path = scene_info.get("scene_path")
    cache_key = (scene_id, scene_path)

    if cache_key not in _scene_cache:
        _scene_cache.clear()
        _scene_cache[cache_key] = load_scene(scene_path)

    return _scene_cache[cache_key]


def load_scene(scene_path):
    import sionna
    from sionna.rt import load_scene as sionna_load_scene

    scene_source = scene_path or sionna.rt.scene.munich
    return sionna_load_scene(scene_source, merge_shapes=True)


def is_failure_result(result):
    return str(result.get("status", "")).lower().startswith("failure")
