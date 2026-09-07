import { useEffect, useState } from "react";
import { getSimulationJob, getSimulationJobResult, runNetworkCoverageOptimization, saveSimulationJobResult } from "../api";

const METRICS = [
  ["uncovered_area_percent", "Uncovered area", "%", "<=", 2],
  ["covered_area_percent", "Covered area", "%", ">=", 98],
  ["overlap_area_percent", "Overlap area", "%", "<=", 25],
  ["average_overlap_count", "Average overlap", "antennas", "<=", 2],
];
function read(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Runs work without storage. */ }
}

export default function OptimizationObjectivePage({ activeScene, baseRequest, onBack, onApply, storageKey }) {
  const runKey = `${storageKey}:run:${activeScene.id}`;
  const [objectives, setObjectives] = useState(() => read(storageKey)?.[activeScene.id]?.objectives?.map(({ metric, operator, target }) => ({ metric, operator, target })) || [
    { metric: "uncovered_area_percent", operator: "<=", target: 2 },
  ]);
  const [step, setStep] = useState(2);
  const [powerStep, setPowerStep] = useState(2);
  const [azimuthStep, setAzimuthStep] = useState(30);
  const [limit, setLimit] = useState(300);
  const [jobId, setJobId] = useState(() => read(runKey)?.jobId || null);
  const [sourceSignature, setSourceSignature] = useState(() => read(runKey)?.signature || "");
  const [busy, setBusy] = useState(() => Boolean(read(runKey)?.jobId));
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("Ready to search antenna tilt, power, and azimuth combinations.");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applied, setApplied] = useState(false);
  const [showTestedSetups, setShowTestedSetups] = useState(false);
  const signature = JSON.stringify(baseRequest);

  useEffect(() => {
    if (!jobId) return undefined;
    let disposed = false;
    let timer;
    async function poll() {
      try {
        const response = await getSimulationJob(jobId);
        if (disposed) return;
        const job = response.item;
        if (!job) {
          if (response.error) throw new Error(response.error);
          setError("This optimization job is no longer available. Start a new run.");
          setBusy(false);
          write(runKey, null);
          return;
        }
        if (job.scene?.id !== activeScene.id || job.simulation_type !== "network_coverage_optimization") {
          setError("This job does not belong to the selected scene.");
          setBusy(false);
          write(runKey, null);
          return;
        }
        if (job.status === "failed") {
          setError(job.error_message || "Optimization failed.");
          setBusy(false);
          return;
        }
        if (job.status === "succeeded") {
          const full = await getSimulationJobResult(jobId);
          if (disposed) return;
          if (!full.optimization) {
            setError(full.error || "Optimization result is unavailable. Start a new run.");
            setBusy(false);
            return;
          }
          setShowTestedSetups(false);
          setResult(full);
          setSaved(Boolean(job.result_run_id));
          setBusy(false);
          setError("");
          setStatus("Optimization finished.");
          return;
        }
        const progress = job.result?.optimization_progress;
        setStatus(progress ? `Tested ${progress.completed} of ${progress.total} setups. Running: ${progress.current}.` : "Waiting in the simulation queue...");
        setError("");
      } catch (err) {
        if (disposed) return;
        setError(`Cannot check progress: ${err.message}. Retrying automatically.`);
      }
      if (!disposed) timer = setTimeout(poll, 3000);
    }
    poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [jobId, activeScene.id, runKey]);

  function update(index, field, value) {
    setObjectives((current) => current.map((item, i) => {
      if (i !== index) return item;
      if (field === "metric") {
        const metric = METRICS.find(([id]) => id === value);
        return { metric: value, operator: metric[3], target: metric[4] };
      }
      return { ...item, [field]: value };
    }));
  }

  async function start(event) {
    event.preventDefault();
    if (busy) return;
    const targets = objectives.map((item) => ({ ...item, target: Number(item.target) }));
    setBusy(true);
    setJobId(null);
    setResult(null);
    setError("");
    setSaved(false);
    setApplied(false);
    setShowTestedSetups(false);
    setSourceSignature(signature);
    write(runKey, null);
    write(storageKey, { ...(read(storageKey) || {}), [activeScene.id]: { simulation_type: "network_coverage", objectives: targets } });
    setStatus("Starting optimization. The current setup will be simulated first...");
    try {
      const response = await runNetworkCoverageOptimization({
        scene_id: activeScene.id,
        base_request: baseRequest,
        objectives: targets,
        tilt_step: Number(step),
        power_step: Number(powerStep),
        azimuth_step: Number(azimuthStep),
        max_candidates: Number(limit),
      });
      if (response.job_id) {
        write(runKey, { jobId: response.job_id, signature });
        setJobId(response.job_id);
      } else {
        if (!response.optimization) throw new Error(response.error || "No optimization result returned.");
        setResult(response);
        setBusy(false);
        setStatus("Optimization finished.");
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const response = await saveSimulationJobResult(jobId);
      if (!response.saved) throw new Error(response.error || "Could not save the result.");
      setSaved(true);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  const optimization = result?.optimization;
  const stale = sourceSignature !== signature;
  const valid = objectives.length > 0 && new Set(objectives.map((o) => o.metric)).size === objectives.length;
  return (
    <main className="route-page optimization-page">
      <div className="page-title with-action">
        <div><h1>Network Coverage Optimization</h1><p>Search antenna tilt, power, and azimuth combinations against measurable coverage targets.</p></div>
        <button className="ghost-button" onClick={onBack}>Back to Network Coverage</button>
      </div>
      <form className="optimization-panel optimization-config-panel" onSubmit={start}>
        <header className="optimization-config-header">
          <div>
            <h2>Optimization setup</h2>
            <p>Define success criteria and the resolution of the search.</p>
          </div>
          <span>{baseRequest?.antennas?.length || 0} active antennas</span>
        </header>
        <fieldset disabled={busy || saving} className="optimization-run-fields">
          <section className="optimization-form-section">
            <div className="optimization-form-heading">
              <div>
                <h3>Performance targets</h3>
                <p>Add up to two conditions. Every target must be met for the search to finish early.</p>
              </div>
              <span>{objectives.length} of 2 configured</span>
            </div>
            <div className="optimization-objective-list">
              {objectives.map((objective, index) => {
                const unit = METRICS.find(([id]) => id === objective.metric)?.[2];
                return (
                  <div className="optimization-target-row" key={index}>
                    <span className="optimization-target-index">Target {index + 1}</span>
                    <label className="optimization-metric-field">
                      <span>Metric</span>
                      <select value={objective.metric} onChange={(e) => update(index, "metric", e.target.value)}>
                        {METRICS.map(([id, label]) => <option key={id} value={id} disabled={objectives.some((o, i) => i !== index && o.metric === id)}>{label}</option>)}
                      </select>
                    </label>
                    <label className="optimization-condition-field">
                      <span>Condition</span>
                      <select value={objective.operator} onChange={(e) => update(index, "operator", e.target.value)}>
                        {["<=", ">=", "<", ">", "="].map((operator) => <option key={operator}>{operator}</option>)}
                      </select>
                    </label>
                    <label className="optimization-target-field">
                      <span>Target</span>
                      <span className="optimization-input-unit">
                        <input type="number" required min="0" max={objective.metric === "average_overlap_count" ? 10 : 100} step="any" value={objective.target} onChange={(e) => update(index, "target", e.target.value)} />
                        <small>{unit}</small>
                      </span>
                    </label>
                    {index > 0 && <button type="button" className="ghost-button optimization-remove-target" onClick={() => setObjectives((current) => current.filter((_, i) => i !== index))}>Remove</button>}
                  </div>
                );
              })}
            </div>
            {objectives.length < 2 && <button className="ghost-button optimization-add-target" type="button" onClick={() => {
              const metric = METRICS.find(([id]) => !objectives.some((o) => o.metric === id) && id === "overlap_area_percent") || METRICS.find(([id]) => id !== objectives[0].metric);
              setObjectives([...objectives, { metric: metric[0], operator: metric[3], target: metric[4] }]);
            }}>Add another target</button>}
          </section>

          <section className="optimization-form-section optimization-search-section">
            <div className="optimization-form-heading">
              <div>
                <h3>Search resolution</h3>
                <p>Smaller increments search more precisely but require more simulations.</p>
              </div>
            </div>
            <div className="optimization-parameter-grid">
              <label>
                <span>Tilt increment</span>
                <span className="optimization-input-unit"><input type="number" required min="0.1" max="20" step="0.1" value={step} onChange={(e) => setStep(e.target.value)} /><small>deg</small></span>
              </label>
              <label>
                <span>Power increment</span>
                <span className="optimization-input-unit"><input type="number" required min="0.1" max="20" step="0.1" value={powerStep} onChange={(e) => setPowerStep(e.target.value)} /><small>dBm</small></span>
              </label>
              <label>
                <span>Azimuth increment</span>
                <span className="optimization-input-unit"><input type="number" required min="1" max="180" step="1" value={azimuthStep} onChange={(e) => setAzimuthStep(e.target.value)} /><small>deg</small></span>
              </label>
              <label>
                <span>Simulation budget</span>
                <span className="optimization-input-unit"><input type="number" required min="1" max="5000" step="1" value={limit} onChange={(e) => setLimit(e.target.value)} /><small>runs</small></span>
              </label>
            </div>
            <p className="optimization-method-note">The budget includes the starting setup. The search explores the full range first, retains strong diverse configurations, then refines them with smaller changes.</p>
          </section>

          <div className="optimization-run-bar">
            <div>
              <strong>Ready to evaluate</strong>
              <span>{objectives.length} target{objectives.length === 1 ? "" : "s"}, up to {limit} simulations</span>
            </div>
            <button className="primary-button" disabled={!valid || !baseRequest?.antennas?.length || baseRequest.antennas.length > 10}>Start optimization</button>
          </div>
        </fieldset>
        <div className={`optimization-status ${busy ? "running" : ""}`}>
          <span aria-hidden="true" />
          <div>
            <p role="status">{status}</p>
            {busy && <p>{jobId ? "You can leave this page and return to check the run." : "Keep this page open while the request is starting."}</p>}
          </div>
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
      </form>
      {optimization && <section className="optimization-panel">
        <h2>Best setup found</h2>
        <p>{optimizationResultSummary(optimization)}</p>
        {Number.isFinite(Number(optimization.global_tested)) && <p>Global exploration: {formatInteger(optimization.global_tested)} setups. Local refinement: {formatInteger(optimization.local_tested)} setups.</p>}
        <table className="optimization-results-table"><thead><tr><th>Metric</th><th>Before</th><th>After</th><th>Target</th></tr></thead>
          <tbody>{METRICS.map(([id, label, unit]) => {
            const target = optimization.objectives.find((o) => o.metric === id);
            return <tr key={id}><td>{label}</td><td>{formatMetric(optimization.baseline.evaluation.kpis[id], unit)}</td><td>{formatMetric(optimization.best.evaluation.kpis[id], unit)}</td><td>{target ? `${target.operator} ${formatMetric(target.target, unit)}` : "—"}</td></tr>;
          })}</tbody>
        </table>
        <p>Covered cells: {formatInteger(optimization.baseline.evaluation.kpis.covered_cells)} → {formatInteger(optimization.best.evaluation.kpis.covered_cells)} of {formatInteger(optimization.best.evaluation.kpis.total_cells)}.</p>
        <button
          type="button"
          className="ghost-button"
          aria-expanded={showTestedSetups}
          onClick={() => setShowTestedSetups((current) => !current)}
        >
          {showTestedSetups ? "Minimize tested setups" : `Expand tested setups (${optimization.tested_count})`}
        </button>
        {showTestedSetups && <>
          <h3>Tested setups</h3>
          <table className="optimization-results-table"><thead><tr><th>Setup</th><th>Settings</th><th>Covered cells</th><th>Covered area</th></tr></thead>
            <tbody>{optimization.trials.map((trial) => (
              <tr key={trial.id}>
                <td>{trial.label}</td>
                <td>{formatSettingsMap(trial.settings, trial.tilts)}</td>
                <td>{trial.error ? "Failed" : `${formatInteger(trial.evaluation.kpis.covered_cells)} / ${formatInteger(trial.evaluation.kpis.total_cells)}`}</td>
                <td>{trial.error ? trial.error : formatMetric(trial.evaluation.kpis.covered_area_percent, "%", 4)}</td>
              </tr>
            ))}</tbody>
          </table>
        </>}
        <p>When targets conflict, results are ranked by the combined shortfall, adjusted for each metric’s scale. Ties keep the earlier setup.</p>
        {optimization.best.changes.length ? <ul>{optimization.best.changes.map((change) => <li key={`${change.antenna_id}-${change.field || "tilt"}`}>{change.antenna_id} {formatField(change.field)}: {formatMetric(change.from)} → {formatMetric(change.to)}</li>)}</ul> : <p>The starting setup remains the best found. No changes suggested.</p>}
        {optimization.trials.some((trial) => trial.error) && <p className="error-text">Some setups failed: {optimization.trials.filter((trial) => trial.error).map((trial) => `${trial.label}: ${trial.error}`).join("; ")}</p>}
        {stale && !applied && <p className="error-text">Your antenna settings changed. Run optimization again before applying.</p>}
        <div className="panel-actions">
          <button className="primary-button" disabled={busy || stale || applied || !optimization.best.changes.length} onClick={() => { onApply(optimization.best.settings || optimization.best.tilts); setApplied(true); }}>{applied ? "Settings applied" : "Apply suggested settings"}</button>
          {jobId && <button className="ghost-button" disabled={saved || saving || busy} onClick={save}>{saved ? "Saved to history" : saving ? "Saving..." : "Save best result to history"}</button>}
        </div>
      </section>}
    </main>
  );
}

function formatMetric(value, unit = "", decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  const text = number.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  });
  return unit ? `${text} ${unit}` : text;
}

function formatInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return Math.round(number).toLocaleString();
}

function formatSettingsMap(settings = {}, tilts = {}) {
  const entries = Object.keys(settings).length ? Object.entries(settings) : Object.entries(tilts).map(([id, tilt]) => [id, { tilt }]);
  return entries
    .map(([antennaId, values]) => `${antennaId}: tilt ${formatMetric(values.tilt, "deg", 2)}, power ${formatMetric(values.tx_power, "dBm", 2)}, az ${formatMetric(values.azimuth, "deg", 2)}`)
    .join(", ");
}

function formatField(field = "tilt") {
  return { tilt: "tilt", tx_power: "power", azimuth: "azimuth" }[field] || field;
}

function optimizationResultSummary(optimization) {
  const tested = optimization.tested_count;
  const limit = optimization.budget_limit || tested;
  if (optimization.stop_reason === "targets_met") {
    return `All targets met after testing ${tested} of up to ${limit} setups.`;
  }
  if (optimization.stop_reason === "budget_exhausted") {
    return `Targets not fully met after using the full ${limit}-simulation budget. Showing the closest setup found.`;
  }
  return `Targets not fully met. The search exhausted its remaining unique candidates after ${tested} of up to ${limit} simulations. Showing the closest setup found.`;
}
