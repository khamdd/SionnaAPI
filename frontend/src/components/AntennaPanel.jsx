import { useEffect, useState } from "react";
import { lngLatBoundsError } from "../utils/scene";
import { formatLngLatPosition, formatMaybeNumber } from "../utils/format";

const TYPE_1 = "type1";
const TYPE_2 = "type2";

const DRAFT_DEFAULTS = {
  antenna_id: "",
  longitude: "",
  latitude: "",
  height_m: 30,
  azimuth_deg: 0,
  tilt_min_deg: 0,
  tilt_current_deg: 8,
  tilt_max_deg: 20,
  tx_power_min_dbm: 20,
  tx_power_current_dbm: 30,
  tx_power_max_dbm: 40,
};

const FIELD_LABELS = {
  antenna_id: "Antenna ID",
  longitude: "Longitude",
  latitude: "Latitude",
  height_m: "Height (m)",
  azimuth_deg: "Azimuth (deg)",
  tilt_min_deg: "Tilt min (deg)",
  tilt_current_deg: "Tilt current (deg)",
  tilt_max_deg: "Tilt max (deg)",
  tx_power_min_dbm: "Power min (dBm)",
  tx_power_current_dbm: "Power current (dBm)",
  tx_power_max_dbm: "Power max (dBm)",
};

export default function AntennaPanel({
  activeScene,
  antennas,
  disabled = false,
  maxAntennas = null,
  onAddType2,
  onChange,
  onRemoveType2,
  showEnabledToggle = false,
  simulationLabel = "Network Coverage",
}) {
  const [draft, setDraft] = useState(() => ({
    ...DRAFT_DEFAULTS,
    antenna_id: suggestedType2Id(antennas),
  }));
  const [addError, setAddError] = useState("");
  const fixedCount = antennas.filter((item) => item._type === TYPE_1).length;
  const type2Count = antennas.length - fixedCount;
  const enabledCount = antennas.filter(isAntennaEnabled).length;
  const limitCount = showEnabledToggle ? enabledCount : antennas.length;
  const hasAntennaLimit = Number.isFinite(maxAntennas);
  const addLimitReached = hasAntennaLimit && limitCount >= maxAntennas;
  const canAdd = !disabled && !addLimitReached;
  const overLimit = hasAntennaLimit && limitCount > maxAntennas;

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      antenna_id: current.antenna_id || suggestedType2Id(antennas),
    }));
    setAddError("");
  }, [activeScene?.id]);

  function updateDraft(field, value) {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function draftHint(field) {
    return fieldHint(field, activeScene?.bounds);
  }

  function submitType2(event = null) {
    event?.preventDefault();
    const result = validateType2Draft(draft, antennas, activeScene);

    if (result.error) {
      setAddError(result.error);
      return;
    }

    const addResult = onAddType2(result.antenna);
    if (addResult?.error) {
      setAddError(addResult.error);
      return;
    }

    setAddError("");
    setDraft({
      ...DRAFT_DEFAULTS,
      antenna_id: suggestedType2Id([...antennas, result.antenna]),
    });
  }

  return (
    <div className="antenna-list">
      <div className="antenna-summary">
        <strong>
          {hasAntennaLimit
            ? `${limitCount}/${maxAntennas} ${showEnabledToggle ? "active" : ""}`
            : antennas.length} antennas
        </strong>
        <span>{fixedCount} fixed antenna, {type2Count} added antenna</span>
      </div>
      {overLimit && (
        <p className="history-status error-text">
          {simulationLabel} supports up to {maxAntennas} active antennas. This scene has {limitCount} active antennas.
        </p>
      )}
      <div className="antenna-add-form">
        <details open={antennas.length === 0}>
          <summary>Add new antenna</summary>
          {addLimitReached && !disabled ? (
            <p className="form-help">
              {simulationLabel} already has the maximum {maxAntennas} active antennas. Uncheck one antenna before adding another.
            </p>
          ) : (
            <>
              <div className="antenna-form-grid">
                <TextField
                  label="antenna_id"
                  value={draft.antenna_id}
                  disabled={!canAdd}
                  onChange={(value) => updateDraft("antenna_id", value)}
                />
                <NumberField
                  label="longitude"
                  hint={draftHint("longitude")}
                  min={activeScene?.bounds?.west}
                  max={activeScene?.bounds?.east}
                  value={draft.longitude}
                  disabled={!canAdd}
                  onChange={(value) => updateDraft("longitude", value)}
                />
                <NumberField
                  label="latitude"
                  hint={draftHint("latitude")}
                  min={activeScene?.bounds?.south}
                  max={activeScene?.bounds?.north}
                  value={draft.latitude}
                  disabled={!canAdd}
                  onChange={(value) => updateDraft("latitude", value)}
                />
                <NumberField
                  label="height_m"
                  hint={draftHint("height_m")}
                  value={draft.height_m}
                  disabled={!canAdd}
                  onChange={(value) => updateDraft("height_m", value)}
                />
                <NumberField
                  label="azimuth_deg"
                  hint={draftHint("azimuth_deg")}
                  value={draft.azimuth_deg}
                  disabled={!canAdd}
                  onChange={(value) => updateDraft("azimuth_deg", value)}
                />
                <NumberField
                  label="tilt_min_deg"
                  hint={draftHint("tilt_min_deg")}
                  value={draft.tilt_min_deg}
                  disabled={!canAdd}
                  onChange={(value) => updateDraft("tilt_min_deg", value)}
                />
                <NumberField
                  label="tilt_current_deg"
                  hint={draftHint("tilt_current_deg")}
                  value={draft.tilt_current_deg}
                  disabled={!canAdd}
                  onChange={(value) => updateDraft("tilt_current_deg", value)}
                />
                <NumberField
                  label="tilt_max_deg"
                  hint={draftHint("tilt_max_deg")}
                  value={draft.tilt_max_deg}
                  disabled={!canAdd}
                  onChange={(value) => updateDraft("tilt_max_deg", value)}
                />
                <NumberField
                  label="tx_power_min_dbm"
                  hint={draftHint("tx_power_min_dbm")}
                  value={draft.tx_power_min_dbm}
                  disabled={!canAdd}
                  onChange={(value) => updateDraft("tx_power_min_dbm", value)}
                />
                <NumberField
                  label="tx_power_current_dbm"
                  hint={draftHint("tx_power_current_dbm")}
                  value={draft.tx_power_current_dbm}
                  disabled={!canAdd}
                  onChange={(value) => updateDraft("tx_power_current_dbm", value)}
                />
                <NumberField
                  label="tx_power_max_dbm"
                  hint={draftHint("tx_power_max_dbm")}
                  value={draft.tx_power_max_dbm}
                  disabled={!canAdd}
                  onChange={(value) => updateDraft("tx_power_max_dbm", value)}
                />
              </div>
              {addError && <p className="field-error">{addError}</p>}
              <button
                className="primary-button"
                type="button"
                disabled={!canAdd}
                onClick={submitType2}
              >
                Add antenna
              </button>
            </>
          )}
        </details>
      </div>
      {antennas.length === 0 && (
        <p className="history-status">No antennas are selected for {simulationLabel}.</p>
      )}
      {antennas.map((item) => (
        <AntennaCard
          antenna={item}
          disabled={disabled}
          key={`${item._type}-${item.id}`}
          onChange={onChange}
          onRemoveType2={onRemoveType2}
          showEnabledToggle={showEnabledToggle}
        />
      ))}
    </div>
  );
}

function AntennaCard({
  antenna,
  disabled,
  onChange,
  onRemoveType2,
  showEnabledToggle,
}) {
  const isType2 = antenna._type === TYPE_2;
  const isEnabled = isAntennaEnabled(antenna);

  return (
    <article className={`antenna-card ${isType2 ? "type2" : "type1"} ${!isEnabled ? "inactive" : ""}`}>
      <h3>
        {showEnabledToggle ? (
          <label className="antenna-enabled-toggle">
            <input
              type="checkbox"
              checked={isEnabled}
              disabled={disabled}
              onChange={(event) => onChange(antenna.id, "enabled", event.target.checked)}
            />
            <span>{antenna.id}</span>
          </label>
        ) : (
          <span>{antenna.id}</span>
        )}
        <small>{isType2 ? "Added antenna" : "Fixed antenna"}</small>
      </h3>
      <div className="antenna-meta">
        <span>{formatLngLatPosition(antenna)}</span>
        <span>Height {formatMaybeNumber(antenna.height_m)} m</span>
      </div>
      <div className="control-row">
        <label htmlFor={`tilt-${antenna.id}`}>Tilt</label>
        <input
          id={`tilt-${antenna.id}`}
          type="range"
          min={antenna.tilt.min}
          max={antenna.tilt.max}
          step="0.5"
          value={antenna.tilt.current}
          disabled={disabled}
          onChange={(event) => onChange(antenna.id, "tilt", Number(event.target.value))}
        />
        <span className="control-value">{formatMaybeNumber(antenna.tilt.current)}</span>
      </div>
      <div className="control-row">
        <label htmlFor={`power-${antenna.id}`}>Power</label>
        <input
          id={`power-${antenna.id}`}
          type="range"
          min={antenna.tx_power.min}
          max={antenna.tx_power.max}
          step="0.5"
          value={antenna.tx_power.current}
          disabled={disabled}
          onChange={(event) => onChange(antenna.id, "tx_power", Number(event.target.value))}
        />
        <span className="control-value">{formatMaybeNumber(antenna.tx_power.current)}</span>
      </div>
      <label className="form-field compact-field">
        <span>Azimuth</span>
        <div>
          <div className="input-with-unit">
            <input
              type="number"
              min="0"
              max="360"
              step="any"
              value={antenna.azimuth}
              disabled={disabled}
              onChange={(event) => onChange(antenna.id, "azimuth", parseNumericInput(event.target.value))}
            />
            <small>deg</small>
          </div>
          <small className="input-hint">0 to 360 degrees.</small>
        </div>
      </label>
      {isType2 && (
        <button
          className="ghost-button danger-button antenna-remove"
          type="button"
          disabled={disabled}
          onClick={() => onRemoveType2(antenna.id)}
        >
          Delete
        </button>
      )}
    </article>
  );
}

function isAntennaEnabled(antenna) {
  return antenna?.enabled !== false;
}

function TextField({ disabled, label, onChange, value }) {
  return (
    <label className="form-field">
      <span>{fieldLabel(label)}</span>
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function NumberField({ disabled, hint = "", label, max, min, onChange, value }) {
  return (
    <label className="form-field">
      <span>{fieldLabel(label)}</span>
      <div>
        <input
          type="number"
          value={value}
          disabled={disabled}
          min={min}
          max={max}
          step="any"
          onChange={(event) => onChange(parseNumericInput(event.target.value))}
        />
        {hint && <small className="input-hint">{hint}</small>}
      </div>
    </label>
  );
}

function fieldLabel(label) {
  return FIELD_LABELS[label] || label;
}

function fieldHint(label, bounds = null) {
  if (label === "longitude") {
    return bounds
      ? `${formatCoordinate(bounds.west)} to ${formatCoordinate(bounds.east)} for the selected scene.`
      : "-180 to 180; must be inside the selected scene.";
  }

  if (label === "latitude") {
    return bounds
      ? `${formatCoordinate(bounds.south)} to ${formatCoordinate(bounds.north)} for the selected scene.`
      : "-90 to 90; must be inside the selected scene.";
  }

  if (label === "height_m") {
    return "Must be greater than 0.";
  }

  if (label === "azimuth_deg") {
    return "0 to 360 degrees.";
  }

  if (label === "tilt_min_deg") {
    return "Must be less than or equal to tilt current and tilt max.";
  }

  if (label === "tilt_current_deg") {
    return "Must be between tilt min and tilt max.";
  }

  if (label === "tilt_max_deg") {
    return "Must be greater than or equal to tilt min and tilt current.";
  }

  if (label === "tx_power_min_dbm") {
    return "Must be less than or equal to power current and power max.";
  }

  if (label === "tx_power_current_dbm") {
    return "Must be between power min and power max.";
  }

  if (label === "tx_power_max_dbm") {
    return "Must be greater than or equal to power min and power current.";
  }

  return "";
}

function formatCoordinate(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "--";
  }

  return numericValue.toFixed(4);
}

function validateType2Draft(draft, antennas, activeScene) {
  const id = String(draft.antenna_id || "").trim();

  if (!id) {
    return { error: "antenna_id is required." };
  }

  if (antennas.some((item) => item.id.toLowerCase() === id.toLowerCase())) {
    return { error: `antenna_id "${id}" is already used.` };
  }

  const numericDraftFields = [
    ["longitude", draft.longitude],
    ["latitude", draft.latitude],
    ["height_m", draft.height_m],
    ["azimuth_deg", draft.azimuth_deg],
    ["tilt_min_deg", draft.tilt_min_deg],
    ["tilt_current_deg", draft.tilt_current_deg],
    ["tilt_max_deg", draft.tilt_max_deg],
    ["tx_power_min_dbm", draft.tx_power_min_dbm],
    ["tx_power_current_dbm", draft.tx_power_current_dbm],
    ["tx_power_max_dbm", draft.tx_power_max_dbm],
  ];
  const missingField = numericDraftFields.find(([, value]) => value === "" || value === null || value === undefined);

  if (missingField) {
    return { error: `${missingField[0]} is required.` };
  }

  const numericFields = numericDraftFields.map(([field, value]) => [field, Number(value)]);
  const invalidField = numericFields.find(([, value]) => !Number.isFinite(value));

  if (invalidField) {
    return { error: `${invalidField[0]} must be a number.` };
  }

  const values = Object.fromEntries(numericFields);
  const antenna = {
    id,
    longitude: values.longitude,
    latitude: values.latitude,
    height_m: values.height_m,
    azimuth: values.azimuth_deg,
    tilt: {
      min: values.tilt_min_deg,
      current: values.tilt_current_deg,
      max: values.tilt_max_deg,
    },
    tx_power: {
      min: values.tx_power_min_dbm,
      current: values.tx_power_current_dbm,
      max: values.tx_power_max_dbm,
    },
  };

  const coordinateError = lngLatBoundsError(
    antenna,
    activeScene?.bounds,
    "Type 2 antenna coordinates",
  );

  if (coordinateError) {
    return { error: coordinateError };
  }

  if (antenna.height_m <= 0) {
    return { error: "height_m must be greater than 0." };
  }

  if (antenna.azimuth < 0 || antenna.azimuth > 360) {
    return { error: "azimuth_deg must be between 0 and 360." };
  }

  const tiltError = validateRange(antenna.tilt, "tilt");
  if (tiltError) {
    return { error: tiltError };
  }

  const powerError = validateRange(antenna.tx_power, "tx_power");
  if (powerError) {
    return { error: powerError };
  }

  return { antenna };
}

function validateRange(range, label) {
  if (range.min > range.max) {
    return `${label}_min must be less than or equal to ${label}_max.`;
  }

  if (range.current < range.min || range.current > range.max) {
    return `${label}_current must be between ${label}_min and ${label}_max.`;
  }

  return "";
}

function suggestedType2Id(antennas) {
  const usedIds = new Set(antennas.map((item) => item.id.toLowerCase()));
  let index = 1;
  let id = `T2-${index}`;

  while (usedIds.has(id.toLowerCase())) {
    index += 1;
    id = `T2-${index}`;
  }

  return id;
}

function parseNumericInput(value) {
  return value === "" ? "" : Number(value);
}
