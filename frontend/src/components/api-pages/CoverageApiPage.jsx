import { useEffect, useMemo, useState } from "react";

import { runCoverageMap } from "../../api";
import { DEFAULT_SOLVER, EMPTY_ARRAY, TRANSMITTER_PATTERN } from "../../constants";
import { lngLatToScenePosition, solverForScene } from "../../utils/scene";
import SimulationAntennaPanel from "../SimulationAntennaPanel";
import {
  ApiScenePreview,
  CoverageResult,
  FormSection,
  QueueNotice,
  SolverFields,
  coverageDraftStorageKey,
  coverageTransmitter,
  loadCoverageDraft,
  runButtonLabel,
  selectCoverageInventoryAntenna,
  updateForm,
  useApiResult,
  useScenePreviewStatus,
  validateCoverageAzimuth,
  validateCoverageTransmitter,
  validateScenePositions,
} from "./ApiPagesShared";

export function CoverageApiPage({ activeScene, antennas = EMPTY_ARRAY, onCreateAntenna, onProgressChange, onQueueOpen, onSceneLoadingChange, onSimulationQueued }) {
  const fixedAntennas = Array.isArray(antennas) ? antennas : EMPTY_ARRAY;
  const [form, setForm] = useState(() => loadCoverageDraft(activeScene?.id, {
    tilt: 8,
    azimuth: 0,
    tx_power: 30,
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
  const sceneSolver = useMemo(
    () => solverForScene(activeScene, form.solver),
    [activeScene, form.solver],
  );
  const baseTransmitter = useMemo(
    () => coverageTransmitter(form, fixedAntennas),
    [form, fixedAntennas],
  );
  const transmitter = useMemo(
    () => ({
      ...baseTransmitter,
      azimuth: form.azimuth,
    }),
    [baseTransmitter, form.azimuth],
  );
  const transmitterPosition = useMemo(
    () => lngLatToScenePosition(transmitter, activeScene?.bounds),
    [transmitter, activeScene?.bounds],
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
  const selectedTransmitterAntennas = useMemo(
    () => (transmitterPosition && transmitter.id
      ? [{
        ...transmitter,
        id: transmitter.id || "TX",
        position: transmitterPosition,
        azimuth: transmitter.azimuth ?? 0,
        tilt: { ...transmitter.tilt, current: form.tilt },
        tx_power: { ...transmitter.tx_power, current: form.tx_power },
      }]
      : EMPTY_ARRAY),
    [form.tilt, form.tx_power, transmitter, transmitterPosition],
  );

  useEffect(() => {
    setForm((current) => {
      if (current.selected_antenna_id && !fixedAntennas.some((antenna) => (antenna.database_id || antenna.id) === current.selected_antenna_id)) {
        return {
          ...current,
          selected_antenna_id: "",
        };
      }

      return current;
    });
  }, [activeScene?.id, fixedAntennas]);

  useEffect(() => {
    if (activeScene?.id) {
      window.localStorage.setItem(coverageDraftStorageKey(activeScene.id), JSON.stringify(form));
    }
  }, [activeScene?.id, form]);

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

  const isQueued = resultState.result?.status === "queued";

  return (
    <main className="app-shell api-workspace-shell coverage-page">
      <section className="map-panel api-workspace-result" aria-label="Coverage API result">
        <div className="topbar">
          <div>
            <h1>Coverage API</h1>
            <p id="run-status">Render a single-transmitter coverage map for a selected transmitter position, tilt, and power.</p>
          </div>
          <button
            className="primary-button"
            type="submit"
            form="coverage-api-form"
            disabled={resultState.loading || !sceneStatus.isSceneReady || !positionValidation.isValid}
          >
            {runButtonLabel(resultState.loading, sceneStatus.isSceneReady, positionValidation.isValid, "Run coverage")}
          </button>
        </div>
        <div className="api-workspace-stage">
          {resultState.error && <p className="history-status error-text">{resultState.error}</p>}
          {!resultState.error && resultState.loading && <p className="history-status">Waiting for backend...</p>}
          {!resultState.error && isQueued && <QueueNotice result={resultState.result} onQueueOpen={onQueueOpen} />}
          <div className="result-summary">
            {!resultState.error && !resultState.result && (
              <ApiScenePreview
                activeScene={activeScene}
                antennas={selectedTransmitterAntennas}
                isSceneReady={sceneStatus.isSceneReady}
                onSceneLoadingChange={sceneStatus.handleSceneLoadingChange}
              />
            )}
            {!resultState.error && resultState.result && !isQueued && (
              <CoverageResult
                activeScene={activeScene}
                onSceneLoadingChange={sceneStatus.handleSceneLoadingChange}
                result={resultState.result}
              />
            )}
            <form id="coverage-api-form" className="api-form api-scene-setup-form" onSubmit={submit}>
              <fieldset className="api-form-lock" disabled={resultState.loading}>
                <SolverFields solver={sceneSolver} onChange={(solver) => updateForm(setForm, "solver", solver)} />
              </fieldset>
            </form>
          </div>
        </div>
      </section>
      <aside className="control-panel api-workspace-controls" aria-label="Coverage API controls">
        <div className="panel-header">
          <h2>Transmitter</h2>
        </div>
        <div className="api-workspace-form">
          <div className="api-form">
            <FormSection title="Transmitter">
              <SimulationAntennaPanel
                antennaPool={fixedAntennas}
                antennas={selectedTransmitterAntennas}
                disabled={resultState.loading}
                maxAntennas={1}
                onAdd={(antennaIds) => selectCoverageInventoryAntenna(setForm, form, fixedAntennas, antennaIds)}
                onCreate={onCreateAntenna}
                onChange={(_antennaId, field, value) => updateForm(setForm, field, value)}
                onRemove={() => updateForm(setForm, "selected_antenna_id", "")}
                simulationLabel="Coverage API"
              />
              {positionValidation.errors.transmitter_position && <small className="field-error">{positionValidation.errors.transmitter_position}</small>}
              {azimuthError && <small className="field-error">{azimuthError}</small>}
            </FormSection>
          </div>
        </div>
      </aside>
    </main>
  );
}
