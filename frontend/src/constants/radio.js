export const DEFAULT_SOLVER = {
  max_depth: 2,
  samples_per_tx: 20000,
  cell_size: 5,
  center: [0, 0, 0],
  size: [300, 300],
};

export const DEFAULT_CAMERA = {
  position: [-1.5, -137, 115],
  look_at: [0, 0, 10],
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
  antenna("A1", 105.8329, 21.0287, 30, 2, 8, 16, 45, 20, 30, 40),
  antenna("A2", 105.8340, 21.0279, 28, 2, 10, 18, 20, 20, 30, 40),
  antenna("A3", 105.8352, 21.0274, 29, 2, 9, 16, 335, 20, 30, 40),
];