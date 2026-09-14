import { useMemo, useState } from "react";

import { isAntennaEnabled, parseAntennaNumericInput } from "../utils/antennas";
import { formatLngLatPosition, formatMaybeNumber } from "../utils/format";

export default function SimulationAntennaPanel({
  antennaPool = [],
  antennas = [],
  disabled = false,
  maxAntennas = null,
  onAdd,
  onChange,
  onRemove,
  showEnabledToggle = false,
  simulationLabel = "simulation",
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
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

  return (
    <div className="antenna-list">
      <div className="antenna-summary">
        <strong>{maxAntennas ? `${antennas.length}/${maxAntennas}` : antennas.length} antennas</strong>
        <button className="primary-button" type="button" disabled={disabled} onClick={() => setPickerOpen(true)}>Add</button>
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
              <div><h2>Add antennas</h2><p>Select one or more antennas from the active scene.</p></div>
              <button className="ghost-button" type="button" onClick={() => setPickerOpen(false)}>Close</button>
            </div>
            <input className="antenna-picker-search" type="search" placeholder="Search antenna ID" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
            <div className="antenna-picker-list">
              {available.map((antenna) => (
                <label key={antenna.database_id || antenna.id}>
                  <input type="checkbox" checked={checked.has(inventoryKey(antenna))} onChange={() => toggle(inventoryKey(antenna))} />
                  <strong>{antenna.id}</strong>
                  <span>{formatLngLatPosition(antenna)} · {formatMaybeNumber(antenna.height_m)} m</span>
                </label>
              ))}
              {antennaPool.length === 0 ? (
                <p className="history-status">No active inventory antennas are inside this scene. Add antennas within the scene bounds on the Antennas page.</p>
              ) : (
                <p className="history-status">No available antennas match this search.</p>
              )}
            </div>
            {error && <p className="field-error">{error}</p>}
            <div className="antenna-picker-actions">
              <button className="ghost-button" type="button" onClick={() => setPickerOpen(false)}>Cancel</button>
              <button className="primary-button" type="button" disabled={checked.size === 0} onClick={addSelected}>Add selected ({checked.size})</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
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
