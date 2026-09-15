import { useEffect, useState } from "react";
import { getSimulationJob, getSimulationJobResult, runNetworkCoverageOptimization, saveSimulationJobResult } from "../api";

const AGGREGATE_METRICS = [
  { id: "uncovered_area_percent", label: "Uncovered area", unit: "%", operator: "<=", target: 2 },
  { id: "covered_area_percent", label: "Covered area", unit: "%", operator: ">=", target: 98 },
  { id: "overlap_area_percent", label: "Overlap area", unit: "%", operator: "<=", target: 25 },
  { id: "average_overlap_count", label: "Average overlap", unit: "antennas", operator: "<=", target: 2 },
];
const RF_MEASUREMENTS = [
  { id: "rsrp_dbm", label: "RSRP", unit: "dBm", threshold: -110 },
  { id: "sinr_db", label: "SINR", unit: "dB", threshold: 5 },
  { id: "throughput_mbps", label: "Throughput", unit: "Mbps", threshold: 20 },
];
const OBJECTIVE_TYPES = [
  ["aggregate", "Coverage or overlap"],
  ["threshold_area", "Area meeting RF threshold"],
  ["percentile", "RF percentile"],
];
const OPERATORS = ["<=", ">=", "<", ">", "="];
const THRESHOLD_OPERATORS = [">=", ">", "<=", "<"];
const MAX_OBJECTIVES = 4;
const CHANGE_FIELDS = [
  ["tilt", "Tilt"], ["tx_power", "Power"], ["azimuth", "Azimuth"],
];
const GUARDRAIL_METRICS = [
  ["covered_area_percent", "Covered area", "%"],
  ["uncovered_area_percent", "Uncovered area", "%"],
  ["overlap_area_percent", "Overlap area", "%"],
  ["average_overlap_count", "Average overlap", "antennas"],
  ["rsrp_dbm_p10", "P10 RSRP", "dB"],
  ["sinr_db_p10", "P10 SINR", "dB"],
  ["throughput_mbps_p10", "P10 throughput", "Mbps"],
];
function read(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Runs work without storage. */ }
}

export default function OptimizationObjectivePage({ activeScene, baseRequest, onBack, onApply, storageKey }) {
  const runKey = `${storageKey}:run:${activeScene.id}`;
  const [objectives, setObjectives] = useState(() => read(storageKey)?.[activeScene.id]?.objectives?.map(normalizeObjective) || [defaultObjective("aggregate")]);
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
  const [selectedCandidateId, setSelectedCandidateId] = useState(null);
  const [changeFields, setChangeFields] = useState(() => CHANGE_FIELDS.map(([field]) => field));
  const [eligibleAntennaIds, setEligibleAntennaIds] = useState(() => baseRequest?.antennas?.map((antenna) => antenna.id) || []);
  const [maxTiltChange, setMaxTiltChange] = useState(10);
  const [maxPowerChange, setMaxPowerChange] = useState(6);
  const [maxAzimuthChange, setMaxAzimuthChange] = useState(60);
  const [maxChangedAntennas, setMaxChangedAntennas] = useState(Math.min(3, baseRequest?.antennas?.length || 1));
  const [preventPowerIncrease, setPreventPowerIncrease] = useState(false);
  const [guardrails, setGuardrails] = useState([]);
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
          setSelectedCandidateId((full.optimization.recommended_candidate || full.optimization.best)?.id);
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
      if (field === "kind") return defaultObjective(value);
      if (field === "metric") {
        const metric = AGGREGATE_METRICS.find(({ id }) => id === value);
        return { ...item, metric: value, operator: metric.operator, target: metric.target };
      }
      if (field === "measurement") {
        const measurement = RF_MEASUREMENTS.find(({ id }) => id === value);
        return item.kind === "threshold_area"
          ? { ...item, measurement: value, threshold: measurement.threshold }
          : { ...item, measurement: value, target: measurement.threshold };
      }
      return { ...item, [field]: value };
    }));
  }

  async function start(event) {
    event.preventDefault();
    if (busy) return;
    const targets = objectives.map(serializeObjective);
    setBusy(true);
    setJobId(null);
    setResult(null);
    setError("");
    setSaved(false);
    setApplied(false);
    setShowTestedSetups(false);
    setSelectedCandidateId(null);
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
        variables: changeFields.map((field) => ({ field, scope: "enabled_antennas" })),
        eligible_antenna_ids: eligibleAntennaIds,
        max_tilt_change: changeFields.includes("tilt") ? Number(maxTiltChange) : undefined,
        max_power_change: changeFields.includes("tx_power") ? Number(maxPowerChange) : undefined,
        max_azimuth_change: changeFields.includes("azimuth") ? Number(maxAzimuthChange) : undefined,
        max_changed_antennas: Number(maxChangedAntennas),
        prevent_total_power_increase: preventPowerIncrease,
        guardrails: guardrails.map((guardrail) => ({ ...guardrail, max_regression: Number(guardrail.max_regression) })),
      });
      if (response.job_id) {
        write(runKey, { jobId: response.job_id, signature });
        setJobId(response.job_id);
      } else {
        if (!response.optimization) throw new Error(response.error || "No optimization result returned.");
        setResult(response);
        setSelectedCandidateId((response.optimization.recommended_candidate || response.optimization.best)?.id);
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
  const recommendedCandidate = optimization?.recommended_candidate || optimization?.best;
  const candidateOptions = optimization ? [recommendedCandidate, ...(optimization.alternatives || [])].filter(Boolean) : [];
  const selectedCandidate = candidateOptions.find((candidate) => candidate.id === selectedCandidateId) || recommendedCandidate;
  const stale = sourceSignature !== signature;
  const objectiveValid = objectives.length > 0 && objectives.every(objectiveIsValid) && new Set(objectives.map(objectiveKey)).size === objectives.length;
  const valid = objectiveValid && changeFields.length > 0 && eligibleAntennaIds.length > 0;
  const disabledReason = optimizationDisabledReason({ busy, saving, baseRequest, objectiveValid, changeFields, eligibleAntennaIds });
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
                <p>Describe the network result you need. Every target must pass.</p>
              </div>
              <span>{objectives.length} of {MAX_OBJECTIVES} configured</span>
            </div>
            <div className="optimization-objective-list">
              {objectives.map((objective, index) => {
                return (
                  <div className="optimization-target-row" key={index}>
                    <span className="optimization-target-index">Target {index + 1}</span>
                    <label>
                      <span>Target type</span>
                      <select value={objective.kind} onChange={(e) => update(index, "kind", e.target.value)}>
                        {OBJECTIVE_TYPES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                      </select>
                    </label>
                    <ObjectiveFields objective={objective} index={index} update={update} />
                    {index > 0 && <button type="button" className="ghost-button optimization-remove-target" onClick={() => setObjectives((current) => current.filter((_, i) => i !== index))}>Remove</button>}
                  </div>
                );
              })}
            </div>
            {objectives.length < MAX_OBJECTIVES && <button className="ghost-button optimization-add-target" type="button" onClick={() => {
              const metric = AGGREGATE_METRICS.find(({ id }) => !objectives.some((o) => o.metric === id) && id === "overlap_area_percent") || AGGREGATE_METRICS.find(({ id }) => !objectives.some((o) => o.metric === id));
              setObjectives([...objectives, { kind: "aggregate", metric: metric.id, operator: metric.operator, target: metric.target }]);
            }}>Add another target</button>}
          </section>

          <section className="optimization-form-section optimization-safety-section">
            <div className="optimization-form-heading"><div><h3>Allowed changes</h3><p>Choose what the optimizer may touch and keep adjustments inside safe limits.</p></div></div>
            <div className="optimization-choice-row">
              {CHANGE_FIELDS.map(([field, label]) => <label key={field}><input type="checkbox" checked={changeFields.includes(field)} onChange={() => setChangeFields((current) => current.includes(field) ? current.filter((item) => item !== field) : [...current, field])} />{label}</label>)}
              <label><input type="checkbox" checked={preventPowerIncrease} onChange={(event) => setPreventPowerIncrease(event.target.checked)} />Do not increase total power</label>
            </div>
            <div className="optimization-parameter-grid">
              <NumberWithUnit label="Maximum tilt change" unit="deg" value={maxTiltChange} min="0.1" max="20" onChange={setMaxTiltChange} />
              <NumberWithUnit label="Maximum power change" unit="dBm" value={maxPowerChange} min="0.1" max="20" onChange={setMaxPowerChange} />
              <NumberWithUnit label="Maximum azimuth change" unit="deg" value={maxAzimuthChange} min="1" max="180" onChange={setMaxAzimuthChange} />
              <NumberWithUnit label="Maximum antennas changed" unit="sites" value={maxChangedAntennas} min="1" max={String(baseRequest?.antennas?.length || 1)} step="1" onChange={setMaxChangedAntennas} />
            </div>
            <div className="optimization-antenna-scope"><span>Antennas allowed to change</span><div>{baseRequest?.antennas?.map((antenna) => <label key={antenna.id}><input type="checkbox" checked={eligibleAntennaIds.includes(antenna.id)} onChange={() => setEligibleAntennaIds((current) => current.includes(antenna.id) ? current.filter((id) => id !== antenna.id) : [...current, antenna.id])} />{antenna.id}</label>)}</div></div>
          </section>

          <section className="optimization-form-section">
            <div className="optimization-form-heading"><div><h3>Protect existing performance</h3><p>Optional guardrails reject setups that regress too far from the starting result.</p></div><span>{guardrails.length} of 4 configured</span></div>
            <div className="optimization-guardrail-list">{guardrails.map((guardrail, index) => {
              const spec = GUARDRAIL_METRICS.find(([metric]) => metric === guardrail.metric) || GUARDRAIL_METRICS[0];
              return <div className="optimization-guardrail-row" key={guardrail.metric}>
                <label><span>Protected KPI</span><select value={guardrail.metric} onChange={(event) => setGuardrails((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, metric: event.target.value } : item))}>{GUARDRAIL_METRICS.map(([metric, label]) => <option key={metric} value={metric} disabled={guardrails.some((item, itemIndex) => itemIndex !== index && item.metric === metric)}>{label}</option>)}</select></label>
                <NumberWithUnit label="Maximum regression" unit={spec[2]} value={guardrail.max_regression} min="0" onChange={(value) => setGuardrails((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, max_regression: value } : item))} />
                <button type="button" className="ghost-button optimization-remove-target" onClick={() => setGuardrails((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
              </div>;
            })}</div>
            {guardrails.length < 4 && <button type="button" className="ghost-button optimization-add-target" onClick={() => { const metric = GUARDRAIL_METRICS.find(([id]) => !guardrails.some((item) => item.metric === id)); setGuardrails([...guardrails, { metric: metric[0], max_regression: 0 }]); }}>Add guardrail</button>}
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
          {disabledReason && <p className="optimization-disabled-reason" role="status">{disabledReason}</p>}
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
        <h2>Recommended setup</h2>
        <p>{optimizationResultSummary(optimization)}</p>
        <p>{optimization.recommendation_reason || "This setup ranked highest against the configured targets."}</p>
        {Number.isFinite(Number(optimization.global_tested)) && <p>Global exploration: {formatInteger(optimization.global_tested)} setups. Local refinement: {formatInteger(optimization.local_tested)} setups.</p>}
        <table className="optimization-results-table optimization-candidate-table"><thead><tr><th>Use</th><th>Option</th><th>Goals met</th><th>Guardrails</th><th>Antennas changed</th><th>Adjustments</th></tr></thead>
          <tbody>{candidateOptions.map((candidate, index) => {
            const evaluations = candidate.evaluation?.evaluations || [];
            return <tr key={candidate.id} className={candidate.id === selectedCandidate?.id ? "selected" : ""}>
              <td><input type="radio" name="optimization-candidate" aria-label={`Select ${index === 0 ? "recommended setup" : `alternative ${index}`}`} checked={candidate.id === selectedCandidate?.id} onChange={() => { setSelectedCandidateId(candidate.id); setApplied(false); }} /></td>
              <td>{index === 0 ? "Recommended" : `Alternative ${index}`}</td>
              <td>{evaluations.filter((item) => item.passed).length} / {evaluations.length}</td>
              <td>{candidate.evaluation?.guardrails?.length ? (candidate.evaluation.guardrails_passed ? "Passed" : "Violated") : "None"}</td>
              <td>{candidate.change_cost?.changed_antennas ?? new Set((candidate.changes || []).map((change) => change.antenna_id)).size}</td>
              <td>{candidate.changes?.length || 0}</td>
            </tr>;
          })}</tbody>
        </table>
        {selectedCandidate.evaluation?.guardrails?.length > 0 && <ul className="optimization-guardrail-results">{selectedCandidate.evaluation.guardrails.map((guardrail) => <li key={guardrail.metric} className={guardrail.passed ? "passed" : "violated"}>{guardrailLabel(guardrail.metric)}: {guardrail.passed ? "passed" : `regressed ${formatMetric(guardrail.regression)} (maximum ${formatMetric(guardrail.max_regression)})`}</li>)}</ul>}
        <h3>Selected setup details</h3>
        <table className="optimization-results-table"><thead><tr><th>Metric</th><th>Before</th><th>After</th><th>Target</th></tr></thead>
          <tbody>{optimization.objectives.map((objective, index) => {
            const before = optimization.baseline.evaluation.evaluations[index];
            const after = selectedCandidate.evaluation.evaluations[index];
            return <tr key={objectiveKey(objective)}><td>{objectiveLabel(objective)}</td><td>{formatObjectiveActual(before, objective)}</td><td>{formatObjectiveActual(after, objective)}</td><td>{objectiveTarget(objective)}</td></tr>;
          })}</tbody>
        </table>
        <p>Covered cells: {formatInteger(optimization.baseline.evaluation.kpis.covered_cells)} → {formatInteger(selectedCandidate.evaluation.kpis.covered_cells)} of {formatInteger(selectedCandidate.evaluation.kpis.total_cells)}.</p>
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
        <p>Setups are ranked by target results first, then by fewer changed antennas and smaller adjustments.</p>
        {selectedCandidate.changes.length ? <ul>{selectedCandidate.changes.map((change) => <li key={`${change.antenna_id}-${change.field || "tilt"}`}>{change.antenna_id} {formatField(change.field)}: {formatMetric(change.from)} → {formatMetric(change.to)}</li>)}</ul> : <p>This option keeps the starting antenna settings.</p>}
        {optimization.trials.some((trial) => trial.error) && <p className="error-text">Some setups failed: {optimization.trials.filter((trial) => trial.error).map((trial) => `${trial.label}: ${trial.error}`).join("; ")}</p>}
        {stale && !applied && <p className="error-text">Your antenna settings changed. Run optimization again before applying.</p>}
        <div className="panel-actions">
          <button className="primary-button" disabled={busy || stale || applied || !selectedCandidate.changes.length} onClick={() => { onApply(selectedCandidate.settings || selectedCandidate.tilts); setApplied(true); }}>{applied ? "Settings applied" : "Apply selected settings"}</button>
          {jobId && <button className="ghost-button" disabled={saved || saving || busy} onClick={save}>{saved ? "Saved to history" : saving ? "Saving..." : "Save recommendation to history"}</button>}
        </div>
      </section>}
    </main>
  );
}

function ObjectiveFields({ objective, index, update }) {
  if (objective.kind === "threshold_area") {
    const measurement = measurementSpec(objective.measurement);
    return <div className="optimization-objective-fields threshold-area-fields">
      <MeasurementField objective={objective} index={index} update={update} />
      <label>
        <span>Cell condition</span>
        <select value={objective.threshold_operator} onChange={(e) => update(index, "threshold_operator", e.target.value)}>
          {THRESHOLD_OPERATORS.map((operator) => <option key={operator}>{operator}</option>)}
        </select>
      </label>
      <NumberWithUnit label="RF threshold" unit={measurement.unit} value={objective.threshold} onChange={(value) => update(index, "threshold", value)} />
      <label>
        <span>Required area</span>
        <select value={objective.operator} onChange={(e) => update(index, "operator", e.target.value)}>
          {OPERATORS.map((operator) => <option key={operator}>{operator}</option>)}
        </select>
      </label>
      <NumberWithUnit label="Area target" unit="%" value={objective.target} min="0" max="100" onChange={(value) => update(index, "target", value)} />
    </div>;
  }

  if (objective.kind === "percentile") {
    const measurement = measurementSpec(objective.measurement);
    return <div className="optimization-objective-fields percentile-fields">
      <MeasurementField objective={objective} index={index} update={update} />
      <NumberWithUnit label="Percentile" unit="P" value={objective.percentile} min="1" max="99" step="1" onChange={(value) => update(index, "percentile", value)} />
      <label>
        <span>Condition</span>
        <select value={objective.operator} onChange={(e) => update(index, "operator", e.target.value)}>
          {OPERATORS.map((operator) => <option key={operator}>{operator}</option>)}
        </select>
      </label>
      <NumberWithUnit label="Target" unit={measurement.unit} value={objective.target} min={objective.measurement === "throughput_mbps" ? "0" : undefined} onChange={(value) => update(index, "target", value)} />
    </div>;
  }

  const metric = aggregateMetric(objective.metric);
  return <div className="optimization-objective-fields aggregate-fields">
    <label>
      <span>Metric</span>
      <select value={objective.metric} onChange={(e) => update(index, "metric", e.target.value)}>
        {AGGREGATE_METRICS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
      </select>
    </label>
    <label>
      <span>Condition</span>
      <select value={objective.operator} onChange={(e) => update(index, "operator", e.target.value)}>
        {OPERATORS.map((operator) => <option key={operator}>{operator}</option>)}
      </select>
    </label>
    <NumberWithUnit label="Target" unit={metric.unit} value={objective.target} min="0" max={objective.metric === "average_overlap_count" ? "10" : "100"} onChange={(value) => update(index, "target", value)} />
  </div>;
}

function MeasurementField({ objective, index, update }) {
  return <label>
    <span>Measurement</span>
    <select value={objective.measurement} onChange={(e) => update(index, "measurement", e.target.value)}>
      {RF_MEASUREMENTS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
    </select>
  </label>;
}

function NumberWithUnit({ label, unit, value, onChange, min, max, step = "any" }) {
  return <label>
    <span>{label}</span>
    <span className="optimization-input-unit">
      <input type="number" required min={min} max={max} step={step} value={value} onChange={(event) => onChange(event.target.value)} />
      <small>{unit}</small>
    </span>
  </label>;
}

function defaultObjective(kind) {
  if (kind === "threshold_area") return { kind, measurement: "rsrp_dbm", threshold_operator: ">=", threshold: -110, operator: ">=", target: 95 };
  if (kind === "percentile") return { kind, measurement: "sinr_db", percentile: 10, operator: ">=", target: 5 };
  return { kind: "aggregate", metric: "uncovered_area_percent", operator: "<=", target: 2 };
}

function normalizeObjective(objective) {
  return { ...objective, kind: objective.kind || "aggregate" };
}

function serializeObjective(objective) {
  if (objective.kind === "threshold_area") return {
    kind: objective.kind,
    measurement: objective.measurement,
    threshold_operator: objective.threshold_operator,
    threshold: Number(objective.threshold),
    operator: objective.operator,
    target: Number(objective.target),
  };
  if (objective.kind === "percentile") return {
    kind: objective.kind,
    measurement: objective.measurement,
    percentile: Number(objective.percentile),
    operator: objective.operator,
    target: Number(objective.target),
  };
  return { metric: objective.metric, operator: objective.operator, target: Number(objective.target) };
}

function objectiveIsValid(objective) {
  if (!Number.isFinite(Number(objective.target))) return false;
  if (objective.kind === "threshold_area") return Boolean(objective.measurement && objective.threshold_operator) && Number.isFinite(Number(objective.threshold));
  if (objective.kind === "percentile") return Boolean(objective.measurement) && Number(objective.percentile) >= 1 && Number(objective.percentile) <= 99;
  return Boolean(objective.metric);
}

function objectiveKey(objective) {
  if ((objective.kind || "aggregate") === "threshold_area") return `threshold-${objective.measurement}-${objective.threshold_operator}-${objective.threshold}`;
  if (objective.kind === "percentile") return `percentile-${objective.measurement}-${objective.percentile}`;
  return `aggregate-${objective.metric}`;
}

function measurementSpec(id) {
  return RF_MEASUREMENTS.find((measurement) => measurement.id === id) || RF_MEASUREMENTS[0];
}

function aggregateMetric(id) {
  return AGGREGATE_METRICS.find((metric) => metric.id === id) || AGGREGATE_METRICS[0];
}

function objectiveLabel(objective) {
  const kind = objective.kind || "aggregate";
  if (kind === "threshold_area") {
    const measurement = measurementSpec(objective.measurement);
    return `Area with ${measurement.label} ${objective.threshold_operator} ${formatMetric(objective.threshold, measurement.unit)}`;
  }
  if (kind === "percentile") return `P${objective.percentile} ${measurementSpec(objective.measurement).label}`;
  return aggregateMetric(objective.metric).label;
}

function objectiveTarget(objective) {
  const unit = (objective.kind || "aggregate") === "threshold_area"
    ? "%"
    : objective.kind === "percentile"
      ? measurementSpec(objective.measurement).unit
      : aggregateMetric(objective.metric).unit;
  return `${objective.operator} ${formatMetric(objective.target, unit)}`;
}

function formatObjectiveActual(evaluation, objective) {
  const unit = (objective.kind || "aggregate") === "threshold_area"
    ? "%"
    : objective.kind === "percentile"
      ? measurementSpec(objective.measurement).unit
      : aggregateMetric(objective.metric).unit;
  return formatMetric(evaluation?.actual, unit);
}

function optimizationDisabledReason({ busy, saving, baseRequest, objectiveValid, changeFields, eligibleAntennaIds }) {
  if (busy) return "An optimization run is already in progress.";
  if (saving) return "Wait for the current result to finish saving.";
  if (!baseRequest?.antennas?.length) return "Select at least one active antenna on Network Coverage.";
  if (baseRequest.antennas.length > 10) return "Network Coverage optimization supports at most 10 active antennas.";
  if (!objectiveValid) return "Complete every target and remove duplicate targets.";
  if (!changeFields.length) return "Allow at least one setting: tilt, power, or azimuth.";
  if (!eligibleAntennaIds.length) return "Allow at least one antenna to change.";
  return "";
}

function guardrailLabel(metric) {
  return GUARDRAIL_METRICS.find(([id]) => id === metric)?.[1] || metric;
}

function formatMetric(value, unit = "", decimals = 2) {
  if (value === null || value === undefined || value === "") return "--";
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

export {
    normalizeObjective,
    objectiveLabel,
    objectiveTarget,
    optimizationDisabledReason,
    serializeObjective,
};
