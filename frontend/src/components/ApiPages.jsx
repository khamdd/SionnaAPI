import { useCallback, useEffect, useState } from "react";
import {
  runCoverageMap,
  runRsrpSimulation,
  runSinr,
  runThroughputComparison,
} from "../api";
import {
  DEFAULT_CAMERA,
  DEFAULT_RSRP_RANDOM_SEED,
  DEFAULT_RSRP_USER_COUNT,
  DEFAULT_SOLVER,
  DEFAULT_USER_HEIGHT_M,
  EMPTY_ARRAY,
  MAX_RSRP_USER_COUNT,
  TRANSMITTER_PATTERN,
} from "../constants";
import {
  formatMaybeNumber,
  formatPositionValue,
  formatText,
} from "../utils/format";
import {
  solverBounds,
  solverForScene,
  validatePositionInsideSolver,
} from "../utils/scene";
import Scene3DPreview, { hasCachedSceneModel } from "./Scene3DPreview";

export function CoverageApiPage({ activeScene, onProgressChange, onSceneLoadingChange }) {
  const [form, setForm] = useState(() => ({
    tilt: 8,
    transmitter_position: [-45, -40, 30],
    tx_power: 30,
    solver: DEFAULT_SOLVER,
    camera: DEFAULT_CAMERA,
  }));
  const [resultState, setResultState] = useApiResult(
    onProgressChange,
    "Running Coverage API...",
  );
  const sceneStatus = useScenePreviewStatus(activeScene, onSceneLoadingChange);
  const sceneSolver = solverForScene(activeScene, form.solver);
  const positionValidation = validateScenePositions(sceneSolver, [
    {
      key: "transmitter_position",
      label: "Transmitter position",
      value: form.transmitter_position,
    },
  ]);

  async function submit(event) {
    event.preventDefault();
    if (resultState.loading || !sceneStatus.isSceneReady || !positionValidation.isValid) {
      return;
    }

    const payload = {
      ...form,
      solver: sceneSolver,
      transmitter_pattern: TRANSMITTER_PATTERN,
    };
    await setResultState(async () => ({
      ...(await runCoverageMap(payload)),
      request: payload,
    }));
  }

  return (
    <ApiPageShell
      title="Coverage API"
      description="Render a single-transmitter coverage map for a selected transmitter position, tilt, and power."
      renderPreview={() => (
        <ApiScenePreview
          activeScene={activeScene}
          isSceneReady={sceneStatus.isSceneReady}
          onSceneLoadingChange={sceneStatus.handleSceneLoadingChange}
        />
      )}
      resultState={resultState}
      renderResult={(result) => (
        <CoverageResult
          activeScene={activeScene}
          onSceneLoadingChange={sceneStatus.handleSceneLoadingChange}
          result={result}
        />
      )}
    >
      <form className="api-form" onSubmit={submit}>
        <fieldset className="api-form-lock" disabled={resultState.loading || !sceneStatus.isSceneReady}>
          <FormSection title="Transmitter">
            <NumberField label="Tilt" unit="deg" value={form.tilt} onChange={(value) => updateForm(setForm, "tilt", value)} />
            <NumberField label="Power" unit="dBm" value={form.tx_power} onChange={(value) => updateForm(setForm, "tx_power", value)} />
            <PositionField
              error={positionValidation.errors.transmitter_position}
              label="Position"
              solver={sceneSolver}
              value={form.transmitter_position}
              onChange={(value) => updateForm(setForm, "transmitter_position", value)}
            />
          </FormSection>
          <SolverFields solver={sceneSolver} onChange={(solver) => updateForm(setForm, "solver", solver)} />
          <button className="primary-button" type="submit" disabled={resultState.loading || !sceneStatus.isSceneReady || !positionValidation.isValid}>
            {runButtonLabel(resultState.loading, sceneStatus.isSceneReady, positionValidation.isValid, "Run coverage")}
          </button>
        </fieldset>
      </form>
    </ApiPageShell>
  );
}

export function SinrApiPage({ activeScene, onProgressChange, onSceneLoadingChange }) {
  const [form, setForm] = useState(() => ({
    tilt: 8,
    transmitter_position: [0, 0, 30],
    receiver_position: [40, 20, 1.5],
    interferer_position: [120, 100, 25],
    interferer_tilt: 12,
    tx_power: 30,
    solver: DEFAULT_SOLVER,
  }));
  const [resultState, setResultState] = useApiResult(
    onProgressChange,
    "Running SINR API...",
  );
  const sceneStatus = useScenePreviewStatus(activeScene, onSceneLoadingChange);
  const sceneSolver = solverForScene(activeScene, form.solver);
  const positionValidation = validateScenePositions(sceneSolver, [
    {
      key: "transmitter_position",
      label: "Transmitter position",
      value: form.transmitter_position,
    },
    {
      key: "receiver_position",
      label: "Receiver position",
      value: form.receiver_position,
    },
    {
      key: "interferer_position",
      label: "Interferer position",
      value: form.interferer_position,
    },
  ]);

  async function submit(event) {
    event.preventDefault();
    if (resultState.loading || !sceneStatus.isSceneReady || !positionValidation.isValid) {
      return;
    }

    const payload = {
      ...form,
      solver: sceneSolver,
      transmitter_pattern: TRANSMITTER_PATTERN,
    };
    await setResultState(async () => ({
      ...(await runSinr(payload)),
      request: payload,
    }));
  }

  return (
    <ApiPageShell
      title="SINR API"
      description="Evaluate signal quality at one receiver point with one serving transmitter and one interferer."
      renderPreview={() => (
        <ApiScenePreview
          activeScene={activeScene}
          isSceneReady={sceneStatus.isSceneReady}
          onSceneLoadingChange={sceneStatus.handleSceneLoadingChange}
        />
      )}
      resultState={resultState}
      renderResult={(result) => (
        <SinrResult
          activeScene={activeScene}
          onSceneLoadingChange={sceneStatus.handleSceneLoadingChange}
          result={result}
        />
      )}
    >
      <form className="api-form" onSubmit={submit}>
        <fieldset className="api-form-lock" disabled={resultState.loading || !sceneStatus.isSceneReady}>
          <FormSection title="Serving transmitter">
            <NumberField label="Tilt" unit="deg" value={form.tilt} onChange={(value) => updateForm(setForm, "tilt", value)} />
            <NumberField label="Power" unit="dBm" value={form.tx_power} onChange={(value) => updateForm(setForm, "tx_power", value)} />
            <PositionField
              error={positionValidation.errors.transmitter_position}
              label="Position"
              solver={sceneSolver}
              value={form.transmitter_position}
              onChange={(value) => updateForm(setForm, "transmitter_position", value)}
            />
          </FormSection>
          <FormSection title="Receiver and interferer">
            <PositionField
              error={positionValidation.errors.receiver_position}
              label="Receiver"
              solver={sceneSolver}
              value={form.receiver_position}
              onChange={(value) => updateForm(setForm, "receiver_position", value)}
            />
            <PositionField
              error={positionValidation.errors.interferer_position}
              label="Interferer"
              solver={sceneSolver}
              value={form.interferer_position}
              onChange={(value) => updateForm(setForm, "interferer_position", value)}
            />
            <NumberField label="Interferer tilt" unit="deg" value={form.interferer_tilt} onChange={(value) => updateForm(setForm, "interferer_tilt", value)} />
          </FormSection>
          <SolverFields solver={sceneSolver} onChange={(solver) => updateForm(setForm, "solver", solver)} />
          <button className="primary-button" type="submit" disabled={resultState.loading || !sceneStatus.isSceneReady || !positionValidation.isValid}>
            {runButtonLabel(resultState.loading, sceneStatus.isSceneReady, positionValidation.isValid, "Calculate SINR")}
          </button>
        </fieldset>
      </form>
    </ApiPageShell>
  );
}

export function RsrpSimulationPage({ activeScene, antennas, onProgressChange, onSceneLoadingChange }) {
  const [selectedUser, setSelectedUser] = useState(null);
  const [form, setForm] = useState(() => ({
    user_count: suggestUserCount(DEFAULT_SOLVER),
    user_height_m: DEFAULT_USER_HEIGHT_M,
    random_seed: DEFAULT_RSRP_RANDOM_SEED,
    solver: DEFAULT_SOLVER,
  }));
  const [resultState, setResultState] = useApiResult(
    onProgressChange,
    "Running RSRP simulation...",
  );
  const sceneStatus = useScenePreviewStatus(activeScene, onSceneLoadingChange);
  const sceneSolver = solverForScene(activeScene, form.solver);
  const positionValidation = validateScenePositions(sceneSolver, [
    {
      key: "transmitter_position",
      label: "Transmitter position",
      value: form.transmitter_position,
    },
    {
      key: "receiver_position",
      label: "Receiver position",
      value: form.receiver_position,
    },
    {
      key: "interferer_position",
      label: "Interferer position",
      value: form.interferer_position,
    },
  ]);

  async function submit(event) {
    event.preventDefault();
    if (resultState.loading || !sceneStatus.isSceneReady || !positionValidation.isValid) {
      return;
    }

    setSelectedUser(null);
    const payload = {
      antennas,
      transmitter_pattern: TRANSMITTER_PATTERN,
      ...form,
      solver: sceneSolver,
    };
    await setResultState(async () => ({
      ...(await runRsrpSimulation(payload)),
      request: payload,
    }));
  }

  const result = resultState.result;
  const solver = result?.solver || sceneSolver;
  const rsrpUsers = result?.users || EMPTY_ARRAY;

  return (
    <section className="api-page">
      <div className="page-title">
        <h1>RSRP Simulation</h1>
        <p>Generate user spots across the active scene and calculate the received reference-signal power from each antenna.</p>
      </div>
      <div className="api-layout rsrp-layout">
        <div className="api-panel">
          <form className="api-form" onSubmit={submit}>
            <fieldset className="api-form-lock" disabled={resultState.loading || !sceneStatus.isSceneReady}>
              <FormSection title="Users">
                <NumberField
                  label="User count"
                  value={form.user_count}
                  min={1}
                  max={MAX_RSRP_USER_COUNT}
                  step={1}
                  onChange={(value) => updateForm(setForm, "user_count", value)}
                />
                <NumberField
                  label="User height"
                  unit="m"
                  value={form.user_height_m}
                  min={0.5}
                  max={10}
                  onChange={(value) => updateForm(setForm, "user_height_m", value)}
                />
                <NumberField
                  label="Random seed"
                  value={form.random_seed}
                  min={0}
                  step={1}
                  onChange={(value) => updateForm(setForm, "random_seed", value)}
                />
                <p className="form-help">
                  Suggested count for this area: {suggestUserCount(sceneSolver)} users.
                </p>
              </FormSection>
              <SolverFields solver={sceneSolver} onChange={(solver) => updateForm(setForm, "solver", solver)} />
              <button className="primary-button" type="submit" disabled={resultState.loading || !sceneStatus.isSceneReady}>
                {resultState.loading ? "Running..." : sceneStatus.isSceneReady ? "Run RSRP simulation" : "Loading scene..."}
              </button>
            </fieldset>
          </form>
        </div>
        <div className="api-result-panel">
          <h2>Result</h2>
          {resultState.error && <p className="history-status error-text">{resultState.error}</p>}
          {!resultState.error && resultState.loading && <p className="history-status">Waiting for backend...</p>}
          <div className="result-summary">
            <div className="api-result-scene-wrap rsrp-scene-wrap">
              {activeScene?.bounds ? (
                <>
                  <Scene3DPreview
                    antennas={result ? result.antennas || antennas : EMPTY_ARRAY}
                    bounds={activeScene.bounds}
                    className="api-result-scene-3d"
                    onLoadingChange={sceneStatus.handleSceneLoadingChange}
                    onRsrpUserSelect={setSelectedUser}
                    rsrpUsers={rsrpUsers}
                    sceneName={activeScene.name}
                    selectedRsrpUser={selectedUser}
                    showOverlay={false}
                    solver={solver}
                    viewMode="top"
                  />
                  {selectedUser && (
                    <RsrpUserDialog
                      user={selectedUser}
                      onClose={() => setSelectedUser(null)}
                    />
                  )}
                </>
              ) : (
                <p className="history-status">No scene preview is available for this result.</p>
              )}
            </div>
            {!resultState.error && !resultState.loading && !result && (
              <p className="history-status">
                The active scene is ready. Run the simulation to generate and place user dots.
              </p>
            )}
            {!resultState.error && result && (
              <RsrpSummary result={result} />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export function ThroughputApiPage({ activeScene, onProgressChange, onSceneLoadingChange }) {
  const [form, setForm] = useState(() => ({
    base_tilt: 6,
    target_tilt: 12,
    transmitter_position: [0, 0, 30],
    receiver_position: [40, 20, 1.5],
    interferer_position: [120, 100, 25],
    interferer_tilt: 12,
    tx_power: 30,
    bandwidth_mhz: 100,
    mimo_layers: 4,
    solver: DEFAULT_SOLVER,
  }));
  const [resultState, setResultState] = useApiResult(
    onProgressChange,
    "Running Throughput API...",
  );
  const sceneStatus = useScenePreviewStatus(activeScene, onSceneLoadingChange);
  const sceneSolver = solverForScene(activeScene, form.solver);

  async function submit(event) {
    event.preventDefault();
    if (resultState.loading || !sceneStatus.isSceneReady) {
      return;
    }

    const payload = {
      ...form,
      solver: sceneSolver,
      transmitter_pattern: TRANSMITTER_PATTERN,
    };
    await setResultState(async () => ({
      ...(await runThroughputComparison(payload)),
      request: payload,
    }));
  }

  return (
    <ApiPageShell
      title="Throughput API"
      description="Compare estimated receiver throughput between two transmitter tilt settings."
      renderPreview={() => (
        <ApiScenePreview
          activeScene={activeScene}
          isSceneReady={sceneStatus.isSceneReady}
          onSceneLoadingChange={sceneStatus.handleSceneLoadingChange}
        />
      )}
      resultState={resultState}
      renderResult={(result) => (
        <ThroughputResult
          activeScene={activeScene}
          onSceneLoadingChange={sceneStatus.handleSceneLoadingChange}
          result={result}
        />
      )}
    >
      <form className="api-form" onSubmit={submit}>
        <fieldset className="api-form-lock" disabled={resultState.loading || !sceneStatus.isSceneReady}>
          <FormSection title="Tilt comparison">
            <NumberField label="Base tilt" unit="deg" value={form.base_tilt} onChange={(value) => updateForm(setForm, "base_tilt", value)} />
            <NumberField label="Target tilt" unit="deg" value={form.target_tilt} onChange={(value) => updateForm(setForm, "target_tilt", value)} />
            <NumberField label="Power" unit="dBm" value={form.tx_power} onChange={(value) => updateForm(setForm, "tx_power", value)} />
          </FormSection>
          <FormSection title="Radio link">
            <PositionField
              error={positionValidation.errors.transmitter_position}
              label="Transmitter"
              solver={sceneSolver}
              value={form.transmitter_position}
              onChange={(value) => updateForm(setForm, "transmitter_position", value)}
            />
            <PositionField
              error={positionValidation.errors.receiver_position}
              label="Receiver"
              solver={sceneSolver}
              value={form.receiver_position}
              onChange={(value) => updateForm(setForm, "receiver_position", value)}
            />
            <PositionField
              error={positionValidation.errors.interferer_position}
              label="Interferer"
              solver={sceneSolver}
              value={form.interferer_position}
              onChange={(value) => updateForm(setForm, "interferer_position", value)}
            />
            <NumberField label="Interferer tilt" unit="deg" value={form.interferer_tilt} onChange={(value) => updateForm(setForm, "interferer_tilt", value)} />
          </FormSection>
          <FormSection title="Throughput assumptions">
            <NumberField label="Bandwidth" unit="MHz" value={form.bandwidth_mhz} min={1} onChange={(value) => updateForm(setForm, "bandwidth_mhz", value)} />
            <NumberField label="MIMO layers" value={form.mimo_layers} min={1} step={1} onChange={(value) => updateForm(setForm, "mimo_layers", value)} />
          </FormSection>
          <SolverFields solver={sceneSolver} onChange={(solver) => updateForm(setForm, "solver", solver)} />
          <button className="primary-button" type="submit" disabled={resultState.loading || !sceneStatus.isSceneReady || !positionValidation.isValid}>
            {runButtonLabel(resultState.loading, sceneStatus.isSceneReady, positionValidation.isValid, "Compare throughput")}
          </button>
        </fieldset>
      </form>
    </ApiPageShell>
  );
}

function RsrpSummary({ result }) {
  const summary = result.summary || {};
  const qualityCounts = summary.quality_counts || {};

  return (
    <>
      <h3>Overall user coverage</h3>
      <dl className="detail-grid">
        <dt>Status</dt><dd>{formatText(result.status)}</dd>
        <dt>Users</dt><dd>{summary.user_count || result.user_count || "--"}</dd>
        <dt>Covered users</dt><dd>{summary.covered_user_count ?? "--"}</dd>
        <dt>Coverage</dt><dd>{formatMaybeNumber(summary.coverage_percent)}%</dd>
        <dt>Average best RSRP</dt><dd>{formatMaybeNumber(summary.average_best_rsrp_dbm)} dBm</dd>
        <dt>Overlap users</dt><dd>{formatMaybeNumber(summary.overlap_summary?.overlap_percent)}%</dd>
        <dt>Avg overlap</dt><dd>{formatMaybeNumber(summary.overlap_summary?.average_overlap_count)}</dd>
        <dt>Seed</dt><dd>{result.random_seed}</dd>
      </dl>
      <div className="rsrp-quality-strip">
        {["excellent", "good", "fair", "poor", "no_coverage"].map((quality) => (
          <div key={quality} className={`rsrp-quality ${quality}`}>
            <span>{qualityLabel(quality)}</span>
            <strong>{qualityCounts[quality] || 0}</strong>
          </div>
        ))}
      </div>
      <h3>Antenna average RSRP</h3>
      <table className="rsrp-table">
        <thead>
          <tr>
            <th>Antenna</th>
            <th>Avg all users</th>
            <th>Avg serving users</th>
            <th>Served</th>
            <th>Measured</th>
          </tr>
        </thead>
        <tbody>
          {(result.antenna_summary || []).map((item) => (
            <tr key={item.antenna}>
              <td>{item.antenna}</td>
              <td>{formatMaybeNumber(item.average_rsrp_dbm)} dBm</td>
              <td>{formatMaybeNumber(item.average_serving_rsrp_dbm)} dBm</td>
              <td>{item.served_user_count}</td>
              <td>{item.measured_user_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function RsrpUserDialog({ onClose, user }) {
  return (
    <div className="coverage-cell-dialog rsrp-user-dialog" role="dialog" aria-label="RSRP user detail">
      <button
        className="coverage-cell-close"
        type="button"
        aria-label="Close user detail"
        onClick={onClose}
      >
        x
      </button>
      <strong>{user.id} - {qualityLabel(user.quality)}</strong>
      <dl>
        <dt>Position</dt><dd>{formatPositionValue(user.position)}</dd>
        <dt>Serving antenna</dt><dd>{formatText(user.serving_antenna)}</dd>
        <dt>Best RSRP</dt><dd>{formatMaybeNumber(user.rsrp_dbm)} dBm</dd>
        <dt>Overlap</dt><dd>{formatOverlap(user)}</dd>
        <dt>Grid cell</dt><dd>{user.grid ? `${user.grid.row}, ${user.grid.col}` : "--"}</dd>
      </dl>
      <OverlapAntennaList antennas={user.overlap_antennas} valueField="rsrp_dbm" />
      <div className="neighbor-list">
        <span>Neighbors</span>
        {user.neighbors?.length ? user.neighbors.map((neighbor) => (
          <div key={neighbor.antenna}>
            <strong>{neighbor.antenna}</strong>
            <span>{formatMaybeNumber(neighbor.rsrp_dbm)} dBm</span>
            <small>{formatMaybeNumber(neighbor.weaker_than_serving_db)} dB weaker</small>
          </div>
        )) : (
          <p className="neighbor-empty">No close neighbor antenna for this user.</p>
        )}
      </div>
    </div>
  );
}

function qualityLabel(quality) {
  return String(quality || "unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

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

function ApiPageShell({ children, description, renderPreview, renderResult, resultState, title }) {
  return (
    <section className="api-page">
      <div className="page-title">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="api-layout">
        <div className="api-panel">
          {children}
        </div>
        <div className="api-result-panel">
          <h2>Result</h2>
          {resultState.error && <p className="history-status error-text">{resultState.error}</p>}
          {!resultState.error && resultState.loading && <p className="history-status">Waiting for backend...</p>}
          {!resultState.error && !resultState.result && renderPreview?.()}
          {!resultState.error && resultState.result && renderResult(resultState.result)}
        </div>
      </div>
    </section>
  );
}

function ApiScenePreview({ activeScene, isSceneReady, onSceneLoadingChange }) {
  return (
    <div className="result-summary">
      <div className="api-result-scene-wrap">
        {activeScene?.bounds ? (
          <Scene3DPreview
            bounds={activeScene.bounds}
            className="api-result-scene-3d"
            onLoadingChange={onSceneLoadingChange}
            sceneName={activeScene.name}
            showOverlay={false}
            solver={solverForScene(activeScene)}
            viewMode="top"
          />
        ) : (
          <p className="history-status">No 3D scene is available for the active scene.</p>
        )}
      </div>
      <p className="history-status">
        {isSceneReady
          ? "Scene is ready. Run the API to see the response summary here."
          : "Loading the 3D scene before simulation can run..."}
      </p>
    </div>
  );
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

function FormSection({ children, title }) {
  return (
    <fieldset className="form-section">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

function SolverFields({ solver, onChange }) {
  return (
    <FormSection title="Solver">
      <NumberField label="Max depth" value={solver.max_depth} min={0} max={10} step={1} onChange={(value) => updateObject(onChange, solver, "max_depth", value)} />
      <NumberField label="Samples per TX" value={solver.samples_per_tx} min={1} max={10000000} step={1} onChange={(value) => updateObject(onChange, solver, "samples_per_tx", value)} />
      <NumberField label="Cell size" unit="m" value={solver.cell_size} min={0.1} max={50} step="any" onChange={(value) => updateObject(onChange, solver, "cell_size", value)} />
    </FormSection>
  );
}

function NumberField({ label, max, min, onChange, step = "any", unit = "", value }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <div className="input-with-unit">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          required
          onChange={(event) => onChange(parseNumericInput(event.target.value))}
        />
        {unit && <small>{unit}</small>}
      </div>
    </label>
  );
}

function PositionField({ error = "", label, onChange, solver = null, value }) {
  const bounds = solverBounds(solver);

  return (
    <label className="form-field">
      <span>{label}</span>
      <div>
        <div className="vector-inputs">
          {["x", "y", "z"].map((axis, index) => (
            <input
              key={axis}
              type="number"
              aria-invalid={Boolean(error) && index < 2}
              aria-label={`${label} ${axis}`}
              value={value[index]}
              min={axis === "x" ? bounds?.xMin : axis === "y" ? bounds?.yMin : undefined}
              max={axis === "x" ? bounds?.xMax : axis === "y" ? bounds?.yMax : undefined}
              step="any"
              required
              onChange={(event) => onChange(replaceArrayValue(value, index, parseNumericInput(event.target.value)))}
            />
          ))}
        </div>
        {error && <small className="field-error">{error}</small>}
      </div>
    </label>
  );
}

function CoverageResult({ activeScene, onSceneLoadingChange, result }) {
  const request = result.request || {};
  const solver = result.solver || request.solver || {};

  return (
    <div className="result-summary">
      <ApiResultScene
        activeScene={activeScene}
        antennas={coverageResultAntennas(result, request)}
        fallbackImageUrl={result.coverage_map_image_url}
        coverageGrid={result.grid}
        onSceneLoadingChange={onSceneLoadingChange}
        result={result}
        solver={solver}
      />
      <h3>Transmitter</h3>
      <dl className="detail-grid">
        <dt>Position</dt><dd>{formatPositionValue(request.transmitter_position)}</dd>
        <dt>Tilt</dt><dd>{formatMaybeNumber(request.tilt)} deg</dd>
        <dt>Power</dt><dd>{formatMaybeNumber(request.tx_power)} dBm</dd>
        <dt>Pattern</dt><dd>{formatText(request.transmitter_pattern)}</dd>
      </dl>
      <h3>Coverage map</h3>
      <dl className="detail-grid">
        <dt>Status</dt><dd>{formatText(result.status)}</dd>
        <dt>Grid</dt><dd>{result.grid ? `${result.grid.rows} x ${result.grid.cols}` : "PNG preview only"}</dd>
        <dt>Layer source</dt><dd>{result.grid ? "Cell grid" : "Rendered image"}</dd>
        <dt>Cell size</dt><dd>{formatMaybeNumber(solver.cell_size)} m</dd>
        <dt>Center</dt><dd>{formatPositionValue(solver.center)}</dd>
        <dt>Size</dt><dd>{formatPositionValue(solver.size)}</dd>
      </dl>
    </div>
  );
}

function SinrResult({ activeScene, onSceneLoadingChange, result }) {
  const request = result.request || {};

  return (
    <div className="result-summary">
      <ApiResultScene
        activeScene={activeScene}
        antennas={linkResultAntennas(result, request)}
        result={result}
        onSceneLoadingChange={onSceneLoadingChange}
        sceneBadges={sinrSceneBadges(result)}
        signalLinks={radioLinkVisuals(request)}
        solver={result.solver || request.solver}
      />
      <h3>Serving transmitter</h3>
      <dl className="detail-grid">
        <dt>Position</dt><dd>{formatPositionValue(request.transmitter_position)}</dd>
        <dt>Tilt</dt><dd>{formatMaybeNumber(request.tilt)} deg</dd>
        <dt>Power</dt><dd>{formatMaybeNumber(request.tx_power)} dBm</dd>
      </dl>
      <h3>Receiver result</h3>
      <dl className="detail-grid">
        <dt>Status</dt><dd>{formatText(result.status)}</dd>
        <dt>Receiver</dt><dd>{formatPositionValue(result.receiver_position || request.receiver_position)}</dd>
        <dt>SINR</dt><dd>{formatMaybeNumber(result.sinr_db)} dB</dd>
        <dt>Signal power</dt><dd>{formatMaybeNumber(result.signal_power)} dBm</dd>
        <dt>Noise power</dt><dd>{formatMaybeNumber(result.noise_power)} dBm</dd>
      </dl>
      <h3>Interferer</h3>
      <dl className="detail-grid">
        <dt>Position</dt><dd>{formatPositionValue(request.interferer_position)}</dd>
        <dt>Tilt</dt><dd>{formatMaybeNumber(request.interferer_tilt)} deg</dd>
      </dl>
    </div>
  );
}

function ThroughputResult({ activeScene, onSceneLoadingChange, result }) {
  const request = result.request || {};
  const comparison = result.comparison || {};

  return (
    <div className="result-summary">
      <ApiResultScene
        activeScene={activeScene}
        antennas={linkResultAntennas(result, request)}
        result={result}
        onSceneLoadingChange={onSceneLoadingChange}
        sceneBadges={throughputSceneBadges(result)}
        signalLinks={radioLinkVisuals(request)}
        solver={result.solver || request.solver}
      />
      <h3>Radio link</h3>
      <dl className="detail-grid">
        <dt>Transmitter</dt><dd>{formatPositionValue(request.transmitter_position)}</dd>
        <dt>Receiver</dt><dd>{formatPositionValue(result.receiver_position || request.receiver_position)}</dd>
        <dt>Interferer</dt><dd>{formatPositionValue(request.interferer_position)}</dd>
        <dt>Power</dt><dd>{formatMaybeNumber(request.tx_power)} dBm</dd>
        <dt>Bandwidth</dt><dd>{formatMaybeNumber(request.bandwidth_mhz)} MHz</dd>
        <dt>MIMO layers</dt><dd>{request.mimo_layers || "--"}</dd>
      </dl>
      <h3>Throughput comparison</h3>
      <dl className="detail-grid">
        <dt>Status</dt><dd>{formatText(result.status)}</dd>
        <dt>Base tilt</dt><dd>{formatMaybeNumber(comparison.base_tilt_deg)} deg</dd>
        <dt>Target tilt</dt><dd>{formatMaybeNumber(comparison.target_tilt_deg)} deg</dd>
        <dt>Base throughput</dt><dd>{formatMaybeNumber(comparison.base_throughput_mbps)} Mbps</dd>
        <dt>Target throughput</dt><dd>{formatMaybeNumber(comparison.target_throughput_mbps)} Mbps</dd>
        <dt>Delta</dt><dd>{formatMaybeNumber(comparison.delta_mbps)} Mbps</dd>
        <dt>Change</dt><dd>{formatMaybeNumber(comparison.percentage_change)}%</dd>
        <dt>Direction</dt><dd>{formatText(comparison.direction)}</dd>
      </dl>
    </div>
  );
}

function ApiResultScene({
  activeScene,
  antennas = EMPTY_ARRAY,
  coverageGrid = null,
  fallbackImageUrl = "",
  onSceneLoadingChange = null,
  result,
  sceneBadges = EMPTY_ARRAY,
  signalLinks = EMPTY_ARRAY,
  solver = null,
}) {
  const [selectedCell, setSelectedCell] = useState(null);

  if (activeScene?.bounds) {
    return (
      <div className="api-result-scene-wrap">
        <Scene3DPreview
          antennas={antennas}
          bounds={activeScene.bounds}
          className="api-result-scene-3d"
          coverageGrid={coverageGrid}
          coverageImageUrl={coverageGrid ? "" : fallbackImageUrl}
          onLoadingChange={onSceneLoadingChange}
          onCoverageCellSelect={setSelectedCell}
          sceneName={activeScene.name}
          selectedCoverageCell={selectedCell}
          showOverlay={false}
          signalLinks={signalLinks}
          solver={solver}
          viewMode="top"
        />
        {sceneBadges.length > 0 && (
          <div className="api-result-scene-badges">
            {sceneBadges.map((badge) => (
              <div key={badge.label}>
                <span>{badge.label}</span>
                <strong>{badge.value}</strong>
              </div>
            ))}
          </div>
        )}
        {selectedCell && (
          <ApiCoverageCellDialog
            cell={selectedCell}
            onClose={() => setSelectedCell(null)}
          />
        )}
      </div>
    );
  }

  if (fallbackImageUrl) {
    return <img src={fallbackImageUrl} alt="API result preview" />;
  }

  return <p className="history-status">No scene preview is available for this result.</p>;
}

function radioLinkVisuals(request) {
  const links = [];

  if (
    Array.isArray(request.transmitter_position)
    && Array.isArray(request.receiver_position)
  ) {
    links.push({
      from: request.transmitter_position,
      label: "Serving",
      to: request.receiver_position,
      type: "serving",
    });
  }

  if (
    Array.isArray(request.interferer_position)
    && Array.isArray(request.receiver_position)
  ) {
    links.push({
      from: request.interferer_position,
      label: "Interference",
      to: request.receiver_position,
      type: "interference",
    });
  }

  return links;
}

function sinrSceneBadges(result) {
  return [
    {
      label: "SINR",
      value: `${formatMaybeNumber(result.sinr_db)} dB`,
    },
    {
      label: "Signal",
      value: `${formatMaybeNumber(result.signal_power)} dBm`,
    },
    {
      label: "Noise + interference",
      value: `${formatMaybeNumber(result.noise_power)} dBm`,
    },
  ];
}

function throughputSceneBadges(result) {
  const comparison = result.comparison || {};

  return [
    {
      label: "Target throughput",
      value: `${formatMaybeNumber(comparison.target_throughput_mbps)} Mbps`,
    },
    {
      label: "Delta",
      value: `${formatMaybeNumber(comparison.delta_mbps)} Mbps`,
    },
    {
      label: "Change",
      value: `${formatMaybeNumber(comparison.percentage_change)}%`,
    },
  ];
}

function coverageResultAntennas(result, request) {
  if (Array.isArray(result.antennas) && result.antennas.length > 0) {
    return result.antennas;
  }

  if (!Array.isArray(request.transmitter_position)) {
    return [];
  }

  return [
    {
      id: "TX",
      position: request.transmitter_position,
      azimuth: 0,
    },
  ];
}

function linkResultAntennas(result, request) {
  if (Array.isArray(result.antennas) && result.antennas.length > 0) {
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

function ApiCoverageCellDialog({ cell, onClose }) {
  return (
    <div className="coverage-cell-dialog" role="dialog" aria-label="Coverage cell detail">
      <button
        className="coverage-cell-close"
        type="button"
        aria-label="Close cell detail"
        onClick={onClose}
      >
        x
      </button>
      <strong>Cell ({formatMaybeNumber(cell.x)} m, {formatMaybeNumber(cell.y)} m)</strong>
      <dl>
        <dt>Serving</dt><dd>{formatText(cell.serving_antenna)}</dd>
        <dt>SINR</dt><dd>{formatMaybeNumber(cell.sinr_db)} dB</dd>
        <dt>Signal</dt><dd>{formatMaybeNumber(cell.signal_dbm)} dBm</dd>
        <dt>Throughput</dt><dd>{formatMaybeNumber(cell.throughput_mbps)} Mbps</dd>
        <dt>Overlap</dt><dd>{formatOverlap(cell)}</dd>
      </dl>
      <OverlapAntennaList antennas={cell.overlap_antennas} valueField="signal_dbm" />
    </div>
  );
}

function OverlapAntennaList({ antennas, valueField }) {
  if (!Array.isArray(antennas) || antennas.length === 0) {
    return <p className="neighbor-empty">No overlap antennas</p>;
  }

  return (
    <div className="neighbor-list">
      <span>Overlap antennas</span>
      {antennas.map((antenna) => (
        <div key={`${antenna.role}-${antenna.antenna}`}>
          <strong>{formatText(antenna.antenna)} ({formatText(antenna.role)})</strong>
          <span>{formatMaybeNumber(antenna[valueField])} dBm</span>
          <small>{formatMaybeNumber(antenna.weaker_than_serving_db)} dB weaker</small>
        </div>
      ))}
    </div>
  );
}

function formatOverlap(item) {
  if (!Number.isFinite(Number(item.overlap_count))) {
    return "--";
  }

  return `${item.overlap_count} antenna(s), ${formatText(item.overlap_level)}`;
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

function useApiResult(onProgressChange, progressLabel) {
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

      if (result.status && result.status !== "success") {
        throw new Error(result.error || "API returned failure.");
      }

      setState({
        error: "",
        loading: false,
        result,
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

function updateObject(onChange, current, field, value) {
  onChange({
    ...current,
    [field]: value,
  });
}

function replaceArrayValue(values, index, value) {
  return values.map((item, itemIndex) => (
    itemIndex === index ? value : item
  ));
}

function parseNumericInput(value) {
  return value === "" ? "" : Number(value);
}
