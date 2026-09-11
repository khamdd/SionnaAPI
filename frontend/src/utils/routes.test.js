import { describe, expect, it } from "vitest";

import { ROUTES } from "../constants";
import {
  NETWORK_OPTIMIZATION_ROUTE,
  SCENE_CREATION_ROUTE,
  SCENE_SELECTION_ROUTE,
  SIMULATION_ENTRY_ROUTE,
  isWorkSceneRequiredRoute,
  normalizeRoute,
} from "./routes";

describe("route constants", () => {
  it("keeps the special routes distinct from the route matrix", () => {
    expect(SCENE_SELECTION_ROUTE).toBe("/scenes");
    expect(SCENE_CREATION_ROUTE).toBe("/choose-scene");
    expect(SIMULATION_ENTRY_ROUTE).toBe("/network");
    expect(NETWORK_OPTIMIZATION_ROUTE).toBe("/network/optimization");
  });
});

describe("normalizeRoute", () => {
  it("maps the root path to the scene selection route", () => {
    expect(normalizeRoute("/")).toBe(SCENE_SELECTION_ROUTE);
  });

  it("passes through every route from the route matrix", () => {
    for (const { path } of ROUTES) {
      expect(normalizeRoute(path)).toBe(path);
    }
  });

  it("passes through scene creation and network optimization routes", () => {
    expect(normalizeRoute(SCENE_CREATION_ROUTE)).toBe(SCENE_CREATION_ROUTE);
    expect(normalizeRoute(NETWORK_OPTIMIZATION_ROUTE)).toBe(NETWORK_OPTIMIZATION_ROUTE);
  });

  it("maps unknown paths to the scene selection route", () => {
    expect(normalizeRoute("/unknown")).toBe(SCENE_SELECTION_ROUTE);
    expect(normalizeRoute("/network/coverage/extra")).toBe(SCENE_SELECTION_ROUTE);
    expect(normalizeRoute("/SCENES")).toBe(SCENE_SELECTION_ROUTE);
  });

  it("maps missing paths to the scene selection route", () => {
    expect(normalizeRoute(undefined)).toBe(SCENE_SELECTION_ROUTE);
    expect(normalizeRoute("")).toBe(SCENE_SELECTION_ROUTE);
  });
});

describe("isWorkSceneRequiredRoute", () => {
  it("excludes scene selection and scene creation", () => {
    expect(isWorkSceneRequiredRoute(SCENE_SELECTION_ROUTE)).toBe(false);
    expect(isWorkSceneRequiredRoute(SCENE_CREATION_ROUTE)).toBe(false);
  });

  it("requires a work scene for simulation and result routes", () => {
    expect(isWorkSceneRequiredRoute(SIMULATION_ENTRY_ROUTE)).toBe(true);
    expect(isWorkSceneRequiredRoute(NETWORK_OPTIMIZATION_ROUTE)).toBe(true);
    expect(isWorkSceneRequiredRoute("/queue")).toBe(true);
    expect(isWorkSceneRequiredRoute("/history")).toBe(true);
  });

  it("requires a work scene for unknown and root paths", () => {
    expect(isWorkSceneRequiredRoute("/")).toBe(true);
    expect(isWorkSceneRequiredRoute("/unknown")).toBe(true);
  });
});
