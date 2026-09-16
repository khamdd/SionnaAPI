import { useEffect, useMemo, useState } from "react";

import { runThroughputComparison } from "../../api";
import { DEFAULT_SOLVER, EMPTY_ARRAY, TRANSMITTER_PATTERN } from "../../constants";
import { formatMaybeNumber } from "../../utils/format";
import { solverForScene } from "../../utils/scene";
import SimulationAntennaPanel from "../SimulationAntennaPanel";
import {
  ApiResultScene,
  FormSection,
  NumberField,
  PropagationFields,
  QueueNotice,
  SinrRoleFields,
  SolverFields,
  ThroughputResultDetails,
  clampNumber,
  cleanSinrRoleSelection,
  firstPositionError,
  formatPropagationModel,
  linkResultAntennas,
  radioLinkVisuals,
  receiverPositionForMode,
  receiverPositionFromMode,
  runButtonLabel,
  sinrPreviewAntennas,
  sinrPreviewLinks,
  sinrRolePositions,
  sinrRoleSelectionChanged,
  sinrSelectedRoleAntennas,
  throughputSceneBadges,
  throughputTiltHint,
  updateForm,
  useApiResult,
  useScenePreviewStatus,
  validateScenePositions,
  validateSinrRoles,
  validateThroughputTilts,
} from "./ApiPagesShared";

const DEFAULT_RECEIVER_POSITION = [0, 0, 1.5];

export function ThroughputApiPage({
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
    noise_figure_db: 7,
    base_tilt: 6,
    target_tilt: 12,
    bandwidth_mhz: 100,
    mimo_layers: 4,
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
    "Running Throughput API...",
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
  const receiverPosition = roleSelection.receiver_position || DEFAULT_RECEIVER_POSITION;
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
      ...(rolePositions.interferer_position ? [{
        key: "interferer_position",
        label: "Interferer position",
        value: rolePositions.interferer_position,
      }] : []),
    ]);
  const positionError = firstPositionError(positionValidation.errors);
  const isAnalytical = form.propagation_model !== "sionna";
  const tiltError = isAnalytical ? "" : validateThroughputTilts(form, selectedRoles.transmitter);
  const throughputError = roleValidation || positionError || tiltError;
  const isFormValid = !throughputError && positionValidation.isValid;
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
  }, [selectedRoles.transmitter?.tilt]);

  async function submit(event) {
    event.preventDefault();
    if (resultState.loading || !isSimulationReady || !isFormValid) {
      return;
    }

    const payload = {
      ...form,
      transmitter_position: rolePositions.transmitter_position,
      receiver_position: rolePositions.receiver_position,
      tx_power: selectedRoles.transmitter.tx_power.current,
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
      ...(await runThroughputComparison(payload)),
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
  const resultSceneBadges = useMemo(
    () => throughputSceneBadges(result),
    [result],
  );
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
  const tiltHint = throughputTiltHint(selectedRoles.transmitter);

  return (
    <main className="app-shell api-workspace-shell throughput-page">
      <section className="map-panel api-workspace-result" aria-label="Throughput API result">
        <div className="topbar">
          <div>
            <h1>Throughput API</h1>
            <p id="run-status">Compare receiver-point throughput between two tilt settings with one serving transmitter and an optional interferer.</p>
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
            <form id="throughput-api-form" className="api-form api-scene-setup-form" onSubmit={submit}>
              <fieldset className="api-form-lock" disabled={resultState.loading}>
                <FormSection title="Throughput roles">
                  <SinrRoleFields
                    antennas={antennas}
                    error={roleValidation || positionError}
                    roles={roleSelection}
                    onChange={onRoleSelectionChange}
                    onReceiverCoordinateModeChange={handleReceiverCoordinateModeChange}
                    onReceiverPositionChange={handleReceiverPositionChange}
                    receiverCoordinateMode={receiverCoordinateMode}
                    receiverPosition={receiverInputPosition}
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
              <SimulationAntennaPanel
                activeScene={activeScene}
                antennaPool={antennaPool}
                antennas={antennas}
                disabled={resultState.loading}
                onAdd={onAddType2Antenna}
                onCreate={onCreateAntenna}
                onChange={onUpdateAntenna}
                onRemove={onRemoveType2Antenna}
                simulationLabel="Throughput API"
              />
            </FormSection>
          </div>
        </div>
      </aside>
    </main>
  );
}
