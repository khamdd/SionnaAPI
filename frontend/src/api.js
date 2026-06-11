import { API_BASE_URL } from "./constants";

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, options);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

export function runNetworkCoverage(payload) {
  return requestJson("/api/v1/network-coverage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function runCoverageMap(payload) {
  return requestJson("/api/v1/coverage-map", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function runSinr(payload) {
  return requestJson("/api/v1/sinr", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function runThroughputComparison(payload) {
  return requestJson("/api/v1/throughput-comparison", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function listSimulationRuns(limit = 25) {
  return requestJson(`/api/v1/simulation-runs?limit=${limit}`);
}

export function getSimulationRun(runId) {
  return requestJson(`/api/v1/simulation-runs/${runId}`);
}

export async function deleteSimulationRun(runId) {
  const response = await fetch(`${API_BASE_URL}/api/v1/simulation-runs/${runId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}
