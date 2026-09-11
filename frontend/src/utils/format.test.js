import { describe, expect, it } from "vitest";

import {
  firstArtifactUrl,
  formatDateTime,
  formatLngLatPosition,
  formatMaybeNumber,
  formatNeighborDelta,
  formatPosition,
  formatPositionValue,
  formatRange,
  formatSimulationType,
  formatText,
} from "./format";

describe("formatSimulationType", () => {
  it("replaces underscores and capitalizes words", () => {
    expect(formatSimulationType("network_coverage")).toBe("Network Coverage");
    expect(formatSimulationType("throughput_comparison")).toBe(
      "Throughput Comparison",
    );
    expect(formatSimulationType("sinr")).toBe("Sinr");
  });

  it("returns an empty string for missing values", () => {
    expect(formatSimulationType(null)).toBe("");
    expect(formatSimulationType(undefined)).toBe("");
    expect(formatSimulationType("")).toBe("");
  });
});

describe("formatDateTime", () => {
  it("returns a dash for missing values", () => {
    expect(formatDateTime(null)).toBe("--");
    expect(formatDateTime(undefined)).toBe("--");
    expect(formatDateTime("")).toBe("--");
  });

  it("formats valid timestamps through Date.toLocaleString", () => {
    const value = "2026-09-11T10:20:30Z";

    expect(formatDateTime(value)).toBe(new Date(value).toLocaleString());
  });
});

describe("formatMaybeNumber", () => {
  it("returns a dash for missing or non-numeric values", () => {
    expect(formatMaybeNumber(null)).toBe("--");
    expect(formatMaybeNumber(undefined)).toBe("--");
    expect(formatMaybeNumber("abc")).toBe("--");
    expect(formatMaybeNumber(Number.NaN)).toBe("--");
  });

  it("formats integers without decimals", () => {
    expect(formatMaybeNumber(5)).toBe("5");
    expect(formatMaybeNumber(0)).toBe("0");
    expect(formatMaybeNumber(-12)).toBe("-12");
    expect(formatMaybeNumber("7")).toBe("7");
  });

  it("formats non-integers with one decimal", () => {
    expect(formatMaybeNumber(5.25)).toBe("5.3");
    expect(formatMaybeNumber("7.5")).toBe("7.5");
  });

  it("treats an empty string as zero", () => {
    expect(formatMaybeNumber("")).toBe("0");
  });
});

describe("formatRange", () => {
  it("returns a dash for a missing range", () => {
    expect(formatRange(null)).toBe("--");
    expect(formatRange(undefined)).toBe("--");
  });

  it("formats current value and min-max range", () => {
    expect(formatRange({ current: 8, min: 2, max: 18 })).toBe(
      "8 (range 2–18)",
    );
  });

  it("appends the unit to the current value and after the range", () => {
    expect(formatRange({ current: 8, min: 2, max: 18 }, "deg")).toBe(
      "8 deg (range 2–18 deg)",
    );
  });

  it("keeps dashes for missing range endpoints", () => {
    expect(formatRange({ current: 6, min: null, max: undefined })).toBe(
      "6 (range --–--)",
    );
  });
});

describe("formatNeighborDelta", () => {
  it("reports negative deltas as stronger", () => {
    expect(formatNeighborDelta(-3.24)).toBe("3.2 dB stronger");
  });

  it("reports zero and positive deltas as weaker", () => {
    expect(formatNeighborDelta(1.5)).toBe("1.5 dB weaker");
    expect(formatNeighborDelta(0)).toBe("0.0 dB weaker");
  });

  it("returns a dash only for non-numeric values", () => {
    expect(formatNeighborDelta("abc")).toBe("--");
    expect(formatNeighborDelta(undefined)).toBe("--");
  });

  it("treats null as zero, which reads as weaker", () => {
    expect(formatNeighborDelta(null)).toBe("0.0 dB weaker");
  });
});

describe("formatPosition", () => {
  it("joins raw position components", () => {
    expect(formatPosition([1, 2.5, "z"])).toBe("1, 2.5, z");
  });
});

describe("formatPositionValue", () => {
  it("returns a dash for non-array values", () => {
    expect(formatPositionValue(null)).toBe("--");
    expect(formatPositionValue(undefined)).toBe("--");
    expect(formatPositionValue("x")).toBe("--");
  });

  it("formats each component with number fallbacks", () => {
    expect(formatPositionValue([1.25, "", null])).toBe("1.3, 0, --");
  });
});

describe("formatLngLatPosition", () => {
  it("formats longitude and latitude with four decimals", () => {
    expect(formatLngLatPosition({ longitude: 105.83423, latitude: 21.027 })).toBe(
      "105.8342, 21.0270",
    );
  });

  it("returns a dash for missing or non-numeric coordinates", () => {
    expect(formatLngLatPosition(null)).toBe("--");
    expect(formatLngLatPosition({})).toBe("--");
    expect(formatLngLatPosition({ longitude: "abc", latitude: 1 })).toBe("--");
  });
});

describe("formatText", () => {
  it("returns a dash for empty values", () => {
    expect(formatText(null)).toBe("--");
    expect(formatText(undefined)).toBe("--");
    expect(formatText("")).toBe("--");
  });

  it("stringifies other values", () => {
    expect(formatText(0)).toBe("0");
    expect(formatText(false)).toBe("false");
    expect(formatText("abc")).toBe("abc");
  });
});

describe("firstArtifactUrl", () => {
  it("prefers the first coverage_png artifact with a public URL", () => {
    const artifacts = [
      { artifact_type: "grid", public_url: "/grid.json" },
      { artifact_type: "coverage_png", public_url: "/map.png" },
      { artifact_type: "coverage_png", public_url: "/second.png" },
    ];

    expect(firstArtifactUrl(artifacts)).toBe("/map.png");
  });

  it("falls back to image file extensions", () => {
    const artifacts = [
      { artifact_type: "grid", public_url: "/grid.json" },
      { artifact_type: "other", public_url: "/photo.jpeg" },
    ];

    expect(firstArtifactUrl(artifacts)).toBe("/photo.jpeg");
  });

  it("skips artifacts without a public URL", () => {
    const artifacts = [
      { artifact_type: "coverage_png", public_url: "" },
      { artifact_type: "other", public_url: "/image.webp" },
    ];

    expect(firstArtifactUrl(artifacts)).toBe("/image.webp");
  });

  it("returns an empty string when nothing matches", () => {
    expect(firstArtifactUrl([])).toBe("");
    expect(firstArtifactUrl(null)).toBe("");
    expect(firstArtifactUrl([{ artifact_type: "grid", public_url: "/x.json" }])).toBe(
      "",
    );
  });
});
