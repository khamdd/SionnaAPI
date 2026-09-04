import { useMemo, useState } from "react";

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

export default function OptimizationObjectivePage({
  activeAntennas = [],
  activeScene,
  onBack,
}) {
  const [selectedIds, setSelectedIds] = useState(() => new Set(["uncovered_area_percent"]));
  const [objectiveValues, setObjectiveValues] = useState(() => (
    Object.fromEntries(
      NETWORK_COVERAGE_OBJECTIVES.map((objective) => [
        objective.id,
        {
          operator: objective.defaultOperator,
          value: String(objective.defaultValue),
        },
      ]),
    )
  ));
  const [confirmedContract, setConfirmedContract] = useState(null);

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

  function toggleObjective(objectiveId) {
    setConfirmedContract(null);
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

    setConfirmedContract({
      simulation_type: "network_coverage",
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
    });
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

          {confirmedContract && (
            <div className="optimization-contract">
              <strong>Confirmed best-result data</strong>
              <pre>{JSON.stringify(confirmedContract, null, 2)}</pre>
            </div>
          )}
        </aside>
      </form>
    </main>
  );
}
