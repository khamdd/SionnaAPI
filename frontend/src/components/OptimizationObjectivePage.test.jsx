import { describe, expect, it } from "vitest";

import {
  allowedChangesValidationError,
  buildOptimizationOutcome,
  explainLowerRank,
  normalizeObjective,
  objectiveLabel,
  objectiveTarget,
  optimizationDisabledReason,
  serializeObjective,
} from "./OptimizationObjectivePage";


describe("optimization RF objectives", () => {
  it("keeps stored legacy objectives compatible", () => {
    expect(normalizeObjective({
      metric: "covered_area_percent",
      operator: ">=",
      target: 95,
    })).toEqual({
      kind: "aggregate",
      metric: "covered_area_percent",
      operator: ">=",
      target: 95,
    });
  });

  it("serializes a threshold-area engineering statement", () => {
    const objective = {
      kind: "threshold_area",
      measurement: "rsrp_dbm",
      threshold_operator: ">=",
      threshold: "-110",
      operator: ">=",
      target: "95",
    };

    expect(serializeObjective(objective)).toEqual({
      kind: "threshold_area",
      measurement: "rsrp_dbm",
      threshold_operator: ">=",
      threshold: -110,
      operator: ">=",
      target: 95,
    });
    expect(objectiveLabel(objective)).toBe("Area with RSRP >= -110 dBm");
    expect(objectiveTarget(objective)).toBe(">= 95 %");
  });

  it("serializes and labels a percentile objective", () => {
    const objective = {
      kind: "percentile",
      measurement: "sinr_db",
      percentile: "10",
      operator: ">=",
      target: "5",
    };

    expect(serializeObjective(objective)).toEqual({
      kind: "percentile",
      measurement: "sinr_db",
      percentile: 10,
      operator: ">=",
      target: 5,
    });
    expect(objectiveLabel(objective)).toBe("P10 SINR");
    expect(objectiveTarget(objective)).toBe(">= 5 dB");
  });

  it("explains why optimization cannot start", () => {
    const common = {
      busy: false,
      saving: false,
      baseRequest: { antennas: [{ id: "A1" }] },
      objectiveValid: true,
      allowedChangesActive: true,
      changeFields: ["tilt"],
      eligibleAntennaIds: ["A1"],
      allowedChangesError: "",
      guardrailsActive: false,
      guardrailsValid: true,
    };

    expect(optimizationDisabledReason({ ...common, changeFields: [] })).toBe(
      "Allow at least one setting: tilt, power, or azimuth.",
    );
    expect(optimizationDisabledReason({ ...common, eligibleAntennaIds: [] })).toBe(
      "Allow at least one antenna to change.",
    );
    expect(optimizationDisabledReason({ ...common, allowedChangesError: "Invalid safety limit." })).toBe(
      "Invalid safety limit.",
    );
    expect(optimizationDisabledReason({ ...common, allowedChangesActive: false })).toBe("");
    expect(
      optimizationDisabledReason({ ...common, guardrailsActive: true, guardrailsValid: false }),
    ).toBe("Set a maximum regression of 0 or more for every guardrail.");
    expect(optimizationDisabledReason(common)).toBe("");
  });
});

describe("optimization safety limits", () => {
  const valid = {
    active: true,
    changeFields: ["tilt", "tx_power", "azimuth"],
    maxTiltChange: 10,
    maxPowerChange: 6,
    maxAzimuthChange: 60,
    maxChangedAntennas: 2,
    antennaCount: 3,
  };

  it.each([
    [{ maxTiltChange: "" }, "Maximum tilt change must be greater than 0 and at most 20°."],
    [{ maxTiltChange: 0 }, "Maximum tilt change must be greater than 0 and at most 20°."],
    [{ maxPowerChange: -1 }, "Maximum power change must be greater than 0 and at most 20 dB."],
    [{ maxAzimuthChange: 181 }, "Maximum azimuth change must be greater than 0 and at most 180°."],
    [{ maxChangedAntennas: 1.5 }, "Maximum antennas changed must be a whole number between 1 and 3."],
    [{ maxChangedAntennas: 4 }, "Maximum antennas changed must be a whole number between 1 and 3."],
  ])("rejects an invalid safety limit", (override, message) => {
    expect(allowedChangesValidationError({ ...valid, ...override })).toBe(message);
  });

  it("ignores limits for parameters that are not selected", () => {
    expect(allowedChangesValidationError({
      ...valid,
      changeFields: ["tilt"],
      maxPowerChange: "",
      maxAzimuthChange: 999,
    })).toBe("");
  });

  it("accepts valid limits and disables validation when safety controls are off", () => {
    expect(allowedChangesValidationError(valid)).toBe("");
    expect(allowedChangesValidationError({ ...valid, active: false, maxTiltChange: "" })).toBe("");
  });
});

describe("optimization outcome explanation", () => {
  const objective = { kind: "aggregate", metric: "covered_area_percent", operator: ">=", target: 90 };
  const candidate = ({ id, actual, score, passed, guardrailsPassed = true, changes = [], changedAntennas = 0 }) => ({
    id,
    changes,
    change_cost: { changed_antennas: changedAntennas, normalized_magnitude: changes.length },
    evaluation: {
      objectives_passed: passed,
      guardrails_passed: guardrailsPassed,
      evaluations: [{ actual, score, normalization_scale: 100, passed }],
      guardrails: [{ metric: "sinr_db_p10", passed: guardrailsPassed }],
    },
  });

  it("explains target improvement, antenna changes, safety filtering, and alternatives", () => {
    const baseline = candidate({ id: "baseline", actual: 70, score: 20, passed: false });
    const recommended = candidate({
      id: "best",
      actual: 92,
      score: 0,
      passed: true,
      changes: [
        { antenna_id: "A1", field: "tilt", from: 5, to: 7 },
        { antenna_id: "A1", field: "tx_power", from: 30, to: 31 },
      ],
      changedAntennas: 1,
    });
    const unsafe = candidate({ id: "unsafe", actual: 95, score: 0, passed: true, guardrailsPassed: false });
    const alternative = candidate({ id: "alternative", actual: 85, score: 5, passed: false, changedAntennas: 2 });
    const outcome = buildOptimizationOutcome({
      objectives: [objective],
      baseline,
      recommended_candidate: recommended,
      alternatives: [alternative],
      trials: [baseline, recommended, unsafe, alternative],
    }, recommended);

    expect(outcome.targets[0].status).toBe("Improved, target met");
    expect(outcome.targets[0].text).toContain("70 % → 92 %");
    expect(outcome.changes).toEqual([{ antennaId: "A1", text: "tilt 5 → 7; power 30 → 31" }]);
    expect(outcome.safety.text).toContain("1 other setup met the targets or scored better, but was rejected");
    expect(outcome.alternatives[0].reason).toContain("misses at least one target");
  });

  it("explains guardrail and change-cost ranking reasons", () => {
    const recommended = candidate({ id: "best", actual: 90, score: 0, passed: true, changedAntennas: 1 });
    const unsafe = candidate({ id: "unsafe", actual: 95, score: 0, passed: true, guardrailsPassed: false });
    const largerChange = candidate({ id: "larger", actual: 90, score: 0, passed: true, changedAntennas: 2 });

    expect(explainLowerRank(recommended, unsafe)).toBe("Rejected because it violates a safety guardrail.");
    expect(explainLowerRank(recommended, largerChange)).toContain("changes more antennas");
  });
});
