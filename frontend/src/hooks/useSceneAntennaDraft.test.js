import { describe, expect, it } from "vitest";

import {
  removeAntennaRoles,
  removeAntennaSetting,
  updateAntennaSetting,
  validateType2AntennaAddition,
} from "./useSceneAntennaDraft";

const SCENE = {
  id: "scene-1",
  bounds: { west: 10, east: 11, south: 20, north: 21 },
};

function antenna(overrides = {}) {
  return {
    id: "A1",
    longitude: 10.5,
    latitude: 20.5,
    height_m: 15,
    azimuth: 90,
    tilt: { min: 0, current: 5, max: 10 },
    tx_power: { min: -20, current: 20, max: 40 },
    ...overrides,
  };
}

function validate(overrides = {}) {
  return validateType2AntennaAddition({
    activeAntennas: [],
    antennas: [],
    antenna: antenna(),
    maxActiveAntennas: null,
    scene: SCENE,
    simulationLabel: "SINR",
    ...overrides,
  });
}

describe("validateType2AntennaAddition", () => {
  it("preserves the missing-scene error", () => {
    expect(validate({ scene: null })).toEqual({
      error: "Select a scene before adding an antenna.",
    });
  });

  it("enforces configured active limits before validating the new antenna", () => {
    expect(validate({
      activeAntennas: Array.from({ length: 10 }),
      maxActiveAntennas: 10,
      simulationLabel: "Network Coverage",
    })).toEqual({
      error: "Network Coverage supports up to 10 active antennas. Uncheck one antenna before adding another.",
    });
  });

  it("keeps role-based pages unlimited when no limit is configured", () => {
    expect(validate({
      activeAntennas: Array.from({ length: 20 }),
      maxActiveAntennas: null,
    })).toEqual({ normalized: antenna() });
  });

  it("preserves incomplete-base validation", () => {
    expect(validate({ antenna: antenna({ id: "" }) })).toEqual({
      error: "Antenna base config is incomplete.",
    });
  });

  it("preserves coordinate validation and four-decimal formatting", () => {
    expect(validate({ antenna: antenna({ longitude: 12 }) })).toEqual({
      error: "Type 2 antenna coordinates must stay inside the selected scene. Longitude 12.0000 must be 10.0000 to 11.0000, and latitude 20.5000 must be 20.0000 to 21.0000.",
    });
  });

  it("preserves case-insensitive duplicate ID validation", () => {
    expect(validate({ antennas: [antenna({ id: "existing" })], antenna: antenna({ id: "EXISTING" }) })).toEqual({
      error: 'antenna_id "EXISTING" is already used.',
    });
  });

  it("normalizes numeric input before storing it", () => {
    expect(validate({
      antenna: antenna({
        longitude: "10.5",
        latitude: "20.5",
        height_m: "15",
        azimuth: "90",
      }),
    })).toEqual({ normalized: antenna() });
  });
});

describe("antenna draft updates", () => {
  it("merges a field update with existing settings", () => {
    expect(updateAntennaSetting(
      { A1: { azimuth: 45, enabled: false, tilt_current: 3, tx_power_current: 10 } },
      antenna(),
      "A1",
      "tilt",
      7,
      true,
    )).toEqual({
      A1: { azimuth: 45, enabled: false, tilt_current: 7, tx_power_current: 10 },
    });
  });

  it("supports enabled updates only for pages with enabled controls", () => {
    const existing = { A1: { azimuth: 45, enabled: true, tilt_current: 3, tx_power_current: 10 } };

    expect(updateAntennaSetting(existing, antenna(), "A1", "enabled", false, true).A1.enabled).toBe(false);
    expect(updateAntennaSetting(existing, antenna(), "A1", "enabled", false, false).A1.enabled).toBe(true);
  });

  it("removes one antenna setting without mutating the source", () => {
    const stored = { A1: { azimuth: 90 }, A2: { azimuth: 180 } };

    expect(removeAntennaSetting(stored, "A1")).toEqual({ A2: { azimuth: 180 } });
    expect(stored).toHaveProperty("A1");
  });

  it("clears every role assigned to a removed antenna", () => {
    expect(removeAntennaRoles({
      transmitter: "A1",
      receiver: "A2",
      interferer: "A1",
    }, "A1")).toEqual({
      transmitter: "",
      receiver: "A2",
      interferer: "",
    });
  });
});
