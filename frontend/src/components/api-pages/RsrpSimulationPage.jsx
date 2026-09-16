import { useMemo, useState } from "react";

import { runRsrpSimulation } from "../../api";
import {
  DEFAULT_RSRP_RANDOM_SEED,
  DEFAULT_SOLVER,
  DEFAULT_USER_HEIGHT_M,
  EMPTY_ARRAY,
  MAX_RSRP_USER_COUNT,
  RSRP_QUALITY_BANDS,
  TRANSMITTER_PATTERN,
} from "../../constants";
import { toValidatedAntennaRequest } from "../../utils/antennas";
import { solverForScene } from "../../utils/scene";
import Scene3DPreview from "../Scene3DPreview";
import SimulationAntennaPanel from "../SimulationAntennaPanel";
import {
  FormSection,
  NumberField,
  QueueNotice,
  RsrpSummary,
  RsrpUserDialog,
  SolverFields,
  suggestUserCount,
  updateForm,
  useApiResult,
  useScenePreviewStatus,
  validateSimulationAntennas,
} from "./ApiPagesShared";

export function RsrpSimulationPage({
  activeScene,
  antennaPool = EMPTY_ARRAY,
  antennas,
  maxAntennas = 10,
  onAddType2Antenna,
  onCreateAntenna,
  onProgressChange,
  onQueueOpen,
  onRemoveType2Antenna,
  onResetAntennas,
  onSceneLoadingChange,
  onSimulationQueued,
  onUpdateAntenna,
  simulationAntennas = antennas,
}) {
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
    onSimulationQueued,
    { sceneName: activeScene?.name },
  );
  const sceneStatus = useScenePreviewStatus(activeScene, onSceneLoadingChange);
  const sceneSolver = useMemo(
    () => solverForScene(activeScene, form.solver),
    [activeScene, form.solver],
  );

  async function submit(event) {
    event.preventDefault();
    if (resultState.loading || !sceneStatus.isSceneReady) {
      return;
    }

    setSelectedUser(null);
    const antennaError = validateSimulationAntennas(
      simulationAntennas,
      activeScene,
      maxAntennas,
      "RSRP Simulation",
    );

    if (antennaError) {
      await setResultState(async () => {
        throw new Error(antennaError);
      });
      return;
    }

    const payload = {
      antennas: simulationAntennas.map(toValidatedAntennaRequest),
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
  const isQueued = result?.status === "queued";
  const solver = useMemo(
    () => result?.solver || sceneSolver,
    [result, sceneSolver],
  );
  const rsrpUsers = result?.users || EMPTY_ARRAY;
  const displayAntennas = simulationAntennas;

  return (
    <main className="app-shell api-workspace-shell rsrp-page">
      <section className="map-panel api-workspace-result" aria-label="RSRP simulation result">
        <div className="topbar">
          <div>
            <h1>RSRP Simulation</h1>
            <p id="run-status">Generate user spots across the active scene and calculate received reference-signal power.</p>
          </div>
          <button
            className="primary-button"
            type="submit"
            form="rsrp-simulation-form"
            disabled={resultState.loading || !sceneStatus.isSceneReady}
          >
            {resultState.loading ? "Running..." : sceneStatus.isSceneReady ? "Run RSRP simulation" : "Loading scene..."}
          </button>
        </div>
        <div className="api-workspace-stage">
          {resultState.error && <p className="history-status error-text">{resultState.error}</p>}
          {!resultState.error && resultState.loading && <p className="history-status">Waiting for backend...</p>}
          {!resultState.error && !resultState.loading && isQueued && (
            <QueueNotice result={result} onQueueOpen={onQueueOpen} />
          )}
          <div className="result-summary">
            <div className="api-result-scene-wrap rsrp-scene-wrap">
              {activeScene?.bounds ? (
                <>
                  <Scene3DPreview
                    antennas={displayAntennas}
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
                    wardBoundary={activeScene.ward_boundary}
                  />
                  <RsrpMapLegend />
                  {selectedUser && !isQueued && (
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
            <form id="rsrp-simulation-form" className="api-form api-scene-setup-form" onSubmit={submit}>
              <fieldset className="api-form-lock" disabled={resultState.loading}>
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
              </fieldset>
            </form>
            {!resultState.error && !resultState.loading && isQueued && (
              <p className="history-status">
                User dots will appear after this queued job finishes. Open the completed result from Simulation Queue.
              </p>
            )}
            {!resultState.error && result && !isQueued && (
              <RsrpSummary result={result} />
            )}
          </div>
        </div>
      </section>
      <aside className="control-panel api-workspace-controls" aria-label="RSRP simulation controls">
        <div className="panel-header">
          <h2>RSRP controls</h2>
          <div className="panel-actions">
            <button
              className="ghost-button"
              type="button"
              disabled={resultState.loading}
              onClick={onResetAntennas}
            >
              Reset
            </button>
          </div>
        </div>
        <div className="api-workspace-form">
          <div className="api-form">
            <FormSection title="Antennas">
              <div className="embedded-antenna-panel">
                <SimulationAntennaPanel
                  activeScene={activeScene}
                  antennaPool={antennaPool}
                  antennas={antennas}
                  disabled={resultState.loading}
                  maxAntennas={maxAntennas}
                  onAdd={onAddType2Antenna}
                  onCreate={onCreateAntenna}
                  onChange={onUpdateAntenna}
                  onRemove={onRemoveType2Antenna}
                  showEnabledToggle
                  simulationLabel="RSRP Simulation"
                />
              </div>
            </FormSection>
          </div>
        </div>
      </aside>
    </main>
  );
}

function RsrpMapLegend() {
  return (
    <div className="rsrp-map-legend" aria-label="RSRP map color legend">
      <strong>RSRP signal strength</strong>
      <div>
        {RSRP_QUALITY_BANDS.map((band) => (
          <span key={band.key}>
            <i style={{ background: band.color }} />
            <b>{band.label}</b>
            <small>{band.range}</small>
          </span>
        ))}
      </div>
    </div>
  );
}
