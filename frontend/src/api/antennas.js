import { requestJson } from "./http";

function jsonOptions(method, body) {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export function listAntennas({ q = "", status = "", sceneId = "", limit = 5000 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (sceneId) params.set("scene_id", sceneId);
  return requestJson(`/api/v1/antennas?${params.toString()}`);
}

export function createAntenna(payload) { return requestJson("/api/v1/antennas", jsonOptions("POST", payload)); }
export function updateAntennaRecord(id, payload) { return requestJson(`/api/v1/antennas/${id}`, jsonOptions("PUT", payload)); }
export function archiveAntenna(id) { return requestJson(`/api/v1/antennas/${id}/archive`, { method: "POST" }); }
export function restoreAntenna(id) { return requestJson(`/api/v1/antennas/${id}/restore`, { method: "POST" }); }
export function previewAntennaImport(antennas) { return requestJson("/api/v1/antennas/import-preview", jsonOptions("POST", { antennas })); }
export function importAntennaBatch(antennas, updateExisting) { return requestJson("/api/v1/antennas/import", jsonOptions("POST", { antennas, update_existing: updateExisting })); }
