import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_RSRP_USER_COUNT,
  DEFAULT_SOLVER,
  MAX_RSRP_USER_COUNT,
} from "../../constants";
import {
  toValidatedAntennaRequest,
} from "../../utils/antennas";
import {
  formatMaybeNumber,
  formatText,
} from "../../utils/format";
import {
  lngLatInsideBounds,
  lngLatToScenePosition,
  validatePositionInsideSolver,
} from "../../utils/scene";
import { hasCachedSceneModel } from "../Scene3DPreview";
import { SINR_ROLES } from "./ApiPageControls";

export {
  FormSection,
  NumberField,
  PropagationFields,
  SinrRoleFields,
  SolverFields,
  formatPropagationModel,
} from "./ApiPageControls";

export {
  ApiResultScene,
  ApiScenePreview,
  CoverageResult,
  QueueNotice,
  RsrpSummary,
  RsrpUserDialog,
  SinrResultDetails,
  ThroughputResultDetails,
  radioLinkVisuals,
  sinrSceneBadges,
  throughputSceneBadges,
} from "./ApiPageResults";

function suggestUserCount(solver) {
  const size = solver?.size || DEFAULT_SOLVER.size;
  const area = Math.max(Number(size[0]) || 0, 1) * Math.max(Number(size[1]) || 0, 1);
  const estimated = Math.round(area / 90);

  if (!Number.isFinite(estimated) || estimated <= 0) {
    return DEFAULT_RSRP_USER_COUNT;
  }

  return Math.min(
    MAX_RSRP_USER_COUNT,
    Math.max(
      250,
      estimated,
    ),
  );
}

function sinrSelectedRoleAntennas(antennas, roles) {
  const byId = new Map((Array.isArray(antennas) ? antennas : []).map((antenna) => [
    antenna.id,
    antenna,
  ]));

  return {
    transmitter: byId.get(roles.transmitter) || null,
    receiver: byId.get(roles.receiver) || null,
    interferer: byId.get(roles.interferer) || null,
  };
}

function sinrRolePositions(selectedRoles, bounds) {
  return {
    transmitter_position: scenePositionForAntenna(selectedRoles.transmitter, bounds),
    receiver_position: scenePositionForAntenna(selectedRoles.receiver, bounds),
    interferer_position: scenePositionForAntenna(selectedRoles.interferer, bounds),
  };
}

function scenePositionForAntenna(antenna, bounds) {
  if (!antenna) {
    return null;
  }

  return lngLatToScenePosition(antenna, bounds);
}

function validateSinrRoles(antennas, roles, selectedRoles, rolePositions, activeScene, simulationLabel = "SINR") {
  if (!Array.isArray(antennas) || antennas.length < 3) {
    return `${simulationLabel} needs exactly 3 role antennas. Add ${3 - (antennas?.length || 0)} missing antenna(s).`;
  }

  const selectedIds = SINR_ROLES.map((role) => roles[role.key]).filter(Boolean);
  if (selectedIds.length < 3) {
    return "Select one transmitter, one receiver, and one interferer.";
  }

  if (new Set(selectedIds).size !== 3) {
    return "Transmitter, receiver, and interferer must be three different antennas.";
  }

  for (const role of SINR_ROLES) {
    const antenna = selectedRoles[role.key];

    if (!antenna) {
      return `${role.label} antenna is not available in this scene.`;
    }

    if (!lngLatInsideBounds(antenna, activeScene?.bounds)) {
      return `${role.label} antenna must stay inside the selected scene.`;
    }
  }

  for (const [field, position] of Object.entries(rolePositions)) {
    if (!Array.isArray(position)) {
      return `${formatText(field.replace("_position", ""))} position is invalid.`;
    }
  }

  return "";
}

function validateThroughputTilts(form, transmitter) {
  if (!transmitter) {
    return "";
  }

  const tiltRange = transmitter.tilt;
  const baseTilt = Number(form.base_tilt);
  const targetTilt = Number(form.target_tilt);

  if (!tiltRange || !Number.isFinite(tiltRange.min) || !Number.isFinite(tiltRange.max)) {
    return `Transmitter ${transmitter.id} does not have a valid tilt range.`;
  }

  if (!Number.isFinite(baseTilt) || !Number.isFinite(targetTilt)) {
    return "Base tilt and target tilt must be numbers.";
  }

  if (baseTilt < tiltRange.min || baseTilt > tiltRange.max) {
    return `Base tilt must stay between ${formatMaybeNumber(tiltRange.min)} and ${formatMaybeNumber(tiltRange.max)} deg for ${transmitter.id}.`;
  }

  if (targetTilt < tiltRange.min || targetTilt > tiltRange.max) {
    return `Target tilt must stay between ${formatMaybeNumber(tiltRange.min)} and ${formatMaybeNumber(tiltRange.max)} deg for ${transmitter.id}.`;
  }

  return "";
}

function throughputTiltHint(transmitter) {
  const tiltRange = transmitter?.tilt;

  if (!tiltRange || !Number.isFinite(tiltRange.min) || !Number.isFinite(tiltRange.max)) {
    return "Select a transmitter to use its allowed tilt range.";
  }

  return `${formatMaybeNumber(tiltRange.min)} to ${formatMaybeNumber(tiltRange.max)} deg for ${transmitter.id}.`;
}

function cleanSinrRoleSelection(roles, antennas) {
  const availableIds = new Set((Array.isArray(antennas) ? antennas : []).map((antenna) => antenna.id));
  const cleaned = {};

  for (const role of SINR_ROLES) {
    const antennaId = roles[role.key] || "";
    cleaned[role.key] = antennaId && availableIds.has(antennaId) ? antennaId : "";
  }

  return cleaned;
}

function sinrRoleSelectionChanged(nextRoles, currentRoles) {
  return SINR_ROLES.some((role) => (nextRoles[role.key] || "") !== (currentRoles[role.key] || ""));
}

function firstPositionError(errors) {
  return Object.values(errors || {}).find(Boolean) || "";
}

function sinrPreviewAntennas(selectedRoles) {
  return SINR_ROLES.map((role) => {
    const antenna = selectedRoles[role.key];

    if (!antenna) {
      return null;
    }

    return {
      ...antenna,
      id: role.key === "interferer" ? "INT" : role.key === "receiver" ? "RX" : "TX",
    };
  }).filter(Boolean);
}

function sinrPreviewLinks(rolePositions) {
  const links = [];

  if (
    Array.isArray(rolePositions.transmitter_position)
    && Array.isArray(rolePositions.receiver_position)
  ) {
    links.push({
      from: rolePositions.transmitter_position,
      to: rolePositions.receiver_position,
      label: "Serving",
      type: "serving",
    });
  }

  if (
    Array.isArray(rolePositions.interferer_position)
    && Array.isArray(rolePositions.receiver_position)
  ) {
    links.push({
      from: rolePositions.interferer_position,
      to: rolePositions.receiver_position,
      label: "Interference",
      type: "interference",
    });
  }

  return links;
}

function useScenePreviewStatus(activeScene, onSceneLoadingChange) {
  const hasSceneBounds = Boolean(activeScene?.bounds);
  const [isScenePreviewLoading, setIsScenePreviewLoading] = useState(
    hasSceneBounds && !hasCachedSceneModel(activeScene?.bounds),
  );

  useEffect(() => {
    const shouldLoadScene = hasSceneBounds && !hasCachedSceneModel(activeScene?.bounds);
    setIsScenePreviewLoading(shouldLoadScene);
    onSceneLoadingChange?.(shouldLoadScene);

    return () => {
      onSceneLoadingChange?.(false);
    };
  }, [activeScene?.bounds, activeScene?.id, hasSceneBounds, onSceneLoadingChange]);

  const handleSceneLoadingChange = useCallback((active) => {
    const nextValue = Boolean(active);
    setIsScenePreviewLoading(nextValue);
    onSceneLoadingChange?.(nextValue);
  }, [onSceneLoadingChange]);

  return {
    handleSceneLoadingChange,
    isScenePreviewLoading,
    isSceneReady: hasSceneBounds && !isScenePreviewLoading,
  };
}

function validateSimulationAntennas(antennas, activeScene, maxAntennas, label) {
  if (!Array.isArray(antennas) || antennas.length === 0) {
    return `Add or check at least one antenna for ${label}.`;
  }

  if (antennas.length > maxAntennas) {
    return `${label} supports up to ${maxAntennas} active antennas. The selected scene currently has ${antennas.length}.`;
  }

  const seenIds = new Set();
  for (const antenna of antennas) {
    const request = toValidatedAntennaRequest(antenna);

    if (!request) {
      return `Antenna ${antenna?.id || ""} has incomplete configuration.`;
    }

    const idKey = request.id.toLowerCase();
    if (seenIds.has(idKey)) {
      return `Antenna ID ${request.id} is duplicated.`;
    }
    seenIds.add(idKey);

    if (!lngLatInsideBounds(request, activeScene?.bounds)) {
      return `Antenna ${request.id} must stay inside the selected scene.`;
    }

    if (request.height_m <= 0) {
      return `Antenna ${request.id} height must be greater than 0.`;
    }

    if (request.azimuth < 0 || request.azimuth > 360) {
      return `Antenna ${request.id} azimuth must be between 0 and 360.`;
    }
  }

  return "";
}

function linkResultAntennas(result, request) {
  if (Array.isArray(result?.antennas) && result.antennas.length > 0) {
    return result.antennas;
  }

  const antennas = [];

  if (Array.isArray(request.transmitter_position)) {
    antennas.push({
      id: "TX",
      position: request.transmitter_position,
      azimuth: 0,
    });
  }

  if (Array.isArray(request.interferer_position)) {
    antennas.push({
      id: "INT",
      position: request.interferer_position,
      azimuth: 0,
    });
  }

  if (Array.isArray(request.receiver_position)) {
    antennas.push({
      id: "RX",
      position: request.receiver_position,
      azimuth: 0,
    });
  }

  return antennas;
}

function coverageTransmitter(form, antennas) {
  return antennas.find((antenna) => (antenna.database_id || antenna.id) === form.selected_antenna_id) || {};
}

function validateCoverageTransmitter(transmitter, _antennas, activeScene) {
  if (!transmitter || Object.keys(transmitter).length === 0) {
    return "Add one antenna before running Coverage API.";
  }

  const id = String(transmitter.id || "").trim();
  const longitude = Number(transmitter.longitude);
  const latitude = Number(transmitter.latitude);
  const height = Number(transmitter.height_m);

  if (!id) {
    return "Antenna ID is required.";
  }

  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return "Enter numeric longitude and latitude.";
  }

  if (!lngLatInsideBounds({ longitude, latitude }, activeScene?.bounds)) {
    return "Transmitter longitude and latitude must stay inside the selected scene.";
  }

  if (!Number.isFinite(height) || height <= 0) {
    return "Transmitter height must be greater than 0.";
  }

  return "";
}

function validateCoverageAzimuth(azimuth) {
  if (azimuth === "" || azimuth === null || azimuth === undefined) {
    return "Azimuth is required.";
  }

  const numericAzimuth = Number(azimuth);

  if (!Number.isFinite(numericAzimuth)) {
    return "Azimuth must be a number.";
  }

  if (numericAzimuth < 0 || numericAzimuth > 360) {
    return "Azimuth must be between 0 and 360 degrees.";
  }

  return "";
}

function selectCoverageInventoryAntenna(onChange, form, antennas, antennaIds) {
  if (antennaIds.length !== 1) {
    return { error: "Coverage API uses exactly one antenna." };
  }
  const requested = antennaIds[0];
  const antenna = requested && typeof requested === "object"
    ? requested
    : antennas.find((item) => (item.database_id || item.id) === requested);
  if (!antenna) return { error: "The selected antenna is no longer available." };
  onChange({
    ...form,
    selected_antenna_id: antenna.database_id || antenna.id,
    azimuth: antenna?.azimuth ?? form.azimuth,
    tilt: antenna?.tilt?.current ?? form.tilt,
    tx_power: antenna?.tx_power?.current ?? form.tx_power,
  });
  return {};
}

function coverageDraftStorageKey(sceneId) {
  return `sionna_coverage_antenna_draft:${sceneId}`;
}

function loadCoverageDraft(sceneId, fallback) {
  if (!sceneId) return fallback;
  try {
    const stored = JSON.parse(window.localStorage.getItem(coverageDraftStorageKey(sceneId)) || "null");
    if (stored && typeof stored === "object") {
      return { ...fallback, ...stored, solver: { ...fallback.solver, ...stored.solver } };
    }
  } catch {
    // Ignore malformed drafts and start from defaults.
  }
  return fallback;
}

function validateScenePositions(solver, fields) {
  const errors = {};

  fields.forEach((field) => {
    const error = validatePositionInsideSolver(field.value, solver);

    if (error) {
      errors[field.key] = `${field.label}: ${error}`;
    }
  });

  return {
    errors,
    isValid: Object.keys(errors).length === 0,
  };
}

function runButtonLabel(isLoading, isSceneReady, isFormValid, readyLabel) {
  if (isLoading) {
    return "Running...";
  }

  if (!isSceneReady) {
    return "Loading scene...";
  }

  if (!isFormValid) {
    return "Fix positions";
  }

  return readyLabel;
}

function useApiResult(onProgressChange, progressLabel, onSimulationQueued, queuedContext = {}) {
  const [state, setState] = useState({
    error: "",
    loading: false,
    result: null,
  });

  async function run(requestFactory) {
    if (state.loading) {
      return;
    }

    onProgressChange?.(true, progressLabel);
    setState({
      error: "",
      loading: true,
      result: null,
    });

    try {
      const result = await requestFactory();

      if (result.status && result.status !== "success" && result.status !== "queued") {
        throw new Error(result.error || "API returned failure.");
      }

      const displayResult = result.status === "queued"
        ? {
          ...result,
          scene_name: queuedContext.sceneName,
        }
        : result;

      if (displayResult.status === "queued") {
        onSimulationQueued?.(displayResult);
      }

      setState({
        error: "",
        loading: false,
        result: displayResult,
      });
    } catch (error) {
      setState({
        error: error.message,
        loading: false,
        result: null,
      });
    } finally {
      onProgressChange?.(false, progressLabel);
    }
  }

  return [state, run];
}

function updateForm(setForm, field, value) {
  setForm((current) => ({
    ...current,
    [field]: value,
  }));
}

function clampNumber(value, min, max) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return value;
  }

  if (Number.isFinite(min) && numericValue < min) {
    return min;
  }

  if (Number.isFinite(max) && numericValue > max) {
    return max;
  }

  return value;
}

export {
  SINR_ROLES,
  clampNumber,
  cleanSinrRoleSelection,
  coverageDraftStorageKey,
  coverageTransmitter,
  firstPositionError,
  linkResultAntennas,
  loadCoverageDraft,
  runButtonLabel,
  selectCoverageInventoryAntenna,
  sinrPreviewAntennas,
  sinrPreviewLinks,
  sinrRolePositions,
  sinrRoleSelectionChanged,
  sinrSelectedRoleAntennas,
  suggestUserCount,
  throughputTiltHint,
  updateForm,
  useApiResult,
  useScenePreviewStatus,
  validateCoverageAzimuth,
  validateCoverageTransmitter,
  validateScenePositions,
  validateSimulationAntennas,
  validateSinrRoles,
  validateThroughputTilts,
};
