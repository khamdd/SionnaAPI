import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listScenes,
  deleteSimulationRun,
  getSimulationRun,
  listSimulationRuns,
  runNetworkCoverage,
} from "./api";
import {
  DEFAULT_ANTENNAS,
  DEFAULT_ACTIVE_SCENE,
  DEFAULT_SOLVER,
  ROUTES,
  TRANSMITTER_PATTERN,
  AUTH_TOKEN_STORAGE_KEY,
  USER_STORAGE_KEY,
} from "./constants";
import AntennaPanel from "./components/AntennaPanel";
import {
  CoverageApiPage,
  RsrpSimulationPage,
  SinrApiPage,
  ThroughputApiPage,
} from "./components/ApiPages";
import ComparisonResult from "./components/ComparisonResult";
import HistoryDetail from "./components/HistoryDetail";
import HistoryModal, { HistoryModalBody } from "./components/HistoryModal";
import HistoryPanel from "./components/HistoryPanel";
import LoginPage from "./components/LoginPage";
import MapPanel from "./components/MapPanel";
import SceneChooserModal from "./components/SceneChooserModal";
import ScenesPage from "./components/ScenesPage";
import { formatDateTime, formatSimulationType } from "./utils/format";
import {
  isSuccessfulHistoryItem,
  pruneComparisonDetails,
  pruneComparisonSelection,
} from "./utils/history";
import {
  drawHeatmap,
  summarizeGrid,
} from "./utils/map";
import {
  sceneSizeMeters,
  solverForScene,
} from "./utils/scene";

function clone(value) {
  return structuredClone(value);
}

export default function App() {
  const [currentUser, setCurrentUser] = useState(() => readStoredUser());
  const [route, setRoute] = useState(() => normalizeRoute(window.location.pathname));
  const [antennas, setAntennas] = useState(() => clone(DEFAULT_ANTENNAS));
  const [latestGrid, setLatestGrid] = useState(null);
  const [latestSolver, setLatestSolver] = useState(() => clone(DEFAULT_SOLVER));
  const [coverageImageUrl, setCoverageImageUrl] = useState("");
  const [runStatus, setRunStatus] = useState("Ready");
  const [runError, setRunError] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [historyStatus, setHistoryStatus] = useState("No history loaded.");
  const [historyError, setHistoryError] = useState(false);
  const [apiProgressLabel, setApiProgressLabel] = useState("");
  const [historyProgressLabel, setHistoryProgressLabel] = useState("");
  const [historyPreviewLoadCount, setHistoryPreviewLoadCount] = useState(0);
  const [latestHistory, setLatestHistory] = useState([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState(null);
  const [comparisonType, setComparisonType] = useState(null);
  const [comparisonSceneId, setComparisonSceneId] = useState(null);
  const [comparisonSceneName, setComparisonSceneName] = useState(null);
  const [selectedComparisonIds, setSelectedComparisonIds] = useState(() => new Set());
  const [comparisonDetails, setComparisonDetails] = useState(() => new Map());
  const [modalContent, setModalContent] = useState(null);
  const [sceneChooserOpen, setSceneChooserOpen] = useState(false);
  const [scenes, setScenes] = useState([]);
  const [activeScene, setActiveScene] = useState(null);
  const [isSceneListLoading, setIsSceneListLoading] = useState(true);
  const [isSceneLoading, setIsSceneLoading] = useState(false);
  const [sceneNotice, setSceneNoticeState] = useState(null);
  const [hover, setHover] = useState(null);

  const canvasRef = useRef(null);
  const mapStageRef = useRef(null);
  const summary = useMemo(() => summarizeGrid(latestGrid), [latestGrid]);

  function authenticate(authResult) {
    const user = authResult.user;

    setCurrentUser(user);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, authResult.access_token);
  }

  function logout() {
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    setCurrentUser(null);
  }

  const handleApiProgressChange = useCallback((active, label) => {
    setApiProgressLabel(active ? label : "");
  }, []);

  const handleHistoryPreviewLoadingChange = useCallback((active) => {
    setHistoryPreviewLoadCount((current) => Math.max(0, current + (active ? 1 : -1)));
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryProgressLabel("Loading history...");
    setHistoryStatus("Loading history...");
    setHistoryError(false);

    try {
      const result = await listSimulationRuns(25);

      if (!result.database_configured) {
        setLatestHistory([]);
        setSelectedComparisonIds(new Set());
        setComparisonDetails(new Map());
        setComparisonType(null);
        setModalContent(null);
        setHistoryStatus("Database is not configured. Set DATABASE_URL to use history.");
        return;
      }

      if (result.error) {
        throw new Error(result.error);
      }

      const items = result.items || [];
      setLatestHistory(items);
      setHistoryStatus(items.length ? `${items.length} saved simulations` : "No saved simulations yet.");
      setSelectedComparisonIds((current) => (
        pruneComparisonSelection(current, items, comparisonType, comparisonSceneId)
      ));
      setComparisonDetails((current) => pruneComparisonDetails(current, items));
    } catch (error) {
      setHistoryStatus(`History failed: ${error.message}`);
      setHistoryError(true);
    } finally {
      setHistoryProgressLabel("");
    }
  }, [comparisonSceneId, comparisonType]);

  const loadScenes = useCallback(async () => {
    setIsSceneListLoading(true);

    try {
      const result = await listScenes();
      const nextScenes = (result.scenes || []).map(enrichScene);
      const nextActiveScene = enrichScene(
        result.active_scene || {
          id: result.active_scene_id || DEFAULT_ACTIVE_SCENE.id,
          name: DEFAULT_ACTIVE_SCENE.name,
        },
      );

      setScenes(nextScenes);
      setActiveScene(nextActiveScene);
      setLatestSolver(solverForScene(nextActiveScene));
      return {
        ...result,
        active_scene: nextActiveScene,
        scenes: nextScenes,
      };
    } finally {
      setIsSceneListLoading(false);
    }
  }, []);

  useEffect(() => {
    function handlePopState() {
      setRoute(normalizeRoute(window.location.pathname));
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (route === "/history") {
      loadHistory();
    }
  }, [route, loadHistory]);

  useEffect(() => {
    loadScenes().catch((error) => {
      setActiveScene(clone(DEFAULT_ACTIVE_SCENE));
      setSceneNotice(`Failed to load scenes: ${error.message}`, true);
    });
  }, [loadScenes]);

  useEffect(() => {
    if (!activeScene) {
      return;
    }

    setAntennas(antennasForScene(activeScene));
    setLatestSolver(solverForScene(activeScene));
    setLatestGrid(null);
    setCoverageImageUrl("");
    setHover(null);
    setRunStatus("Ready");
    setRunError(false);
  }, [activeScene?.id]);

  useEffect(() => {
    if (comparisonType && selectedComparisonIds.size === 0) {
      setComparisonType(null);
      setComparisonSceneId(null);
      setComparisonSceneName(null);
    }
  }, [comparisonType, selectedComparisonIds]);

  useEffect(() => {
    drawHeatmap(canvasRef.current, mapStageRef.current, latestGrid);
  }, [latestGrid, route]);

  useEffect(() => {
    function handleResize() {
      drawHeatmap(canvasRef.current, mapStageRef.current, latestGrid);
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [latestGrid]);

  useEffect(() => {
    if (!modalContent) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeModal();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [modalContent]);

  function navigate(path) {
    const nextRoute = normalizeRoute(path);
    window.history.pushState({}, "", nextRoute);
    setRoute(nextRoute);
  }

  async function runSimulation() {
    if (isRunning || isSceneLoading || isSceneListLoading || !activeScene) {
      return;
    }

    setIsRunning(true);
    setRunError(false);
    setRunStatus("Running GPU simulation...");

    try {
      const result = await runNetworkCoverage(buildNetworkCoveragePayload(antennas, activeScene));

      if (result.status !== "success") {
        throw new Error(result.error || "Simulation failed");
      }

      setLatestGrid(result.grid);
      setLatestSolver(result.solver);
      setCoverageImageUrl(result.coverage_map_image_url ? `${result.coverage_map_image_url}?t=${Date.now()}` : "");
      setRunStatus("Simulation complete");
    } catch (error) {
      setRunStatus(`Simulation failed: ${error.message}`);
      setRunError(true);
    } finally {
      setIsRunning(false);
    }
  }

  function updateAntenna(index, field, value) {
    setAntennas((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) {
        return item;
      }

      return {
        ...item,
        [field]: {
          ...item[field],
          current: value,
        },
      };
    }));
  }

  function resetAntennas() {
    setAntennas(antennasForScene(activeScene));
    setLatestGrid(null);
    setLatestSolver(solverForScene(activeScene));
    setCoverageImageUrl("");
    setHover(null);
    setRunStatus("Ready");
    setRunError(false);
  }

  function toggleComparisonSelection(item) {
    if (!isSuccessfulHistoryItem(item)) {
      return;
    }

    if (
      comparisonType
      && (
        item.simulation_type !== comparisonType
        || item.scene_id !== comparisonSceneId
      )
    ) {
      return;
    }

    setComparisonType((current) => current || item.simulation_type);
    setComparisonSceneId((current) => current || item.scene_id);
    setComparisonSceneName((current) => current || item.scene_name);
    setSelectedComparisonIds((current) => toggleSetValue(current, item.id));
    setComparisonDetails((current) => removeMapValue(current, item.id));
  }

  function cancelComparison() {
    setComparisonType(null);
    setComparisonSceneId(null);
    setComparisonSceneName(null);
    setSelectedComparisonIds(new Set());
    setComparisonDetails(new Map());
  }

  async function chooseScene() {
    if (isRunning || apiProgressLabel || historyProgressLabel || historyPreviewLoadCount > 0 || isSceneLoading || isSceneListLoading) {
      return;
    }

    try {
      const result = await loadScenes();
      const importedCount = result.imported_scene_count || 0;
      const maxScenes = result.max_imported_scenes || 3;

      if (importedCount >= maxScenes) {
        setSceneNotice(`Only ${maxScenes} imported scenes are allowed. Delete one before choosing a new scene.`, true);
        navigate("/scenes");
        return;
      }

      setSceneChooserOpen(true);
    } catch (error) {
      setSceneNotice(`Failed to check scenes: ${error.message}`, true);
      navigate("/scenes");
    }
  }

  function handleSceneActivated(scene) {
    setActiveScene(enrichScene(scene));
    setSceneChooserOpen(false);
    setSceneNotice(`${scene.name} is now active.`);
    loadScenes().catch(() => {});
  }

  function setSceneNotice(message, error = false) {
    setSceneNoticeState({ message, error });
  }

  async function showComparisonResult() {
    if (historyProgressLabel || historyPreviewLoadCount > 0) {
      return;
    }

    if (!comparisonType || selectedComparisonIds.size < 2) {
      return;
    }

    setHistoryProgressLabel("Loading comparison...");
    setHistoryStatus("Loading comparison...");
    setHistoryError(false);

    try {
      const { items, details } = await loadComparisonDetails(
        selectedComparisonIds,
        comparisonDetails,
      );

      setComparisonDetails(details);
      setModalContent(
        <HistoryModalBody title={`Comparison: ${formatSimulationType(comparisonType)}`}>
          <ComparisonResult
            items={items}
            onPreviewLoadingChange={handleHistoryPreviewLoadingChange}
            type={comparisonType}
          />
        </HistoryModalBody>,
      );
      cancelComparison();
      setSelectedHistoryId(null);
      setHistoryStatus(`Compared ${items.length} simulations.`);
    } catch (error) {
      setHistoryStatus(`Comparison failed: ${error.message}`);
      setHistoryError(true);
    } finally {
      setHistoryProgressLabel("");
    }
  }

  async function openHistoryDetail(runId) {
    if (historyProgressLabel || historyPreviewLoadCount > 0) {
      return;
    }

    setSelectedHistoryId(runId);
    setHistoryProgressLabel("Loading history detail...");
    setModalContent(<p className="history-status">Loading detail...</p>);

    try {
      const result = await getSimulationRun(runId);

      if (!result.database_configured) {
        setModalContent(<p className="history-status">Database is not configured.</p>);
        return;
      }

      if (result.error) {
        throw new Error(result.error);
      }

      if (!result.item) {
        setModalContent(<p className="history-status">Simulation not found.</p>);
        return;
      }

      setModalContent(
        <HistoryDetail
          item={result.item}
          onPreviewLoadingChange={handleHistoryPreviewLoadingChange}
        />,
      );
    } catch (error) {
      setModalContent(<p className="history-status error-text">Detail failed: {error.message}</p>);
    } finally {
      setHistoryProgressLabel("");
    }
  }

  async function deleteHistoryItem(item) {
    if (historyProgressLabel || historyPreviewLoadCount > 0) {
      return;
    }

    const confirmed = window.confirm(
      `Delete ${formatSimulationType(item.simulation_type)} history from ${formatDateTime(item.created_at)}?`,
    );

    if (!confirmed) {
      return;
    }

    setHistoryProgressLabel("Deleting history...");
    setHistoryStatus("Deleting history...");
    setHistoryError(false);

    try {
      await deleteSimulationRun(item.id);

      if (selectedHistoryId === item.id) {
        closeModal();
      }

      setSelectedComparisonIds((current) => removeSetValue(current, item.id));
      setComparisonDetails((current) => removeMapValue(current, item.id));

      await loadHistory();
    } catch (error) {
      setHistoryStatus(`Delete failed: ${error.message}`);
      setHistoryError(true);
    } finally {
      setHistoryProgressLabel("");
    }
  }

  function closeModal() {
    setModalContent(null);
    setSelectedHistoryId(null);
    setHistoryPreviewLoadCount(0);
  }

  function handleHover(event) {
    if (!latestGrid) {
      setHover(null);
      return;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const col = Math.floor((x / rect.width) * latestGrid.cols);
    const row = latestGrid.rows - 1 - Math.floor((y / rect.height) * latestGrid.rows);
    const cell = latestGrid.cells.find((item) => item.row === row && item.col === col);

    if (!cell) {
      setHover(null);
      return;
    }

    setHover({
      cell,
      left: Math.min(x + 14, rect.width - 252),
      top: Math.max(y - 80, 10),
    });
  }

  const modalProgressLabel = modalContent
    ? historyProgressLabel
      || (historyPreviewLoadCount > 0 ? "Loading history preview..." : "")
    : "";

  const busyLabel = isRunning
    ? "Running simulation..."
    : apiProgressLabel
      || (!modalContent ? historyProgressLabel : "")
      || (!modalContent && historyPreviewLoadCount > 0 ? "Loading history preview..." : "")
      || (isSceneLoading ? "Loading scene..." : "")
      || (isSceneListLoading ? "Loading scenes..." : "");

  if (!currentUser) {
    return <LoginPage onAuthenticated={authenticate} />;
  }

  return (
    <div className="app-frame">
      <Navbar
        activeScene={activeScene}
        currentUser={currentUser}
        isBusy={Boolean(busyLabel)}
        onChooseScene={chooseScene}
        onLogout={logout}
        route={route}
        onNavigate={navigate}
      />
      <GlobalProgress active={Boolean(busyLabel)} label={busyLabel} />
      {route === "/network" && (
        <NetworkCoveragePage
          activeScene={activeScene}
          antennas={antennas}
          canvasRef={canvasRef}
          coverageImageUrl={coverageImageUrl}
          hover={hover}
          isSceneLoading={isSceneLoading || isSceneListLoading || !activeScene}
          isRunning={isRunning}
          latestGrid={latestGrid}
          latestSolver={latestSolver}
          mapStageRef={mapStageRef}
          onHover={handleHover}
          onHoverEnd={() => setHover(null)}
          onResetAntennas={resetAntennas}
          onRun={runSimulation}
          onSceneLoadingChange={setIsSceneLoading}
          onUpdateAntenna={updateAntenna}
          runError={runError}
          runStatus={runStatus}
          summary={summary}
        />
      )}
      {route === "/coverage" && (
        <CoverageApiPage
          activeScene={activeScene}
          onProgressChange={handleApiProgressChange}
          onSceneLoadingChange={setIsSceneLoading}
        />
      )}
      {route === "/rsrp" && (
        <RsrpSimulationPage
          activeScene={activeScene}
          antennas={antennas}
          onProgressChange={handleApiProgressChange}
          onSceneLoadingChange={setIsSceneLoading}
        />
      )}
      {route === "/sinr" && (
        <SinrApiPage
          activeScene={activeScene}
          onProgressChange={handleApiProgressChange}
          onSceneLoadingChange={setIsSceneLoading}
        />
      )}
      {route === "/throughput" && (
        <ThroughputApiPage
          activeScene={activeScene}
          onProgressChange={handleApiProgressChange}
          onSceneLoadingChange={setIsSceneLoading}
        />
      )}
      {route === "/history" && (
        <HistoryRoutePage
          comparisonType={comparisonType}
          historyError={historyError}
          historyStatus={historyStatus}
          isLoading={Boolean(historyProgressLabel) || historyPreviewLoadCount > 0}
          items={latestHistory}
          onCancelComparison={cancelComparison}
          onDelete={deleteHistoryItem}
          onOpen={openHistoryDetail}
          onRefresh={loadHistory}
          onShowComparison={showComparisonResult}
          onToggleCompare={toggleComparisonSelection}
          selectedComparisonIds={selectedComparisonIds}
          selectedHistoryId={selectedHistoryId}
          comparisonSceneId={comparisonSceneId}
          comparisonSceneName={comparisonSceneName}
        />
      )}
      {route === "/scenes" && (
        <ScenesPage
          activeSceneId={activeScene?.id}
          isLoading={isSceneListLoading || isSceneLoading}
          notice={sceneNotice}
          onRefresh={loadScenes}
          onSceneActivated={handleSceneActivated}
          onSetNotice={setSceneNotice}
          scenes={scenes}
        />
      )}

      {modalContent && (
        <HistoryModal
          onClose={closeModal}
          progressLabel={modalProgressLabel}
        >
          {modalContent}
        </HistoryModal>
      )}
      {sceneChooserOpen && (
        <HistoryModal onClose={() => setSceneChooserOpen(false)}>
          <SceneChooserModal
            onClose={() => setSceneChooserOpen(false)}
            onLimitReached={(message) => {
              setSceneChooserOpen(false);
              setSceneNotice(message, true);
              navigate("/scenes");
            }}
            onSceneActivated={handleSceneActivated}
          />
        </HistoryModal>
      )}
    </div>
  );
}

function Navbar({
  activeScene,
  currentUser,
  isBusy,
  onChooseScene,
  onLogout,
  onNavigate,
  route,
}) {
  return (
    <header className="app-navbar">
      <div>
        <strong>Sionna Planner</strong>
        <span>Scene: {activeScene?.name || "Loading..."}</span>
      </div>
      <nav aria-label="Primary navigation">
        {ROUTES.map((item) => (
          <button
            key={item.path}
            className={route === item.path ? "active" : ""}
            type="button"
            disabled={isBusy}
            onClick={() => onNavigate(item.path)}
          >
            {item.label}
          </button>
        ))}
        <button className="scene-picker-button" type="button" disabled={isBusy} onClick={onChooseScene}>
          Choose scene
        </button>
        <button className="logout-button" type="button" onClick={onLogout}>
          {currentUser?.username || "Logout"} | Logout
        </button>
      </nav>
    </header>
  );
}

function readStoredUser() {
  try {
    if (!localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)) {
      return null;
    }

    return JSON.parse(localStorage.getItem(USER_STORAGE_KEY));
  } catch {
    return null;
  }
}

function GlobalProgress({ active, label }) {
  return (
    <div
      className={`global-progress ${active ? "active" : ""}`}
      aria-hidden={!active}
      role="status"
    >
      <span>{label}</span>
      <div>
        <i />
      </div>
    </div>
  );
}

function NetworkCoveragePage({
  activeScene,
  antennas,
  canvasRef,
  coverageImageUrl,
  hover,
  isSceneLoading,
  isRunning,
  latestGrid,
  latestSolver,
  mapStageRef,
  onHover,
  onHoverEnd,
  onResetAntennas,
  onRun,
  onSceneLoadingChange,
  onUpdateAntenna,
  runError,
  runStatus,
  summary,
}) {
  return (
    <main className="app-shell">
      <MapPanel
        activeScene={activeScene}
        antennas={antennas}
        coverageImageUrl={coverageImageUrl}
        canvasRef={canvasRef}
        hover={hover}
        isBusy={isRunning || isSceneLoading}
        isRunning={isRunning}
        latestSolver={latestSolver}
        latestGrid={latestGrid}
        mapStageRef={mapStageRef}
        onHover={onHover}
        onHoverEnd={onHoverEnd}
        onRun={onRun}
        onSceneLoadingChange={onSceneLoadingChange}
        runError={runError}
        runStatus={runStatus}
        summary={summary}
      />
      <aside className="control-panel" aria-label="Antenna controls">
        <div className="panel-header">
          <h2>Antenna sectors</h2>
          <div className="panel-actions">
            <button className="ghost-button" type="button" disabled={isRunning || isSceneLoading} onClick={onResetAntennas}>
              Reset
            </button>
          </div>
        </div>
        <AntennaPanel
          antennas={antennas}
          disabled={isRunning || isSceneLoading}
          onChange={onUpdateAntenna}
        />
      </aside>
    </main>
  );
}

function HistoryRoutePage({
  comparisonSceneId,
  comparisonSceneName,
  comparisonType,
  historyError,
  historyStatus,
  isLoading,
  items,
  onCancelComparison,
  onDelete,
  onOpen,
  onRefresh,
  onShowComparison,
  onToggleCompare,
  selectedComparisonIds,
  selectedHistoryId,
}) {
  return (
    <main className="route-page">
      <div className="page-title with-action">
        <div>
          <h1>Simulation History</h1>
          <p>Review saved simulation runs, compare matching successful runs, or delete old records.</p>
        </div>
        <button className="ghost-button" type="button" disabled={isLoading} onClick={onRefresh}>
          Refresh
        </button>
      </div>
      <section className="history-page-panel">
        <HistoryPanel
          comparisonSceneId={comparisonSceneId}
          comparisonSceneName={comparisonSceneName}
          comparisonType={comparisonType}
          historyError={historyError}
          historyStatus={historyStatus}
          isLoading={isLoading}
          items={items}
          onCancelComparison={onCancelComparison}
          onDelete={onDelete}
          onOpen={onOpen}
          onShowComparison={onShowComparison}
          onToggleCompare={onToggleCompare}
          selectedComparisonIds={selectedComparisonIds}
          selectedHistoryId={selectedHistoryId}
        />
      </section>
    </main>
  );
}

function buildNetworkCoveragePayload(antennas, activeScene) {
  return {
    antennas,
    transmitter_pattern: TRANSMITTER_PATTERN,
    solver: solverForScene(activeScene),
    camera: {
      position: [0, 0, 650],
      look_at: [0, 0, 0],
    },
    bandwidth_mhz: 100,
    mimo_layers: 4,
  };
}

function antennasForScene(scene) {
  const size = sceneSizeMeters(scene);

  if (!size) {
    return clone(DEFAULT_ANTENNAS);
  }

  const { width, height } = size;
  const scaleX = width / DEFAULT_SOLVER.size[0];
  const scaleY = height / DEFAULT_SOLVER.size[1];
  const xLimit = width / 2;
  const yLimit = height / 2;

  return DEFAULT_ANTENNAS.map((antenna) => {
    const [x, y, z] = antenna.position;

    return {
      ...clone(antenna),
      position: [
        roundPosition(clamp(x * scaleX, -xLimit, xLimit)),
        roundPosition(clamp(y * scaleY, -yLimit, yLimit)),
        z,
      ],
    };
  });
}

function roundPosition(value) {
  return Number(value.toFixed(2));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

async function loadComparisonDetails(selectedIds, cachedDetails) {
  const items = [];
  const details = new Map(cachedDetails);

  for (const runId of selectedIds) {
    let item = details.get(runId);

    if (!item) {
      const result = await getSimulationRun(runId);

      if (!result.database_configured) {
        throw new Error("Database is not configured.");
      }

      if (result.error) {
        throw new Error(result.error);
      }

      if (!result.item) {
        throw new Error("Simulation not found.");
      }

      item = result.item;
      details.set(runId, item);
    }

    items.push(item);
  }

  return {
    items,
    details,
  };
}

function normalizeRoute(pathname) {
  if (pathname === "/") {
    return "/network";
  }

  return ROUTES.some((item) => item.path === pathname)
    ? pathname
    : "/network";
}

function enrichScene(scene) {
  if (!scene) {
    return clone(DEFAULT_ACTIVE_SCENE);
  }

  if (scene.id === DEFAULT_ACTIVE_SCENE.id && !scene.bounds) {
    return {
      ...DEFAULT_ACTIVE_SCENE,
      ...scene,
      bounds: DEFAULT_ACTIVE_SCENE.bounds,
    };
  }

  return scene;
}

function toggleSetValue(current, value) {
  const next = new Set(current);

  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }

  return next;
}

function removeSetValue(current, value) {
  const next = new Set(current);
  next.delete(value);
  return next;
}

function removeMapValue(current, key) {
  if (!current.has(key)) {
    return current;
  }

  const next = new Map(current);
  next.delete(key);
  return next;
}
