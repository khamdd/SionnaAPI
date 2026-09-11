import { TRANSMITTER_PATTERN } from "../constants";
import { formatText } from "./format";
import { lngLatToScenePosition, solverForScene } from "./scene";
import { toAntennaRequest } from "./antennas";

export function buildNetworkCoveragePayload(antennas, activeScene) {
  return {
    antennas: antennas.map(toAntennaRequest),
    transmitter_pattern: TRANSMITTER_PATTERN,
    solver: solverForScene(activeScene),
    bandwidth_mhz: 100,
    mimo_layers: 4,
  };
}

export function simulationJobToHistoryItem(job, result = null) {
  const response = result || job.result || {};
  const isOptimization = job.simulation_type === "network_coverage_optimization";
  const request = isOptimization
    ? response.optimization?.best_request || job.request?.base_request || {}
    : job.request || {};
  const scene = job.scene || {};

  return {
    id: job.result_run_id || job.id,
    simulation_type: isOptimization ? "network_coverage" : job.simulation_type,
    status: response.status || (job.status === "succeeded" ? "success" : job.status),
    transmitter_pattern: request.transmitter_pattern || TRANSMITTER_PATTERN,
    scene_id: scene.id,
    scene_name: scene.name || scene.id,
    scene_bounds: scene.bounds,
    cell_size_m: request.solver?.cell_size,
    bandwidth_mhz: request.bandwidth_mhz,
    mimo_layers: request.mimo_layers,
    coverage_map_image_url: response.coverage_map_image_url,
    error_message: job.error_message || response.error,
    started_at: job.started_at,
    finished_at: job.finished_at,
    created_at: job.queued_at,
    solver: response.solver || request.solver,
    request_json: request,
    response_json: response,
    antennas: antennaSnapshotsForJob(request, scene.bounds),
    artifacts: [],
  };
}

export function antennaSnapshotsForJob(request, sceneBounds) {
  if (!Array.isArray(request.antennas)) {
    return [];
  }

  return request.antennas.map((antenna) => ({
    antenna_code: antenna.id,
    position: Array.isArray(antenna.position)
      ? antenna.position
      : lngLatToScenePosition(antenna, sceneBounds),
    azimuth_deg: antenna.azimuth,
    tilt: antenna.tilt,
    tx_power: antenna.tx_power,
  }));
}

export function formatJobStatus(job) {
  if (job.result_run_id) {
    return "Saved";
  }

  return formatText(job.status);
}
