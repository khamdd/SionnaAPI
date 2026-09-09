export const DEFAULT_SOLVER = {
  max_depth: 8,
  samples_per_tx: 1000000,
  cell_size: 5,
  center: [0, 0, 0],
  size: [300, 300],
};

export const TRANSMITTER_PATTERN = "tr38901";
export const DEFAULT_RSRP_USER_COUNT = 1000;
export const MAX_RSRP_USER_COUNT = 5000;
export const DEFAULT_USER_HEIGHT_M = 1.5;
export const DEFAULT_RSRP_RANDOM_SEED = 42;
export const RSRP_QUALITY_BANDS = [
  {
    key: "excellent",
    label: "Excellent",
    range: ">= -80 dBm",
    description: "Strong signal",
    color: "#16a34a",
  },
  {
    key: "good",
    label: "Good",
    range: "-90 to -80 dBm",
    description: "Reliable signal",
    color: "#84cc16",
  },
  {
    key: "fair",
    label: "Fair",
    range: "-100 to -90 dBm",
    description: "Usable signal",
    color: "#facc15",
  },
  {
    key: "poor",
    label: "Poor",
    range: "-120 to -100 dBm",
    description: "Weak signal",
    color: "#f97316",
  },
  {
    key: "no_coverage",
    label: "No coverage",
    range: "< -120 dBm",
    description: "Below threshold",
    color: "#ef4444",
  },
];

function antenna(
  id,
  longitude,
  latitude,
  heightM,
  tiltMin,
  tiltCurrent,
  tiltMax,
  azimuth,
  powerMin,
  powerCurrent,
  powerMax,
) {
  return {
    id,
    longitude,
    latitude,
    height_m: heightM,
    tilt: {
      min: tiltMin,
      current: tiltCurrent,
      max: tiltMax,
    },
    azimuth,
    tx_power: {
      min: powerMin,
      current: powerCurrent,
      max: powerMax,
    },
  };
}

export const DEFAULT_ANTENNAS = [
  antenna("HN-01", 105.8329, 21.0287, 30, 2, 8, 16, 45, 20, 30, 40),
  antenna("HN-02", 105.8340, 21.0279, 28, 2, 10, 18, 20, 20, 30, 40),
  antenna("HN-03", 105.8352, 21.0274, 29, 2, 9, 16, 335, 20, 30, 40),
  antenna("HN-04", 105.8314, 21.0301, 32, 2, 7, 15, 90, 20, 31, 43),
  antenna("HN-05", 105.8371, 21.0292, 27, 1, 6, 14, 135, 18, 29, 40),
  antenna("HN-06", 105.8298, 21.0268, 35, 3, 11, 19, 210, 20, 32, 44),
  antenna("HN-07", 105.8386, 21.0259, 31, 2, 8, 18, 275, 19, 30, 42),
  antenna("HN-08", 105.8276, 21.0315, 26, 1, 5, 13, 15, 18, 28, 39),
  antenna("HN-09", 105.8403, 21.0310, 33, 2, 9, 17, 60, 20, 31, 41),
  antenna("HN-10", 105.8261, 21.0244, 30, 2, 10, 20, 120, 20, 33, 45),
  antenna("HN-11", 105.8420, 21.0249, 29, 2, 7, 16, 185, 19, 30, 42),
  antenna("HN-12", 105.8247, 21.0291, 34, 3, 12, 21, 240, 20, 32, 44),
  antenna("HN-13", 105.8437, 21.0284, 28, 1, 6, 15, 300, 18, 29, 40),
  antenna("HN-14", 105.8309, 21.0334, 31, 2, 8, 17, 25, 20, 30, 41),
  antenna("HN-15", 105.8360, 21.0338, 27, 1, 5, 14, 80, 18, 28, 39),
  antenna("HN-16", 105.8394, 21.0217, 36, 3, 13, 22, 150, 21, 34, 46),
  antenna("HN-17", 105.8287, 21.0219, 30, 2, 9, 18, 205, 20, 31, 43),
  antenna("HN-18", 105.8450, 21.0321, 32, 2, 10, 19, 260, 20, 32, 44),
  antenna("HN-19", 105.8235, 21.0326, 29, 1, 7, 16, 315, 19, 30, 42),
  antenna("HN-20", 105.8331, 21.0204, 33, 2, 11, 20, 355, 20, 33, 45),
];
