import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_BASE_URL, AUTH_TOKEN_STORAGE_KEY } from "./constants";
import * as api from "./api";

let fetchMock;
let storage;

function respond(body, { ok = true, status = 200, jsonFails = false } = {}) {
  return {
    ok,
    status,
    json: jsonFails
      ? async () => {
        throw new Error("invalid json");
      }
      : async () => body,
  };
}

function setToken(token) {
  if (token === null) {
    storage.delete(AUTH_TOKEN_STORAGE_KEY);
  } else {
    storage.set(AUTH_TOKEN_STORAGE_KEY, token);
  }
}

function lastCall() {
  const calls = fetchMock.mock.calls;

  return calls[calls.length - 1];
}

function expectRequest(expected) {
  const [url, options] = lastCall();

  expect(url).toBe(`${API_BASE_URL}${expected.path}`);
  expect(options.method).toBe(expected.method ?? undefined);
  expect(options.body).toBe(expected.body);

  if (Object.prototype.hasOwnProperty.call(expected, "headers")) {
    expect(options.headers).toEqual(expected.headers);
  }

  return { url, options };
}

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  });
  setToken("tok-123");
  fetchMock = vi.fn(async () => respond({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authentication headers", () => {
  it("sends the stored token as a bearer header on every request", async () => {
    setToken("tok-123");

    await api.getCurrentUser();

    const [, options] = lastCall();
    expect(options.headers.Authorization).toBe("Bearer tok-123");

    setToken("tok-456");
    await api.getCurrentUser();

    const [, nextOptions] = lastCall();
    expect(nextOptions.headers.Authorization).toBe("Bearer tok-456");
  });

  it("omits the Authorization header without a stored token", async () => {
    setToken(null);

    await api.listScenes();

    const [, options] = lastCall();
    expect(options.headers).toEqual({});
  });
});

describe("error message extraction", () => {
  it.each([
    ["detail string", { detail: "Boom" }, "Boom"],
    ["error string", { error: "Oops" }, "Oops"],
    ["nested detail error", { detail: { error: "Nested" } }, "Nested"],
    ["body without message fields", { foo: 1 }, "HTTP 500"],
  ])("extracts the message from the %s", async (_name, body, expected) => {
    fetchMock = vi.fn(async () => respond(body, { ok: false, status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    let message = "";
    try {
      await api.getCurrentUser();
    } catch (error) {
      message = error.message;
    }

    expect(message).toBe(expected);
  });

  it("falls back to the HTTP status for unreadable bodies", async () => {
    fetchMock = vi.fn(async () =>
      respond({}, { ok: false, status: 418, jsonFails: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.getCurrentUser()).rejects.toThrow("HTTP 418");
  });

  it("propagates the extracted message from raw delete requests", async () => {
    fetchMock = vi.fn(async () =>
      respond({ detail: "Nope" }, { ok: false, status: 409 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.deleteScene("scene-1")).rejects.toThrow("Nope");
  });
});

describe("simulation submission functions", () => {
  it.each([
    ["runNetworkCoverage", "/api/v1/network-coverage"],
    ["runNetworkCoverageOptimization", "/api/v1/optimizations/network-coverage/run"],
    ["runCoverageMap", "/api/v1/coverage-map"],
    ["runRsrpSimulation", "/api/v1/rsrp-simulation"],
    ["runSinr", "/api/v1/sinr"],
    ["runThroughputComparison", "/api/v1/throughput-comparison"],
  ])("%s posts the payload and returns the response unchanged", async (name, path) => {
    const payload = { simulation_type: "sinr", antennas: [] };
    const resultBody = { job_id: "job-1" };
    fetchMock = vi.fn(async () => respond(resultBody));
    vi.stubGlobal("fetch", fetchMock);

    const result = await api[name](payload);

    expectRequest({
      method: "POST",
      path,
      headers: {
        Authorization: "Bearer tok-123",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    expect(result).toBe(resultBody);

    const inlineBody = { status: "success", sinr_db: 12.5 };
    fetchMock = vi.fn(async () => respond(inlineBody));
    vi.stubGlobal("fetch", fetchMock);

    const inlineResult = await api[name](payload);

    expect(inlineResult).toBe(inlineBody);
  });
});

describe("authentication endpoints", () => {
  it("registers a user", async () => {
    const payload = { username: "user", password: "secret" };

    await api.registerUser(payload);

    expectRequest({
      method: "POST",
      path: "/api/v1/auth/register",
      headers: {
        Authorization: "Bearer tok-123",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  });

  it("logs a user in", async () => {
    const payload = { username: "user", password: "secret" };

    await api.loginUser(payload);

    expectRequest({
      method: "POST",
      path: "/api/v1/auth/login",
      headers: {
        Authorization: "Bearer tok-123",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  });

  it("verifies the current user with GET", async () => {
    await api.getCurrentUser();

    expectRequest({
      method: undefined,
      path: "/api/v1/auth/verify",
      headers: { Authorization: "Bearer tok-123" },
    });
  });
});

describe("network configuration endpoints", () => {
  it("lists configurations with scene id, default limit, and optional status", async () => {
    await api.listNetworkConfigurations("scene-1");

    expectRequest({
      path: "/api/v1/network-configurations?scene_id=scene-1&limit=200",
    });

    await api.listNetworkConfigurations("scene-1", "published", 5);

    expectRequest({
      path: "/api/v1/network-configurations?scene_id=scene-1&limit=5&status=published",
    });
  });

  it("creates a configuration", async () => {
    const payload = { scene_id: "scene-1", antennas: [] };

    await api.createNetworkConfiguration(payload);

    expectRequest({
      method: "POST",
      path: "/api/v1/network-configurations",
      headers: {
        Authorization: "Bearer tok-123",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  });

  it("compares two configurations", async () => {
    await api.compareNetworkConfigurations("cfg-a", "cfg-b");

    expectRequest({
      method: "POST",
      path: "/api/v1/network-configurations/compare",
      headers: {
        Authorization: "Bearer tok-123",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        baseline_configuration_id: "cfg-a",
        candidate_configuration_id: "cfg-b",
      }),
    });
  });

  it("publishes a configuration with a body-less POST", async () => {
    await api.publishNetworkConfiguration("cfg-1");

    expectRequest({
      method: "POST",
      path: "/api/v1/network-configurations/cfg-1/publish",
      headers: { Authorization: "Bearer tok-123" },
    });
  });
});

describe("simulation profile endpoints", () => {
  it("lists profiles with scene id and limit", async () => {
    await api.listSimulationProfiles("scene-1");

    expectRequest({
      path: "/api/v1/simulation-profiles?scene_id=scene-1&limit=200",
    });

    await api.listSimulationProfiles("scene-1", 3);

    expectRequest({
      path: "/api/v1/simulation-profiles?scene_id=scene-1&limit=3",
    });
  });

  it("creates a profile", async () => {
    const payload = { name: "profile" };

    await api.createSimulationProfile(payload);

    expectRequest({
      method: "POST",
      path: "/api/v1/simulation-profiles",
      headers: {
        Authorization: "Bearer tok-123",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  });

  it("updates a profile with PUT", async () => {
    const payload = { name: "renamed" };

    await api.updateSimulationProfile("prof-1", payload);

    expectRequest({
      method: "PUT",
      path: "/api/v1/simulation-profiles/prof-1",
      headers: {
        Authorization: "Bearer tok-123",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  });

  it("deletes a profile with DELETE", async () => {
    await api.deleteSimulationProfile("prof-1");

    expectRequest({
      method: "DELETE",
      path: "/api/v1/simulation-profiles/prof-1",
      headers: { Authorization: "Bearer tok-123" },
    });
  });

  it("enables a profile with a configuration id", async () => {
    await api.setSimulationProfileEnabled("prof-1", true, "cfg-1");

    expectRequest({
      method: "POST",
      path: "/api/v1/simulation-profiles/prof-1/enable",
      headers: {
        Authorization: "Bearer tok-123",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ configuration_id: "cfg-1" }),
    });
  });

  it("keeps a null configuration id when enabling", async () => {
    await api.setSimulationProfileEnabled("prof-1", true, null);

    expectRequest({
      method: "POST",
      path: "/api/v1/simulation-profiles/prof-1/enable",
      headers: {
        Authorization: "Bearer tok-123",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ configuration_id: null }),
    });
  });

  it("disables a profile without a request body", async () => {
    await api.setSimulationProfileEnabled("prof-1", false);

    const { options } = expectRequest({
      method: "POST",
      path: "/api/v1/simulation-profiles/prof-1/disable",
      headers: { Authorization: "Bearer tok-123" },
    });

    expect(options.body).toBeUndefined();
  });

  it("builds a profile request", async () => {
    await api.buildSimulationProfileRequest("prof-1", "cfg-1");

    expectRequest({
      method: "POST",
      path: "/api/v1/simulation-profiles/prof-1/build-request",
      headers: {
        Authorization: "Bearer tok-123",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ configuration_id: "cfg-1" }),
    });
  });
});

describe("history and queue endpoints", () => {
  it("lists runs with a default limit and optional scene id", async () => {
    await api.listSimulationRuns();

    expectRequest({ path: "/api/v1/simulation-runs?limit=25" });

    await api.listSimulationRuns(50, "scene-9");

    expectRequest({
      path: "/api/v1/simulation-runs?limit=50&scene_id=scene-9",
    });

    await api.listSimulationRuns(50, "");

    expectRequest({ path: "/api/v1/simulation-runs?limit=50" });
  });

  it("fetches a run and its result", async () => {
    await api.getSimulationRun("run-1");

    expectRequest({ path: "/api/v1/simulation-runs/run-1" });

    await api.getSimulationRunResult("run-1");

    expectRequest({ path: "/api/v1/simulation-runs/run-1/result" });
  });

  it("lists jobs with a default limit", async () => {
    await api.listSimulationJobs();

    expectRequest({ path: "/api/v1/simulation-jobs?limit=100" });

    await api.listSimulationJobs(7);

    expectRequest({ path: "/api/v1/simulation-jobs?limit=7" });
  });

  it("fetches a job and its result", async () => {
    await api.getSimulationJob("job-1");

    expectRequest({ path: "/api/v1/simulation-jobs/job-1" });

    await api.getSimulationJobResult("job-1");

    expectRequest({ path: "/api/v1/simulation-jobs/job-1/result" });
  });

  it("saves a queue result with a body-less POST", async () => {
    await api.saveSimulationJobResult("job-1");

    expectRequest({
      method: "POST",
      path: "/api/v1/simulation-jobs/job-1/save",
      headers: { Authorization: "Bearer tok-123" },
    });
  });

  it("deletes a job through the raw fetch path", async () => {
    const body = { deleted: true };
    fetchMock = vi.fn(async () => respond(body));
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.deleteSimulationJob("job-1");

    expectRequest({
      method: "DELETE",
      path: "/api/v1/simulation-jobs/job-1",
      headers: { Authorization: "Bearer tok-123" },
    });
    expect(result).toBe(body);
  });

  it("deletes a history run through the raw fetch path", async () => {
    fetchMock = vi.fn(async () => respond({ deleted: true }));
    vi.stubGlobal("fetch", fetchMock);

    await api.deleteSimulationRun("run-1");

    expectRequest({
      method: "DELETE",
      path: "/api/v1/simulation-runs/run-1",
      headers: { Authorization: "Bearer tok-123" },
    });
  });
});

describe("scene endpoints", () => {
  it("lists scenes", async () => {
    await api.listScenes();

    expectRequest({ path: "/api/v1/scenes" });
  });

  it("creates a scene preview", async () => {
    const payload = { bounds: { west: 1, south: 2, east: 3, north: 4 } };

    await api.createScenePreview(payload);

    expectRequest({
      method: "POST",
      path: "/api/v1/scenes/preview",
      headers: {
        Authorization: "Bearer tok-123",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  });

  it("activates a scene with a body-less POST", async () => {
    await api.activateScene("scene-1");

    expectRequest({
      method: "POST",
      path: "/api/v1/scenes/scene-1/activate",
      headers: { Authorization: "Bearer tok-123" },
    });
  });

  it("deletes a scene through the raw fetch path", async () => {
    fetchMock = vi.fn(async () => respond({ deleted: true }));
    vi.stubGlobal("fetch", fetchMock);

    await api.deleteScene("scene-1");

    expectRequest({
      method: "DELETE",
      path: "/api/v1/scenes/scene-1",
      headers: { Authorization: "Bearer tok-123" },
    });
  });
});

describe("artifact fetching", () => {
  it("keeps absolute artifact URLs unchanged", async () => {
    await api.fetchArtifactJson("http://cdn.example.com/x.json");

    const [url] = lastCall();
    expect(url).toBe("http://cdn.example.com/x.json");
  });

  it("prefixes relative artifact URLs with the API base", async () => {
    await api.fetchArtifactJson("/static/simulation-results/x.json");

    const [url] = lastCall();
    expect(url).toBe(`${API_BASE_URL}/static/simulation-results/x.json`);

    await api.fetchArtifactJson("static/simulation-results/x.json");

    const [nextUrl] = lastCall();
    expect(nextUrl).toBe(`${API_BASE_URL}/static/simulation-results/x.json`);
  });

  it("sends the bearer header for artifact downloads", async () => {
    await api.fetchArtifactJson("/static/x.json");

    const [, options] = lastCall();
    expect(options.headers.Authorization).toBe("Bearer tok-123");
  });
});

describe("offline buildings", () => {
  it("passes bounds as query parameters and forwards the signal", async () => {
    const signal = { aborted: false };

    await api.getOfflineBuildings(
      { south: "1.5", west: "2.5", north: "3.5", east: "4.5" },
      signal,
    );

    const { url, options } = expectRequest({
      path: "/api/v1/offline-buildings?south=1.5&west=2.5&north=3.5&east=4.5",
      headers: { Authorization: "Bearer tok-123" },
    });

    expect(url).toBe(`${API_BASE_URL}/api/v1/offline-buildings?south=1.5&west=2.5&north=3.5&east=4.5`);
    expect(options.signal).toBe(signal);
  });
});
