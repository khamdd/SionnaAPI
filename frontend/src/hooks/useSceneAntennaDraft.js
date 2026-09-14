import { useMemo, useState } from "react";

import {
  isAntennaEnabled,
  networkCoverageAntennasForScene,
  normalizeAntennaBase,
  simulationSettingsForAntenna,
} from "../utils/antennas";
import { lngLatBoundsError } from "../utils/scene";
import {
  normalizeStoredAntennaSettings,
  normalizeStoredSinrRoles,
  normalizeStoredType2Antennas,
  persistSceneMap,
  readStoredSceneMap,
  removeStoredSceneMapValue,
  setSceneMapValue,
  updateStoredSceneMap,
} from "../utils/sceneStorage";

const SCENE_MAP_PERSIST_DEBOUNCE_MS = 300;
const pendingSceneMapWrites = new Map();
let pagehideFlushRegistered = false;

function flushPendingSceneMapWrites() {
  for (const [storageKey, pending] of pendingSceneMapWrites) {
    if (pending.timer && typeof window !== "undefined") {
      window.clearTimeout(pending.timer);
    }
    persistSceneMap(storageKey, pending.map);
  }
  pendingSceneMapWrites.clear();
}

function ensurePagehideFlush() {
  if (pagehideFlushRegistered) {
    return;
  }
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
    return;
  }
  pagehideFlushRegistered = true;
  window.addEventListener("pagehide", () => flushPendingSceneMapWrites());
}

function scheduleSceneMapPersist(storageKey, sceneMap) {
  ensurePagehideFlush();
  let pending = pendingSceneMapWrites.get(storageKey);
  if (!pending) {
    pending = { map: null, timer: 0 };
    pendingSceneMapWrites.set(storageKey, pending);
  }
  pending.map = sceneMap;
  if (!pending.timer) {
    pending.timer = window.setTimeout(() => {
      pending.timer = 0;
      const write = pendingSceneMapWrites.get(storageKey);
      pendingSceneMapWrites.delete(storageKey);
      if (write) {
        persistSceneMap(storageKey, write.map);
      }
    }, SCENE_MAP_PERSIST_DEBOUNCE_MS);
  }
}

function updateSceneMapDraft(storageKey, sceneMap, sceneId, valueOrUpdater, normalizeValue) {
  const next = new Map(sceneMap);
  const value = typeof valueOrUpdater === "function"
    ? valueOrUpdater(next.get(sceneId))
    : valueOrUpdater;

  setSceneMapValue(next, sceneId, value, normalizeValue);
  scheduleSceneMapPersist(storageKey, next);
  return next;
}

export function validateType2AntennaAddition({
  activeAntennas,
  antennas,
  antenna,
  maxActiveAntennas,
  scene,
  simulationLabel,
}) {
  if (!scene?.id) {
    return { error: "Select a scene before adding an antenna." };
  }

  if (maxActiveAntennas != null && activeAntennas.length >= maxActiveAntennas) {
    return {
      error: `${simulationLabel} supports up to ${maxActiveAntennas} active antennas. Uncheck one antenna before adding another.`,
    };
  }

  const normalized = normalizeAntennaBase(antenna);
  if (!normalized) {
    return { error: "Antenna base config is incomplete." };
  }

  const coordinateError = lngLatBoundsError(
    normalized,
    scene.bounds,
    "Type 2 antenna coordinates",
  );
  if (coordinateError) {
    return { error: coordinateError };
  }

  if (antennas.some((item) => item.id.toLowerCase() === normalized.id.toLowerCase())) {
    return { error: `antenna_id "${normalized.id}" is already used.` };
  }

  return { normalized };
}

export function updateAntennaSetting(storedSettings, antenna, antennaId, field, value, supportsEnabled) {
  const sceneSettings = { ...(storedSettings || {}) };
  const currentSetting = {
    ...simulationSettingsForAntenna(antenna),
    ...(sceneSettings[antennaId] || {}),
  };

  if (field === "tilt") {
    currentSetting.tilt_current = value;
  } else if (field === "tx_power") {
    currentSetting.tx_power_current = value;
  } else if (field === "azimuth") {
    currentSetting.azimuth = value;
  } else if (field === "enabled" && supportsEnabled) {
    currentSetting.enabled = Boolean(value);
  }

  sceneSettings[antennaId] = currentSetting;
  return sceneSettings;
}

export function removeAntennaSetting(storedSettings, antennaId) {
  const sceneSettings = { ...(storedSettings || {}) };
  delete sceneSettings[antennaId];
  return sceneSettings;
}

export function removeAntennaRoles(storedRoles, antennaId) {
  const roles = { ...(storedRoles || {}) };

  for (const [role, selectedId] of Object.entries(roles)) {
    if (selectedId === antennaId) {
      roles[role] = "";
    }
  }

  return roles;
}

export default function useSceneAntennaDraft({
  activeScene,
  fixedAntennas,
  maxActiveAntennas = null,
  rolesStorageKey = null,
  settingsStorageKey,
  simulationLabel,
  supportsEnabled = false,
  type2StorageKey,
}) {
  const [type2AntennasByScene, setType2AntennasByScene] = useState(() => (
    readStoredSceneMap(type2StorageKey, normalizeStoredType2Antennas)
  ));
  const [antennaSettingsByScene, setAntennaSettingsByScene] = useState(() => (
    readStoredSceneMap(settingsStorageKey, normalizeStoredAntennaSettings)
  ));
  const [roleSelectionsByScene, setRoleSelectionsByScene] = useState(() => (
    rolesStorageKey
      ? readStoredSceneMap(rolesStorageKey, normalizeStoredSinrRoles)
      : new Map()
  ));

  const antennas = useMemo(
    () => networkCoverageAntennasForScene(
      activeScene,
      fixedAntennas,
      type2AntennasByScene,
      antennaSettingsByScene,
    ),
    [activeScene, antennaSettingsByScene, fixedAntennas, type2AntennasByScene],
  );
  const activeAntennas = useMemo(
    () => antennas.filter(isAntennaEnabled),
    [antennas],
  );
  const roleSelection = useMemo(
    () => roleSelectionsByScene.get(activeScene?.id) || {},
    [activeScene?.id, roleSelectionsByScene],
  );

  function updateAntenna(antennaId, field, value) {
    if (!activeScene?.id || value === "") {
      return;
    }

    const antenna = antennas.find((item) => item.id === antennaId);
    if (!antenna) {
      return;
    }

    setAntennaSettingsByScene((current) => updateSceneMapDraft(
      settingsStorageKey,
      current,
      activeScene.id,
      (storedSettings) => updateAntennaSetting(
        storedSettings,
        antenna,
        antennaId,
        field,
        value,
        supportsEnabled,
      ),
      normalizeStoredAntennaSettings,
    ));
  }

  function addType2Antenna(antenna) {
    const validation = validateType2AntennaAddition({
      activeAntennas,
      antennas,
      antenna,
      maxActiveAntennas,
      scene: activeScene,
      simulationLabel,
    });

    if (validation.error) {
      return validation;
    }

    const { normalized } = validation;
    setType2AntennasByScene((current) => updateSceneMapDraft(
      type2StorageKey,
      current,
      activeScene.id,
      (sceneAntennas) => [...(sceneAntennas || []), normalized],
      normalizeStoredType2Antennas,
    ));
    setAntennaSettingsByScene((current) => updateSceneMapDraft(
      settingsStorageKey,
      current,
      activeScene.id,
      (sceneSettings) => ({
        ...(sceneSettings || {}),
        [normalized.id]: simulationSettingsForAntenna(normalized),
      }),
      normalizeStoredAntennaSettings,
    ));
    return { ok: true };
  }

  function removeType2Antenna(antennaId) {
    if (!activeScene?.id) {
      return;
    }

    setType2AntennasByScene((current) => updateStoredSceneMap(
      type2StorageKey,
      current,
      activeScene.id,
      (sceneAntennas) => (sceneAntennas || []).filter((item) => item.id !== antennaId),
      normalizeStoredType2Antennas,
    ));
    setAntennaSettingsByScene((current) => updateStoredSceneMap(
      settingsStorageKey,
      current,
      activeScene.id,
      (storedSettings) => removeAntennaSetting(storedSettings, antennaId),
      normalizeStoredAntennaSettings,
    ));

    if (rolesStorageKey) {
      setRoleSelectionsByScene((current) => updateStoredSceneMap(
        rolesStorageKey,
        current,
        activeScene.id,
        (storedRoles) => removeAntennaRoles(storedRoles, antennaId),
        normalizeStoredSinrRoles,
      ));
    }
  }

  function updateRoleSelection(nextRoles) {
    if (!activeScene?.id || !rolesStorageKey) {
      return;
    }

    setRoleSelectionsByScene((current) => updateSceneMapDraft(
      rolesStorageKey,
      current,
      activeScene.id,
      nextRoles,
      normalizeStoredSinrRoles,
    ));
  }

  function clear(sceneId = activeScene?.id) {
    if (!sceneId) {
      return;
    }

    setType2AntennasByScene((current) => (
      removeStoredSceneMapValue(type2StorageKey, current, sceneId)
    ));
    setAntennaSettingsByScene((current) => (
      removeStoredSceneMapValue(settingsStorageKey, current, sceneId)
    ));

    if (rolesStorageKey) {
      setRoleSelectionsByScene((current) => (
        removeStoredSceneMapValue(rolesStorageKey, current, sceneId)
      ));
    }
  }

  return {
    activeAntennas,
    addType2Antenna,
    antennas,
    clear,
    removeType2Antenna,
    roleSelection,
    updateAntenna,
    updateRoleSelection,
  };
}
