import {
  API_BASE_URL,
  AUTH_TOKEN_STORAGE_KEY,
} from "./constants";

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, withAuth(options));

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

export function runNetworkCoverageOptimization(payload) {
  return requestJson("/api/v1/optimizations/network-coverage/run", {
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

export function runRsrpSimulation(payload) {
  return requestJson("/api/v1/rsrp-simulation", {
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

export function getCurrentUser() {
  return requestJson("/api/v1/auth/verify");
}

export function listNetworkConfigurations(sceneId, status = "", limit = 200) {
  const params = new URLSearchParams({
    scene_id: sceneId,
    limit: String(limit),
  });

  if (status) {
    params.set("status", status);
  }

  return requestJson(`/api/v1/network-configurations?${params.toString()}`);
}

export function createNetworkConfiguration(payload) {
  return requestJson("/api/v1/network-configurations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function compareNetworkConfigurations(
  baselineConfigurationId,
  candidateConfigurationId,
) {
  return requestJson("/api/v1/network-configurations/compare", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      baseline_configuration_id: baselineConfigurationId,
      candidate_configuration_id: candidateConfigurationId,
    }),
  });
}

export function publishNetworkConfiguration(configurationId) {
  return requestJson(`/api/v1/network-configurations/${configurationId}/publish`, {
    method: "POST",
  });
}

export function listSimulationProfiles(sceneId, limit = 200) {
  const params = new URLSearchParams({
    scene_id: sceneId,
    limit: String(limit),
  });

  return requestJson(`/api/v1/simulation-profiles?${params.toString()}`);
}

export function createSimulationProfile(payload) {
  return requestJson("/api/v1/simulation-profiles", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function updateSimulationProfile(profileId, payload) {
  return requestJson(`/api/v1/simulation-profiles/${profileId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function deleteSimulationProfile(profileId) {
  return requestJson(`/api/v1/simulation-profiles/${profileId}`, {
    method: "DELETE",
  });
}

export function setSimulationProfileEnabled(
  profileId,
  enabled,
  configurationId = null,
) {
  return requestJson(
    `/api/v1/simulation-profiles/${profileId}/${enabled ? "enable" : "disable"}`,
    {
      method: "POST",
      ...(enabled ? {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configuration_id: configurationId }),
      } : {}),
    },
  );
}

export function buildSimulationProfileRequest(profileId, configurationId) {
  return requestJson(`/api/v1/simulation-profiles/${profileId}/build-request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ configuration_id: configurationId }),
  });
}

export function registerUser(payload) {
  return requestJson("/api/v1/auth/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function loginUser(payload) {
  return requestJson("/api/v1/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function listSimulationRuns(limit = 25, sceneId = "") {
  const params = new URLSearchParams({
    limit: String(limit),
  });

  if (sceneId) {
    params.set("scene_id", sceneId);
  }

  return requestJson(`/api/v1/simulation-runs?${params.toString()}`);
}

export function getSimulationRun(runId) {
  return requestJson(`/api/v1/simulation-runs/${runId}`);
}

export function getSimulationRunResult(runId) {
  return requestJson(`/api/v1/simulation-runs/${runId}/result`);
}

export function listSimulationJobs(limit = 100) {
  const params = new URLSearchParams({
    limit: String(limit),
  });

  return requestJson(`/api/v1/simulation-jobs?${params.toString()}`);
}

export function getSimulationJob(jobId) {
  return requestJson(`/api/v1/simulation-jobs/${jobId}`);
}

export function getSimulationJobResult(jobId) {
  return requestJson(`/api/v1/simulation-jobs/${jobId}/result`);
}

export function saveSimulationJobResult(jobId) {
  return requestJson(`/api/v1/simulation-jobs/${jobId}/save`, {
    method: "POST",
  });
}

export async function deleteSimulationJob(jobId) {
  const response = await fetch(`${API_BASE_URL}/api/v1/simulation-jobs/${jobId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return response.json();
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
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return response.json();
}

export async function deleteSimulationRun(runId) {
  const response = await fetch(`${API_BASE_URL}/api/v1/simulation-runs/${runId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return response.json();
}

export async function fetchArtifactJson(url) {
  const response = await fetch(toApiUrl(url), {
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return response.json();
}

function withAuth(options = {}) {
  return {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {}),
    },
  };
}

function authHeaders() {
  const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);

  if (!token) {
    return {};
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

function toApiUrl(url) {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  return `${API_BASE_URL}${url.startsWith("/") ? url : `/${url}`}`;
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

export function getOfflineBuildings(bounds, signal) {
  const params = new URLSearchParams({
    south: String(bounds.south),
    west: String(bounds.west),
    north: String(bounds.north),
    east: String(bounds.east),
  });

  return requestJson(`/api/v1/offline-buildings?${params.toString()}`, {
    signal,
  });
}
