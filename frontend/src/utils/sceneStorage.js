import { SCENE_FIXED_ANTENNAS_STORAGE_KEY } from "../constants";
import { normalizeAntennaBase } from "./antennas";

export function enrichScene(scene) {
  const cachedFixedAntennas = readSceneFixedAntennas(scene?.id);

  if (cachedFixedAntennas) {
    return {
      ...scene,
      fixed_antennas: cachedFixedAntennas,
    };
  }

  return scene;
}

export function readSceneFixedAntennas(sceneId) {
  if (!sceneId) {
    return null;
  }

  try {
    const saved = JSON.parse(localStorage.getItem(SCENE_FIXED_ANTENNAS_STORAGE_KEY) || "{}");
    const antennas = normalizeStoredFixedAntennas(saved[sceneId]);

    if (!antennas) {
      delete saved[sceneId];
      localStorage.setItem(SCENE_FIXED_ANTENNAS_STORAGE_KEY, JSON.stringify(saved));
    }

    return antennas;
  } catch {
    return null;
  }
}

export function readStoredSceneMap(storageKey, normalizeValue) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    return new Map(
      Object.entries(saved)
        .map(([sceneId, value]) => [sceneId, normalizeValue(value)])
        .filter(([, value]) => value !== null),
    );
  } catch {
    return new Map();
  }
}

export function persistSceneMap(storageKey, sceneMap) {
  const saved = {};

  for (const [sceneId, value] of sceneMap) {
    saved[sceneId] = value;
  }

  localStorage.setItem(storageKey, JSON.stringify(saved));
}

export function setSceneMapValue(sceneMap, sceneId, value, normalizeValue) {
  const normalized = normalizeValue(value);

  if (normalized === null) {
    sceneMap.delete(sceneId);
  } else {
    sceneMap.set(sceneId, normalized);
  }
}

export function updateStoredSceneMap(
  storageKey,
  sceneMap,
  sceneId,
  valueOrUpdater,
  normalizeValue,
) {
  const next = new Map(sceneMap);
  const value = typeof valueOrUpdater === "function"
    ? valueOrUpdater(next.get(sceneId))
    : valueOrUpdater;

  setSceneMapValue(next, sceneId, value, normalizeValue);
  persistSceneMap(storageKey, next);
  return next;
}

export function removeStoredSceneMapValue(storageKey, sceneMap, sceneId) {
  const next = new Map(sceneMap);
  next.delete(sceneId);
  persistSceneMap(storageKey, next);
  return next;
}

export function saveSceneFixedAntennas(sceneId, antennas) {
  if (!sceneId || !Array.isArray(antennas)) {
    return;
  }

  try {
    const saved = JSON.parse(localStorage.getItem(SCENE_FIXED_ANTENNAS_STORAGE_KEY) || "{}");
    const normalized = normalizeStoredFixedAntennas(antennas);

    if (!normalized) {
      return;
    }

    saved[sceneId] = normalized;
    localStorage.setItem(SCENE_FIXED_ANTENNAS_STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Local cache is best-effort; backend scene metadata is the primary store.
  }
}

export function normalizeStoredType2Antennas(antennas) {
  if (!Array.isArray(antennas)) {
    return null;
  }

  const normalized = antennas
    .map(normalizeAntennaBase)
    .filter(Boolean);

  return normalized.length ? normalized : null;
}

export function normalizeStoredAntennaSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return null;
  }

  const normalized = {};

  for (const [antennaId, value] of Object.entries(settings)) {
    const azimuth = Number(value?.azimuth);
    const tiltCurrent = Number(value?.tilt_current);
    const txPowerCurrent = Number(value?.tx_power_current);
    const enabled = value?.enabled === undefined ? true : Boolean(value.enabled);

    if (
      !antennaId
      || !Number.isFinite(azimuth)
      || !Number.isFinite(tiltCurrent)
      || !Number.isFinite(txPowerCurrent)
    ) {
      continue;
    }

    normalized[antennaId] = {
      azimuth,
      enabled,
      tilt_current: tiltCurrent,
      tx_power_current: txPowerCurrent,
    };
  }

  return Object.keys(normalized).length ? normalized : null;
}

export function normalizeStoredSinrRoles(roles) {
  if (!roles || typeof roles !== "object" || Array.isArray(roles)) {
    return null;
  }

  const normalized = {};

  for (const role of ["transmitter", "receiver", "interferer"]) {
    const antennaId = String(roles[role] || "").trim();

    if (antennaId) {
      normalized[role] = antennaId;
    }
  }

  return Object.keys(normalized).length ? normalized : null;
}

export function normalizeStoredFixedAntennas(antennas) {
  if (!Array.isArray(antennas) || antennas.length === 0) {
    return null;
  }

  const normalized = antennas
    .map((antenna) => {
      const longitude = Number(antenna?.longitude);
      const latitude = Number(antenna?.latitude);
      const height = Number(antenna?.height_m);

      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        return null;
      }

      const { position: _position, ...rest } = antenna;

      return {
        ...rest,
        longitude,
        latitude,
        height_m: Number.isFinite(height) ? height : 0,
      };
    })
    .filter(Boolean);

  return normalized.length ? normalized : null;
}
