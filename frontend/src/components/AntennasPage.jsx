import { useEffect, useMemo, useRef, useState } from "react";

import {
  archiveAntenna,
  createAntenna,
  importAntennaBatch,
  listAntennas,
  previewAntennaImport,
  restoreAntenna,
  updateAntennaRecord,
} from "../api";
import { inspectAntennaWorkbook } from "../utils/antennaImport";
import { downloadAntennaTemplate } from "../utils/antennaTemplate";
import { formatAntennaCoordinate } from "../utils/antennas";
import { formatMaybeNumber } from "../utils/format";

const EMPTY_FORM = {
  id: "", longitude: "", latitude: "", height_m: 30, azimuth: 0,
  tilt: { min: 0, current: 8, max: 20 },
  tx_power: { min: 20, current: 30, max: 40 },
};

const ANTENNAS_PAGE_SIZE = 20;

export default function AntennasPage({ onInventoryChange }) {
  const [antennas, setAntennas] = useState([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const fileRef = useRef(null);

  async function load() {
    setBusy(true);
    try {
      const result = await listAntennas();
      setAntennas(result.antennas || []);
      onInventoryChange?.(result.antennas || []);
      setNotice("");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { load(); }, []);

  const visible = useMemo(() => antennas.filter((antenna) => (
    (!status || antenna.status === status)
    && antenna.id.toLowerCase().includes(query.trim().toLowerCase())
  )), [antennas, query, status]);

  const pageCount = Math.max(1, Math.ceil(visible.length / ANTENNAS_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const paged = useMemo(() => visible.slice(
    (currentPage - 1) * ANTENNAS_PAGE_SIZE,
    currentPage * ANTENNAS_PAGE_SIZE,
  ), [visible, currentPage]);
  const rangeStart = (currentPage - 1) * ANTENNAS_PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * ANTENNAS_PAGE_SIZE, visible.length);

  useEffect(() => {
    setPage(1);
  }, [query, status]);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = normalizeForm(editor.values);
      if (editor.databaseId) await updateAntennaRecord(editor.databaseId, payload);
      else await createAntenna(payload);
      setEditor(null);
      await load();
    } catch (error) {
      setNotice(error.message);
      setBusy(false);
    }
  }

  async function setArchived(antenna, archived) {
    if (archived && !window.confirm(`Archive antenna "${antenna.id}"?`)) return;
    setBusy(true);
    try {
      if (archived) await archiveAntenna(antenna.database_id);
      else await restoreAntenna(antenna.database_id);
      await load();
    } catch (error) {
      setNotice(error.message);
      setBusy(false);
    }
  }

  async function chooseWorkbook(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    const inspected = await inspectAntennaWorkbook(file);
    if (inspected.invalid.length) {
      setImportPreview({ fileName: file.name, invalid: inspected.invalid, new: [], changed: [], unchanged: [], antennas: [] });
      setBusy(false);
      return;
    }
    try {
      const result = await previewAntennaImport(inspected.antennas);
      setImportPreview({ fileName: file.name, invalid: [], antennas: inspected.antennas, ...result.preview });
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    setBusy(true);
    try {
      await importAntennaBatch(importPreview.antennas, importPreview.changed.length > 0);
      setImportPreview(null);
      await load();
    } catch (error) {
      setNotice(error.message);
      setBusy(false);
    }
  }

  return (
    <main className="route-page antenna-inventory-page">
      <header className="page-title with-action antenna-inventory-title">
        <div><h1>Antenna inventory</h1><p>Manage the shared antennas available to configurations and simulations.</p></div>
        <div className="page-title-actions">
          <button className="ghost-button" type="button" onClick={() => downloadAntennaTemplate(antennas)}>Download template</button>
          <button className="ghost-button" type="button" disabled={busy} onClick={() => fileRef.current?.click()}>Import XLSX</button>
          <button className="primary-button" type="button" disabled={busy} onClick={() => setEditor({ databaseId: null, values: structuredClone(EMPTY_FORM) })}>Add antenna</button>
          <input ref={fileRef} className="hidden" type="file" accept=".xlsx" onChange={chooseWorkbook} />
        </div>
      </header>
      {notice && <p className="configuration-notice error" role="alert">{notice}</p>}
      <section className="antenna-inventory-toolbar">
        <input type="search" placeholder="Search antenna ID" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">Active</option><option value="archived">Archived</option><option value="">All statuses</option></select>
        <span>{visible.length} shown</span>
      </section>
      <div className="antenna-inventory-table-wrap">
        <table className="antenna-inventory-table">
          <thead><tr><th>ID</th><th>Longitude</th><th>Latitude</th><th>Height</th><th>Azimuth</th><th>Tilt</th><th>Power</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {paged.map((antenna) => (
              <tr key={antenna.database_id}>
                <td><strong>{antenna.id}</strong></td><td>{formatAntennaCoordinate(antenna.longitude)}</td><td>{formatAntennaCoordinate(antenna.latitude)}</td><td>{formatMaybeNumber(antenna.height_m)} m</td><td>{formatMaybeNumber(antenna.azimuth)}°</td><td>{rangeLabel(antenna.tilt)}°</td><td>{rangeLabel(antenna.tx_power)} dBm</td><td><span className={`antenna-status ${antenna.status}`}>{antenna.status}</span></td>
                <td><div className="table-actions"><button className="ghost-button" type="button" disabled={busy} onClick={() => setEditor({ databaseId: antenna.database_id, values: structuredClone(antenna) })}>Edit</button>{antenna.status === "active" ? <button className="ghost-button danger-button" type="button" disabled={busy} onClick={() => setArchived(antenna, true)}>Archive</button> : <button className="ghost-button" type="button" disabled={busy} onClick={() => setArchived(antenna, false)}>Restore</button>}</div></td>
              </tr>
            ))}
            {!visible.length && <tr><td colSpan="9" className="antenna-inventory-empty">No antennas match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      {visible.length > 0 && (
        <div className="antenna-pagination">
          <button
            className="ghost-button"
            type="button"
            disabled={busy || currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous
          </button>
          <span>Page {currentPage} of {pageCount} · {rangeStart}–{rangeEnd} of {visible.length} antennas</span>
          <button
            className="ghost-button"
            type="button"
            disabled={busy || currentPage >= pageCount}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </button>
        </div>
      )}
      {editor && <AntennaEditor editor={editor} busy={busy} onCancel={() => setEditor(null)} onChange={setEditor} onSave={save} />}
      {importPreview && <ImportPreview preview={importPreview} busy={busy} onCancel={() => setImportPreview(null)} onConfirm={confirmImport} />}
    </main>
  );
}

function AntennaEditor({ editor, busy, onCancel, onChange, onSave }) {
  const values = editor.values;
  const set = (field, value) => onChange({ ...editor, values: { ...values, [field]: value } });
  const setRange = (field, part, value) => set(field, { ...values[field], [part]: value });
  return <div className="antenna-picker-backdrop"><form className="antenna-editor" onSubmit={onSave}><div className="panel-header"><div><h2>{editor.databaseId ? "Edit antenna" : "Add antenna"}</h2><p>Inventory values update every related configuration.</p></div></div><div className="antenna-form-grid"><Field disabled={Boolean(editor.databaseId)} label="Antenna ID" value={values.id} onChange={(value) => set("id", value)} /><Field label="Longitude" type="number" value={values.longitude} onChange={(value) => set("longitude", value)} /><Field label="Latitude" type="number" value={values.latitude} onChange={(value) => set("latitude", value)} /><Field label="Height (m)" type="number" value={values.height_m} onChange={(value) => set("height_m", value)} /><Field label="Azimuth (deg)" type="number" value={values.azimuth} onChange={(value) => set("azimuth", value)} />{["min", "current", "max"].map((part) => <Field key={`tilt-${part}`} label={`Tilt ${part}`} type="number" value={values.tilt[part]} onChange={(value) => setRange("tilt", part, value)} />)}{["min", "current", "max"].map((part) => <Field key={`power-${part}`} label={`Power ${part}`} type="number" value={values.tx_power[part]} onChange={(value) => setRange("tx_power", part, value)} />)}</div><div className="antenna-picker-actions"><button className="ghost-button" type="button" onClick={onCancel}>Cancel</button><button className="primary-button" disabled={busy} type="submit">Save antenna</button></div></form></div>;
}

function ImportPreview({ preview, busy, onCancel, onConfirm }) {
  const canImport = preview.antennas.length > 0 && preview.invalid.length === 0;
  return <div className="antenna-picker-backdrop"><section className="antenna-editor"><div className="panel-header"><div><h2>Import preview</h2><p>{preview.fileName}</p></div></div><div className="import-preview-counts"><span><strong>{preview.new.length}</strong> new</span><span><strong>{preview.changed.length}</strong> changed</span><span><strong>{preview.unchanged.length}</strong> unchanged</span><span className={preview.invalid.length ? "error-text" : ""}><strong>{preview.invalid.length}</strong> invalid</span></div>{preview.changed.length > 0 && <p>Changed rows will update existing antennas after confirmation.</p>}{preview.invalid.map((item, index) => <p className="field-error" key={index}>{item.error}</p>)}<div className="antenna-picker-actions"><button className="ghost-button" type="button" onClick={onCancel}>Cancel</button><button className="primary-button" type="button" disabled={busy || !canImport} onClick={onConfirm}>Import antennas</button></div></section></div>;
}

function Field({ disabled = false, label, onChange, type = "text", value }) { return <label className="form-field"><span>{label}</span><input disabled={disabled} required type={type} step={type === "number" ? "any" : undefined} value={value} onChange={(event) => onChange(type === "number" ? (event.target.value === "" ? "" : Number(event.target.value)) : event.target.value)} /></label>; }
function rangeLabel(range) { return `${formatMaybeNumber(range.min)} / ${formatMaybeNumber(range.current)} / ${formatMaybeNumber(range.max)}`; }
function normalizeForm(values) { return { id: String(values.id).trim(), longitude: Number(values.longitude), latitude: Number(values.latitude), height_m: Number(values.height_m), azimuth: Number(values.azimuth), tilt: { min: Number(values.tilt.min), current: Number(values.tilt.current), max: Number(values.tilt.max) }, tx_power: { min: Number(values.tx_power.min), current: Number(values.tx_power.current), max: Number(values.tx_power.max) } }; }
