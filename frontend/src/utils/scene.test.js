import { describe, expect, it } from "vitest";

import { DEFAULT_SOLVER } from "../constants";
import {
  lngLatBoundsError,
  lngLatInsideBounds,
  lngLatToScenePosition,
  sceneSizeMeters,
  solverBounds,
  solverForScene,
  validatePositionInsideSolver,
} from "./scene";

const EQUATOR_BOUNDS = { west: 0, east: 0.002, south: 0, north: 0.001 };

describe("sceneSizeMeters", () => {
  it("prefers scene metrics and rounds to two decimals", () => {
    expect(
      sceneSizeMeters({ metrics: { width_m: 123.456, height_m: 88.123 } }),
    ).toEqual({ width: 123.46, height: 88.12 });
  });

  it("ignores non-positive or non-numeric metrics", () => {
    expect(
      sceneSizeMeters({ metrics: { width_m: -1, height_m: 0 } }),
    ).toBeNull();
  });

  it("derives size from bounds near the equator", () => {
    expect(sceneSizeMeters({ bounds: EQUATOR_BOUNDS })).toEqual({
      width: 222.64,
      height: 111.32,
    });
  });

  it("returns null for missing or inverted bounds", () => {
    expect(sceneSizeMeters({})).toBeNull();
    expect(sceneSizeMeters(null)).toBeNull();
    expect(
      sceneSizeMeters({ bounds: { west: 1, east: 0, south: 0, north: 1 } }),
    ).toBeNull();
    expect(
      sceneSizeMeters({ bounds: { west: 0, east: 1, south: 2, north: 1 } }),
    ).toBeNull();
    expect(
      sceneSizeMeters({
        bounds: { west: "a", east: 1, south: 0, north: 1 },
      }),
    ).toBeNull();
  });
});

describe("solverForScene", () => {
  it("falls back to the default solver when the scene has no usable size", () => {
    expect(solverForScene(null)).toEqual({
      ...DEFAULT_SOLVER,
      center: [0, 0, 0],
      size: DEFAULT_SOLVER.size,
    });
  });

  it("centers the solver on the scene and enlarges cell size for large areas", () => {
    const scene = {
      metrics: { width_m: 5000, height_m: 4000 },
    };
    const solver = solverForScene(scene);

    expect(solver.center).toEqual([0, 0, 0]);
    expect(solver.size).toEqual([5000, 4000]);
    expect(solver.cell_size).toBe(20);
  });

  it("keeps a requested cell size that is larger than the minimum", () => {
    const scene = { metrics: { width_m: 200, height_m: 200 } };
    const baseSolver = { ...DEFAULT_SOLVER, cell_size: 9 };
    const solver = solverForScene(scene, baseSolver);

    expect(solver.cell_size).toBe(9);
  });

  it("uses the default cell size for small scenes", () => {
    const scene = { metrics: { width_m: 200, height_m: 200 } };
    const baseSolver = { ...DEFAULT_SOLVER, cell_size: 2 };
    const solver = solverForScene(scene, baseSolver);

    expect(solver.cell_size).toBe(5);
  });
});

describe("solverBounds", () => {
  it("computes min and max bounds around the center", () => {
    expect(solverBounds({ center: [0, 0, 0], size: [10, 20] })).toEqual({
      xMin: -5,
      xMax: 5,
      yMin: -10,
      yMax: 10,
    });
    expect(solverBounds({ center: [10, -4, 0], size: [8, 6] })).toEqual({
      xMin: 6,
      xMax: 14,
      yMin: -7,
      yMax: -1,
    });
  });

  it("falls back to the default solver dimensions", () => {
    expect(solverBounds(undefined)).toEqual({
      xMin: -150,
      xMax: 150,
      yMin: -150,
      yMax: 150,
    });
  });

  it("returns null for invalid sizes or centers", () => {
    expect(solverBounds({ center: [0, 0], size: [0, 10] })).toBeNull();
    expect(solverBounds({ center: [0, 0], size: [-3, 10] })).toBeNull();
    expect(solverBounds({ center: ["a", 0], size: [8, 6] })).toBeNull();
  });
});

describe("validatePositionInsideSolver", () => {
  const solver = { center: [0, 0, 0], size: [10, 20] };

  it("accepts positions inside the bounds", () => {
    expect(validatePositionInsideSolver([0, 0, 1.5], solver)).toBe("");
    expect(validatePositionInsideSolver([-5, 10, 0], solver)).toBe("");
  });

  it("requires numeric coordinates", () => {
    expect(validatePositionInsideSolver(["", 0, 0], solver)).toBe(
      "Enter numeric x, y, and z coordinates.",
    );
    expect(validatePositionInsideSolver([null, 0, 0], solver)).toBe(
      "Enter numeric x, y, and z coordinates.",
    );
    expect(validatePositionInsideSolver(["abc", 0, 0], solver)).toBe(
      "Enter numeric x, y, and z coordinates.",
    );
  });

  it("rejects positions outside the bounds with formatted limits", () => {
    expect(validatePositionInsideSolver([6, 0, 0], solver)).toBe(
      "Must stay inside x -5 to 5 m and y -10 to 10 m.",
    );
    expect(validatePositionInsideSolver([0, -10.5, 0], solver)).toBe(
      "Must stay inside x -5 to 5 m and y -10 to 10 m.",
    );
  });

  it("skips validation when bounds are unavailable", () => {
    expect(validatePositionInsideSolver([999, 0, 0], { size: [0, 0] })).toBe("");
  });
});

describe("lngLatToScenePosition", () => {
  it("maps the bounds center to the scene origin", () => {
    expect(
      lngLatToScenePosition(
        { longitude: 0.001, latitude: 0.0005, height_m: 30 },
        EQUATOR_BOUNDS,
      ),
    ).toEqual([0, 0, 30]);
  });

  it("converts numeric-string inputs and defaults a missing height to zero", () => {
    expect(
      lngLatToScenePosition(
        { longitude: "0.001", latitude: "0.0005", height_m: "abc" },
        EQUATOR_BOUNDS,
      ),
    ).toEqual([0, 0, 0]);
  });

  it("maps an eastern offset into positive x meters", () => {
    expect(
      lngLatToScenePosition(
        { longitude: 0.0015, latitude: 0.0005, height_m: 10 },
        EQUATOR_BOUNDS,
      ),
    ).toEqual([55.66, 0, 10]);
  });

  it("clamps coordinates outside the bounds", () => {
    expect(
      lngLatToScenePosition(
        { longitude: 0.003, latitude: 0.0005, height_m: 0 },
        EQUATOR_BOUNDS,
      ),
    ).toEqual([111.32, 0, 0]);
  });

  it("returns null for unusable inputs or bounds", () => {
    expect(
      lngLatToScenePosition({ longitude: "abc", latitude: 0 }, EQUATOR_BOUNDS),
    ).toBeNull();
    expect(
      lngLatToScenePosition({ longitude: 1, latitude: 0 }, null),
    ).toBeNull();
    expect(
      lngLatToScenePosition(
        { longitude: 1, latitude: 0 },
        { west: 2, east: 1, south: 0, north: 1 },
      ),
    ).toBeNull();
  });
});

describe("lngLatInsideBounds and lngLatBoundsError", () => {
  const bounds = { west: 10, east: 10.001, south: 20, north: 20.001 };

  it("accepts coordinates inside the bounds", () => {
    expect(
      lngLatInsideBounds({ longitude: 10.0005, latitude: 20.0005 }, bounds),
    ).toBe(true);
    expect(
      lngLatBoundsError({ longitude: 10.0005, latitude: 20.0005 }, bounds),
    ).toBe("");
  });

  it("accepts coordinates within the four-decimal rounding tolerance", () => {
    expect(
      lngLatBoundsError({ longitude: 10.00104, latitude: 20 }, bounds),
    ).toBe("");
    expect(
      lngLatInsideBounds({ longitude: 10.00104, latitude: 20 }, bounds),
    ).toBe(true);
  });

  it("rejects coordinates beyond the tolerance with the documented message", () => {
    expect(
      lngLatBoundsError({ longitude: 10.0011, latitude: 20.0005 }, bounds),
    ).toBe(
      "Coordinates must stay inside the selected scene. "
      + "Longitude 10.0011 must be 10.0000 to 10.0010, and "
      + "latitude 20.0005 must be 20.0000 to 20.0010.",
    );
    expect(
      lngLatInsideBounds({ longitude: 10.0011, latitude: 20.0005 }, bounds),
    ).toBe(false);
  });

  it("uses the provided label in error messages", () => {
    expect(
      lngLatBoundsError(
        { longitude: "abc", latitude: 20 },
        bounds,
        "Fixed antenna",
      ),
    ).toBe("Fixed antenna must include numeric longitude and latitude.");
  });

  it("reports unavailable bounds", () => {
    expect(
      lngLatBoundsError({ longitude: 10, latitude: 20 }, null),
    ).toBe(
      "Coordinates cannot be checked because selected scene bounds are unavailable.",
    );
  });
});
