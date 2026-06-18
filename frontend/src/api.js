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
  return runSimulationRequest("/api/v1/network-coverage", payload);
}

export function runCoverageMap(payload) {
  return runSimulationRequest("/api/v1/coverage-map", payload);
}

export function runRsrpSimulation(payload) {
  return runSimulationRequest("/api/v1/rsrp-simulation", payload);
}

export function runSinr(payload) {
  return runSimulationRequest("/api/v1/sinr", payload);
}

export function runThroughputComparison(payload) {
  return runSimulationRequest("/api/v1/throughput-comparison", payload);
}

export function getCurrentUser() {
  return requestJson("/api/v1/auth/verify");
}

async function runSimulationRequest(path, payload) {
  const response = await requestJson(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response?.job_id) {
    return response;
  }

  return pollSimulationJob(response.job_id);
}

async function pollSimulationJob(jobId) {
  const timeoutAt = Date.now() + 30 * 60 * 1000;

  while (Date.now() < timeoutAt) {
    await delay(1500);

    const jobResponse = await requestJson(`/api/v1/simulation-jobs/${jobId}`);
    const job = jobResponse.item || jobResponse;

    if (job.status === "succeeded") {
      return {
        ...(job.result || {}),
        job_id: job.id,
        result_run_id: job.result_run_id,
      };
    }

    if (job.status === "failed") {
      const result = job.result || {};
      throw new Error(job.error_message || result.error || "Simulation job failed.");
    }
  }

  throw new Error("Simulation job timed out while waiting for the worker.");
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
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
