import { ROUTES } from "../constants";

export const SCENE_SELECTION_ROUTE = "/scenes";
export const SCENE_CREATION_ROUTE = "/choose-scene";
export const SIMULATION_ENTRY_ROUTE = "/network";
export const NETWORK_OPTIMIZATION_ROUTE = "/network/optimization";

export function normalizeRoute(pathname) {
  if (pathname === "/") {
    return SCENE_SELECTION_ROUTE;
  }

  return ROUTES.some((item) => item.path === pathname)
    || pathname === SCENE_CREATION_ROUTE
    || pathname === NETWORK_OPTIMIZATION_ROUTE
    ? pathname
    : SCENE_SELECTION_ROUTE;
}

export function isWorkSceneRequiredRoute(pathname) {
  return pathname !== SCENE_SELECTION_ROUTE && pathname !== SCENE_CREATION_ROUTE;
}
