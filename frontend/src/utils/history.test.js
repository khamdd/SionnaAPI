import { describe, expect, it } from "vitest";

import {
  compareButtonTitle,
  historyListSubtitle,
  isSuccessfulHistoryItem,
  pruneComparisonDetails,
  pruneComparisonSelection,
} from "./history";

describe("isSuccessfulHistoryItem", () => {
  it("matches the success status case-insensitively", () => {
    expect(isSuccessfulHistoryItem({ status: "success" })).toBe(true);
    expect(isSuccessfulHistoryItem({ status: "Success" })).toBe(true);
    expect(isSuccessfulHistoryItem({ status: "SUCCESS" })).toBe(true);
  });

  it("rejects other or missing statuses", () => {
    expect(isSuccessfulHistoryItem({ status: "failure" })).toBe(false);
    expect(isSuccessfulHistoryItem({ status: "partial_failure" })).toBe(false);
    expect(isSuccessfulHistoryItem({})).toBe(false);
    expect(isSuccessfulHistoryItem({ status: null })).toBe(false);
  });
});

describe("compareButtonTitle", () => {
  it("blocks failed simulations", () => {
    expect(
      compareButtonTitle(
        { status: "failure", simulation_type: "sinr" },
        true,
        false,
        "sinr",
        "Scene A",
      ),
    ).toBe("Failed simulations cannot be compared");
  });

  it("explains incompatible comparisons while comparing", () => {
    expect(
      compareButtonTitle(
        { status: "success", simulation_type: "sinr" },
        true,
        false,
        "throughput_comparison",
        "Scene A",
      ),
    ).toBe(
      "Only successful Throughput Comparison runs from Scene A can be compared now",
    );
  });

  it("falls back to the same-scene wording without a scene name", () => {
    expect(
      compareButtonTitle(
        { status: "success", simulation_type: "sinr" },
        true,
        false,
        "sinr",
        "",
      ),
    ).toBe("Only successful Sinr runs from the same scene can be compared now");
  });

  it("describes the comparison target when idle", () => {
    expect(
      compareButtonTitle(
        { status: "success", simulation_type: "sinr" },
        false,
        true,
        "sinr",
        "Scene A",
      ),
    ).toBe("Compare Sinr history");
  });
});

describe("historyListSubtitle", () => {
  it("formats SINR runs as point results", () => {
    expect(
      historyListSubtitle({
        simulation_type: "sinr",
        scene_name: "Hanoi",
        status: "success",
      }),
    ).toBe("SINR point | Hanoi | success");
  });

  it("formats throughput runs with bandwidth and MIMO layers", () => {
    expect(
      historyListSubtitle({
        simulation_type: "throughput_comparison",
        bandwidth_mhz: 100,
        mimo_layers: 4,
        scene_name: "Hanoi",
      }),
    ).toBe("100 MHz | 4 layers | Hanoi");
    expect(
      historyListSubtitle({
        simulation_type: "throughput_comparison",
        bandwidth_mhz: null,
        mimo_layers: null,
        scene_name: "Hanoi",
      }),
    ).toBe("-- MHz | -- layers | Hanoi");
  });

  it("formats coverage map runs with cell size", () => {
    expect(
      historyListSubtitle({
        simulation_type: "coverage_map",
        cell_size_m: 5,
        scene_name: "Hanoi",
      }),
    ).toBe("Cell 5 m | Hanoi");
  });

  it("uses the generic cell/bandwidth/layers line for other types", () => {
    expect(
      historyListSubtitle({
        simulation_type: "network_coverage",
        cell_size_m: 10,
        bandwidth_mhz: 20,
        mimo_layers: null,
        scene_name: "Da Nang",
      }),
    ).toBe("Cell 10 m | 20 MHz | -- layers | Da Nang");
    expect(
      historyListSubtitle({ simulation_type: "rsrp_simulation" }),
    ).toBe("Cell -- m | -- MHz | -- layers | --");
  });
});

describe("pruneComparisonSelection", () => {
  const items = [
    { id: "run-1", simulation_type: "sinr", scene_id: "scene-1", status: "success" },
    { id: "run-2", simulation_type: "sinr", scene_id: "scene-1", status: "failure" },
    { id: "run-3", simulation_type: "sinr", scene_id: "scene-2", status: "success" },
    { id: "run-4", simulation_type: "rsrp_simulation", scene_id: "scene-1", status: "success" },
  ];

  it("keeps only compatible successful selections", () => {
    const current = new Set(["run-1", "run-2", "run-3", "run-4"]);

    expect(
      pruneComparisonSelection(current, items, "sinr", "scene-1"),
    ).toEqual(new Set(["run-1"]));
  });

  it("returns an empty selection when nothing is compatible", () => {
    expect(
      pruneComparisonSelection(new Set(["run-2"]), items, "sinr", "scene-1"),
    ).toEqual(new Set());
  });

  it("returns the current selection unchanged without a comparison type", () => {
    const current = new Set(["run-9"]);

    expect(pruneComparisonSelection(current, items, "", "scene-1")).toBe(current);
  });
});

describe("pruneComparisonDetails", () => {
  it("drops details whose run no longer exists", () => {
    const current = new Map([
      ["run-1", { id: "run-1" }],
      ["run-2", { id: "run-2" }],
    ]);
    const items = [{ id: "run-1" }];

    expect(pruneComparisonDetails(current, items)).toEqual(
      new Map([["run-1", { id: "run-1" }]]),
    );
  });
});
