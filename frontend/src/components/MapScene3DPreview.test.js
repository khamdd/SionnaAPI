import { describe, expect, it } from "vitest";
import {
  antennaFeatures,
  cellFeature,
  colorForCoverageCell,
  coverageCellAtLngLat,
  signalLinkFeatures,
  viewportMaskFeatures,
  worldPositionToLngLat,
} from "./MapScene3DPreview";

const bounds = { south: 10, west: 106, north: 10.01, east: 106.01 };
const solver = { center: [0, 0, 0], size: [1096.5, 1113.2, 10], cell_size: 2 };

describe("MapScene3DPreview overlay projection", () => {
  it("projects Sionna coordinates to the same scene bounds", () => {
    expect(worldPositionToLngLat([0, 0, 0], solver, bounds)).toEqual([106.005, 10.005]);
  });

  it("creates selectable cell geometry and resolves a map click to that cell", () => {
    const grid = { rows: 2, cols: 2, cells: [{ row: 0, col: 0, signal_dbm: -80 }] };
    const data = { bounds, solver, coverageGrid: grid };
    expect(cellFeature(grid.cells[0], solver, bounds).geometry.coordinates[0]).toHaveLength(5);
    expect(coverageCellAtLngLat({ lng: 106.00001, lat: 10.00001 }, data)).toBe(grid.cells[0]);
  });

  it("keeps antenna directions, link overlays, and coverage colors available", () => {
    const antennas = antennaFeatures([
      { id: "A1", longitude: 106.005, latitude: 10.005, azimuth: 0 },
      { id: "RX", kind: "receiver-point", position: [0, 0, 0] },
    ], solver, bounds);
    const links = signalLinkFeatures([{ from: [0, 0, 0], to: [20, 20, 0], type: "serving" }], solver, bounds);
    expect(antennas.features).toHaveLength(3);
    expect(links.features[0].properties.color).toBe("#22c55e");
    expect(colorForCoverageCell({ overlap_level: "high_overlap" }, "overlap")).toContain("234, 179, 8");
  });

  it("masks the nationwide basemap outside the selected scene", () => {
    const mask = viewportMaskFeatures(bounds);
    expect(mask.features).toHaveLength(4);
    expect(mask.features.every((feature) => feature.geometry.coordinates[0].length === 5)).toBe(true);
  });
});
