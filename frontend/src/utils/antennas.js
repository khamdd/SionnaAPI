import { lngLatInsideBounds } from "./scene";
import { clone } from "./collections";

export const MAX_NETWORK_COVERAGE_ANTENNAS = 10;

export function antennasForActiveScene(scene, sceneAntennaOverrides) {
  const override = sceneAntennaOverrides.get(scene?.id);

  if (Array.isArray(override) && override.length > 0) {
    return clone(override);
  }

  if (Array.isArray(scene?.fixed_antennas) && scene.fixed_antennas.length > 0) {
    return clone(scene.fixed_antennas);
  }

  return [];
}

export function networkCoverageAntennasForScene(
  scene,
  fixedAntennas,
  type2AntennasByScene,
  settingsByScene,
) {
  if (!scene?.id) {
    return [];
  }

  const settings = settingsByScene.get(scene.id) || {};
  const type1Antennas = fixedAntennas
    .map((antenna) => applySimulationSettings(antenna, settings[antenna.id], "type1"))
    .filter(Boolean);
  const type2Antennas = (type2AntennasByScene.get(scene.id) || [])
    .map((antenna) => applySimulationSettings(antenna, settings[antenna.id], "type2"))
    .filter(Boolean);

  return [
    ...type1Antennas,
    ...type2Antennas,
  ];
}

export function applySimulationSettings(antenna, settings = {}, type) {
  const base = normalizeAntennaBase(antenna);

  if (!base) {
    return null;
  }

  return {
    ...base,
    _type: type,
    azimuth: settings.azimuth ?? base.azimuth,
    enabled: settings.enabled ?? true,
    tilt: {
      ...base.tilt,
      current: settings.tilt_current ?? base.tilt.current,
    },
    tx_power: {
      ...base.tx_power,
      current: settings.tx_power_current ?? base.tx_power.current,
    },
  };
}

export function simulationSettingsForAntenna(antenna) {
  return {
    azimuth: antenna.azimuth,
    enabled: antenna.enabled ?? true,
    tilt_current: antenna.tilt?.current,
    tx_power_current: antenna.tx_power?.current,
  };
}

export function isAntennaEnabled(antenna) {
  return antenna?.enabled !== false;
}

export function parseAntennaNumericInput(value) {
  return value === "" ? "" : Number(value);
}

export function formatAntennaCoordinate(value, fallback = "--") {
  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue.toFixed(4) : fallback;
}

export function validateNetworkCoverageSimulationAntennas(
  antennas,
  activeScene,
  maxAntennas = MAX_NETWORK_COVERAGE_ANTENNAS,
) {
  if (!Array.isArray(antennas) || antennas.length === 0) {
    return "Add or check at least one antenna for Network Coverage.";
  }

  if (antennas.length > maxAntennas) {
    return `Network Coverage supports up to ${maxAntennas} active antennas. The selected scene currently has ${antennas.length}.`;
  }

  const seenIds = new Set();
  for (const antenna of antennas) {
    const base = normalizeAntennaBase(antenna);
    if (!base) {
      return `Antenna ${antenna?.id || ""} has incomplete base configuration.`;
    }

    const idKey = base.id.toLowerCase();
    if (seenIds.has(idKey)) {
      return `Antenna ID ${base.id} is duplicated.`;
    }
    seenIds.add(idKey);

    if (!lngLatInsideBounds(base, activeScene?.bounds)) {
      return `Antenna ${base.id} must stay inside the selected scene.`;
    }

    if (base.height_m <= 0) {
      return `Antenna ${base.id} height_m must be greater than 0.`;
    }

    if (base.azimuth < 0 || base.azimuth > 360) {
      return `Antenna ${base.id} azimuth must be between 0 and 360.`;
    }

    const tiltError = validateRange(base.tilt, "tilt");
    if (tiltError) {
      return `Antenna ${base.id}: ${tiltError}`;
    }

    const powerError = validateRange(base.tx_power, "tx_power");
    if (powerError) {
      return `Antenna ${base.id}: ${powerError}`;
    }
  }

  return "";
}

export function validateRange(range, label) {
  if (range.min > range.max) {
    return `${label}_min must be less than or equal to ${label}_max.`;
  }

  if (range.current < range.min || range.current > range.max) {
    return `${label}_current must be between ${label}_min and ${label}_max.`;
  }

  return "";
}

export function toAntennaRequest(antenna) {
  const base = normalizeAntennaBase(antenna);

  return {
    id: base.id,
    longitude: base.longitude,
    latitude: base.latitude,
    height_m: base.height_m,
    tilt: base.tilt,
    azimuth: base.azimuth,
    tx_power: base.tx_power,
  };
}

export function toConfigurationAntenna(antenna) {
  return {
    id: String(antenna.id).trim(),
    longitude: Number(antenna.longitude),
    latitude: Number(antenna.latitude),
    height_m: Number(antenna.height_m),
    enabled: isAntennaEnabled(antenna),
    tilt: {
      min: Number(antenna.tilt.min),
      current: Number(antenna.tilt.current),
      max: Number(antenna.tilt.max),
    },
    azimuth: Number(antenna.azimuth),
    tx_power: {
      min: Number(antenna.tx_power.min),
      current: Number(antenna.tx_power.current),
      max: Number(antenna.tx_power.max),
    },
  };
}

export function toValidatedAntennaRequest(antenna) {
  const base = normalizeAntennaBase(antenna);

  if (
    !base
    || validateRange(base.tilt, "tilt")
    || validateRange(base.tx_power, "tx_power")
  ) {
    return null;
  }

  return {
    id: base.id,
    longitude: base.longitude,
    latitude: base.latitude,
    height_m: base.height_m,
    azimuth: base.azimuth,
    tilt: base.tilt,
    tx_power: base.tx_power,
  };
}

export function normalizeAntennaBase(antenna) {
  const id = String(antenna?.id || "").trim();
  const longitude = Number(antenna?.longitude);
  const latitude = Number(antenna?.latitude);
  const heightM = Number(antenna?.height_m);
  const azimuth = Number(antenna?.azimuth);
  const tilt = normalizeRangeValue(antenna?.tilt);
  const txPower = normalizeRangeValue(antenna?.tx_power);

  if (
    !id
    || !Number.isFinite(longitude)
    || !Number.isFinite(latitude)
    || !Number.isFinite(heightM)
    || !Number.isFinite(azimuth)
    || !tilt
    || !txPower
  ) {
    return null;
  }

  return {
    id,
    longitude,
    latitude,
    height_m: heightM,
    azimuth,
    tilt,
    tx_power: txPower,
  };
}

export function normalizeRangeValue(range) {
  const min = Number(range?.min);
  const current = Number(range?.current);
  const max = Number(range?.max);

  if (
    !Number.isFinite(min)
    || !Number.isFinite(current)
    || !Number.isFinite(max)
  ) {
    return null;
  }

  return {
    min,
    current,
    max,
  };
}
