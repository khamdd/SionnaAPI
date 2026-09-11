import { describe, expect, it } from "vitest";

import {
  MAX_NETWORK_COVERAGE_ANTENNAS,
  antennasForActiveScene,
  applySimulationSettings,
  formatAntennaCoordinate,
  isAntennaEnabled,
  networkCoverageAntennasForScene,
  normalizeAntennaBase,
  normalizeRangeValue,
  parseAntennaNumericInput,
  simulationSettingsForAntenna,
  toAntennaRequest,
  toConfigurationAntenna,
  toValidatedAntennaRequest,
  validateNetworkCoverageSimulationAntennas,
  validateRange,
} from "./antennas";

const TILT = { min: 0, current: 6, max: 20 };
const POWER = { min: -40, current: 10, max: 40 };
const SCENE_BOUNDS = { south: 20, north: 21, west: 10, east: 11 };
const ACTIVE_SCENE = { id: "scene-1", bounds: SCENE_BOUNDS };

function baseAntenna(overrides = {}) {
  return {
    id: "A1",
    longitude: 10.5,
    latitude: 20.5,
    height_m: 12,
    azimuth: 90,
    tilt: TILT,
    tx_power: POWER,
    ...overrides,
  };
}

describe("MAX_NETWORK_COVERAGE_ANTENNAS", () => {
  it("keeps the backend-aligned active antenna limit", () => {
    expect(MAX_NETWORK_COVERAGE_ANTENNAS).toBe(10);
  });
});

describe("normalizeRangeValue", () => {
  it("normalizes finite numbers and numeric strings", () => {
    expect(normalizeRangeValue({ min: 0, current: "6.5", max: 20 })).toEqual({
      min: 0,
      current: 6.5,
      max: 20,
    });
  });

  it("returns null when any bound is missing or non-finite", () => {
    expect(normalizeRangeValue(null)).toBeNull();
    expect(normalizeRangeValue(undefined)).toBeNull();
    expect(normalizeRangeValue({})).toBeNull();
    expect(normalizeRangeValue({ min: 0, current: 6, max: "x" })).toBeNull();
    expect(normalizeRangeValue({ min: Number.NaN, current: 6, max: 20 })).toBeNull();
    expect(normalizeRangeValue({ min: 0, current: Number.POSITIVE_INFINITY, max: 20 })).toBeNull();
  });
});

describe("normalizeAntennaBase", () => {
  it("trims the id and coerces numeric fields", () => {
    expect(
      normalizeAntennaBase({
        id: "  A1  ",
        longitude: "10.5",
        latitude: "20.5",
        height_m: "12",
        azimuth: "90",
        tilt: TILT,
        tx_power: POWER,
        extra: "dropped",
      }),
    ).toEqual({
      id: "A1",
      longitude: 10.5,
      latitude: 20.5,
      height_m: 12,
      azimuth: 90,
      tilt: TILT,
      tx_power: POWER,
    });
  });

  it("allows height_m of zero and lets validation reject it", () => {
    const base = normalizeAntennaBase(baseAntenna({ height_m: 0 }));

    expect(base.height_m).toBe(0);
  });

  it("returns null for incomplete antennas", () => {
    expect(normalizeAntennaBase(null)).toBeNull();
    expect(normalizeAntennaBase(undefined)).toBeNull();
    expect(normalizeAntennaBase(baseAntenna({ id: "   " }))).toBeNull();
    expect(normalizeAntennaBase(baseAntenna({ longitude: "abc" }))).toBeNull();
    expect(normalizeAntennaBase(baseAntenna({ latitude: undefined }))).toBeNull();
    expect(normalizeAntennaBase(baseAntenna({ height_m: undefined }))).toBeNull();
    expect(normalizeAntennaBase(baseAntenna({ tilt: null }))).toBeNull();
    expect(normalizeAntennaBase(baseAntenna({ tx_power: { min: -40, current: 10 } }))).toBeNull();
  });

  it("coerces null numeric fields to zero like Number does", () => {
    const base = normalizeAntennaBase(baseAntenna({ latitude: null, height_m: null }));

    expect(base.latitude).toBe(0);
    expect(base.height_m).toBe(0);
  });

  it("coerces empty numeric strings to zero like Number does", () => {
    const base = normalizeAntennaBase(baseAntenna({ azimuth: "" }));

    expect(base.azimuth).toBe(0);
  });
});

describe("parseAntennaNumericInput", () => {
  it("preserves an empty input and converts numeric input", () => {
    expect(parseAntennaNumericInput("")).toBe("");
    expect(parseAntennaNumericInput("12.5")).toBe(12.5);
    expect(parseAntennaNumericInput(null)).toBe(0);
  });

  it("returns NaN for non-numeric input", () => {
    expect(parseAntennaNumericInput("not-a-number")).toBeNaN();
  });
});

describe("formatAntennaCoordinate", () => {
  it("uses four decimal places for numbers and numeric strings", () => {
    expect(formatAntennaCoordinate(106.123456)).toBe("106.1235");
    expect(formatAntennaCoordinate("10.5")).toBe("10.5000");
  });

  it("preserves the existing fallback and Number coercion behavior", () => {
    expect(formatAntennaCoordinate("invalid")).toBe("--");
    expect(formatAntennaCoordinate("invalid", "—")).toBe("—");
    expect(formatAntennaCoordinate(null)).toBe("0.0000");
  });
});

describe("validateRange", () => {
  it("requires min to be less than or equal to max", () => {
    expect(validateRange({ min: 10, current: 5, max: 0 }, "tilt")).toBe(
      "tilt_min must be less than or equal to tilt_max.",
    );
  });

  it("requires current to stay between min and max", () => {
    expect(validateRange({ min: 0, current: -1, max: 20 }, "tilt")).toBe(
      "tilt_current must be between tilt_min and tilt_max.",
    );
    expect(validateRange({ min: 0, current: 21, max: 20 }, "tilt")).toBe(
      "tilt_current must be between tilt_min and tilt_max.",
    );
  });

  it("accepts boundary values and valid ranges", () => {
    expect(validateRange({ min: 0, current: 0, max: 20 }, "tilt")).toBe("");
    expect(validateRange({ min: 0, current: 20, max: 20 }, "tilt")).toBe("");
  });

  it("keeps the provided label in error strings", () => {
    expect(validateRange({ min: 5, current: 0, max: 4 }, "tx_power")).toBe(
      "tx_power_min must be less than or equal to tx_power_max.",
    );
  });
});

describe("toAntennaRequest", () => {
  it("keeps only the request fields and drops simulation-only state", () => {
    const antenna = {
      ...baseAntenna(),
      _type: "type1",
      enabled: false,
      position: [1, 2, 3],
    };

    expect(toAntennaRequest(antenna)).toEqual({
      id: "A1",
      longitude: 10.5,
      latitude: 20.5,
      height_m: 12,
      tilt: TILT,
      azimuth: 90,
      tx_power: POWER,
    });
  });

  it("normalizes numeric strings and trimmed ids", () => {
    const request = toAntennaRequest({
      id: " x1 ",
      longitude: "10.5",
      latitude: "20.5",
      height_m: "12",
      azimuth: "90",
      tilt: { min: "0", current: "6", max: "20" },
      tx_power: { min: "-40", current: "10", max: "40" },
    });

    expect(request.id).toBe("x1");
    expect(request.height_m).toBe(12);
    expect(request.tilt).toEqual({ min: 0, current: 6, max: 20 });
  });
});

describe("toConfigurationAntenna", () => {
  it("preserves the configuration enabled field and normalizes numeric values", () => {
    expect(toConfigurationAntenna({
      ...baseAntenna(),
      id: " config-1 ",
      longitude: "10.5",
      enabled: false,
      _type: "type2",
    })).toEqual({
      id: "config-1",
      longitude: 10.5,
      latitude: 20.5,
      height_m: 12,
      enabled: false,
      tilt: TILT,
      azimuth: 90,
      tx_power: POWER,
    });
  });

  it("defaults enabled to true and keeps invalid numbers for caller validation", () => {
    const antenna = toConfigurationAntenna(baseAntenna({
      longitude: "invalid",
      enabled: undefined,
    }));

    expect(antenna.enabled).toBe(true);
    expect(antenna.longitude).toBeNaN();
  });
});

describe("toValidatedAntennaRequest", () => {
  it("normalizes valid values and removes non-request fields", () => {
    expect(toValidatedAntennaRequest({
      ...baseAntenna(),
      longitude: "10.5",
      enabled: false,
      _type: "type2",
      position: [1, 2, 3],
    })).toEqual({
      id: "A1",
      longitude: 10.5,
      latitude: 20.5,
      height_m: 12,
      tilt: TILT,
      azimuth: 90,
      tx_power: POWER,
    });
  });

  it("rejects incomplete values and invalid ranges", () => {
    expect(toValidatedAntennaRequest({ id: "A1" })).toBeNull();
    expect(toValidatedAntennaRequest(baseAntenna({
      tilt: { min: 10, current: 5, max: 0 },
    }))).toBeNull();
    expect(toValidatedAntennaRequest(baseAntenna({
      tx_power: { min: -40, current: 50, max: 40 },
    }))).toBeNull();
  });
});

describe("isAntennaEnabled", () => {
  it("treats only an explicit false as disabled", () => {
    expect(isAntennaEnabled({ enabled: false })).toBe(false);
    expect(isAntennaEnabled({ enabled: true })).toBe(true);
    expect(isAntennaEnabled({ enabled: undefined })).toBe(true);
    expect(isAntennaEnabled({})).toBe(true);
    expect(isAntennaEnabled(null)).toBe(true);
    expect(isAntennaEnabled(undefined)).toBe(true);
  });
});

describe("simulationSettingsForAntenna", () => {
  it("extracts the stored settings shape", () => {
    expect(
      simulationSettingsForAntenna({
        azimuth: 45,
        enabled: false,
        tilt: { current: 7 },
        tx_power: { current: 25 },
      }),
    ).toEqual({
      azimuth: 45,
      enabled: false,
      tilt_current: 7,
      tx_power_current: 25,
    });
  });

  it("defaults enabled to true and keeps missing ranges undefined", () => {
    expect(simulationSettingsForAntenna({ azimuth: 10 })).toEqual({
      azimuth: 10,
      enabled: true,
      tilt_current: undefined,
      tx_power_current: undefined,
    });
  });
});

describe("applySimulationSettings", () => {
  it("applies overrides over the normalized base", () => {
    const applied = applySimulationSettings(
      baseAntenna(),
      { azimuth: 180, tilt_current: 9, tx_power_current: 22, enabled: false },
      "type2",
    );

    expect(applied).toEqual({
      id: "A1",
      longitude: 10.5,
      latitude: 20.5,
      height_m: 12,
      azimuth: 180,
      tilt: { min: 0, current: 9, max: 20 },
      tx_power: { min: -40, current: 22, max: 40 },
      enabled: false,
      _type: "type2",
    });
  });

  it("falls back to base values when overrides are missing or null", () => {
    const applied = applySimulationSettings(baseAntenna(), {}, "type1");

    expect(applied.azimuth).toBe(90);
    expect(applied.tilt.current).toBe(6);
    expect(applied.tx_power.current).toBe(10);
    expect(applied.enabled).toBe(true);
    expect(applied._type).toBe("type1");

    const nullOverrides = applySimulationSettings(
      baseAntenna(),
      { azimuth: null, tilt_current: null, tx_power_current: null },
      "type1",
    );

    expect(nullOverrides.azimuth).toBe(90);
    expect(nullOverrides.tilt.current).toBe(6);
    expect(nullOverrides.tx_power.current).toBe(10);
  });

  it("returns null for antennas without a complete base", () => {
    expect(applySimulationSettings(null, {}, "type1")).toBeNull();
    expect(applySimulationSettings({ id: "A1" }, {}, "type1")).toBeNull();
  });
});

describe("networkCoverageAntennasForScene", () => {
  const fixed = [baseAntenna(), baseAntenna({ id: "A2", longitude: 10.6 })];
  const type2 = new Map([
    ["scene-1", [baseAntenna({ id: "T2-1" })]],
  ]);

  it("returns an empty list without a scene id", () => {
    expect(networkCoverageAntennasForScene(null, [], type2, new Map())).toEqual([]);
    expect(networkCoverageAntennasForScene({}, [], type2, new Map())).toEqual([]);
  });

  it("lists type1 antennas before type2 antennas", () => {
    const antennas = networkCoverageAntennasForScene(ACTIVE_SCENE, fixed, type2, new Map());

    expect(antennas.map((antenna) => antenna.id)).toEqual(["A1", "A2", "T2-1"]);
    expect(antennas.map((antenna) => antenna._type)).toEqual(["type1", "type1", "type2"]);
  });

  it("applies scene settings per antenna id and defaults the rest", () => {
    const settings = new Map([
      ["scene-1", { A2: { azimuth: 10, tilt_current: 8, tx_power_current: 12, enabled: false } }],
    ]);

    const antennas = networkCoverageAntennasForScene(ACTIVE_SCENE, fixed, type2, settings);

    expect(antennas[0].enabled).toBe(true);
    expect(antennas[0].azimuth).toBe(90);
    expect(antennas[1].azimuth).toBe(10);
    expect(antennas[1].tilt.current).toBe(8);
    expect(antennas[1].tx_power.current).toBe(12);
    expect(antennas[1].enabled).toBe(false);
  });

  it("drops antennas with incomplete base data", () => {
    const brokenFixed = [baseAntenna(), { id: "broken", longitude: 10.5 }];

    const antennas = networkCoverageAntennasForScene(ACTIVE_SCENE, brokenFixed, type2, new Map());

    expect(antennas.map((antenna) => antenna.id)).toEqual(["A1", "T2-1"]);
  });

  it("handles missing type2 entries and settings for the scene", () => {
    const antennas = networkCoverageAntennasForScene(
      ACTIVE_SCENE,
      fixed,
      new Map(),
      new Map(),
    );

    expect(antennas.map((antenna) => antenna.id)).toEqual(["A1", "A2"]);
    expect(antennas.every((antenna) => antenna.enabled)).toBe(true);
  });
});

describe("antennasForActiveScene", () => {
  const fixedAntennas = [baseAntenna()];
  const scene = { id: "scene-1", fixed_antennas: fixedAntennas };

  it("prefers a non-empty override over scene fixed antennas", () => {
    const override = new Map([
      ["scene-1", [baseAntenna({ id: "override-1" })]],
    ]);

    const antennas = antennasForActiveScene(scene, override);

    expect(antennas.map((antenna) => antenna.id)).toEqual(["override-1"]);
  });

  it("falls back to scene fixed antennas when the override is empty", () => {
    const antennas = antennasForActiveScene(scene, new Map([["scene-1", []]]));

    expect(antennas.map((antenna) => antenna.id)).toEqual(["A1"]);
  });

  it("uses scene fixed antennas when no override exists", () => {
    expect(antennasForActiveScene(scene, new Map()).map((a) => a.id)).toEqual(["A1"]);
  });

  it("returns an empty list without fixed antennas or a scene", () => {
    expect(antennasForActiveScene({ id: "scene-1" }, new Map())).toEqual([]);
    expect(antennasForActiveScene(null, new Map())).toEqual([]);
  });

  it("returns cloned antennas so callers cannot mutate scene data", () => {
    const antennas = antennasForActiveScene(scene, new Map());

    antennas[0].id = "mutated";

    expect(scene.fixed_antennas[0].id).toBe("A1");
  });
});

describe("validateNetworkCoverageSimulationAntennas", () => {
  it("requires at least one antenna", () => {
    expect(validateNetworkCoverageSimulationAntennas([], ACTIVE_SCENE)).toBe(
      "Add or check at least one antenna for Network Coverage.",
    );
    expect(validateNetworkCoverageSimulationAntennas(null, ACTIVE_SCENE)).toBe(
      "Add or check at least one antenna for Network Coverage.",
    );
  });

  it("enforces the active antenna limit with the default and custom maximums", () => {
    const antennas = Array.from({ length: 11 }, (_, index) => baseAntenna({ id: `A${index + 1}` }));

    expect(validateNetworkCoverageSimulationAntennas(antennas, ACTIVE_SCENE)).toBe(
      "Network Coverage supports up to 10 active antennas. The selected scene currently has 11.",
    );
    expect(
      validateNetworkCoverageSimulationAntennas(antennas, ACTIVE_SCENE, 2),
    ).toBe(
      "Network Coverage supports up to 2 active antennas. The selected scene currently has 11.",
    );
  });

  it("rejects antennas with incomplete base configuration", () => {
    expect(
      validateNetworkCoverageSimulationAntennas([baseAntenna({ tilt: null })], ACTIVE_SCENE),
    ).toBe("Antenna A1 has incomplete base configuration.");
    expect(
      validateNetworkCoverageSimulationAntennas([{ longitude: 10.5 }], ACTIVE_SCENE),
    ).toBe("Antenna  has incomplete base configuration.");
  });

  it("rejects duplicated antenna ids case-insensitively", () => {
    expect(
      validateNetworkCoverageSimulationAntennas(
        [baseAntenna(), baseAntenna({ id: "a1" })],
        ACTIVE_SCENE,
      ),
    ).toBe("Antenna ID a1 is duplicated.");
  });

  it("rejects antennas outside the scene bounds or without scene bounds", () => {
    expect(
      validateNetworkCoverageSimulationAntennas(
        [baseAntenna({ longitude: 12 })],
        ACTIVE_SCENE,
      ),
    ).toBe("Antenna A1 must stay inside the selected scene.");
    expect(validateNetworkCoverageSimulationAntennas([baseAntenna()], null)).toBe(
      "Antenna A1 must stay inside the selected scene.",
    );
  });

  it("requires a positive height", () => {
    expect(
      validateNetworkCoverageSimulationAntennas([baseAntenna({ height_m: 0 })], ACTIVE_SCENE),
    ).toBe("Antenna A1 height_m must be greater than 0.");
    expect(
      validateNetworkCoverageSimulationAntennas([baseAntenna({ height_m: -3 })], ACTIVE_SCENE),
    ).toBe("Antenna A1 height_m must be greater than 0.");
  });

  it("requires azimuth between 0 and 360", () => {
    expect(
      validateNetworkCoverageSimulationAntennas([baseAntenna({ azimuth: -1 })], ACTIVE_SCENE),
    ).toBe("Antenna A1 azimuth must be between 0 and 360.");
    expect(
      validateNetworkCoverageSimulationAntennas([baseAntenna({ azimuth: 361 })], ACTIVE_SCENE),
    ).toBe("Antenna A1 azimuth must be between 0 and 360.");
    expect(
      validateNetworkCoverageSimulationAntennas([baseAntenna({ azimuth: 0 })], ACTIVE_SCENE),
    ).toBe("");
    expect(
      validateNetworkCoverageSimulationAntennas([baseAntenna({ azimuth: 360 })], ACTIVE_SCENE),
    ).toBe("");
  });

  it("surfaces tilt and tx_power range errors with the antenna id", () => {
    expect(
      validateNetworkCoverageSimulationAntennas(
        [baseAntenna({ tilt: { min: 10, current: 6, max: 0 } })],
        ACTIVE_SCENE,
      ),
    ).toBe("Antenna A1: tilt_min must be less than or equal to tilt_max.");
    expect(
      validateNetworkCoverageSimulationAntennas(
        [baseAntenna({ tilt: { min: 0, current: 21, max: 20 } })],
        ACTIVE_SCENE,
      ),
    ).toBe("Antenna A1: tilt_current must be between tilt_min and tilt_max.");
    expect(
      validateNetworkCoverageSimulationAntennas(
        [baseAntenna({ tx_power: { min: -40, current: 50, max: 40 } })],
        ACTIVE_SCENE,
      ),
    ).toBe("Antenna A1: tx_power_current must be between tx_power_min and tx_power_max.");
  });

  it("accepts a valid set of antennas", () => {
    expect(
      validateNetworkCoverageSimulationAntennas(
        [baseAntenna(), baseAntenna({ id: "A2", longitude: 10.6, latitude: 20.6 })],
        ACTIVE_SCENE,
      ),
    ).toBe("");
  });
});
