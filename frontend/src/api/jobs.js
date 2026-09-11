import { authHeaders, readErrorMessage, requestJson, toApiUrl } from "./http";

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

export function deleteSimulationRun(runId) {
  return requestJson(`/api/v1/simulation-runs/${runId}`, {
    method: "DELETE",
  });
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

export function deleteSimulationJob(jobId) {
  return requestJson(`/api/v1/simulation-jobs/${jobId}`, {
    method: "DELETE",
  });
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
