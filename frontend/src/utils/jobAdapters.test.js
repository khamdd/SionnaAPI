import { describe, expect, it } from "vitest";

import { DEFAULT_SOLVER, TRANSMITTER_PATTERN } from "../constants";
import { solverForScene } from "./scene";
import {
  antennaSnapshotsForJob,
  buildNetworkCoveragePayload,
  formatJobStatus,
  simulationJobToHistoryItem,
} from "./jobAdapters";

const SCENE_BOUNDS = { south: 20, north: 21, west: 10, east: 11 };
const SCENE = { id: "scene-1", name: "Test Scene", bounds: SCENE_BOUNDS };
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

describe("buildNetworkCoveragePayload", () => {
  it("builds the canonical network coverage request", () => {
    const payload = buildNetworkCoveragePayload(
      [baseAntenna(), { ...baseAntenna(), id: "A2", enabled: false, position: [1, 2, 3] }],
      SCENE,
    );

    expect(payload).toEqual({
      antennas: [
        {
          id: "A1",
          longitude: 10.5,
          latitude: 20.5,
          height_m: 12,
          tilt: TILT,
          azimuth: 90,
          tx_power: POWER,
        },
        {
          id: "A2",
          longitude: 10.5,
          latitude: 20.5,
          height_m: 12,
          tilt: TILT,
          azimuth: 90,
          tx_power: POWER,
        },
      ],
      transmitter_pattern: TRANSMITTER_PATTERN,
      solver: solverForScene(SCENE),
      bandwidth_mhz: 100,
      mimo_layers: 4,
    });
  });

  it("keeps the fallback solver when the scene has no usable bounds", () => {
    const payload = buildNetworkCoveragePayload([], null);

    expect(payload.antennas).toEqual([]);
    expect(payload.solver).toEqual({
      ...DEFAULT_SOLVER,
      center: [0, 0, 0],
      size: DEFAULT_SOLVER.size,
    });
    expect(payload.transmitter_pattern).toBe("tr38901");
    expect(payload.bandwidth_mhz).toBe(100);
    expect(payload.mimo_layers).toBe(4);
  });
});

describe("formatJobStatus", () => {
  it("reports saved jobs by their saved run", () => {
    expect(formatJobStatus({ result_run_id: "run-1", status: "succeeded" })).toBe("Saved");
  });

  it("formats the raw status and falls back to dashes", () => {
    expect(formatJobStatus({ status: "succeeded" })).toBe("succeeded");
    expect(formatJobStatus({ status: "" })).toBe("--");
    expect(formatJobStatus({ status: null })).toBe("--");
    expect(formatJobStatus({})).toBe("--");
  });
});

describe("simulationJobToHistoryItem", () => {
  const request = {
    transmitter_pattern: "custom-pattern",
    bandwidth_mhz: 100,
    mimo_layers: 4,
    solver: { cell_size: 5 },
    antennas: [baseAntenna()],
  };
  const job = {
    id: "job-1",
    simulation_type: "network_coverage",
    status: "succeeded",
    scene: SCENE,
    request,
    queued_at: "2026-09-11T10:00:00Z",
    started_at: "2026-09-11T10:00:05Z",
    finished_at: "2026-09-11T10:01:00Z",
    result: {
      status: "success",
      coverage_map_image_url: "/static/generated/coverage.png",
      solver: { cell_size: 5 },
    },
  };

  it("converts a succeeded job into a history item", () => {
    const item = simulationJobToHistoryItem(job);

    expect(item).toEqual({
      id: "job-1",
      simulation_type: "network_coverage",
      status: "success",
      transmitter_pattern: "custom-pattern",
      scene_id: "scene-1",
      scene_name: "Test Scene",
      scene_bounds: SCENE_BOUNDS,
      cell_size_m: 5,
      bandwidth_mhz: 100,
      mimo_layers: 4,
      coverage_map_image_url: "/static/generated/coverage.png",
      error_message: undefined,
      started_at: "2026-09-11T10:00:05Z",
      finished_at: "2026-09-11T10:01:00Z",
      created_at: "2026-09-11T10:00:00Z",
      solver: { cell_size: 5 },
      request_json: job.request,
      response_json: job.result,
      antennas: [
        {
          antenna_code: "A1",
          position: [0, 0, 12],
          azimuth_deg: 90,
          tilt: TILT,
          tx_power: POWER,
        },
      ],
      artifacts: [],
    });
  });

  it("prefers the saved run id and keeps failed job errors", () => {
    const failedJob = {
      ...job,
      id: "job-2",
      result_run_id: "run-9",
      status: "failed",
      error_message: "simulation failed",
      result: null,
    };

    const item = simulationJobToHistoryItem(failedJob);

    expect(item.id).toBe("run-9");
    expect(item.status).toBe("failed");
    expect(item.error_message).toBe("simulation failed");
    expect(item.response_json).toEqual({});
    expect(item.solver).toEqual({ cell_size: 5 });
  });

  it("falls back to the default transmitter pattern and scene id as name", () => {
    const item = simulationJobToHistoryItem({
      id: "job-3",
      simulation_type: "rsrp_simulation",
      status: "succeeded",
      scene: { id: "scene-2" },
    });

    expect(item.transmitter_pattern).toBe(TRANSMITTER_PATTERN);
    expect(item.scene_id).toBe("scene-2");
    expect(item.scene_name).toBe("scene-2");
    expect(item.status).toBe("success");
  });

  it("converts optimization jobs to network coverage history with the best request", () => {
    const bestRequest = {
      transmitter_pattern: "custom",
      bandwidth_mhz: 50,
      mimo_layers: 2,
      solver: { cell_size: 8 },
      antennas: [],
    };
    const optimizationJob = {
      id: "opt-1",
      simulation_type: "network_coverage_optimization",
      status: "succeeded",
      scene: SCENE,
      request: {
        base_request: {
          bandwidth_mhz: 100,
          mimo_layers: 4,
          solver: { cell_size: 5 },
          antennas: [baseAntenna()],
        },
      },
      result: {
        status: "success",
        optimization: { best_request: bestRequest },
      },
    };

    const item = simulationJobToHistoryItem(optimizationJob);

    expect(item.simulation_type).toBe("network_coverage");
    expect(item.request_json).toBe(bestRequest);
    expect(item.bandwidth_mhz).toBe(50);
    expect(item.mimo_layers).toBe(2);
    expect(item.cell_size_m).toBe(8);
    expect(item.transmitter_pattern).toBe("custom");
    expect(item.antennas).toEqual([]);
  });

  it("falls back to the optimization base request when no best request exists", () => {
    const baseRequest = {
      bandwidth_mhz: 100,
      mimo_layers: 4,
      solver: { cell_size: 5 },
      antennas: [baseAntenna()],
    };
    const optimizationJob = {
      id: "opt-2",
      simulation_type: "network_coverage_optimization",
      status: "succeeded",
      scene: SCENE,
      request: { base_request: baseRequest },
      result: { status: "success" },
    };

    const item = simulationJobToHistoryItem(optimizationJob);

    expect(item.request_json).toBe(baseRequest);
    expect(item.antennas).toHaveLength(1);
  });

  it("uses an empty request for optimization jobs without requests", () => {
    const item = simulationJobToHistoryItem({
      id: "opt-3",
      simulation_type: "network_coverage_optimization",
      status: "succeeded",
      scene: SCENE,
    });

    expect(item.request_json).toEqual({});
    expect(item.transmitter_pattern).toBe(TRANSMITTER_PATTERN);
    expect(item.status).toBe("success");
    expect(item.bandwidth_mhz).toBeUndefined();
  });
});

describe("antennaSnapshotsForJob", () => {
  it("returns an empty list when the request has no antenna array", () => {
    expect(antennaSnapshotsForJob({}, SCENE_BOUNDS)).toEqual([]);
    expect(antennaSnapshotsForJob({ antennas: "junk" }, SCENE_BOUNDS)).toEqual([]);
  });

  it("maps request antennas into snapshot shape", () => {
    const position = [1, 2, 3];

    expect(
      antennaSnapshotsForJob(
        { antennas: [{ ...baseAntenna(), position }] },
        SCENE_BOUNDS,
      ),
    ).toEqual([
      {
        antenna_code: "A1",
        position: [1, 2, 3],
        azimuth_deg: 90,
        tilt: TILT,
        tx_power: POWER,
      },
    ]);
  });

  it("converts missing positions against the scene bounds", () => {
    const snapshots = antennaSnapshotsForJob(
      { antennas: [baseAntenna()] },
      SCENE_BOUNDS,
    );

    expect(snapshots[0].position).toEqual([0, 0, 12]);
  });

  it("produces a null position when scene bounds are unavailable", () => {
    const snapshots = antennaSnapshotsForJob({ antennas: [baseAntenna()] }, null);

    expect(snapshots[0].position).toBeNull();
  });
});
