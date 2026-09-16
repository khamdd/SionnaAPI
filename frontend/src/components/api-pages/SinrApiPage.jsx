import { useEffect, useMemo, useState } from "react";

import { runSinr } from "../../api";
import { DEFAULT_SOLVER, EMPTY_ARRAY, TRANSMITTER_PATTERN } from "../../constants";
import { solverForScene } from "../../utils/scene";
import SimulationAntennaPanel from "../SimulationAntennaPanel";
import {
  ApiResultScene,
  FormSection,
  PropagationFields,
  QueueNotice,
  SinrResultDetails,
  SinrRoleFields,
  SolverFields,
  cleanSinrRoleSelection,
  firstPositionError,
  linkResultAntennas,
  radioLinkVisuals,
  receiverPositionForMode,
  receiverPositionFromMode,
  runButtonLabel,
  sinrPreviewAntennas,
  sinrPreviewLinks,
  sinrRolePositions,
  sinrRoleSelectionChanged,
  sinrSceneBadges,
  sinrSelectedRoleAntennas,
  updateForm,
  useApiResult,
  useScenePreviewStatus,
  validateScenePositions,
  validateSinrRoles,
} from "./ApiPagesShared";

export function SinrApiPage({
  activeScene,
  antennaPool = EMPTY_ARRAY,
  antennas = EMPTY_ARRAY,
  onAddType2Antenna,
  onCreateAntenna,
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
  const [receiverCoordinateMode, setReceiverCoordinateMode] = useState("meters");
  const [receiverCoordinateDraft, setReceiverCoordinateDraft] = useState(null);

  useEffect(() => {
    setReceiverCoordinateDraft(null);
    setReceiverCoordinateMode("meters");
  }, [activeScene?.id]);
  const [resultState, setResultState] = useApiResult(
    onProgressChange,
    "Running SINR API...",
    onSimulationQueued,
    { sceneName: activeScene?.name },
  );
  const sceneStatus = useScenePreviewStatus(activeScene, onSceneLoadingChange);
  const sceneSolver = useMemo(
    () => solverForScene(activeScene, form.solver),
    [activeScene, form.solver],
  );
  const selectedRoles = useMemo(
    () => sinrSelectedRoleAntennas(antennas, roleSelection),
    [antennas, roleSelection],
  );
  const receiverPosition = roleSelection.receiver_position || null;
  const receiverInputPosition = receiverCoordinateDraft
    || receiverPositionForMode(receiverPosition, receiverCoordinateMode, activeScene?.bounds);
  const rolePositions = useMemo(
    () => sinrRolePositions(selectedRoles, receiverPosition, activeScene?.bounds),
    [selectedRoles, receiverPosition, activeScene?.bounds],
  );
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
      ...(rolePositions.interferer_position ? [{
        key: "interferer_position",
        label: "Interferer position",
        value: rolePositions.interferer_position,
      }] : []),
    ]);
  const sinrError = roleValidation || firstPositionError(positionValidation.errors);
  const isFormValid = !sinrError && positionValidation.isValid;
  const isAnalytical = form.propagation_model !== "sionna";
  const isSimulationReady = isAnalytical || sceneStatus.isSceneReady;

  function handleReceiverCoordinateModeChange(nextMode) {
    setReceiverCoordinateMode(nextMode);
    setReceiverCoordinateDraft(receiverPositionForMode(
      receiverPosition,
      nextMode,
      activeScene?.bounds,
    ));
  }

  function handleReceiverPositionChange(nextPosition) {
    setReceiverCoordinateDraft(nextPosition);
    const scenePosition = receiverPositionFromMode(
      nextPosition,
      receiverCoordinateMode,
      activeScene?.bounds,
    );

    if (scenePosition) {
      onRoleSelectionChange?.({
        ...roleSelection,
        receiver_position: scenePosition,
      });
    }
  }

  useEffect(() => {
    const cleanedRoles = cleanSinrRoleSelection(roleSelection, antennas);

    const nextRoles = {
      ...cleanedRoles,
      receiver_position: cleanedRoles.receiver_position || { x: 0, y: 0, z: 1.5 },
    };

    if (sinrRoleSelectionChanged(nextRoles, roleSelection)) {
      onRoleSelectionChange?.(nextRoles);
      return;
    }

    if (!nextRoles.transmitter && antennas.length > 0) {
      onRoleSelectionChange?.({
        ...nextRoles,
        transmitter: antennas[0]?.id || "",
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
      tx_power: selectedRoles.transmitter.tx_power.current,
      propagation_model: form.propagation_model,
      carrier_frequency_ghz: form.carrier_frequency_ghz,
      bandwidth_mhz: form.bandwidth_mhz,
      noise_figure_db: form.noise_figure_db,
      solver: sceneSolver,
      transmitter_pattern: TRANSMITTER_PATTERN,
      ...(selectedRoles.interferer ? {
        interferer_position: rolePositions.interferer_position,
        interferer_tilt: selectedRoles.interferer.tilt.current,
        interferer_tx_power: selectedRoles.interferer.tx_power.current,
      } : {}),
    };
    const displayPayload = {
      ...payload,
      antenna_roles: {
        transmitter: selectedRoles.transmitter,
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
  const resultRequest = useMemo(() => result?.request || {}, [result]);
  const resultAntennas = useMemo(
    () => linkResultAntennas(result, resultRequest),
    [result, resultRequest],
  );
  const resultSceneBadges = useMemo(() => sinrSceneBadges(result), [result]);
  const resultSignalLinks = useMemo(
    () => radioLinkVisuals(resultRequest),
    [resultRequest],
  );
  const previewAntennas = useMemo(
    () => sinrPreviewAntennas(selectedRoles, rolePositions.receiver_position),
    [selectedRoles, rolePositions.receiver_position],
  );
  const previewLinks = useMemo(
    () => sinrPreviewLinks(rolePositions),
    [rolePositions],
  );

  return (
    <main className="app-shell api-workspace-shell sinr-page">
      <section className="map-panel api-workspace-result" aria-label="SINR API result">
        <div className="topbar">
          <div>
            <h1>SINR API</h1>
            <p id="run-status">Evaluate signal quality at one receiver point with one serving transmitter and an optional interferer.</p>
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
                antennas={resultAntennas}
                result={result}
                onSceneLoadingChange={sceneStatus.handleSceneLoadingChange}
sceneBadges={resultSceneBadges}
                signalLinks={resultSignalLinks}
                solver={result.solver || resultRequest.solver}
              />
            ) : (
              <ApiResultScene
                activeScene={activeScene}
                antennas={previewAntennas}
                result={{}}
                onSceneLoadingChange={sceneStatus.handleSceneLoadingChange}
                signalLinks={previewLinks}
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
                    onReceiverCoordinateModeChange={handleReceiverCoordinateModeChange}
                    onReceiverPositionChange={handleReceiverPositionChange}
                    receiverCoordinateMode={receiverCoordinateMode}
                    receiverPosition={receiverInputPosition}
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
              <SimulationAntennaPanel
                activeScene={activeScene}
                antennaPool={antennaPool}
                antennas={antennas}
                disabled={resultState.loading}
                onAdd={onAddType2Antenna}
                onCreate={onCreateAntenna}
                onChange={onUpdateAntenna}
                onRemove={onRemoveType2Antenna}
                simulationLabel="SINR API"
              />
            </FormSection>
          </div>
        </div>
      </aside>
    </main>
  );
}
