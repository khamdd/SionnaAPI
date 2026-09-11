import { requestJson } from "./http";

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

export function deleteScene(sceneId) {
  return requestJson(`/api/v1/scenes/${sceneId}`, {
    method: "DELETE",
  });
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
