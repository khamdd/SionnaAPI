import { useEffect, useState } from "react";
import { lngLatInsideBounds } from "../utils/scene";
import { formatMaybeNumber } from "../utils/format";

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
  maxAntennas = 10,
  onAddType2,
  onChange,
  onRemoveType2,
  simulationLabel = "Network Coverage",
}) {
  const [draft, setDraft] = useState(() => ({
    ...DRAFT_DEFAULTS,
    antenna_id: suggestedType2Id(antennas),
  }));
  const [addError, setAddError] = useState("");
  const fixedCount = antennas.filter((item) => item._type === TYPE_1).length;
  const type2Count = antennas.length - fixedCount;
  const canAdd = !disabled && antennas.length < maxAntennas;
  const overLimit = antennas.length > maxAntennas;

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
        <strong>{antennas.length}/{maxAntennas} antennas</strong>
        <span>{fixedCount} type 1, {type2Count} type 2</span>
      </div>
      {overLimit && (
        <p className="history-status error-text">
          {simulationLabel} supports up to {maxAntennas} antennas. This scene has {antennas.length} selected antennas.
        </p>
      )}
      <div className="antenna-add-form">
        <details open={antennas.length === 0}>
          <summary>Add type 2 antenna</summary>
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
              value={draft.longitude}
              disabled={!canAdd}
              onChange={(value) => updateDraft("longitude", value)}
            />
            <NumberField
              label="latitude"
              hint={draftHint("latitude")}
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
}) {
  const isType2 = antenna._type === TYPE_2;

  return (
    <article className={`antenna-card ${isType2 ? "type2" : "type1"}`}>
      <h3>
        <span>{antenna.id}</span>
        <small>{isType2 ? "Type 2" : "Type 1"}</small>
      </h3>
      <div className="antenna-meta">
        <span>{formatAntennaLocation(antenna)}</span>
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

function NumberField({ disabled, hint = "", label, onChange, value }) {
  return (
    <label className="form-field">
      <span>{fieldLabel(label)}</span>
      <div>
        <input
          type="number"
          value={value}
          disabled={disabled}
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

  const antenna = {
    id,
    longitude: Number(draft.longitude),
    latitude: Number(draft.latitude),
    height_m: Number(draft.height_m),
    azimuth: Number(draft.azimuth_deg),
    tilt: {
      min: Number(draft.tilt_min_deg),
      current: Number(draft.tilt_current_deg),
      max: Number(draft.tilt_max_deg),
    },
    tx_power: {
      min: Number(draft.tx_power_min_dbm),
      current: Number(draft.tx_power_current_dbm),
      max: Number(draft.tx_power_max_dbm),
    },
  };

  const numericFields = [
    ["longitude", antenna.longitude],
    ["latitude", antenna.latitude],
    ["height_m", antenna.height_m],
    ["azimuth_deg", antenna.azimuth],
    ["tilt_min_deg", antenna.tilt.min],
    ["tilt_current_deg", antenna.tilt.current],
    ["tilt_max_deg", antenna.tilt.max],
    ["tx_power_min_dbm", antenna.tx_power.min],
    ["tx_power_current_dbm", antenna.tx_power.current],
    ["tx_power_max_dbm", antenna.tx_power.max],
  ];
  const invalidField = numericFields.find(([, value]) => !Number.isFinite(value));

  if (invalidField) {
    return { error: `${invalidField[0]} must be a number.` };
  }

  if (!lngLatInsideBounds(antenna, activeScene?.bounds)) {
    return { error: "Type 2 antenna coordinates must stay inside the selected scene." };
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

function formatAntennaLocation(antenna) {
  if (
    Number.isFinite(Number(antenna.longitude)) &&
    Number.isFinite(Number(antenna.latitude))
  ) {
    return `${formatMaybeNumber(antenna.longitude)}, ${formatMaybeNumber(antenna.latitude)}`;
  }

  return "--";
}

function parseNumericInput(value) {
  return value === "" ? "" : Number(value);
}
