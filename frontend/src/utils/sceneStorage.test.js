import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SCENE_FIXED_ANTENNAS_STORAGE_KEY } from "../constants";
import {
  enrichScene,
  normalizeStoredAntennaSettings,
  normalizeStoredFixedAntennas,
  normalizeStoredSinrRoles,
  normalizeStoredType2Antennas,
  persistSceneMap,
  readSceneFixedAntennas,
  readStoredSceneMap,
  saveSceneFixedAntennas,
  setSceneMapValue,
} from "./sceneStorage";

const SCENE_ID = "scene-1";
const TILT = { min: 0, current: 6, max: 20 };
const POWER = { min: -40, current: 10, max: 40 };

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

let storage;

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readStoredSceneMap", () => {
  it("reads stored scene entries and drops values that fail normalization", () => {
    storage.set(
      "draft-key",
      JSON.stringify({
        [SCENE_ID]: [baseAntenna()],
        "scene-2": "not-an-array",
      }),
    );

    const sceneMap = readStoredSceneMap("draft-key", normalizeStoredType2Antennas);

    expect(sceneMap).toBeInstanceOf(Map);
    expect([...sceneMap.keys()]).toEqual([SCENE_ID]);
    expect(sceneMap.get(SCENE_ID)).toEqual([baseAntenna()]);
  });

  it("returns an empty map for missing or invalid JSON", () => {
    expect(readStoredSceneMap("draft-key", normalizeStoredType2Antennas)).toEqual(new Map());
    expect(readStoredSceneMap("missing-key", normalizeStoredType2Antennas)).toEqual(new Map());

    storage.set("draft-key", "{not json");
    expect(readStoredSceneMap("draft-key", normalizeStoredType2Antennas)).toEqual(new Map());

    storage.set("draft-key", "null");
    expect(readStoredSceneMap("draft-key", normalizeStoredType2Antennas)).toEqual(new Map());
  });

  it("round-trips values written by persistSceneMap", () => {
    const sceneMap = new Map([
      [SCENE_ID, [baseAntenna()]],
      ["scene-2", { A1: { azimuth: 10, tilt_current: 5, tx_power_current: 20, enabled: false } }],
    ]);

    persistSceneMap("draft-key", sceneMap);
    const restoredAntennas = readStoredSceneMap("draft-key", normalizeStoredType2Antennas);
    const restoredSettings = readStoredSceneMap("draft-key", normalizeStoredAntennaSettings);

    expect(restoredAntennas.get(SCENE_ID)).toEqual([baseAntenna()]);
    expect(restoredSettings.get("scene-2")).toEqual({
      A1: { azimuth: 10, tilt_current: 5, tx_power_current: 20, enabled: false },
    });
  });

  it("persists an empty map as an empty JSON object", () => {
    persistSceneMap("draft-key", new Map());

    expect(storage.get("draft-key")).toBe("{}");
  });
});

describe("setSceneMapValue", () => {
  it("stores the normalized value on the same map instance", () => {
    const sceneMap = new Map();

    setSceneMapValue(sceneMap, SCENE_ID, [baseAntenna()], normalizeStoredType2Antennas);

    expect(sceneMap.get(SCENE_ID)).toEqual([baseAntenna()]);
  });

  it("deletes the scene entry when normalization fails", () => {
    const sceneMap = new Map([[SCENE_ID, [baseAntenna()]]]);

    setSceneMapValue(sceneMap, SCENE_ID, "junk", normalizeStoredType2Antennas);

    expect(sceneMap.has(SCENE_ID)).toBe(false);
  });
});

describe("normalizeStoredType2Antennas", () => {
  it("normalizes valid antennas and coerces numeric strings", () => {
    expect(
      normalizeStoredType2Antennas([
        {
          id: " A1 ",
          longitude: "10.5",
          latitude: "20.5",
          height_m: "12",
          azimuth: "90",
          tilt: { min: "0", current: "6", max: "20" },
          tx_power: { min: "-40", current: "10", max: "40" },
        },
      ]),
    ).toEqual([baseAntenna()]);
  });

  it("returns null for non-arrays, empty arrays, and fully invalid entries", () => {
    expect(normalizeStoredType2Antennas(null)).toBeNull();
    expect(normalizeStoredType2Antennas("junk")).toBeNull();
    expect(normalizeStoredType2Antennas({})).toBeNull();
    expect(normalizeStoredType2Antennas([])).toBeNull();
    expect(normalizeStoredType2Antennas([{ id: "A1" }])).toBeNull();
  });

  it("drops invalid entries and keeps the valid ones", () => {
    expect(
      normalizeStoredType2Antennas([{ id: "bad" }, baseAntenna({ id: "A2" })]),
    ).toEqual([baseAntenna({ id: "A2" })]);
  });
});

describe("normalizeStoredAntennaSettings", () => {
  it("normalizes settings and defaults enabled to true", () => {
    expect(
      normalizeStoredAntennaSettings({
        A1: { azimuth: "45", tilt_current: "6", tx_power_current: "10" },
        A2: { azimuth: 90, tilt_current: 7, tx_power_current: 20, enabled: false },
      }),
    ).toEqual({
      A1: { azimuth: 45, enabled: true, tilt_current: 6, tx_power_current: 10 },
      A2: { azimuth: 90, enabled: false, tilt_current: 7, tx_power_current: 20 },
    });
  });

  it("coerces enabled through Boolean", () => {
    expect(
      normalizeStoredAntennaSettings({
        A1: { azimuth: 0, tilt_current: 0, tx_power_current: 0, enabled: 0 },
        A2: { azimuth: 0, tilt_current: 0, tx_power_current: 0, enabled: "yes" },
      }),
    ).toEqual({
      A1: { azimuth: 0, enabled: false, tilt_current: 0, tx_power_current: 0 },
      A2: { azimuth: 0, enabled: true, tilt_current: 0, tx_power_current: 0 },
    });
  });

  it("skips entries with missing or non-finite values", () => {
    expect(
      normalizeStoredAntennaSettings({
        A1: { tilt_current: 6, tx_power_current: 10 },
        A2: { azimuth: "x", tilt_current: 6, tx_power_current: 10 },
        A3: { azimuth: 45, tilt_current: Number.NaN, tx_power_current: 10 },
      }),
    ).toBeNull();
  });

  it("returns null for non-objects and empty settings", () => {
    expect(normalizeStoredAntennaSettings(null)).toBeNull();
    expect(normalizeStoredAntennaSettings("junk")).toBeNull();
    expect(normalizeStoredAntennaSettings(42)).toBeNull();
    expect(normalizeStoredAntennaSettings([])).toBeNull();
    expect(normalizeStoredAntennaSettings({})).toBeNull();
  });
});

describe("normalizeStoredSinrRoles", () => {
  it("keeps only the three supported roles with trimmed ids", () => {
    expect(
      normalizeStoredSinrRoles({
        transmitter: " A1 ",
        receiver: "A2",
        interferer: "A3",
        extra: "A4",
      }),
    ).toEqual({ transmitter: "A1", receiver: "A2", interferer: "A3" });
  });

  it("keeps partial role assignments", () => {
    expect(normalizeStoredSinrRoles({ transmitter: "A1", receiver: "   " })).toEqual({
      transmitter: "A1",
    });
  });

  it("returns null for non-objects and empty role maps", () => {
    expect(normalizeStoredSinrRoles(null)).toBeNull();
    expect(normalizeStoredSinrRoles("junk")).toBeNull();
    expect(normalizeStoredSinrRoles([])).toBeNull();
    expect(normalizeStoredSinrRoles({})).toBeNull();
    expect(normalizeStoredSinrRoles({ transmitter: "" })).toBeNull();
  });
});

describe("normalizeStoredFixedAntennas", () => {
  it("normalizes coordinates, defaults height, and drops the position field", () => {
    const stored = {
      id: "F1",
      position: [1, 2, 3],
      longitude: "10.5",
      latitude: "20.5",
      note: "kept",
    };

    expect(normalizeStoredFixedAntennas([stored])).toEqual([
      {
        id: "F1",
        note: "kept",
        longitude: 10.5,
        latitude: 20.5,
        height_m: 0,
      },
    ]);
  });

  it("keeps a finite height and drops antennas without coordinates", () => {
    expect(
      normalizeStoredFixedAntennas([
        { id: "F1", longitude: 10.5, latitude: 20.5, height_m: "9" },
        { id: "F2", longitude: "x", latitude: 20.5 },
        { id: "F3", latitude: 20.5 },
      ]),
    ).toEqual([
      { id: "F1", longitude: 10.5, latitude: 20.5, height_m: 9 },
    ]);
  });

  it("returns null for non-arrays, empty arrays, and fully invalid entries", () => {
    expect(normalizeStoredFixedAntennas(null)).toBeNull();
    expect(normalizeStoredFixedAntennas(undefined)).toBeNull();
    expect(normalizeStoredFixedAntennas("junk")).toBeNull();
    expect(normalizeStoredFixedAntennas([])).toBeNull();
    expect(normalizeStoredFixedAntennas([{ id: "F1" }])).toBeNull();
  });
});

describe("readSceneFixedAntennas", () => {
  it("returns null without a scene id", () => {
    expect(readSceneFixedAntennas(null)).toBeNull();
    expect(readSceneFixedAntennas("")).toBeNull();
    expect(storage.has(SCENE_FIXED_ANTENNAS_STORAGE_KEY)).toBe(false);
  });

  it("reads and normalizes the cached antennas for a scene", () => {
    storage.set(
      SCENE_FIXED_ANTENNAS_STORAGE_KEY,
      JSON.stringify({ [SCENE_ID]: [{ ...baseAntenna(), position: [1, 2, 3] }] }),
    );

    expect(readSceneFixedAntennas(SCENE_ID)).toEqual([baseAntenna()]);
  });

  it("writes back a pruned object when a scene entry is invalid", () => {
    const valid = [baseAntenna()];
    storage.set(
      SCENE_FIXED_ANTENNAS_STORAGE_KEY,
      JSON.stringify({ [SCENE_ID]: "junk", "scene-2": valid }),
    );

    expect(readSceneFixedAntennas(SCENE_ID)).toBeNull();
    expect(JSON.parse(storage.get(SCENE_FIXED_ANTENNAS_STORAGE_KEY))).toEqual({
      "scene-2": valid,
    });
  });

  it("writes an empty object when no entry exists yet", () => {
    expect(readSceneFixedAntennas(SCENE_ID)).toBeNull();
    expect(storage.get(SCENE_FIXED_ANTENNAS_STORAGE_KEY)).toBe("{}");
  });

  it("returns null and leaves storage untouched for corrupt JSON", () => {
    storage.set(SCENE_FIXED_ANTENNAS_STORAGE_KEY, "{not json");

    expect(readSceneFixedAntennas(SCENE_ID)).toBeNull();
    expect(storage.get(SCENE_FIXED_ANTENNAS_STORAGE_KEY)).toBe("{not json");
  });
});

describe("saveSceneFixedAntennas", () => {
  it("stores normalized antennas and preserves other scenes", () => {
    storage.set(
      SCENE_FIXED_ANTENNAS_STORAGE_KEY,
      JSON.stringify({ "scene-2": [{ id: "F9", longitude: 1, latitude: 2 }] }),
    );

    saveSceneFixedAntennas(SCENE_ID, [{ ...baseAntenna(), position: [3, 4, 5] }]);

    const saved = JSON.parse(storage.get(SCENE_FIXED_ANTENNAS_STORAGE_KEY));
    expect(saved["scene-2"]).toEqual([{ id: "F9", longitude: 1, latitude: 2 }]);
    expect(saved[SCENE_ID]).toEqual([baseAntenna()]);
  });

  it("ignores missing scene ids, non-arrays, and invalid antenna lists", () => {
    saveSceneFixedAntennas(null, [baseAntenna()]);
    saveSceneFixedAntennas(SCENE_ID, "junk");
    saveSceneFixedAntennas(SCENE_ID, []);

    expect(storage.has(SCENE_FIXED_ANTENNAS_STORAGE_KEY)).toBe(false);
  });

  it("stays silent when the existing cache is corrupt", () => {
    storage.set(SCENE_FIXED_ANTENNAS_STORAGE_KEY, "{not json");

    expect(() => saveSceneFixedAntennas(SCENE_ID, [baseAntenna()])).not.toThrow();
    expect(storage.get(SCENE_FIXED_ANTENNAS_STORAGE_KEY)).toBe("{not json");
  });
});

describe("enrichScene", () => {
  it("overlays cached fixed antennas onto the scene", () => {
    storage.set(
      SCENE_FIXED_ANTENNAS_STORAGE_KEY,
      JSON.stringify({ [SCENE_ID]: [baseAntenna()] }),
    );

    const enriched = enrichScene({ id: SCENE_ID, name: "Scene" });

    expect(enriched.fixed_antennas).toEqual([baseAntenna()]);
    expect(enriched.name).toBe("Scene");
  });

  it("returns the same scene reference when no cache exists", () => {
    const scene = { id: SCENE_ID, name: "Scene" };

    expect(enrichScene(scene)).toBe(scene);
  });

  it("returns null scenes unchanged", () => {
    expect(enrichScene(null)).toBeNull();
  });
});
