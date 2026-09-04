import { useEffect, useMemo, useState } from "react";
import {
  evaluateNetworkCoverageOptimization,
  previewNetworkCoverageOptimizationCandidates,
} from "../api";

const MAX_OBJECTIVES = 2;
const OPERATORS = ["<=", ">=", "<", ">", "="];

const NETWORK_COVERAGE_OBJECTIVES = [
  {
    id: "uncovered_area_percent",
    label: "Uncovered area",
    unit: "%",
    defaultOperator: "<=",
    defaultValue: 2,
    description: "Limit cells where the coverage map has no usable serving signal.",
  },
  {
    id: "covered_area_percent",
    label: "Covered area",
    unit: "%",
    defaultOperator: ">=",
    defaultValue: 98,
    description: "Require a minimum share of the selected scene to be covered.",
  },
  {
    id: "overlap_area_percent",
    label: "Overlap area",
    unit: "%",
    defaultOperator: "<=",
    defaultValue: 25,
    description: "Control cells affected by multiple antennas and possible interference.",
  },
  {
    id: "average_overlap_count",
    label: "Average overlap",
    unit: "antennas",
    defaultOperator: "<=",
    defaultValue: 2,
    description: "Keep the average number of influential antennas per cell manageable.",
  },
];

const DEFAULT_OBJECTIVE_VALUES = Object.fromEntries(
  NETWORK_COVERAGE_OBJECTIVES.map((objective) => [
    objective.id,
    {
      operator: objective.defaultOperator,
      value: String(objective.defaultValue),
    },
  ]),
);

export default function OptimizationObjectivePage({
  activeAntennas = [],
  activeScene,
  baseRequest,
  latestGrid,
  onBack,
  onLoadLatestResult,
  storageKey,
}) {
  const [selectedIds, setSelectedIds] = useState(() => new Set(["uncovered_area_percent"]));
  const [objectiveValues, setObjectiveValues] = useState(() => DEFAULT_OBJECTIVE_VALUES);
  const [confirmedContract, setConfirmedContract] = useState(null);
  const [evaluationPreview, setEvaluationPreview] = useState(null);
  const [evaluationStatus, setEvaluationStatus] = useState("Run a Network Coverage simulation, confirm objectives, then evaluate the latest result.");
  const [evaluationError, setEvaluationError] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [tiltStep, setTiltStep] = useState("2");
  const [maxCandidates, setMaxCandidates] = useState("20");
  const [candidatePreview, setCandidatePreview] = useState(null);
  const [candidateStatus, setCandidateStatus] = useState("Confirm objectives to preview candidate tilt setups.");
  const [candidateError, setCandidateError] = useState(false);
  const [isGeneratingCandidates, setIsGeneratingCandidates] = useState(false);

  const selectedObjectives = useMemo(
    () => NETWORK_COVERAGE_OBJECTIVES.filter((objective) => selectedIds.has(objective.id)),
    [selectedIds],
  );
  const selectedCount = selectedIds.size;
  const hasInvalidObjective = selectedObjectives.some((objective) => {
    const rawValue = String(objectiveValues[objective.id]?.value ?? "").trim();
    const value = Number(rawValue);
    return rawValue === "" || !Number.isFinite(value);
  });
  const hasLatestGrid = Array.isArray(latestGrid?.cells) && latestGrid.cells.length > 0;
  const candidateRequest = confirmedContract?.base_request || baseRequest;
  const canPreviewCandidates = Boolean(confirmedContract && candidateRequest);
  const hasInvalidCandidateSettings = (
    !Number.isFinite(Number(tiltStep))
    || Number(tiltStep) <= 0
    || !Number.isFinite(Number(maxCandidates))
    || Number(maxCandidates) < 1
  );

  useEffect(() => {
    const storedContract = readStoredOptimizationContract(storageKey, activeScene?.id);

    if (!storedContract) {
      setSelectedIds(new Set(["uncovered_area_percent"]));
      setObjectiveValues(DEFAULT_OBJECTIVE_VALUES);
      setConfirmedContract(null);
      setEvaluationPreview(null);
      setEvaluationStatus("Run a Network Coverage simulation, confirm objectives, then evaluate the latest result.");
      setEvaluationError(false);
      resetCandidatePreview("Confirm objectives to preview candidate tilt setups.");
      return;
    }

    setSelectedIds(new Set(storedContract.objectives.map((objective) => objective.metric)));
    setObjectiveValues(valuesFromStoredContract(storedContract));
    setConfirmedContract(storedContract);
    setEvaluationPreview(null);
    setEvaluationStatus(hasLatestGrid
      ? "Ready to evaluate the latest Network Coverage result."
      : "Run a Network Coverage simulation before evaluating.");
    setEvaluationError(false);
    resetCandidatePreview("Ready to preview candidate tilt setups.");
  }, [activeScene?.id, storageKey]);

  useEffect(() => {
    setEvaluationPreview(null);
    setEvaluationStatus(hasLatestGrid
      ? "Ready to evaluate the latest Network Coverage result."
      : "Run a Network Coverage simulation before evaluating.");
    setEvaluationError(false);
  }, [latestGrid]);

  function toggleObjective(objectiveId) {
    setConfirmedContract(null);
    setEvaluationPreview(null);
    resetCandidatePreview("Confirm objectives to preview candidate tilt setups.");
    setSelectedIds((current) => {
      const next = new Set(current);

      if (next.has(objectiveId)) {
        next.delete(objectiveId);
        return next;
      }

      if (next.size >= MAX_OBJECTIVES) {
        return next;
      }

      next.add(objectiveId);
      return next;
    });
  }

  function updateObjectiveValue(objectiveId, field, value) {
    setConfirmedContract(null);
    setEvaluationPreview(null);
    resetCandidatePreview("Confirm objectives to preview candidate tilt setups.");
    setObjectiveValues((current) => ({
      ...current,
      [objectiveId]: {
        ...current[objectiveId],
        [field]: value,
      },
    }));
  }

  function confirmObjectives(event) {
    event.preventDefault();

    if (selectedCount === 0 || hasInvalidObjective) {
      return;
    }

    const contract = {
      id: `${activeScene?.id || "scene"}:network_coverage`,
      simulation_type: "network_coverage",
      base_request: baseRequest || null,
      scene: {
        id: activeScene?.id || null,
        name: activeScene?.name || "",
      },
      objectives: selectedObjectives.map((objective) => ({
        metric: objective.id,
        label: objective.label,
        operator: objectiveValues[objective.id].operator,
        target: Number(objectiveValues[objective.id].value),
        unit: objective.unit,
      })),
      variables: [
        {
          field: "tilt",
          scope: "enabled_antennas",
        },
      ],
      constraints: {
        max_objectives: MAX_OBJECTIVES,
        max_antennas: 10,
        active_antennas: activeAntennas.length,
      },
    };

    saveConfirmedContract(contract);
  }

  function saveConfirmedContract(contract) {
    setConfirmedContract(contract);
    setEvaluationPreview(null);
    setEvaluationStatus(hasLatestGrid
      ? "Objectives confirmed. Evaluate the latest result when ready."
      : "Objectives confirmed. Run a Network Coverage simulation before evaluating.");
    setEvaluationError(false);
    resetCandidatePreview("Objectives confirmed. Preview candidate tilt setups when ready.");
    persistOptimizationContract(storageKey, activeScene?.id, contract);
  }

  function resetCandidatePreview(status) {
    setCandidatePreview(null);
    setCandidateStatus(status);
    setCandidateError(false);
  }

  async function generateCandidatePreview() {
    if (!canPreviewCandidates || hasInvalidCandidateSettings || isGeneratingCandidates) {
      return;
    }

    setIsGeneratingCandidates(true);
    setCandidateError(false);
    setCandidateStatus("Generating candidate tilt setups...");

    try {
      const payload = {
        base_request: candidateRequest,
        tilt_step: Number(tiltStep),
        max_candidates: Number(maxCandidates),
      };
      const result = await previewCandidatesWithBackendOrLocalFallback(payload);

      setCandidatePreview(result);
      setCandidateStatus(`Generated ${result.generated_count || 0} candidate tilt setup(s).`);
    } catch (error) {
      setCandidatePreview(null);
      setCandidateStatus(`Candidate preview failed: ${error.message}`);
      setCandidateError(true);
    } finally {
      setIsGeneratingCandidates(false);
    }
  }

  async function previewCandidatesWithBackendOrLocalFallback(payload) {
    try {
      return await previewNetworkCoverageOptimizationCandidates(payload);
    } catch {
      return {
        status: "success",
        source: "local",
        ...generateNetworkCoverageTiltCandidates(
          payload.base_request,
          payload.tilt_step,
          payload.max_candidates,
        ),
      };
    }
  }

  async function evaluateLatestResult() {
    if (!confirmedContract || isEvaluating) {
      return;
    }

    setIsEvaluating(true);
    setEvaluationError(false);
    setEvaluationStatus(hasLatestGrid
      ? "Evaluating latest Network Coverage result..."
      : "Looking for the latest completed Network Coverage result...");

    try {
      const latestResult = hasLatestGrid
        ? { grid: latestGrid }
        : await onLoadLatestResult?.();
      const grid = latestResult?.grid;

      if (!Array.isArray(grid?.cells) || grid.cells.length === 0) {
        setEvaluationPreview(null);
        setEvaluationStatus("No completed Network Coverage result is available for this scene yet. If the run was queued, wait for it to finish in Simulation Queue.");
        setEvaluationError(true);
        return;
      }

      const objectives = confirmedContract.objectives.map((objective) => ({
        metric: objective.metric,
        operator: objective.operator,
        target: objective.target,
      }));
      const result = await evaluateWithBackendOrLocalFallback(grid, objectives);

      setEvaluationPreview(result);
      setEvaluationStatus(result.passed
        ? "Latest result satisfies the confirmed objectives."
        : "Latest result does not satisfy every confirmed objective.");
    } catch (error) {
      setEvaluationPreview(null);
      setEvaluationStatus(`Evaluation failed: ${error.message}`);
      setEvaluationError(true);
    } finally {
      setIsEvaluating(false);
    }
  }

  async function evaluateWithBackendOrLocalFallback(grid, objectives) {
    try {
      return await evaluateNetworkCoverageOptimization({
        result: {
          grid,
        },
        objectives,
      });
    } catch {
      return {
        status: "success",
        source: "local",
        ...evaluateNetworkCoverageGrid(grid, objectives),
      };
    }
  }

  return (
    <main className="route-page optimization-page">
      <div className="page-title with-action">
        <div>
          <h1>Network Coverage Optimization</h1>
          <p>Set the target result the optimizer should search for when antenna tilt optimization is enabled.</p>
        </div>
        <button className="ghost-button" type="button" onClick={onBack}>
          Back to Network Coverage
        </button>
      </div>

      <form className="optimization-layout" onSubmit={confirmObjectives}>
        <section className="optimization-panel">
          <div className="optimization-section-header">
            <div>
              <h2>Optimization objectives</h2>
              <p>Choose up to {MAX_OBJECTIVES} target metrics for this phase.</p>
            </div>
            <strong>{selectedCount}/{MAX_OBJECTIVES}</strong>
          </div>

          <div className="objective-grid">
            {NETWORK_COVERAGE_OBJECTIVES.map((objective) => {
              const isSelected = selectedIds.has(objective.id);
              const isLocked = !isSelected && selectedCount >= MAX_OBJECTIVES;
              const values = objectiveValues[objective.id];

              return (
                <article
                  className={`objective-card ${isSelected ? "selected" : ""}`}
                  key={objective.id}
                >
                  <label className="objective-card-header">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={isLocked}
                      onChange={() => toggleObjective(objective.id)}
                    />
                    <span>
                      <strong>{objective.label}</strong>
                      <small>{objective.description}</small>
                    </span>
                  </label>
                  <div className="objective-target-row">
                    <label>
                      <span>Operator</span>
                      <select
                        value={values.operator}
                        disabled={!isSelected}
                        onChange={(event) => updateObjectiveValue(objective.id, "operator", event.target.value)}
                      >
                        {OPERATORS.map((operator) => (
                          <option key={operator} value={operator}>{operator}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Value</span>
                      <div className="objective-value-input">
                        <input
                          type="number"
                          step="any"
                          value={values.value}
                          disabled={!isSelected}
                          aria-invalid={isSelected && (String(values.value).trim() === "" || !Number.isFinite(Number(values.value)))}
                          onChange={(event) => updateObjectiveValue(objective.id, "value", event.target.value)}
                        />
                        <small>{objective.unit}</small>
                      </div>
                    </label>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="optimization-panel optimization-summary-panel">
          <div className="optimization-section-header">
            <div>
              <h2>Optimization input</h2>
              <p>Confirmed objectives become the data contract for the next optimization phase.</p>
            </div>
          </div>

          <dl className="optimization-context">
            <dt>Scene</dt>
            <dd>{activeScene?.name || "No scene selected"}</dd>
            <dt>Active antennas</dt>
            <dd>{activeAntennas.length}</dd>
            <dt>Variable</dt>
            <dd>Antenna tilt</dd>
          </dl>

          <div className="selected-objective-list">
            {selectedObjectives.length > 0 ? selectedObjectives.map((objective) => (
              <div key={objective.id}>
                <span>{objective.label}</span>
                <strong>
                  {objectiveValues[objective.id].operator} {objectiveValues[objective.id].value || "--"} {objective.unit}
                </strong>
              </div>
            )) : (
              <p>Select at least one objective.</p>
            )}
          </div>

          <button
            className="primary-button"
            type="submit"
            disabled={selectedCount === 0 || hasInvalidObjective}
          >
            Confirm
          </button>

          <button
            className="ghost-button"
            type="button"
            disabled={!confirmedContract || isEvaluating}
            onClick={evaluateLatestResult}
          >
            {isEvaluating ? "Evaluating..." : "Evaluate latest result"}
          </button>

          <p className={`optimization-preview-status ${evaluationError ? "error-text" : ""}`}>
            {evaluationStatus}
          </p>

          <div className="candidate-preview-controls">
            <strong>Candidate tilt preview</strong>
            <div>
              <label>
                <span>Tilt step</span>
                <input
                  type="number"
                  min="0.1"
                  max="20"
                  step="0.1"
                  value={tiltStep}
                  aria-invalid={!Number.isFinite(Number(tiltStep)) || Number(tiltStep) <= 0}
                  onChange={(event) => {
                    setTiltStep(event.target.value);
                    resetCandidatePreview("Preview settings changed.");
                  }}
                />
              </label>
              <label>
                <span>Max candidates</span>
                <input
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={maxCandidates}
                  aria-invalid={!Number.isFinite(Number(maxCandidates)) || Number(maxCandidates) < 1}
                  onChange={(event) => {
                    setMaxCandidates(event.target.value);
                    resetCandidatePreview("Preview settings changed.");
                  }}
                />
              </label>
            </div>
            <button
              className="ghost-button"
              type="button"
              disabled={!canPreviewCandidates || hasInvalidCandidateSettings || isGeneratingCandidates}
              onClick={generateCandidatePreview}
            >
              {isGeneratingCandidates ? "Generating..." : "Generate candidate preview"}
            </button>
            <p className={`optimization-preview-status ${candidateError ? "error-text" : ""}`}>
              {candidateStatus}
            </p>
          </div>

          {confirmedContract && (
            <div className="optimization-contract">
              <strong>Confirmed best-result data</strong>
              <pre>{JSON.stringify(confirmedContract, null, 2)}</pre>
            </div>
          )}

          {evaluationPreview && (
            <EvaluationPreview
              evaluation={evaluationPreview}
              objectives={confirmedContract?.objectives || []}
            />
          )}

          {candidatePreview && (
            <CandidatePreview preview={candidatePreview} />
          )}
        </aside>
      </form>
    </main>
  );
}

function CandidatePreview({ preview }) {
  return (
    <div className="candidate-preview-list">
      <div>
        <strong>Candidate setups</strong>
        <span>{preview.generated_count || 0}/{preview.max_candidates || 0}</span>
      </div>
      {(preview.candidates || []).map((candidate) => (
        <article key={candidate.id}>
          <div>
            <strong>{candidate.label}</strong>
            <span>{candidate.changes?.length ? `${candidate.changes.length} change(s)` : "Baseline"}</span>
          </div>
          <p>{formatTiltMap(candidate.tilts)}</p>
        </article>
      ))}
    </div>
  );
}

function EvaluationPreview({ evaluation, objectives }) {
  const objectiveByMetric = new Map(
    objectives.map((objective) => [objective.metric, objective]),
  );

  return (
    <div className="optimization-evaluation-preview">
      <div>
        <strong>Latest result preview</strong>
        <span>{evaluation.passed ? "Passed" : "Needs improvement"}</span>
      </div>
      <dl className="optimization-context">
        <dt>Total score</dt>
        <dd>{formatNumber(evaluation.score)}</dd>
        <dt>Covered area</dt>
        <dd>{formatMetric(evaluation.kpis?.covered_area_percent, "%")}</dd>
        <dt>Uncovered area</dt>
        <dd>{formatMetric(evaluation.kpis?.uncovered_area_percent, "%")}</dd>
      </dl>
      <div className="objective-evaluation-list">
        {(evaluation.evaluations || []).map((item) => {
          const objective = objectiveByMetric.get(item.metric);
          return (
            <div className={item.passed ? "passed" : "failed"} key={item.metric}>
              <span>{objective?.label || item.metric}</span>
              <strong>{item.passed ? "Pass" : "Fail"}</strong>
              <small>
                Actual {formatMetric(item.actual, objective?.unit)}
                {" "}vs {item.operator} {formatMetric(item.target, objective?.unit)}
              </small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function valuesFromStoredContract(contract) {
  const values = {
    ...DEFAULT_OBJECTIVE_VALUES,
  };

  for (const objective of contract.objectives) {
    values[objective.metric] = {
      operator: objective.operator,
      value: String(objective.target),
    };
  }

  return values;
}

function readStoredOptimizationContract(storageKey, sceneId) {
  if (!storageKey || !sceneId) {
    return null;
  }

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    return normalizeStoredContract(saved[sceneId]);
  } catch {
    return null;
  }
}

function persistOptimizationContract(storageKey, sceneId, contract) {
  if (!storageKey || !sceneId || !contract) {
    return;
  }

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    saved[sceneId] = contract;
    localStorage.setItem(storageKey, JSON.stringify(saved));
  } catch {
    // Best-effort browser storage; the confirmed state remains visible in memory.
  }
}

function normalizeStoredContract(contract) {
  if (!contract || contract.simulation_type !== "network_coverage") {
    return null;
  }

  if (!Array.isArray(contract.objectives)) {
    return null;
  }

  const objectives = contract.objectives
    .filter((objective) => (
      NETWORK_COVERAGE_OBJECTIVES.some((candidate) => candidate.id === objective?.metric)
      && OPERATORS.includes(objective?.operator)
      && Number.isFinite(Number(objective?.target))
    ))
    .slice(0, MAX_OBJECTIVES);

  if (objectives.length === 0) {
    return null;
  }

  return {
    ...contract,
    objectives,
  };
}

function generateNetworkCoverageTiltCandidates(baseRequest, tiltStep, maxCandidates) {
  const antennas = Array.isArray(baseRequest?.antennas) ? baseRequest.antennas : [];
  const step = Number(tiltStep);
  const limit = Math.max(1, Math.floor(Number(maxCandidates)));
  const baselineTilts = Object.fromEntries(
    antennas.map((antenna) => [antenna.id, Number(antenna.tilt?.current)]),
  );
  const candidates = [];
  const seen = new Set();

  addCandidate(candidates, seen, "baseline", "Current setup", baselineTilts, baselineTilts, limit);

  [
    [step, "all_up", `All antennas +${formatCandidateStep(step)} deg`],
    [-step, "all_down", `All antennas -${formatCandidateStep(step)} deg`],
  ].forEach(([direction, id, label]) => {
    const tilts = Object.fromEntries(
      antennas.map((antenna) => [
        antenna.id,
        clampTilt(Number(antenna.tilt?.current) + direction, antenna.tilt),
      ]),
    );
    addCandidate(candidates, seen, id, label, tilts, baselineTilts, limit);
  });

  antennas.forEach((antenna) => {
    [
      [step, "up", `${antenna.id} +${formatCandidateStep(step)} deg`],
      [-step, "down", `${antenna.id} -${formatCandidateStep(step)} deg`],
    ].forEach(([direction, suffix, label]) => {
      const tilts = {
        ...baselineTilts,
        [antenna.id]: clampTilt(Number(antenna.tilt?.current) + direction, antenna.tilt),
      };

      addCandidate(candidates, seen, `${antenna.id}_${suffix}`, label, tilts, baselineTilts, limit);
    });
  });

  return {
    tilt_step: step,
    max_candidates: limit,
    generated_count: candidates.length,
    antenna_count: antennas.length,
    candidates,
  };
}

function addCandidate(candidates, seen, id, label, tilts, baselineTilts, limit) {
  if (candidates.length >= limit) {
    return;
  }

  const key = Object.keys(tilts)
    .sort()
    .map((antennaId) => `${antennaId}:${tilts[antennaId]}`)
    .join("|");

  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  candidates.push({
    id,
    label,
    tilts,
    changes: Object.keys(tilts)
      .sort()
      .filter((antennaId) => Math.abs(tilts[antennaId] - baselineTilts[antennaId]) > Number.EPSILON)
      .map((antennaId) => ({
        antenna_id: antennaId,
        from: baselineTilts[antennaId],
        to: tilts[antennaId],
        delta: roundCandidateNumber(tilts[antennaId] - baselineTilts[antennaId]),
      })),
  });
}

function clampTilt(value, tilt) {
  return roundCandidateNumber(Math.min(
    Math.max(value, Number(tilt?.min)),
    Number(tilt?.max),
  ));
}

function formatTiltMap(tilts) {
  return Object.entries(tilts || {})
    .map(([antennaId, tilt]) => `${antennaId}: ${formatNumber(tilt)} deg`)
    .join(" | ");
}

function formatCandidateStep(step) {
  return Number(step).toFixed(2).replace(/\.?0+$/, "");
}

function roundCandidateNumber(value) {
  return Math.round(Number(value) * 1000000) / 1000000;
}

function evaluateNetworkCoverageGrid(grid, objectives) {
  const kpis = extractNetworkCoverageKpis(grid);
  const evaluations = objectives.map((objective) => evaluateObjective(kpis, objective));
  const scores = evaluations.map((evaluation) => evaluation.score);

  return {
    passed: evaluations.every((evaluation) => evaluation.passed),
    score: scores.some((score) => !Number.isFinite(score))
      ? Infinity
      : scores.reduce((total, score) => total + score, 0),
    kpis,
    evaluations,
  };
}

function extractNetworkCoverageKpis(grid) {
  const cells = Array.isArray(grid?.cells) ? grid.cells : [];
  const totalCells = cells.length;
  const coveredCells = cells.filter((cell) => !isNoCoverageCell(cell));
  const uncoveredCells = cells.length - coveredCells.length;
  const overlapSummary = grid?.overlap_summary || {};

  return {
    total_cells: totalCells,
    covered_cells: coveredCells.length,
    uncovered_cells: uncoveredCells,
    uncovered_area_percent: percent(uncoveredCells, totalCells),
    covered_area_percent: percent(coveredCells.length, totalCells),
    overlap_area_percent: numericValue(overlapSummary.overlap_percent) ?? percent(
      cells.filter((cell) => numericValue(cell.overlap_count) >= 2).length,
      totalCells,
    ),
    average_overlap_count: numericValue(overlapSummary.average_overlap_count) ?? averageOverlapCount(coveredCells),
  };
}

function evaluateObjective(kpis, objective) {
  const actual = numericValue(kpis[objective.metric]);
  const target = numericValue(objective.target);

  return {
    metric: objective.metric,
    operator: objective.operator,
    target,
    actual,
    passed: actual !== null && target !== null && compareMetric(actual, objective.operator, target),
    score: actual === null || target === null ? Infinity : objectiveScore(actual, objective.operator, target),
  };
}

function compareMetric(actual, operator, target) {
  if (operator === "<") {
    return actual < target;
  }
  if (operator === "<=") {
    return actual <= target;
  }
  if (operator === ">") {
    return actual > target;
  }
  if (operator === ">=") {
    return actual >= target;
  }
  if (operator === "=") {
    return Math.abs(actual - target) <= Number.EPSILON;
  }
  return false;
}

function objectiveScore(actual, operator, target) {
  if (operator === "<" || operator === "<=") {
    return Math.max(0, actual - target);
  }
  if (operator === ">" || operator === ">=") {
    return Math.max(0, target - actual);
  }
  if (operator === "=") {
    return Math.abs(actual - target);
  }
  return Infinity;
}

function isNoCoverageCell(cell) {
  if (!cell || typeof cell !== "object") {
    return true;
  }

  if (cell.overlap_level === "no_coverage") {
    return true;
  }

  const overlapCount = numericValue(cell.overlap_count);
  if (overlapCount !== null) {
    return overlapCount <= 0;
  }

  return numericValue(cell.sinr_db) === null;
}

function averageOverlapCount(cells) {
  const counts = cells
    .map((cell) => numericValue(cell.overlap_count))
    .filter((value) => value !== null && value > 0);

  if (!counts.length) {
    return 0;
  }

  return Math.round((counts.reduce((total, value) => total + value, 0) / counts.length) * 100) / 100;
}

function percent(part, total) {
  if (!total) {
    return 0;
  }

  return Math.round((part / total) * 10000) / 100;
}

function numericValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatMetric(value, unit = "") {
  if (!Number.isFinite(Number(value))) {
    return "--";
  }

  return `${formatNumber(value)}${unit ? ` ${unit}` : ""}`;
}

function formatNumber(value) {
  if (!Number.isFinite(Number(value))) {
    return "--";
  }

  return Number(value).toFixed(2).replace(/\.00$/, "");
}
