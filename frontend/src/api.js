import { API_BASE_URL } from "./constants";

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, options);

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
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

export function listScenes() {
  return requestJson("/api/v1/scenes");
}

export function createScenePreview(payload) {
  return requestJson("/api/v1/scenes/preview", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function activateScene(sceneId) {
  return requestJson(`/api/v1/scenes/${sceneId}/activate`, {
    method: "POST",
  });
}

export async function deleteScene(sceneId) {
  const response = await fetch(`${API_BASE_URL}/api/v1/scenes/${sceneId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return response.json();
}

export async function deleteSimulationRun(runId) {
  const response = await fetch(`${API_BASE_URL}/api/v1/simulation-runs/${runId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return response.json();
}

async function readErrorMessage(response) {
  try {
    const body = await response.json();
    const detail = body.detail || body.error || body;

    if (typeof detail === "string") {
      return detail;
    }

    if (detail?.error) {
      return detail.error;
    }
  } catch {
    // Fall through to the generic HTTP message.
  }

  return `HTTP ${response.status}`;
}
