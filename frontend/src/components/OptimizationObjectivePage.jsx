import { useEffect, useMemo, useState } from "react";
import { evaluateNetworkCoverageOptimization } from "../api";

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
    id: "poor_sinr_area_percent",
    label: "Poor SINR area",
    unit: "%",
    defaultOperator: "<=",
    defaultValue: 5,
    description: "Reduce the share of cells below the poor-quality SINR threshold.",
  },
  {
    id: "minimum_sinr_db",
    label: "Minimum SINR",
    unit: "dB",
    defaultOperator: ">=",
    defaultValue: 0,
    description: "Protect the weakest served cells from dropping below a target SINR.",
  },
  {
    id: "median_throughput_mbps",
    label: "Median throughput",
    unit: "Mbps",
    defaultOperator: ">=",
    defaultValue: 50,
    description: "Push the typical user-cell throughput above the engineer target.",
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
  storageKey,
}) {
  const [selectedIds, setSelectedIds] = useState(() => new Set(["uncovered_area_percent"]));
  const [objectiveValues, setObjectiveValues] = useState(() => DEFAULT_OBJECTIVE_VALUES);
  const [confirmedContract, setConfirmedContract] = useState(null);
  const [evaluationPreview, setEvaluationPreview] = useState(null);
  const [evaluationStatus, setEvaluationStatus] = useState("Run a Network Coverage simulation, confirm objectives, then evaluate the latest result.");
  const [evaluationError, setEvaluationError] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);

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

  useEffect(() => {
    const storedContract = readStoredOptimizationContract(storageKey, activeScene?.id);

    if (!storedContract) {
      setSelectedIds(new Set(["uncovered_area_percent"]));
      setObjectiveValues(DEFAULT_OBJECTIVE_VALUES);
      setConfirmedContract(null);
      setEvaluationPreview(null);
      setEvaluationStatus("Run a Network Coverage simulation, confirm objectives, then evaluate the latest result.");
      setEvaluationError(false);
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
    persistOptimizationContract(storageKey, activeScene?.id, contract);
  }

  async function evaluateLatestResult() {
    if (!confirmedContract || !hasLatestGrid || isEvaluating) {
      return;
    }

    setIsEvaluating(true);
    setEvaluationError(false);
    setEvaluationStatus("Evaluating latest Network Coverage result...");

    try {
      const result = await evaluateNetworkCoverageOptimization({
        result: {
          grid: latestGrid,
        },
        objectives: confirmedContract.objectives.map((objective) => ({
          metric: objective.metric,
          operator: objective.operator,
          target: objective.target,
        })),
      });

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
            disabled={!confirmedContract || !hasLatestGrid || isEvaluating}
            onClick={evaluateLatestResult}
          >
            {isEvaluating ? "Evaluating..." : "Evaluate latest result"}
          </button>

          <p className={`optimization-preview-status ${evaluationError ? "error-text" : ""}`}>
            {evaluationStatus}
          </p>

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
        </aside>
      </form>
    </main>
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
