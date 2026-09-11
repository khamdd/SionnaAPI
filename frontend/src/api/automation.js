import { requestJson } from "./http";

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
