import { useCallback, useEffect, useState } from "react";
import {
  runCoverageMap,
  runRsrpSimulation,
  runSinr,
  runThroughputComparison,
} from "../api";
import {
  DEFAULT_RSRP_RANDOM_SEED,
  DEFAULT_RSRP_USER_COUNT,
  DEFAULT_SOLVER,
  DEFAULT_USER_HEIGHT_M,
  EMPTY_ARRAY,
  MAX_RSRP_USER_COUNT,
  RSRP_QUALITY_BANDS,
  TRANSMITTER_PATTERN,
} from "../constants";
import {
  formatMaybeNumber,
  formatPositionValue,
  formatText,
} from "../utils/format";
import {
  lngLatInsideBounds,
  lngLatToScenePosition,
  solverBounds,
  solverForScene,
  validatePositionInsideSolver,
} from "../utils/scene";
import AntennaPanel from "./AntennaPanel";
import Scene3DPreview, { hasCachedSceneModel } from "./Scene3DPreview";

const COVERAGE_TYPE2_TRANSMITTER_ID = "__coverage_type2_transmitter__";
const SINR_ROLES = [
  { key: "transmitter", label: "Transmitter" },
  { key: "receiver", label: "Receiver" },
  { key: "interferer", label: "Interferer" },
];

export function CoverageApiPage({ activeScene, antennas = EMPTY_ARRAY, onProgressChange, onQueueOpen, onSceneLoadingChange, onSimulationQueued }) {
  const fixedAntennas = Array.isArray(antennas) ? antennas : EMPTY_ARRAY;
  const [form, setForm] = useState(() => ({
    tilt: 8,
    azimuth: 0,
    tx_power: 30,
    transmitter: {
      id: "TX",
      longitude: "",
      latitude: "",
      height_m: 30,
    },
    selected_antenna_id: "",
    solver: DEFAULT_SOLVER,
  }));
  const [resultState, setResultState] = useApiResult(
    onProgressChange,
    "Running Coverage API...",
    onSimulationQueued,
    { sceneName: activeScene?.name },
  );
  const sceneStatus = useScenePreviewStatus(activeScene, onSceneLoadingChange);
  const sceneSolver = solverForScene(activeScene, form.solver);
  const baseTransmitter = coverageTransmitter(form, fixedAntennas);
  const transmitter = {
    ...baseTransmitter,
    azimuth: form.azimuth,
  };
  const transmitterPosition = lngLatToScenePosition(
    transmitter,
    activeScene?.bounds,
  );
  const transmitterError = validateCoverageTransmitter(
    baseTransmitter,
    fixedAntennas,
    activeScene,
  );
  const azimuthError = validateCoverageAzimuth(form.azimuth);
  const positionValidation = transmitterError || azimuthError
    ? { errors: { transmitter_position: transmitterError }, isValid: false }
    : validateScenePositions(sceneSolver, [
      {
        key: "transmitter_position",
        label: "Transmitter position",
        value: transmitterPosition,
      },
    ]);
  const selectedTransmitterAntennas = transmitterPosition
    ? [{
      id: transmitter.id || "TX",
      position: transmitterPosition,
      longitude: transmitter.longitude,
      latitude: transmitter.latitude,
      height_m: transmitter.height_m,
      azimuth: transmitter.azimuth ?? 0,
    }]
    : EMPTY_ARRAY;

  useEffect(() => {
    setForm((current) => {
      if (
        fixedAntennas.length === 1
        && current.selected_antenna_id !== fixedAntennas[0].id
        && current.selected_antenna_id !== COVERAGE_TYPE2_TRANSMITTER_ID
      ) {
        const antenna = fixedAntennas[0];

        return {
          ...current,
          selected_antenna_id: antenna.id,
          azimuth: antenna.azimuth ?? current.azimuth,
          tilt: antenna.tilt?.current ?? current.tilt,
          tx_power: antenna.tx_power?.current ?? current.tx_power,
        };
      }

      if (
        fixedAntennas.length > 1
        && current.selected_antenna_id
        && current.selected_antenna_id !== COVERAGE_TYPE2_TRANSMITTER_ID
        && !fixedAntennas.some((antenna) => antenna.id === current.selected_antenna_id)
      ) {
        return {
          ...current,
          selected_antenna_id: "",
        };
      }

      if (fixedAntennas.length === 0 && current.selected_antenna_id) {
        return {
          ...current,
          selected_antenna_id: "",
        };
      }

      return current;
    });
  }, [activeScene?.id, fixedAntennas]);

  async function submit(event) {
    event.preventDefault();
    if (resultState.loading || !sceneStatus.isSceneReady || !positionValidation.isValid) {
      return;
    }

    const payload = {
      tilt: form.tilt,
      azimuth: form.azimuth,
      transmitter_position: transmitterPosition,
      tx_power: form.tx_power,
      solver: sceneSolver,
      transmitter_pattern: TRANSMITTER_PATTERN,
    };
    const displayPayload = {
      ...payload,
      transmitter,
    };
    await setResultState(async () => ({
      ...(await runCoverageMap(payload)),
      request: displayPayload,
    }));
  }

  return (
    <ApiPageShell
      layout="workspace"
      workspaceAction={(
        <button
          className="primary-button"
          type="submit"
          form="coverage-api-form"
          disabled={resultState.loading || !sceneStatus.isSceneReady || !positionValidation.isValid}
        >
          {runButtonLabel(resultState.loading, sceneStatus.isSceneReady, positionValidation.isValid, "Run coverage")}
        </button>
      )}
      title="Coverage API"
      description="Render a single-transmitter coverage map for a selected transmitter position, tilt, and power."
      renderPreview={() => (
        <ApiScenePreview
          activeScene={activeScene}
          antennas={selectedTransmitterAntennas}
          isSceneReady={sceneStatus.isSceneReady}
          onSceneLoadingChange={sceneStatus.handleSceneLoadingChange}
        />
      )}
      onQueueOpen={onQueueOpen}
      resultState={resultState}
      renderResult={(result) => (
        <CoverageResult
          activeScene={activeScene}
          onSceneLoadingChange={sceneStatus.handleSceneLoadingChange}
          result={result}
        />
      )}
    >
      <form id="coverage-api-form" className="api-form" onSubmit={submit}>
        <fieldset className="api-form-lock" disabled={resultState.loading}>
          <FormSection title="Transmitter">
            <CoverageTransmitterFields
              activeScene={activeScene}
              antennas={fixedAntennas}
              error={positionValidation.errors.transmitter_position}
              form={form}
              onChange={setForm}
            />
            <NumberField
              hint="0 to 360 degrees."
              label="Azimuth"
              max={360}
              min={0}
              unit="deg"
              value={form.azimuth}
              onChange={(value) => updateForm(setForm, "azimuth", value)}
            />
            {azimuthError && <small className="field-error">{azimuthError}</small>}
            <NumberField
              hint={rangeHint(transmitter.tilt, "degrees")}
              label="Tilt"
              max={transmitter.tilt?.max}
              min={transmitter.tilt?.min}
              unit="deg"
              value={form.tilt}
              onChange={(value) => updateForm(setForm, "tilt", value)}
            />
            <NumberField
              hint={rangeHint(transmitter.tx_power, "dBm")}
              label="Power"
              max={transmitter.tx_power?.max}
              min={transmitter.tx_power?.min}
              unit="dBm"
              value={form.tx_power}
              onChange={(value) => updateForm(setForm, "tx_power", value)}
            />
          </FormSection>
          <SolverFields solver={sceneSolver} onChange={(solver) => updateForm(setForm, "solver", solver)} />
        </fieldset>
      </form>
    </ApiPageShell>
  );
}

export function SinrApiPage({
  activeScene,
  antennas = EMPTY_ARRAY,
  onAddType2Antenna,
  onProgressChange,
  onQueueOpen,
  onRemoveType2Antenna,
  onResetAntennas,
  onRoleSelectionChange,
  onSceneLoadingChange,
  onSimulationQueued,
  onUpdateAntenna,
  roleSelection = {},
}) {
  const [form, setForm] = useState(() => ({
    propagation_model: "sionna",
    carrier_frequency_ghz: 3.5,
    bandwidth_mhz: 100,
    noise_figure_db: 7,
    solver: DEFAULT_SOLVER,
  }));
  const [resultState, setResultState] = useApiResult(
    onProgressChange,
    "Running SINR API...",
    onSimulationQueued,
    { sceneName: activeScene?.name },
  );
  const sceneStatus = useScenePreviewStatus(activeScene, onSceneLoadingChange);
  const sceneSolver = solverForScene(activeScene, form.solver);
  const selectedRoles = sinrSelectedRoleAntennas(antennas, roleSelection);
  const rolePositions = sinrRolePositions(selectedRoles, activeScene?.bounds);
  const roleValidation = validateSinrRoles(
    antennas,
    roleSelection,
    selectedRoles,
    rolePositions,
    activeScene,
  );
  const positionValidation = roleValidation
    ? { errors: {}, isValid: false }
    : validateScenePositions(sceneSolver, [
      {
        key: "transmitter_position",
        label: "Transmitter position",
        value: rolePositions.transmitter_position,
      },
      {
        key: "receiver_position",
        label: "Receiver position",
        value: rolePositions.receiver_position,
      },
      {
        key: "interferer_position",
        label: "Interferer position",
        value: rolePositions.interferer_position,
      },
    ]);
  const sinrError = roleValidation || firstPositionError(positionValidation.errors);
  const isFormValid = !sinrError && positionValidation.isValid;
  const isAnalytical = form.propagation_model !== "sionna";
  const isSimulationReady = isAnalytical || sceneStatus.isSceneReady;

  useEffect(() => {
    const cleanedRoles = cleanSinrRoleSelection(roleSelection, antennas);

    if (sinrRoleSelectionChanged(cleanedRoles, roleSelection)) {
      onRoleSelectionChange?.(cleanedRoles);
      return;
    }

    if (
      antennas.length === 3
      && SINR_ROLES.every((role) => !cleanedRoles[role.key])
    ) {
      onRoleSelectionChange?.({
        transmitter: cleanedRoles.transmitter || antennas[0]?.id || "",
        receiver: cleanedRoles.receiver || antennas[1]?.id || "",
        interferer: cleanedRoles.interferer || antennas[2]?.id || "",
      });
    }
  }, [antennas, onRoleSelectionChange, roleSelection]);

  async function submit(event) {
    event.preventDefault();
    if (resultState.loading || !isSimulationReady || !isFormValid) {
      return;
    }

    const payload = {
      tilt: selectedRoles.transmitter.tilt.current,
      transmitter_position: rolePositions.transmitter_position,
      receiver_position: rolePositions.receiver_position,
      interferer_position: rolePositions.interferer_position,
      interferer_tilt: selectedRoles.interferer.tilt.current,
      tx_power: selectedRoles.transmitter.tx_power.current,
      interferer_tx_power: selectedRoles.interferer.tx_power.current,
      propagation_model: form.propagation_model,
      carrier_frequency_ghz: form.carrier_frequency_ghz,
      bandwidth_mhz: form.bandwidth_mhz,
      noise_figure_db: form.noise_figure_db,
      solver: sceneSolver,
      transmitter_pattern: TRANSMITTER_PATTERN,
    };
    const displayPayload = {
      ...payload,
      antenna_roles: {
        transmitter: selectedRoles.transmitter,
        receiver: selectedRoles.receiver,
        interferer: selectedRoles.interferer,
      },
    };
    await setResultState(async () => ({
      ...(await runSinr(payload)),
      request: displayPayload,
    }));
  }

  const result = resultState.result;
  const isQueued = result?.status === "queued";
  const resultRequest = result?.request || {};

  return (
    <main className="app-shell api-workspace-shell sinr-page">
      <section className="map-panel api-workspace-result" aria-label="SINR API result">
        <div className="topbar">
          <div>
            <h1>SINR API</h1>
            <p id="run-status">Evaluate signal quality at one receiver point with one serving transmitter and one interferer.</p>
          </div>
          <button
            className="primary-button"
            type="submit"
            form="sinr-api-form"
            disabled={resultState.loading || !isSimulationReady || !isFormValid}
          >
            {runButtonLabel(resultState.loading, isSimulationReady, isFormValid, "Calculate SINR")}
          </button>
        </div>
        <div className="api-workspace-stage">
          {resultState.error && <p className="history-status error-text">{resultState.error}</p>}
          {!resultState.error && resultState.loading && <p className="history-status">Waiting for backend...</p>}
          {!resultState.error && !resultState.loading && isQueued && (
            <QueueNotice result={result} onQueueOpen={onQueueOpen} />
          )}
          <div className="result-summary">
            {result && !isQueued ? (
              <ApiResultScene
                activeScene={activeScene}
                antennas={linkResultAntennas(result, resultRequest)}
                result={result}
                onSceneLoadingChange={sceneStatus.handleSceneLoadingChange}
                sceneBadges={sinrSceneBadges(result)}
                signalLinks={radioLinkVisuals(resultRequest)}
                solver={result.solver || resultRequest.solver}
              />
            ) : (
              <ApiResultScene
                activeScene={activeScene}
                antennas={sinrPreviewAntennas(selectedRoles)}
                result={{}}
                onSceneLoadingChange={sceneStatus.handleSceneLoadingChange}
                signalLinks={sinrPreviewLinks(rolePositions)}
                solver={sceneSolver}
              />
            )}
            <form id="sinr-api-form" className="api-form api-scene-setup-form" onSubmit={submit}>
              <fieldset className="api-form-lock" disabled={resultState.loading}>
                <FormSection title="SINR roles">
                  <SinrRoleFields
                    antennas={antennas}
                    error={sinrError}
                    roles={roleSelection}
                    onChange={onRoleSelectionChange}
                  />
                </FormSection>
                <PropagationFields form={form} onChange={setForm} includeBandwidth />
                {!isAnalytical && (
                  <SolverFields solver={sceneSolver} onChange={(solver) => updateForm(setForm, "solver", solver)} />
                )}
              </fieldset>
            </form>
            {!resultState.error && result && !isQueued && (
              <SinrResultDetails result={result} />
            )}
          </div>
        </div>
      </section>
      <aside className="control-panel api-workspace-controls" aria-label="SINR candidate antenna controls">
        <div className="panel-header">
          <h2>SINR antennas</h2>
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
            <FormSection title="Candidate antennas">
              <AntennaPanel
                activeScene={activeScene}
                antennas={antennas}
                disabled={resultState.loading}
                onAddType2={onAddType2Antenna}
                onChange={onUpdateAntenna}
                onRemoveType2={onRemoveType2Antenna}
                simulationLabel="SINR API"
              />
            </FormSection>
          </div>
        </div>
      </aside>
    </main>
  );
}

export function RsrpSimulationPage({
  activeScene,
  antennas,
  maxAntennas = 10,
  onAddType2Antenna,
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
  const sceneSolver = solverForScene(activeScene, form.solver);

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
      antennas: simulationAntennas.map(toAntennaRequest),
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
  const solver = result?.solver || sceneSolver;
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
                <AntennaPanel
                  activeScene={activeScene}
                  antennas={antennas}
                  disabled={resultState.loading}
                  maxAntennas={maxAntennas}
                  onAddType2={onAddType2Antenna}
                  onChange={onUpdateAntenna}
                  onRemoveType2={onRemoveType2Antenna}
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

export function ThroughputApiPage({
  activeScene,
  antennas = EMPTY_ARRAY,
  onAddType2Antenna,
  onProgressChange,
  onQueueOpen,
  onRemoveType2Antenna,
  onResetAntennas,
  onRoleSelectionChange,
  onSceneLoadingChange,
  onSimulationQueued,
  onUpdateAntenna,
  roleSelection = {},
}) {
  const [form, setForm] = useState(() => ({
    propagation_model: "sionna",
    carrier_frequency_ghz: 3.5,
    noise_figure_db: 7,
    base_tilt: 6,
    target_tilt: 12,
    bandwidth_mhz: 100,
    mimo_layers: 4,
    solver: DEFAULT_SOLVER,
  }));
  const [resultState, setResultState] = useApiResult(
    onProgressChange,
    "Running Throughput API...",
    onSimulationQueued,
    { sceneName: activeScene?.name },
  );
  const sceneStatus = useScenePreviewStatus(activeScene, onSceneLoadingChange);
  const sceneSolver = solverForScene(activeScene, form.solver);
  const selectedRoles = sinrSelectedRoleAntennas(antennas, roleSelection);
  const rolePositions = sinrRolePositions(selectedRoles, activeScene?.bounds);
  const roleValidation = validateSinrRoles(
    antennas,
    roleSelection,
    selectedRoles,
    rolePositions,
    activeScene,
    "Throughput",
  );
  const positionValidation = roleValidation
    ? { errors: {}, isValid: false }
    : validateScenePositions(sceneSolver, [
      {
        key: "transmitter_position",
        label: "Transmitter position",
        value: rolePositions.transmitter_position,
      },
      {
        key: "receiver_position",
        label: "Receiver position",
        value: rolePositions.receiver_position,
      },
      {
        key: "interferer_position",
        label: "Interferer position",
        value: rolePositions.interferer_position,
      },
    ]);
  const positionError = firstPositionError(positionValidation.errors);
  const isAnalytical = form.propagation_model !== "sionna";
  const tiltError = isAnalytical ? "" : validateThroughputTilts(form, selectedRoles.transmitter);
  const throughputError = roleValidation || positionError || tiltError;
  const isFormValid = !throughputError && positionValidation.isValid;
  const isSimulationReady = isAnalytical || sceneStatus.isSceneReady;

  useEffect(() => {
    const cleanedRoles = cleanSinrRoleSelection(roleSelection, antennas);

    if (sinrRoleSelectionChanged(cleanedRoles, roleSelection)) {
      onRoleSelectionChange?.(cleanedRoles);
      return;
    }

    if (
      antennas.length === 3
      && SINR_ROLES.every((role) => !cleanedRoles[role.key])
    ) {
      onRoleSelectionChange?.({
        transmitter: cleanedRoles.transmitter || antennas[0]?.id || "",
        receiver: cleanedRoles.receiver || antennas[1]?.id || "",
        interferer: cleanedRoles.interferer || antennas[2]?.id || "",
      });
    }
  }, [antennas, onRoleSelectionChange, roleSelection]);

  useEffect(() => {
    const tiltRange = selectedRoles.transmitter?.tilt;

    if (!tiltRange) {
      return;
    }

    setForm((current) => {
      const nextBaseTilt = clampNumber(current.base_tilt, tiltRange.min, tiltRange.max);
      const nextTargetTilt = clampNumber(current.target_tilt, tiltRange.min, tiltRange.max);

      if (nextBaseTilt === current.base_tilt && nextTargetTilt === current.target_tilt) {
        return current;
      }

      return {
        ...current,
        base_tilt: nextBaseTilt,
        target_tilt: nextTargetTilt,
      };
    });
  }, [
    selectedRoles.transmitter?.id,
    selectedRoles.transmitter?.tilt?.max,
    selectedRoles.transmitter?.tilt?.min,
  ]);

  async function submit(event) {
    event.preventDefault();
    if (resultState.loading || !isSimulationReady || !isFormValid) {
      return;
    }

    const payload = {
      ...form,
      transmitter_position: rolePositions.transmitter_position,
      receiver_position: rolePositions.receiver_position,
      interferer_position: rolePositions.interferer_position,
      interferer_tilt: selectedRoles.interferer.tilt.current,
      tx_power: selectedRoles.transmitter.tx_power.current,
      interferer_tx_power: selectedRoles.interferer.tx_power.current,
      solver: sceneSolver,
      transmitter_pattern: TRANSMITTER_PATTERN,
    };
    const displayPayload = {
      ...payload,
      antenna_roles: {
        transmitter: selectedRoles.transmitter,
        receiver: selectedRoles.receiver,
        interferer: selectedRoles.interferer,
      },
    };
    await setResultState(async () => ({
      ...(await runThroughputComparison(payload)),
      request: displayPayload,
    }));
  }

  const result = resultState.result;
  const isQueued = result?.status === "queued";
  const resultRequest = result?.request || {};
  const tiltHint = throughputTiltHint(selectedRoles.transmitter);

  return (
    <main className="app-shell api-workspace-shell throughput-page">
      <section className="map-panel api-workspace-result" aria-label="Throughput API result">
        <div className="topbar">
          <div>
            <h1>Throughput API</h1>
            <p id="run-status">Compare receiver throughput between two tilt settings with one serving transmitter and one interferer.</p>
          </div>
          <button
            className="primary-button"
            type="submit"
            form="throughput-api-form"
            disabled={resultState.loading || !isSimulationReady || !isFormValid}
          >
            {runButtonLabel(resultState.loading, isSimulationReady, isFormValid, "Compare throughput")}
          </button>
        </div>
        <div className="api-workspace-stage">
          {resultState.error && <p className="history-status error-text">{resultState.error}</p>}
          {!resultState.error && resultState.loading && <p className="history-status">Waiting for backend...</p>}
          {!resultState.error && !resultState.loading && isQueued && (
            <QueueNotice result={result} onQueueOpen={onQueueOpen} />
          )}
          <div className="result-summary">
            {result && !isQueued ? (
              <ApiResultScene
                activeScene={activeScene}
                antennas={linkResultAntennas(result, resultRequest)}
                result={result}
                onSceneLoadingChange={sceneStatus.handleSceneLoadingChange}
                sceneBadges={throughputSceneBadges(result)}
                signalLinks={radioLinkVisuals(resultRequest)}
                solver={result.solver || resultRequest.solver}
              />
            ) : (
              <ApiResultScene
                activeScene={activeScene}
                antennas={sinrPreviewAntennas(selectedRoles)}
                result={{}}
                onSceneLoadingChange={sceneStatus.handleSceneLoadingChange}
                signalLinks={sinrPreviewLinks(rolePositions)}
                solver={sceneSolver}
              />
            )}
            <form id="throughput-api-form" className="api-form api-scene-setup-form" onSubmit={submit}>
              <fieldset className="api-form-lock" disabled={resultState.loading}>
                <FormSection title="Throughput roles">
                  <SinrRoleFields
                    antennas={antennas}
                    error={roleValidation || positionError}
                    roles={roleSelection}
                    onChange={onRoleSelectionChange}
                    simulationLabel="Throughput"
                  />
                </FormSection>
                <PropagationFields form={form} onChange={setForm} />
                <FormSection title="Tilt comparison">
                    <NumberField
                      hint={tiltHint}
                      label="Base tilt"
                      unit="deg"
                      value={form.base_tilt}
                      min={selectedRoles.transmitter?.tilt?.min}
                      max={selectedRoles.transmitter?.tilt?.max}
                      onChange={(value) => updateForm(setForm, "base_tilt", value)}
                    />
                    <NumberField
                      hint={tiltHint}
                      label="Target tilt"
                      unit="deg"
                      value={form.target_tilt}
                      min={selectedRoles.transmitter?.tilt?.min}
                      max={selectedRoles.transmitter?.tilt?.max}
                      onChange={(value) => updateForm(setForm, "target_tilt", value)}
                    />
                    {tiltError && <small className="field-error">{tiltError}</small>}
                    {isAnalytical && (
                      <p className="form-help">
                        {formatPropagationModel(form.propagation_model)} does not use tilt, so both settings will produce the same result.
                      </p>
                    )}
                    {selectedRoles.transmitter && (
                      <p className="form-help">
                        Power uses the selected transmitter simulation setting: {formatMaybeNumber(selectedRoles.transmitter.tx_power.current)} dBm.
                      </p>
                    )}
                </FormSection>
                <FormSection title="Throughput assumptions">
                  <NumberField
                    hint="1 MHz or greater."
                    label="Bandwidth"
                    unit="MHz"
                    value={form.bandwidth_mhz}
                    min={1}
                    onChange={(value) => updateForm(setForm, "bandwidth_mhz", value)}
                  />
                  <NumberField
                    hint="1 layer or greater."
                    label="MIMO layers"
                    value={form.mimo_layers}
                    min={1}
                    step={1}
                    onChange={(value) => updateForm(setForm, "mimo_layers", value)}
                  />
                </FormSection>
                {!isAnalytical && (
                  <SolverFields solver={sceneSolver} onChange={(solver) => updateForm(setForm, "solver", solver)} />
                )}
              </fieldset>
            </form>
            {!resultState.error && result && !isQueued && (
              <ThroughputResultDetails result={result} />
            )}
          </div>
        </div>
      </section>
      <aside className="control-panel api-workspace-controls" aria-label="Throughput candidate antenna controls">
        <div className="panel-header">
          <h2>Throughput antennas</h2>
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
            <FormSection title="Candidate antennas">
              <AntennaPanel
                activeScene={activeScene}
                antennas={antennas}
                disabled={resultState.loading}
                onAddType2={onAddType2Antenna}
                onChange={onUpdateAntenna}
                onRemoveType2={onRemoveType2Antenna}
                simulationLabel="Throughput API"
              />
            </FormSection>
          </div>
        </div>
      </aside>
    </main>
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
      <div className="rsrp-legend-header">
        <h3>RSRP quality legend</h3>
        <p>Higher dBm values indicate stronger received signal at each user point.</p>
      </div>
      <div className="rsrp-quality-strip" aria-label="RSRP quality legend">
        {RSRP_QUALITY_BANDS.map((band) => (
          <div key={band.key} className={`rsrp-quality ${band.key}`}>
            <span className="rsrp-quality-label">{band.label}</span>
            <strong>
              {qualityCounts[band.key] || 0}
              <small> users</small>
            </strong>
            <span className="rsrp-quality-range">{band.range}</span>
            <span className="rsrp-quality-description">{band.description}</span>
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

export function RsrpUserDialog({ onClose, user }) {
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

function ApiPageShell({
  children,
  description,
  layout = "standard",
  onQueueOpen,
  renderPreview,
  renderResult,
  resultState,
  title,
  workspaceAction = null,
}) {
  const isQueued = resultState.result?.status === "queued";

  if (layout === "workspace") {
    return (
      <main className="app-shell api-workspace-shell">
        <section className="map-panel api-workspace-result" aria-label={`${title} result`}>
          <div className="topbar">
            <div>
              <h1>{title}</h1>
              <p id="run-status">{description}</p>
            </div>
            {workspaceAction}
          </div>
          <div className="api-workspace-stage">
            {resultState.error && <p className="history-status error-text">{resultState.error}</p>}
            {!resultState.error && resultState.loading && <p className="history-status">Waiting for backend...</p>}
            {!resultState.error && !resultState.result && renderPreview?.()}
            {!resultState.error && isQueued && <QueueNotice result={resultState.result} onQueueOpen={onQueueOpen} />}
            {!resultState.error && resultState.result && !isQueued && renderResult(resultState.result)}
          </div>
        </section>
        <aside className="control-panel api-workspace-controls" aria-label={`${title} controls`}>
          <div className="panel-header">
            <h2>Controls</h2>
          </div>
          <div className="api-workspace-form">
            {children}
          </div>
        </aside>
      </main>
    );
  }

  return (
    <section className={[
      "api-page",
      layout === "result-wide" ? "api-page-result-wide" : "",
    ].filter(Boolean).join(" ")}>
      <div className="page-title">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className={[
        "api-layout",
        layout === "result-wide" ? "api-layout-result-wide" : "",
      ].filter(Boolean).join(" ")}>
        <div className="api-panel">
          {children}
        </div>
        <div className="api-result-panel">
          <h2>Result</h2>
          {resultState.error && <p className="history-status error-text">{resultState.error}</p>}
          {!resultState.error && resultState.loading && <p className="history-status">Waiting for backend...</p>}
          {!resultState.error && !resultState.result && renderPreview?.()}
          {!resultState.error && isQueued && <QueueNotice result={resultState.result} onQueueOpen={onQueueOpen} />}
          {!resultState.error && resultState.result && !isQueued && renderResult(resultState.result)}
        </div>
      </div>
    </section>
  );
}

function CoverageTransmitterFields({
  activeScene,
  antennas,
  error,
  form,
  onChange,
}) {
  if (antennas.length === 0) {
    return (
      <>
        <p className="form-help">No fixed antennas are inside this scene. Add one added antenna transmitter for this Coverage API run.</p>
        <TextField
          label="Antenna ID"
          value={form.transmitter.id}
          onChange={(value) => updateManualTransmitter(onChange, form, "id", value)}
        />
        <NumberField
          hint={coordinateHint("longitude", activeScene?.bounds)}
          label="Longitude"
          max={activeScene?.bounds?.east}
          min={activeScene?.bounds?.west}
          value={form.transmitter.longitude}
          onChange={(value) => updateManualTransmitter(onChange, form, "longitude", value)}
        />
        <NumberField
          hint={coordinateHint("latitude", activeScene?.bounds)}
          label="Latitude"
          max={activeScene?.bounds?.north}
          min={activeScene?.bounds?.south}
          value={form.transmitter.latitude}
          onChange={(value) => updateManualTransmitter(onChange, form, "latitude", value)}
        />
        <NumberField
          hint="Must be greater than 0."
          label="Height"
          min={0.1}
          unit="m"
          value={form.transmitter.height_m}
          onChange={(value) => updateManualTransmitter(onChange, form, "height_m", value)}
        />
        {error && <small className="field-error">{error}</small>}
      </>
    );
  }

  const selected = antennas.find((antenna) => antenna.id === form.selected_antenna_id);
  const isType2Selected = form.selected_antenna_id === COVERAGE_TYPE2_TRANSMITTER_ID;

  return (
    <>
      <label className="form-field">
        <span>Transmitter</span>
        <select
          aria-invalid={Boolean(error)}
          required
          value={form.selected_antenna_id}
          onChange={(event) => selectCoverageTransmitter(onChange, form, antennas, event.target.value)}
        >
          {antennas.length > 1 && <option value="">Select transmitter</option>}
          {antennas.map((antenna) => (
            <option key={antenna.id} value={antenna.id}>
              {antenna.id}
            </option>
          ))}
          <option value={COVERAGE_TYPE2_TRANSMITTER_ID}>Add custom transmitter</option>
        </select>
      </label>
      {isType2Selected && (
        <>
          <TextField
            label="Antenna ID"
            value={form.transmitter.id}
            onChange={(value) => updateManualTransmitter(onChange, form, "id", value)}
          />
          <NumberField
            hint={coordinateHint("longitude", activeScene?.bounds)}
            label="Longitude"
            max={activeScene?.bounds?.east}
            min={activeScene?.bounds?.west}
            value={form.transmitter.longitude}
            onChange={(value) => updateManualTransmitter(onChange, form, "longitude", value)}
          />
          <NumberField
            hint={coordinateHint("latitude", activeScene?.bounds)}
            label="Latitude"
            max={activeScene?.bounds?.north}
            min={activeScene?.bounds?.south}
            value={form.transmitter.latitude}
            onChange={(value) => updateManualTransmitter(onChange, form, "latitude", value)}
          />
          <NumberField
            hint="Must be greater than 0."
            label="Height"
            min={0.1}
            unit="m"
            value={form.transmitter.height_m}
            onChange={(value) => updateManualTransmitter(onChange, form, "height_m", value)}
          />
        </>
      )}
      {selected && (
        <p className="form-help">
          {selected.id}: {formatCoordinate(selected.longitude)}, {formatCoordinate(selected.latitude)}, {formatMaybeNumber(selected.height_m)} m.
        </p>
      )}
      {error && <small className="field-error">{error}</small>}
    </>
  );
}

function TextField({ label, onChange, value }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <input
        type="text"
        value={value}
        required
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function QueueNotice({ onQueueOpen, result }) {
  const sceneName = result.scene_name || result.scene?.name || result.scene?.id;

  return (
    <div className="queue-notice">
      <strong>Simulation recorded</strong>
      <p>The job is in Simulation Queue. Open the queue to watch its status and save the result after it finishes.</p>
      <dl className="detail-grid">
        <dt>Scene</dt><dd>{sceneName || "--"}</dd>
        <dt>Type</dt><dd>{result.simulation_type || "--"}</dd>
      </dl>
      {onQueueOpen && (
        <button className="primary-button" type="button" onClick={onQueueOpen}>
          Open Simulation Queue
        </button>
      )}
    </div>
  );
}

function ApiScenePreview({
  activeScene,
  antennas = EMPTY_ARRAY,
  isSceneReady,
  onSceneLoadingChange,
  signalLinks = EMPTY_ARRAY,
  solver = null,
}) {
  return (
    <div className="result-summary">
      <div className="api-result-scene-wrap">
        {activeScene?.bounds ? (
          <Scene3DPreview
            antennas={antennas}
            bounds={activeScene.bounds}
            className="api-result-scene-3d"
            onLoadingChange={onSceneLoadingChange}
            sceneName={activeScene.name}
            showOverlay={false}
            signalLinks={signalLinks}
            solver={solver || solverForScene(activeScene)}
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

function SinrRoleFields({ antennas, error, onChange, roles, simulationLabel = "SINR" }) {
  const availableAntennas = Array.isArray(antennas) ? antennas : EMPTY_ARRAY;

  function updateRole(role, antennaId) {
    onChange?.({
      ...roles,
      [role]: antennaId,
    });
  }

  return (
    <>
      {availableAntennas.length < 3 && (
        <p className="form-help">
          Add {3 - availableAntennas.length} more added antenna(s) before running {simulationLabel}.
        </p>
      )}
      {SINR_ROLES.map((role) => (
        <label className="form-field" key={role.key}>
          <span>{role.label}</span>
          <select
            value={roles[role.key] || ""}
            required
            onChange={(event) => updateRole(role.key, event.target.value)}
          >
            <option value="">Select {role.label.toLowerCase()}</option>
            {availableAntennas.map((antenna) => (
              <option key={antenna.id} value={antenna.id}>
                {antenna.id} ({antenna._type === "type2" ? "Added antenna" : "Fixed antenna"})
              </option>
            ))}
          </select>
        </label>
      ))}
      {error && <small className="field-error">{error}</small>}
      <p className="form-help">
        {simulationLabel} runs only when one transmitter, one receiver, and one interferer are selected as three different antennas.
      </p>
    </>
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

function FormSection({ children, title }) {
  return (
    <fieldset className="form-section">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

function PropagationFields({ form, includeBandwidth = false, onChange }) {
  const isAnalytical = form.propagation_model !== "sionna";

  return (
    <FormSection title="Propagation">
      <label className="form-field">
        <span>Model</span>
        <div>
          <select
            value={form.propagation_model}
            onChange={(event) => updateForm(onChange, "propagation_model", event.target.value)}
          >
            <option value="sionna">Sionna 3D ray tracing</option>
            <option value="uma">UMa</option>
            <option value="ericsson">Ericsson</option>
            <option value="friis">Friis</option>
          </select>
          <small className="input-hint">
            {isAnalytical
              ? `Uses only the ${formatPropagationModel(form.propagation_model)} formula without 3D ray tracing.`
              : "Uses the selected 3D scene, antenna pattern, and tilt."}
          </small>
        </div>
      </label>
      {isAnalytical && (
        <>
          <NumberField
            hint={`Carrier frequency used by the ${formatPropagationModel(form.propagation_model)} formula.`}
            label="Frequency"
            min={0.01}
            max={100}
            unit="GHz"
            value={form.carrier_frequency_ghz}
            onChange={(value) => updateForm(onChange, "carrier_frequency_ghz", value)}
          />
          {includeBandwidth && (
            <NumberField
              hint="Used to calculate thermal noise."
              label="Bandwidth"
              min={0.01}
              unit="MHz"
              value={form.bandwidth_mhz}
              onChange={(value) => updateForm(onChange, "bandwidth_mhz", value)}
            />
          )}
          <NumberField
            hint="Receiver noise figure from 0 to 30 dB."
            label="Noise figure"
            min={0}
            max={30}
            unit="dB"
            value={form.noise_figure_db}
            onChange={(value) => updateForm(onChange, "noise_figure_db", value)}
          />
        </>
      )}
    </FormSection>
  );
}

function SolverFields({ solver, onChange }) {
  return (
    <FormSection title="Solver">
      <NumberField hint="0 to 10." label="Max depth" value={solver.max_depth} min={0} max={10} step={1} onChange={(value) => updateObject(onChange, solver, "max_depth", value)} />
      <NumberField hint="1 to 10,000,000." label="Samples per TX" value={solver.samples_per_tx} min={1} max={10000000} step={1} onChange={(value) => updateObject(onChange, solver, "samples_per_tx", value)} />
      <NumberField hint="0.1 to 50 m." label="Cell size" unit="m" value={solver.cell_size} min={0.1} max={50} step="any" onChange={(value) => updateObject(onChange, solver, "cell_size", value)} />
    </FormSection>
  );
}

function NumberField({ hint = "", label, max, min, onChange, step = "any", unit = "", value }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <div>
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
        {hint && <small className="input-hint">{hint}</small>}
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
        <dt>Antenna</dt><dd>{formatText(request.transmitter?.id || "Manual transmitter")}</dd>
        <dt>Coordinates</dt><dd>{formatTransmitterCoordinates(request.transmitter)}</dd>
        <dt>Position</dt><dd>{formatPositionValue(request.transmitter_position)}</dd>
        <dt>Azimuth</dt><dd>{formatMaybeNumber(request.azimuth)} deg</dd>
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
      <SinrResultDetails result={result} />
    </div>
  );
}

function SinrResultDetails({ result }) {
  const request = result.request || {};
  const isAnalytical = isFormulaPropagationModel(result.propagation_model);

  return (
    <>
      <h3>Serving transmitter</h3>
      <dl className="detail-grid">
        <dt>Position</dt><dd>{formatPositionValue(request.transmitter_position)}</dd>
        <dt>Tilt</dt><dd>{formatMaybeNumber(request.tilt)} deg</dd>
        <dt>Power</dt><dd>{formatMaybeNumber(request.tx_power)} dBm</dd>
        <dt>Interferer power</dt><dd>{formatMaybeNumber(request.interferer_tx_power ?? request.tx_power)} dBm</dd>
        <dt>Propagation</dt><dd>{formatPropagationModel(result.propagation_model)}</dd>
        {isAnalytical && <><dt>Frequency</dt><dd>{formatMaybeNumber(request.carrier_frequency_ghz)} GHz</dd></>}
      </dl>
      <h3>Receiver result</h3>
      <dl className="detail-grid">
        <dt>Status</dt><dd>{formatText(result.status)}</dd>
        <dt>Receiver</dt><dd>{formatPositionValue(result.receiver_position || request.receiver_position)}</dd>
        <dt>SINR</dt><dd>{formatMaybeNumber(result.sinr_db)} dB</dd>
        <dt>Signal power</dt><dd>{formatMaybeNumber(result.signal_power)} dBm</dd>
        <dt>Interference + noise</dt><dd>{formatMaybeNumber(result.noise_power)} dBm</dd>
      </dl>
      <h3>Interferer</h3>
      <dl className="detail-grid">
        <dt>Position</dt><dd>{formatPositionValue(request.interferer_position)}</dd>
        <dt>Tilt</dt><dd>{formatMaybeNumber(request.interferer_tilt)} deg</dd>
      </dl>
    </>
  );
}

function ThroughputResult({ activeScene, onSceneLoadingChange, result }) {
  const request = result.request || {};

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
      <ThroughputResultDetails result={result} />
    </div>
  );
}

function ThroughputResultDetails({ result }) {
  const request = result.request || {};
  const comparison = result.comparison || {};
  const isAnalytical = isFormulaPropagationModel(result.propagation_model);

  return (
    <>
      <h3>Radio link</h3>
      <dl className="detail-grid">
        <dt>Transmitter</dt><dd>{formatPositionValue(request.transmitter_position)}</dd>
        <dt>Receiver</dt><dd>{formatPositionValue(result.receiver_position || request.receiver_position)}</dd>
        <dt>Interferer</dt><dd>{formatPositionValue(request.interferer_position)}</dd>
        <dt>Power</dt><dd>{formatMaybeNumber(request.tx_power)} dBm</dd>
        <dt>Bandwidth</dt><dd>{formatMaybeNumber(request.bandwidth_mhz)} MHz</dd>
        <dt>Interferer power</dt><dd>{formatMaybeNumber(request.interferer_tx_power ?? request.tx_power)} dBm</dd>
        <dt>MIMO layers</dt><dd>{request.mimo_layers || "--"}</dd>
        <dt>Propagation</dt><dd>{formatPropagationModel(result.propagation_model)}</dd>
        {isAnalytical && <><dt>Frequency</dt><dd>{formatMaybeNumber(request.carrier_frequency_ghz)} GHz</dd></>}
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
      {isAnalytical && <p className="form-help">{result.recommendation}</p>}
    </>
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
      id: request.transmitter?.id || "TX",
      position: request.transmitter_position,
      longitude: request.transmitter?.longitude,
      latitude: request.transmitter?.latitude,
      height_m: request.transmitter?.height_m,
      azimuth: request.transmitter?.azimuth ?? 0,
    },
  ];
}

function formatTransmitterCoordinates(transmitter) {
  if (!transmitter) {
    return "--";
  }

  return `${formatCoordinate(transmitter.longitude)}, ${formatCoordinate(transmitter.latitude)}`;
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
    const request = toAntennaRequest(antenna);

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

function toAntennaRequest(antenna) {
  const id = String(antenna?.id || "").trim();
  const longitude = Number(antenna?.longitude);
  const latitude = Number(antenna?.latitude);
  const heightM = Number(antenna?.height_m);
  const azimuth = Number(antenna?.azimuth);
  const tilt = toRangeRequest(antenna?.tilt);
  const txPower = toRangeRequest(antenna?.tx_power);

  if (
    !id
    || !Number.isFinite(longitude)
    || !Number.isFinite(latitude)
    || !Number.isFinite(heightM)
    || !Number.isFinite(azimuth)
    || !tilt
    || !txPower
  ) {
    return null;
  }

  return {
    id,
    longitude,
    latitude,
    height_m: heightM,
    azimuth,
    tilt,
    tx_power: txPower,
  };
}

function toRangeRequest(range) {
  const min = Number(range?.min);
  const current = Number(range?.current);
  const max = Number(range?.max);

  if (
    !Number.isFinite(min)
    || !Number.isFinite(current)
    || !Number.isFinite(max)
    || min > max
    || current < min
    || current > max
  ) {
    return null;
  }

  return {
    min,
    current,
    max,
  };
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

function coverageTransmitter(form, antennas) {
  if (
    antennas.length === 0
    || form.selected_antenna_id === COVERAGE_TYPE2_TRANSMITTER_ID
  ) {
    return form.transmitter;
  }

  return antennas.find((antenna) => antenna.id === form.selected_antenna_id) || {};
}

function validateCoverageTransmitter(transmitter, antennas, activeScene) {
  if (antennas.length > 0 && !transmitter.id) {
    return "Select one fixed antenna or add an added antenna transmitter.";
  }

  if (!transmitter || Object.keys(transmitter).length === 0) {
    return "Add one transmitter before running Coverage API.";
  }

  const id = String(transmitter.id || "").trim();
  const longitude = Number(transmitter.longitude);
  const latitude = Number(transmitter.latitude);
  const height = Number(transmitter.height_m);

  if (!id) {
    return "Antenna ID is required.";
  }

  const isSelectedFixedAntenna = antennas.includes(transmitter);

  if (
    !isSelectedFixedAntenna
    && antennas.some((antenna) => antenna.id.toLowerCase() === id.toLowerCase())
  ) {
    return `Antenna ID ${id} is already used by a fixed antenna.`;
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

function updateManualTransmitter(onChange, form, field, value) {
  onChange({
    ...form,
    transmitter: {
      ...form.transmitter,
      [field]: value,
    },
  });
}

function selectCoverageTransmitter(onChange, form, antennas, antennaId) {
  const antenna = antennas.find((item) => item.id === antennaId);

  if (antennaId === COVERAGE_TYPE2_TRANSMITTER_ID) {
    onChange({
      ...form,
      selected_antenna_id: antennaId,
    });
    return;
  }

  onChange({
    ...form,
    selected_antenna_id: antennaId,
    azimuth: antenna?.azimuth ?? form.azimuth,
    tilt: antenna?.tilt?.current ?? form.tilt,
    tx_power: antenna?.tx_power?.current ?? form.tx_power,
  });
}

function coordinateHint(axis, bounds) {
  if (!bounds) {
    return axis === "longitude"
      ? "-180.0000 to 180.0000."
      : "-90.0000 to 90.0000.";
  }

  return axis === "longitude"
    ? `${formatCoordinate(bounds.west)} to ${formatCoordinate(bounds.east)} for the selected scene.`
    : `${formatCoordinate(bounds.south)} to ${formatCoordinate(bounds.north)} for the selected scene.`;
}

function rangeHint(range, unit) {
  const min = Number(range?.min);
  const max = Number(range?.max);

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return "";
  }

  return `${formatMaybeNumber(min)} to ${formatMaybeNumber(max)} ${unit}.`;
}

function formatCoordinate(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "--";
  }

  return numericValue.toFixed(4);
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

function isFormulaPropagationModel(value) {
  return ["uma", "ericsson", "friis"].includes(value);
}

function formatPropagationModel(value) {
  const labels = {
    sionna: "Sionna 3D",
    uma: "UMa",
    ericsson: "Ericsson",
    friis: "Friis",
  };

  return labels[value] || "Sionna 3D";
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

function parseNumericInput(value) {
  return value === "" ? "" : Number(value);
}
