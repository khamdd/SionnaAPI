import { describe, expect, it } from "vitest";

import {
  allowedChangesValidationError,
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
