import { ROUTES } from "../constants";
import {
  NETWORK_OPTIMIZATION_ROUTE,
  SCENE_SELECTION_ROUTE,
  SIMULATION_ENTRY_ROUTE,
} from "../utils/routes";

function NavIcon({ path }) {
  const paths = {
    "/network": "M4 16v4m5-8v8m5-13v13m5-17v17M2 20h20",
    "/configurations": "M4 5h16M4 12h16M4 19h16M8 3v4m8 3v4M11 17v4",
    "/profiles": "M5 4h14v5H5V4Zm0 11h14v5H5v-5Zm3-3h8M12 9v6",
    "/coverage": "M3 6.5 12 2l9 4.5-9 4.5-9-4.5Zm0 5L12 16l9-4.5M3 16.5 12 21l9-4.5",
    "/rsrp": "M4.9 19.1a10 10 0 0 1 14.2 0M8 16a5.7 5.7 0 0 1 8 0m-5.4-3a2 2 0 0 1 2.8 0M12 21h.01",
    "/sinr": "M4 18V9m5 9V5m5 13v-7m5 7V3M2 21h20",
    "/throughput": "M3 17 8 12l4 4 8-9m-5 0h5v5",
    "/queue": "M5 4h14v4H5V4Zm0 6h14v4H5v-4Zm0 6h14v4H5v-4Z",
    "/history": "M12 8v5l3 2m6-3a9 9 0 1 1-3-6.7M21 3v6h-6",
  };

  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[path] || paths["/network"]} />
    </svg>
  );
}

export default function Navbar({
  activeScene,
  currentUser,
  hasWorkScene,
  isBusy,
  onChangeScene,
  onLogout,
  onNavigate,
  route,
}) {
  const visibleRoutes = hasWorkScene
    ? ROUTES.filter((item) => item.path !== SCENE_SELECTION_ROUTE)
    : [];
  const simulationRoutes = visibleRoutes.filter((item) => (
    item.path !== "/queue" && item.path !== "/history"
  ));
  const resultRoutes = visibleRoutes.filter((item) => (
    item.path === "/queue" || item.path === "/history"
  ));

  return (
    <header className="app-navbar">
      <div className="brand-block">
        <span className="brand-mark" aria-hidden="true">
          <i /><i /><i />
        </span>
        <div>
          <strong>Sionna Planner</strong>
          <span>Radio network workspace</span>
        </div>
      </div>
      <nav aria-label="Primary navigation">
        {simulationRoutes.length > 0 && (
          <div className="nav-group simulation-nav" aria-label="Simulation tools">
            <span>Planning tools</span>
            <div>
              {simulationRoutes.map((item) => (
                <button
                  key={item.path}
                  className={route === item.path || (item.path === SIMULATION_ENTRY_ROUTE && route === NETWORK_OPTIMIZATION_ROUTE) ? "active" : ""}
                  type="button"
                  disabled={isBusy}
                  aria-current={route === item.path ? "page" : undefined}
                  title={item.label}
                  onClick={() => onNavigate(item.path)}
                >
                  <NavIcon path={item.path} />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {resultRoutes.length > 0 && (
          <div className="nav-group records-nav records-section" aria-label="Simulation results">
            <span>Results</span>
            <div>
              {resultRoutes.map((item) => (
                <button
                  key={item.path}
                  className={route === item.path ? "active" : ""}
                  type="button"
                  disabled={isBusy}
                  aria-current={route === item.path ? "page" : undefined}
                  title={item.label}
                  onClick={() => onNavigate(item.path)}
                >
                  <NavIcon path={item.path} />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="nav-context">
          {hasWorkScene && (
            <div className="scene-context">
              <span>Active work scene</span>
              <strong title={activeScene?.name}>{activeScene?.name || "Loading scene"}</strong>
              <button type="button" disabled={isBusy} onClick={onChangeScene}>
                Change scene
              </button>
            </div>
          )}
          <div className="user-menu">
            <div className="user-identity">
              <span className="user-avatar" aria-hidden="true">
                {(currentUser?.username || "U").slice(0, 1).toUpperCase()}
              </span>
              <span>
                <small>Signed in as</small>
                <strong>{currentUser?.username || "User"}</strong>
              </span>
            </div>
            <div className="user-menu-panel">
              {!hasWorkScene && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => onNavigate(SCENE_SELECTION_ROUTE)}
                >
                  Select scene
                </button>
              )}
              {hasWorkScene && (
                <button
                  className="mobile-change-scene"
                  type="button"
                  disabled={isBusy}
                  onClick={onChangeScene}
                >
                  Change scene
                </button>
              )}
              <button className="logout-button" type="button" onClick={onLogout}>
                Sign out
              </button>
            </div>
          </div>
        </div>
      </nav>
    </header>
  );
}
