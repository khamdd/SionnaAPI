import { describe, expect, it } from "vitest";

import { validateCreateDraft } from "./SimulationAntennaPanel";

const scene = { bounds: { west: 105.8, east: 105.9, south: 21, north: 21.1 } };
const valid = {
  id: "NEW-1", longitude: 105.85, latitude: 21.05, height_m: 30, azimuth: 0,
  tilt: { min: 0, current: 8, max: 20 },
  tx_power: { min: 20, current: 30, max: 40 },
};

describe("validateCreateDraft", () => {
  it("accepts an antenna inside the selected scene", () => {
    expect(validateCreateDraft(valid, scene)).toBe("");
  });

  it("reports the exact scene range for out-of-bounds coordinates", () => {
    expect(validateCreateDraft({ ...valid, longitude: 106 }, scene)).toBe(
      "Antenna coordinates must stay inside the selected scene. Longitude 106.0000 must be 105.8000 to 105.9000, and latitude 21.0500 must be 21.0000 to 21.1000.",
    );
  });

  it("rejects invalid physical and range values before saving", () => {
    expect(validateCreateDraft({ ...valid, height_m: 0 }, scene)).toBe("Height must be greater than 0 m.");
    expect(validateCreateDraft({ ...valid, tilt: { min: 10, current: 8, max: 20 } }, scene)).toContain("Tilt_current");
  });
});
