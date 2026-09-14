import { describe, expect, it } from "vitest";

import {
  createSceneWardBoundary,
  projectWardBoundaryRings,
  wardBoundaryCoordinateRings,
} from "./wardBoundary";

const WARD_FEATURE = {
  type: "Feature",
  id: "00166",
  properties: {
    ward_code: "00166",
    ward_name: "Cầu Giấy",
    ward_full_name: "Phường Cầu Giấy",
    ignored: "not persisted",
  },
  geometry: {
    type: "Polygon",
    coordinates: [[
      [105.8, 21.0],
      [105.81, 21.0],
      [105.81, 21.01],
      [105.8, 21.0],
    ]],
  },
};

describe("createSceneWardBoundary", () => {
  it("keeps only the ward metadata needed by saved scenes", () => {
    expect(createSceneWardBoundary(WARD_FEATURE)).toEqual({
      type: "Feature",
      properties: {
        ward_code: "00166",
        ward_name: "Cầu Giấy",
        ward_full_name: "Phường Cầu Giấy",
      },
      geometry: WARD_FEATURE.geometry,
    });
  });

  it("rejects malformed boundary features", () => {
    expect(createSceneWardBoundary(null)).toBeNull();
    expect(createSceneWardBoundary({ ...WARD_FEATURE, geometry: null })).toBeNull();
  });
});

describe("wardBoundaryCoordinateRings", () => {
  it("flattens polygon and multipolygon rings", () => {
    expect(wardBoundaryCoordinateRings(WARD_FEATURE)).toHaveLength(1);
    expect(wardBoundaryCoordinateRings({
      ...WARD_FEATURE,
      geometry: {
        type: "MultiPolygon",
        coordinates: [WARD_FEATURE.geometry.coordinates, WARD_FEATURE.geometry.coordinates],
      },
    })).toHaveLength(2);
  });
});

describe("projectWardBoundaryRings", () => {
  it("projects longitude and latitude into the shared 3D scene coordinates", () => {
    const [ring] = projectWardBoundaryRings(
      WARD_FEATURE,
      { south: 21.0, west: 105.8, north: 21.01, east: 105.81 },
      { scale: 0.5 },
    );

    expect(ring).toHaveLength(4);
    expect(ring[0].x).toBeLessThan(0);
    expect(ring[0].z).toBeGreaterThan(0);
    expect(ring[2].x).toBeGreaterThan(0);
    expect(ring[2].z).toBeLessThan(0);
  });
});
