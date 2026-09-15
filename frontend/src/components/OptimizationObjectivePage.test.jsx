import { describe, expect, it } from "vitest";

import {
  normalizeObjective,
  objectiveLabel,
  objectiveTarget,
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
});
