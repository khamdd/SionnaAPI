import { useMemo, useState } from "react";

import { formatAntennaCoordinate, isAntennaEnabled, parseAntennaNumericInput, validateRange } from "../utils/antennas";
import { lngLatBoundsError } from "../utils/scene";
import { formatLngLatPosition, formatMaybeNumber } from "../utils/format";

export default function SimulationAntennaPanel({
  activeScene,
  antennaPool = [],
  antennas = [],
  disabled = false,
  maxAntennas = null,
  onAdd,
  onChange,
  onCreate,
  onRemove,
  showEnabledToggle = false,
  simulationLabel = "simulation",
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mode, setMode] = useState("pool");
  const [createDraft, setCreateDraft] = useState(() => emptyAntenna(activeScene));
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState(() => new Set());
  const [error, setError] = useState("");
  const selectedIds = useMemo(() => new Set(antennas.map(inventoryKey)), [antennas]);
  const available = useMemo(() => antennaPool.filter((antenna) => (
    !selectedIds.has(inventoryKey(antenna))
    && antenna.id.toLowerCase().includes(query.trim().toLowerCase())
  )), [antennaPool, query, selectedIds]);

  function toggle(antennaId) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(antennaId)) next.delete(antennaId);
      else next.add(antennaId);
      return next;
    });
  }

  function addSelected() {
    const result = onAdd([...checked]);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setChecked(new Set());
    setError("");
    setPickerOpen(false);
  }

  function openPicker() {
    setMode("pool");
    setError("");
    setCreateDraft(emptyAntenna(activeScene));
    setPickerOpen(true);
  }

  async function createAndAdd(event) {
    event.preventDefault();
    const validationError = validateCreateDraft(createDraft, activeScene);
    if (validationError) {
      setError(validationError);
      return;
    }
    setCreating(true);
    setError("");
    try {
      const antenna = await onCreate(normalizeCreateDraft(createDraft));
      const result = onAdd([antenna]);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setChecked(new Set());
      setPickerOpen(false);
    } catch (createError) {
      setError(createError.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="antenna-list">
      <div className="antenna-summary">
        <strong>{maxAntennas ? `${antennas.length}/${maxAntennas}` : antennas.length} antennas</strong>
        <button className="primary-button" type="button" disabled={disabled} onClick={openPicker}>Add</button>
      </div>
      {antennas.length === 0 && <p className="history-status">No antennas selected for {simulationLabel}.</p>}
      {antennas.map((antenna) => (
        <SelectedAntennaCard
          antenna={antenna}
          disabled={disabled}
          key={antenna.database_id || antenna.id}
          onChange={onChange}
          onRemove={onRemove}
          showEnabledToggle={showEnabledToggle}
        />
      ))}
      {pickerOpen && (
        <div className="antenna-picker-backdrop" role="presentation" onMouseDown={() => setPickerOpen(false)}>
          <section className="antenna-picker" role="dialog" aria-modal="true" aria-label="Add antennas" onMouseDown={(event) => event.stopPropagation()}>
            <div className="panel-header">
              <div><h2>Add antenna</h2><p>Choose an existing antenna or create one within this scene.</p></div>
              <button className="ghost-button" type="button" onClick={() => setPickerOpen(false)}>Close</button>
            </div>
            <div className="antenna-add-tabs" role="tablist" aria-label="Antenna source">
              <button className={mode === "pool" ? "active" : ""} type="button" role="tab" aria-selected={mode === "pool"} onClick={() => { setMode("pool"); setError(""); }}>Select from pool</button>
              <button className={mode === "create" ? "active" : ""} type="button" role="tab" aria-selected={mode === "create"} onClick={() => { setMode("create"); setError(""); }}>Create for this scene</button>
            </div>
            {mode === "pool" ? <>
              <input className="antenna-picker-search" type="search" placeholder="Search antenna ID" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
              <div className="antenna-picker-list">
                {available.map((antenna) => (
                  <label key={antenna.database_id || antenna.id}>
                    <input type="checkbox" checked={checked.has(inventoryKey(antenna))} onChange={() => toggle(inventoryKey(antenna))} />
                    <strong>{antenna.id}</strong>
                    <span>{formatLngLatPosition(antenna)} · {formatMaybeNumber(antenna.height_m)} m</span>
                  </label>
                ))}
                {available.length === 0 && (antennaPool.length === 0
                  ? <p className="history-status">No active inventory antennas are inside this scene. Create one here to continue.</p>
                  : <p className="history-status">No available antennas match this search.</p>)}
              </div>
              {error && <p className="field-error" role="alert">{error}</p>}
              <div className="antenna-picker-actions">
                <button className="ghost-button" type="button" onClick={() => setPickerOpen(false)}>Cancel</button>
                <button className="primary-button" type="button" disabled={checked.size === 0} onClick={addSelected}>Add selected ({checked.size})</button>
              </div>
            </> : (
              <CreateAntennaForm activeScene={activeScene} busy={creating} draft={createDraft} error={error} onCancel={() => setPickerOpen(false)} onChange={setCreateDraft} onSubmit={createAndAdd} />
            )}
          </section>
        </div>
      )}
    </div>
  );
}

const CREATE_DEFAULTS = {
  id: "", longitude: "", latitude: "", height_m: 30, azimuth: 0,
  tilt: { min: 0, current: 8, max: 20 },
  tx_power: { min: 20, current: 30, max: 40 },
};

function emptyAntenna(scene) {
  const bounds = scene?.bounds;
  return {
    ...structuredClone(CREATE_DEFAULTS),
    longitude: bounds ? Number(((bounds.west + bounds.east) / 2).toFixed(6)) : "",
    latitude: bounds ? Number(((bounds.south + bounds.north) / 2).toFixed(6)) : "",
  };
}

function CreateAntennaForm({ activeScene, busy, draft, error, onCancel, onChange, onSubmit }) {
  const set = (field, value) => onChange({ ...draft, [field]: value });
  const setRange = (field, part, value) => set(field, { ...draft[field], [part]: value });
  const bounds = activeScene?.bounds;
  return <form className="simulation-antenna-create" onSubmit={onSubmit} noValidate>
    <p className="scene-bounds-callout"><strong>{activeScene?.name || "Selected scene"}</strong><span>Longitude {formatBound(bounds?.west)} to {formatBound(bounds?.east)} · Latitude {formatBound(bounds?.south)} to {formatBound(bounds?.north)}</span></p>
    <div className="antenna-form-grid">
      <CreateField label="Antenna ID" value={draft.id} onChange={(value) => set("id", value)} />
      <CreateField label="Longitude" type="number" min={bounds?.west} max={bounds?.east} hint={`${formatBound(bounds?.west)} to ${formatBound(bounds?.east)} for this scene.`} value={draft.longitude} onChange={(value) => set("longitude", value)} />
      <CreateField label="Latitude" type="number" min={bounds?.south} max={bounds?.north} hint={`${formatBound(bounds?.south)} to ${formatBound(bounds?.north)} for this scene.`} value={draft.latitude} onChange={(value) => set("latitude", value)} />
      <CreateField label="Height (m)" type="number" min="0" hint="Greater than 0 m." value={draft.height_m} onChange={(value) => set("height_m", value)} />
      <CreateField label="Azimuth (deg)" type="number" min="0" max="360" hint="0 to 360 degrees." value={draft.azimuth} onChange={(value) => set("azimuth", value)} />
      {['min', 'current', 'max'].map((part) => <CreateField key={`tilt-${part}`} label={`Tilt ${part}`} type="number" hint={part === 'current' ? 'Must stay between min and max.' : ''} value={draft.tilt[part]} onChange={(value) => setRange('tilt', part, value)} />)}
      {['min', 'current', 'max'].map((part) => <CreateField key={`power-${part}`} label={`Power ${part} (dBm)`} type="number" hint={part === 'current' ? 'Must stay between min and max.' : ''} value={draft.tx_power[part]} onChange={(value) => setRange('tx_power', part, value)} />)}
    </div>
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="antenna-picker-actions"><button className="ghost-button" type="button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save and add"}</button></div>
  </form>;
}

function CreateField({ hint = "", label, max, min, onChange, type = "text", value }) {
  return <label className="form-field"><span>{label}</span><input type={type} step={type === "number" ? "any" : undefined} min={min} max={max} value={value} onChange={(event) => onChange(type === "number" ? parseAntennaNumericInput(event.target.value) : event.target.value)} />{hint && <small className="input-hint">{hint}</small>}</label>;
}

function formatBound(value) {
  return Number.isFinite(Number(value)) ? formatAntennaCoordinate(value) : "—";
}

export function validateCreateDraft(draft, activeScene) {
  if (!String(draft.id || "").trim()) return "Antenna ID is required.";
  const numeric = ["longitude", "latitude", "height_m", "azimuth"].find((field) => draft[field] === "" || !Number.isFinite(Number(draft[field])));
  if (numeric) return `${numeric.replace("_m", "")} must be a number.`;
  const invalidRange = ["tilt", "tx_power"].find((field) => (
    ["min", "current", "max"].some((part) => draft[field]?.[part] === "" || !Number.isFinite(Number(draft[field]?.[part])))
  ));
  if (invalidRange) return `${invalidRange === "tx_power" ? "Power" : "Tilt"} values must be numbers.`;
  const coordinateError = lngLatBoundsError(draft, activeScene?.bounds, "Antenna coordinates");
  if (coordinateError) return coordinateError;
  if (Number(draft.height_m) <= 0) return "Height must be greater than 0 m.";
  if (Number(draft.azimuth) < 0 || Number(draft.azimuth) > 360) return "Azimuth must be between 0 and 360 degrees.";
  const numericTilt = Object.fromEntries(Object.entries(draft.tilt).map(([key, value]) => [key, Number(value)]));
  const numericPower = Object.fromEntries(Object.entries(draft.tx_power).map(([key, value]) => [key, Number(value)]));
  const tiltError = validateRange(numericTilt, "Tilt");
  if (tiltError) return tiltError;
  return validateRange(numericPower, "Power");
}

function normalizeCreateDraft(draft) {
  return {
    id: String(draft.id).trim(), longitude: Number(draft.longitude), latitude: Number(draft.latitude),
    height_m: Number(draft.height_m), azimuth: Number(draft.azimuth),
    tilt: Object.fromEntries(Object.entries(draft.tilt).map(([key, value]) => [key, Number(value)])),
    tx_power: Object.fromEntries(Object.entries(draft.tx_power).map(([key, value]) => [key, Number(value)])),
  };
}

function SelectedAntennaCard({ antenna, disabled, onChange, onRemove, showEnabledToggle }) {
  const enabled = isAntennaEnabled(antenna);
  const key = inventoryKey(antenna);
  return (
    <article className={`antenna-card inventory ${enabled ? "" : "inactive"}`}>
      <h3>
        {showEnabledToggle ? (
          <label className="antenna-enabled-toggle"><input type="checkbox" checked={enabled} disabled={disabled} onChange={(event) => onChange(key, "enabled", event.target.checked)} /><span>{antenna.id}</span></label>
        ) : <span>{antenna.id}</span>}
        <small>Inventory antenna</small>
      </h3>
      <div className="antenna-meta"><span>{formatLngLatPosition(antenna)}</span><span>Height {formatMaybeNumber(antenna.height_m)} m</span></div>
      <div className="control-row"><label>Tilt</label><input type="range" min={antenna.tilt.min} max={antenna.tilt.max} step="0.5" value={antenna.tilt.current} disabled={disabled} onChange={(event) => onChange(key, "tilt", Number(event.target.value))} /><span className="control-value">{formatMaybeNumber(antenna.tilt.current)}</span></div>
      <div className="control-row"><label>Power</label><input type="range" min={antenna.tx_power.min} max={antenna.tx_power.max} step="0.5" value={antenna.tx_power.current} disabled={disabled} onChange={(event) => onChange(key, "tx_power", Number(event.target.value))} /><span className="control-value">{formatMaybeNumber(antenna.tx_power.current)}</span></div>
      <label className="form-field compact-field"><span>Azimuth</span><div><div className="input-with-unit"><input type="number" min="0" max="360" step="any" value={antenna.azimuth} disabled={disabled} onChange={(event) => onChange(key, "azimuth", parseAntennaNumericInput(event.target.value))} /><small>deg</small></div></div></label>
      <button className="ghost-button danger-button antenna-remove" type="button" disabled={disabled} onClick={() => onRemove(key)}>Remove</button>
    </article>
  );
}

function inventoryKey(antenna) {
  return antenna.database_id || antenna.id;
}
