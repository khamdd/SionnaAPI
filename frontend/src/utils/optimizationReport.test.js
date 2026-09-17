import { describe, expect, it } from "vitest";

import { buildOptimizationReport } from "./optimizationReport";

describe("optimization engineering report", () => {
  it("renders escaped results, decisions, settings, guardrails, alternatives, and maps", () => {
    const grid = { rows: 1, cols: 2, cells: [
      { row: 0, col: 0, signal_dbm: -100 },
      { row: 0, col: 1, signal_dbm: -90 },
    ] };
    const evaluation = {
      passed: true,
      guardrails_passed: true,
      evaluations: [{ actual: 92, passed: true }],
      guardrails: [{ metric: "sinr_db_p10", baseline: 3, actual: 5, max_regression: 0, passed: true }],
    };
    const recommended = {
      id: "best",
      evaluation,
      settings: { "A<1": { tilt: 5, tx_power: 31, azimuth: 90 } },
      changes: [{ antenna_id: "A<1", field: "tilt", from: 3, to: 5, delta: 2 }],
      change_cost: { changed_antennas: 1 },
    };
    const report = buildOptimizationReport({
      scene: { id: "scene-1", name: "Test <scene>" },
      generatedAt: new Date("2026-01-01T00:00:00Z"),
      result: { grid, optimization: {
        baseline: { settings: { "A<1": { tilt: 3, tx_power: 30, azimuth: 90 } }, evaluation: { evaluations: [{ actual: 80 }] } },
        recommended_candidate: recommended,
        alternatives: [{ evaluation, changes: [], change_cost: { changed_antennas: 0 } }],
        objectives: [{ metric: "covered_area_percent", operator: ">=", target: 90 }],
        comparison: { baseline_grid: grid },
        recommendation_reason: "Best safe result.",
        tested_count: 12,
        budget_limit: 20,
        budget_saved: 8,
        stop_reason: "targets_met",
      } },
    });

    expect(report).toContain("Test &lt;scene&gt;");
    expect(report).not.toContain("Test <scene>");
    expect(report).toContain("A&lt;1");
    expect(report).toContain("Tilt 3°, power 30 dBm, azimuth 90°");
    expect(report).toContain("P10 SINR");
    expect(report).toContain("Alternative 1");
    expect(report).toContain("Starting coverage");
    expect(report).toContain("<svg");
    expect(report).toContain("8 simulations");
  });

  it("coalesces same-color heatmap cells to keep reports small", () => {
    const grid = {
      rows: 40,
      cols: 40,
      cells: Array.from({ length: 1600 }, (_, index) => ({
        row: Math.floor(index / 40),
        col: index % 40,
        signal_dbm: -90,
      })),
    };
    const report = buildOptimizationReport({
      scene: { id: "scene-1", name: "Test" },
      result: {
        grid,
        optimization: {
          baseline: { evaluation: { evaluations: [] } },
          recommended_candidate: { evaluation: { evaluations: [] } },
          comparison: { baseline_grid: grid },
        },
      },
    });

    expect((report.match(/<rect /g) || []).length).toBe(120);
  });
});
