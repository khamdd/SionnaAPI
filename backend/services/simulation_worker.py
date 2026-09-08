import logging
import os
import signal
import socket
import threading
import time
from contextlib import contextmanager
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from backend.core.config import get_simulation_job_settings
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
    handle_simulation_job_failure,
    heartbeat_simulation_job,
    is_simulation_job_cancel_requested,
    mark_simulation_job_cancelled,
    mark_simulation_job_failed,
    mark_simulation_job_succeeded,
    recover_expired_simulation_jobs,
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

TRANSIENT_EXCEPTIONS = (ConnectionError, OSError, SQLAlchemyError, TimeoutError)
PERMANENT_INPUT_EXCEPTIONS = (KeyError, TypeError, ValueError, ValidationError)

_worker_thread = None
_stop_event = threading.Event()
_scene_cache = {}


class JobCancellationRequested(RuntimeError):
    pass


class JobExecutionTimeout(TimeoutError):
    pass


class JobLeaseLost(RuntimeError):
    pass


def create_worker_id():
    configured = os.getenv("SIMULATION_WORKER_ID")
    if configured:
        return configured
    return f"{socket.gethostname()}-{os.getpid()}-{str(uuid4())[:8]}"


def start_simulation_worker():
    global _worker_thread

    settings = get_simulation_job_settings()
    if not is_database_configured():
        logger.info("Simulation worker disabled because DATABASE_URL is not configured.")
        return
    if not settings.worker_enabled:
        logger.info("In-process simulation worker is disabled.")
        return
    if _worker_thread and _worker_thread.is_alive():
        return

    _stop_event.clear()
    worker_id = create_worker_id()
    _worker_thread = threading.Thread(
        target=simulation_worker_loop,
        kwargs={"worker_id": worker_id},
        name="simulation-worker",
        daemon=True,
    )
    _worker_thread.start()
    logger.info("Simulation worker started: %s", worker_id)


def stop_simulation_worker(timeout=5.0):
    _stop_event.set()

    if _worker_thread and _worker_thread.is_alive():
        _worker_thread.join(timeout=timeout)


def run_simulation_worker_forever():
    if not is_database_configured():
        raise RuntimeError("The simulation worker requires a configured database.")
    _stop_event.clear()
    worker_id = create_worker_id()
    logger.info("Foreground simulation worker started: %s", worker_id)
    simulation_worker_loop(worker_id=worker_id)


def simulation_worker_loop(poll_interval=None, worker_id=None):
    settings = get_simulation_job_settings()
    poll_interval = poll_interval or settings.poll_interval_seconds
    worker_id = worker_id or create_worker_id()
    recovery_interval = max(5.0, settings.lease_seconds / 2)
    next_recovery_at = 0.0

    while not _stop_event.is_set():
        try:
            monotonic_now = time.monotonic()
            if monotonic_now >= next_recovery_at:
                recovered = recover_expired_simulation_jobs()
                if recovered:
                    logger.warning("Recovered %s expired simulation job(s).", recovered)
                next_recovery_at = monotonic_now + recovery_interval

            job = claim_next_simulation_job(
                worker_id=worker_id,
                lease_seconds=settings.lease_seconds,
            )
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
    worker_id = job.get("worker_id")
    settings = get_simulation_job_settings()

    try:
        with JobHeartbeat(job_id, worker_id, settings) as heartbeat:
            with job_execution_timeout(settings.timeout_seconds):
                _ensure_job_active(job_id, worker_id, heartbeat)
                req = build_request(simulation_type, request_json)
                if simulation_type == "network_coverage_optimization":
                    scene = get_worker_scene(scene_info)
                    from backend.services.optimization_service import (
                        run_network_coverage_optimization,
                    )

                    def report_progress(value):
                        _ensure_job_active(job_id, worker_id, heartbeat)
                        _update_progress(job_id, value, worker_id)

                    result = run_network_coverage_optimization(
                        req,
                        lambda candidate: _run_optimization_candidate(
                            candidate,
                            scene_info,
                            job.get("base_url"),
                            scene,
                            job_id,
                            worker_id,
                            heartbeat,
                        ),
                        progress=report_progress,
                    )
                else:
                    runtime_req = with_runtime_antenna_positions(req, scene_info)
                    scene = (
                        None
                        if getattr(req, "propagation_model", "sionna") != "sionna"
                        else get_worker_scene(scene_info)
                    )
                    result = execute_simulation(
                        simulation_type,
                        runtime_req,
                        scene,
                        job.get("base_url"),
                    )
                _ensure_job_active(job_id, worker_id, heartbeat)

        if is_failure_result(result):
            _handle_failure_result(job_id, result, worker_id)
            return

        _mark_succeeded(job_id, result, worker_id)

    except JobCancellationRequested:
        logger.info("Simulation job cancellation acknowledged: %s", job_id)
        _mark_cancelled(job_id, worker_id)
    except JobLeaseLost:
        logger.warning("Simulation job lease ownership was lost: %s", job_id)
    except Exception as exc:
        failure_type, retryable = classify_exception(exc)
        logger.exception(
            "Simulation job attempt failed: %s (%s)",
            job_id,
            failure_type,
        )
        handle_simulation_job_failure(
            job_id,
            str(exc),
            failure_type,
            retryable,
            result={"status": "failure", "error": str(exc)},
            worker_id=worker_id,
        )


def _run_optimization_candidate(
    candidate,
    scene_info,
    base_url,
    scene,
    job_id,
    worker_id,
    heartbeat,
):
    _ensure_job_active(job_id, worker_id, heartbeat)
    result = calculate_network_coverage_service(
        with_runtime_antenna_positions(candidate, scene_info),
        base_url,
        scene,
    )
    _ensure_job_active(job_id, worker_id, heartbeat)
    return result


def classify_exception(exc):
    if isinstance(exc, JobExecutionTimeout):
        return "timeout", True
    if isinstance(exc, PERMANENT_INPUT_EXCEPTIONS):
        return "validation", False
    if isinstance(exc, TRANSIENT_EXCEPTIONS):
        return "transient", True
    return "simulation", False


def _handle_failure_result(job_id, result, worker_id):
    failure_type = str(result.get("failure_type") or "simulation")
    retryable = bool(result.get("retryable", False))
    handle_simulation_job_failure(
        job_id,
        result.get("error") or "Simulation failed.",
        failure_type,
        retryable,
        result=result,
        worker_id=worker_id,
    )


def _ensure_job_active(job_id, worker_id, heartbeat):
    if worker_id is None:
        return
    if heartbeat.lease_lost:
        raise JobLeaseLost("Worker could not renew the job lease.")
    if is_simulation_job_cancel_requested(job_id, worker_id):
        raise JobCancellationRequested("Simulation job cancellation was requested.")


def _update_progress(job_id, value, worker_id):
    if worker_id is None:
        update_optimization_progress(job_id, value)
    else:
        update_optimization_progress(job_id, value, worker_id=worker_id)


def _mark_succeeded(job_id, result, worker_id):
    if worker_id is None:
        return mark_simulation_job_succeeded(job_id, result)
    return mark_simulation_job_succeeded(job_id, result, worker_id=worker_id)


def _mark_cancelled(job_id, worker_id):
    if worker_id is None:
        return mark_simulation_job_cancelled(job_id)
    return mark_simulation_job_cancelled(job_id, worker_id=worker_id)


class JobHeartbeat:
    def __init__(self, job_id, worker_id, settings):
        self.job_id = job_id
        self.worker_id = worker_id
        self.settings = settings
        self.lease_lost = False
        self._stop = threading.Event()
        self._thread = None

    def __enter__(self):
        if self.worker_id is not None:
            self._thread = threading.Thread(
                target=self._run,
                name=f"job-heartbeat-{self.job_id}",
                daemon=True,
            )
            self._thread.start()
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)

    def _run(self):
        while not self._stop.wait(self.settings.heartbeat_interval_seconds):
            try:
                renewed = heartbeat_simulation_job(
                    self.job_id,
                    self.worker_id,
                    lease_seconds=self.settings.lease_seconds,
                )
                if not renewed:
                    self.lease_lost = True
                    return
            except Exception:
                logger.warning(
                    "Failed to renew job heartbeat: %s",
                    self.job_id,
                    exc_info=True,
                )


@contextmanager
def job_execution_timeout(timeout_seconds):
    can_use_alarm = (
        hasattr(signal, "SIGALRM")
        and threading.current_thread() is threading.main_thread()
    )
    if not can_use_alarm:
        yield
        return

    def raise_timeout(signum, frame):
        raise JobExecutionTimeout(
            f"Simulation exceeded the {timeout_seconds}-second timeout."
        )

    previous_handler = signal.getsignal(signal.SIGALRM)
    signal.signal(signal.SIGALRM, raise_timeout)
    signal.setitimer(signal.ITIMER_REAL, timeout_seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)


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
