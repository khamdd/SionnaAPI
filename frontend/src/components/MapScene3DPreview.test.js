import { describe, expect, it } from "vitest";
import {
  antennaFeatures,
  cellFeature,
  colorForCoverageCell,
  constrainedSceneCenter,
  coverageCellAtLngLat,
  offlineBuildingFeatureCollection,
  signalLinkFeatures,
  viewportMaskVertices,
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

  it("keeps buildings in one MapLibre GeoJSON source at every zoom", () => {
    const collection = offlineBuildingFeatureCollection([
      {
        id: "b1",
        tags: { "building:levels": "3" },
        geometry: [
          { lon: 106, lat: 10 },
          { lon: 106.001, lat: 10 },
          { lon: 106.001, lat: 10.001 },
        ],
      },
    ]);
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].properties.height).toBeCloseTo(9.3);
    expect(collection.features[0].geometry.coordinates[0]).toHaveLength(4);
  });

  it("builds four WebGL rectangles around the selected scene", () => {
    const vertices = viewportMaskVertices(bounds);
    expect(vertices).toHaveLength(48);
    expect(vertices.every(Number.isFinite)).toBe(true);
  });

  it("constrains panning without imposing a minimum zoom", () => {
    expect(constrainedSceneCenter({ lng: 105, lat: 11 }, bounds)).toEqual({
      lng: bounds.west,
      lat: bounds.north,
    });
    expect(constrainedSceneCenter({ lng: 106.005, lat: 10.005 }, bounds)).toEqual({
      lng: 106.005,
      lat: 10.005,
    });
  });
});
