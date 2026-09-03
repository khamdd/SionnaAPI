import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listScenes,
  deleteSimulationRun,
  getSimulationRun,
  listSimulationRuns,
  runNetworkCoverage,
  getCurrentUser,
} from "./api";
import {
  DEFAULT_SOLVER,
  ROUTES,
  TRANSMITTER_PATTERN,
  AUTH_TOKEN_STORAGE_KEY,
  SCENE_FIXED_ANTENNAS_STORAGE_KEY,
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
import SceneChooserPage from "./components/SceneChooserModal";
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
  solverForScene,
} from "./utils/scene";

function clone(value) {
  return structuredClone(value);
}

const SCENE_SELECTION_ROUTE = "/scenes";
const SCENE_CREATION_ROUTE = "/choose-scene";
const SIMULATION_ENTRY_ROUTE = "/network";
const HISTORY_PAGE_LIMIT = 200;

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [route, setRoute] = useState(() => normalizeRoute(window.location.pathname));
  const [antennas, setAntennas] = useState([]);
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
  const [selectedHistoryDeleteIds, setSelectedHistoryDeleteIds] = useState(() => new Set());
  const [comparisonType, setComparisonType] = useState(null);
  const [comparisonSceneId, setComparisonSceneId] = useState(null);
  const [comparisonSceneName, setComparisonSceneName] = useState(null);
  const [selectedComparisonIds, setSelectedComparisonIds] = useState(() => new Set());
  const [comparisonDetails, setComparisonDetails] = useState(() => new Map());
  const [modalContent, setModalContent] = useState(null);
  const [scenes, setScenes] = useState([]);
  const [activeScene, setActiveScene] = useState(null);
  const [isSceneListLoading, setIsSceneListLoading] = useState(true);
  const [isSceneLoading, setIsSceneLoading] = useState(false);
  const [sceneNotice, setSceneNoticeState] = useState(null);
  const [hover, setHover] = useState(null);
  const [authStatus, setAuthStatus] = useState("checking");
  const [sceneAntennaOverrides, setSceneAntennaOverrides] = useState(() => new Map());
  const [hasWorkScene, setHasWorkScene] = useState(false);

  const canvasRef = useRef(null);
  const mapStageRef = useRef(null);
  const summary = useMemo(() => summarizeGrid(latestGrid), [latestGrid]);

  function authenticate(authResult) {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, authResult.access_token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(authResult.user));
    setCurrentUser(authResult.user);
    setAuthStatus("authenticated");
    navigate(SCENE_SELECTION_ROUTE);
  }

  useEffect(() => {
    const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);

    if(!token) {
      setAuthStatus("unauthenticated");
      return;
    }

    getCurrentUser()
    .then((result) => {
      setCurrentUser(result.user);
      setAuthStatus("authenticated");
    })
    .catch(() => {
      localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
      localStorage.removeItem(USER_STORAGE_KEY);
      setCurrentUser(null);
      setAuthStatus("unauthenticated");
    });
  }, []);

  function logout() {
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    setCurrentUser(null);
    setAuthStatus("unauthenticated");
    setHasWorkScene(false);
  }

  const handleApiProgressChange = useCallback((active, label) => {
    setApiProgressLabel(active ? label : "");
  }, []);

  const handleHistoryPreviewLoadingChange = useCallback((active) => {
    setHistoryPreviewLoadCount((current) => Math.max(0, current + (active ? 1 : -1)));
  }, []);

  const loadHistory = useCallback(async () => {
    const sceneId = activeScene?.id;
    const sceneName = activeScene?.name || "selected scene";

    if (!sceneId) {
      setLatestHistory([]);
      setSelectedHistoryId(null);
      setSelectedHistoryDeleteIds(new Set());
      setSelectedComparisonIds(new Set());
      setComparisonDetails(new Map());
      setComparisonType(null);
      setComparisonSceneId(null);
      setComparisonSceneName(null);
      setModalContent(null);
      setHistoryStatus("Select a work scene to view history.");
      setHistoryError(true);
      return;
    }

    setHistoryProgressLabel("Loading history...");
    setHistoryStatus(`Loading history for ${sceneName}...`);
    setHistoryError(false);

    try {
      const result = await listSimulationRuns(HISTORY_PAGE_LIMIT, sceneId);

      if (!result.database_configured) {
        setLatestHistory([]);
        setSelectedHistoryDeleteIds(new Set());
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

      const items = (result.items || []).filter((item) => item.scene_id === sceneId);
      setLatestHistory(items);
      setSelectedHistoryDeleteIds((current) => new Set(
        [...current].filter((id) => items.some((item) => item.id === id)),
      ));
      setHistoryStatus(items.length ? `${items.length} saved simulations for ${sceneName}` : `No saved simulations for ${sceneName}.`);
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
  }, [activeScene?.id, activeScene?.name, comparisonSceneId, comparisonType]);

  const loadScenes = useCallback(async (options = {}) => {
    const syncActiveScene = options.syncActiveScene ?? hasWorkScene;
    setIsSceneListLoading(true);

    try {
      const result = await listScenes();
      const nextScenes = (result.scenes || []).map(enrichScene);
      const nextActiveScene = result.active_scene ? enrichScene(result.active_scene) : null;

      setScenes(nextScenes);
      if (syncActiveScene) {
        setActiveScene(nextActiveScene);
        setLatestSolver(nextActiveScene ? solverForScene(nextActiveScene) : clone(DEFAULT_SOLVER));
        if (!nextActiveScene) {
          setHasWorkScene(false);
        }
      }
      return {
        ...result,
        active_scene: nextActiveScene,
        scenes: nextScenes,
      };
    } finally {
      setIsSceneListLoading(false);
    }
  }, [hasWorkScene]);

  useEffect(() => {
    function handlePopState() {
      setRoute(normalizeRoute(window.location.pathname));
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if(authStatus !== "authenticated"){
      return;
    }

    if (!hasWorkScene && isWorkSceneRequiredRoute(route)) {
      setSceneNotice("Select or create a work scene before opening simulations.", true);
      navigate(SCENE_SELECTION_ROUTE, { replace: true });
      return;
    }

    if (route === "/history") {
      loadHistory();
    }
  }, [authStatus, hasWorkScene, route, loadHistory]);

  useEffect(() => {
    if(authStatus !== "authenticated") {
      return;
    }

    loadScenes().catch((error) => {
      setSceneNotice(`Failed to load scenes: ${error.message}`, true);
    });
  }, [authStatus, hasWorkScene, loadScenes]);

  useEffect(() => {
    if (!activeScene) {
      return;
    }

    setAntennas(antennasForActiveScene(activeScene, sceneAntennaOverrides));
    setLatestSolver(solverForScene(activeScene));
    setLatestGrid(null);
    setCoverageImageUrl("");
    setHover(null);
    setRunStatus("Ready");
    setRunError(false);
  }, [activeScene?.id, sceneAntennaOverrides]);

  useEffect(() => {
    setLatestHistory([]);
    setSelectedHistoryId(null);
    setSelectedHistoryDeleteIds(new Set());
    setSelectedComparisonIds(new Set());
    setComparisonDetails(new Map());
    setComparisonType(null);
    setComparisonSceneId(null);
    setComparisonSceneName(null);
    setModalContent(null);
    setHistoryStatus(activeScene ? `History is scoped to ${activeScene.name}.` : "Select a work scene to view history.");
    setHistoryError(!activeScene);
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

  function navigate(path, options = {}) {
    if (!options.allowWithoutWorkScene && !hasWorkScene && isWorkSceneRequiredRoute(path)) {
      setSceneNotice("Select or create a work scene before opening simulations.", true);
      path = SCENE_SELECTION_ROUTE;
    }

    const nextRoute = normalizeRoute(path);
    if (options.replace) {
      window.history.replaceState({}, "", nextRoute);
    } else {
      window.history.pushState({}, "", nextRoute);
    }
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
    setAntennas(antennasForActiveScene(activeScene, sceneAntennaOverrides));
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
        navigate(SCENE_SELECTION_ROUTE);
        return;
      }

      navigate(SCENE_CREATION_ROUTE);
    } catch (error) {
      setSceneNotice(`Failed to check scenes: ${error.message}`, true);
      navigate(SCENE_SELECTION_ROUTE);
    }
  }

  function changeWorkScene() {
    const confirmed = window.confirm("Change scene? The current work scene will be cleared and simulations will be unavailable until you select another scene.");

    if (!confirmed) {
      return;
    }

    setHasWorkScene(false);
    setActiveScene(null);
    setAntennas([]);
    setLatestSolver(clone(DEFAULT_SOLVER));
    setLatestGrid(null);
    setCoverageImageUrl("");
    setHover(null);
    setRunStatus("Ready");
    setRunError(false);
    cancelComparison();
    setSceneNotice("No work scene is active. Select or create a scene to continue.");
    navigate(SCENE_SELECTION_ROUTE, { allowWithoutWorkScene: true });
  }

  function handleSceneActivated(scene, sceneAntennas = null) {
    const fixedAntennas = Array.isArray(sceneAntennas)
      ? sceneAntennas
      : scene?.fixed_antennas;

    if (Array.isArray(fixedAntennas)) {
      saveSceneFixedAntennas(scene.id, fixedAntennas);
      setSceneAntennaOverrides((current) => {
        const next = new Map(current);
        next.set(scene.id, clone(fixedAntennas));
        return next;
      });
    }

    setActiveScene(enrichScene(scene));
    setHasWorkScene(true);
    setSceneNotice(`${scene.name} is now active.`);
    loadScenes({ syncActiveScene: true }).catch(() => {});
    navigate(SIMULATION_ENTRY_ROUTE, { allowWithoutWorkScene: true });
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
      setSelectedHistoryDeleteIds((current) => removeSetValue(current, item.id));

      await loadHistory();
    } catch (error) {
      setHistoryStatus(`Delete failed: ${error.message}`);
      setHistoryError(true);
    } finally {
      setHistoryProgressLabel("");
    }
  }

  function toggleHistoryDeleteSelection(runId) {
    setSelectedHistoryDeleteIds((current) => toggleSetValue(current, runId));
  }

  function toggleAllHistoryDeleteSelection() {
    setSelectedHistoryDeleteIds((current) => (
      current.size === latestHistory.length
        ? new Set()
        : new Set(latestHistory.map((item) => item.id))
    ));
  }

  async function deleteSelectedHistory() {
    if (
      historyProgressLabel
      || historyPreviewLoadCount > 0
      || selectedHistoryDeleteIds.size === 0
    ) {
      return;
    }

    const selectedIds = [...selectedHistoryDeleteIds];
    const confirmed = window.confirm(
      `Delete ${selectedIds.length} selected simulation histories?`,
    );

    if (!confirmed) {
      return;
    }

    setHistoryProgressLabel("Deleting selected history...");
    setHistoryStatus(`Deleting ${selectedIds.length} selected histories...`);
    setHistoryError(false);

    try {
      const results = await Promise.allSettled(
        selectedIds.map((runId) => deleteSimulationRun(runId)),
      );
      const deletedIds = new Set(
        selectedIds.filter((id, index) => results[index].status === "fulfilled"),
      );
      const failedIds = selectedIds.filter((id) => !deletedIds.has(id));

      if (selectedHistoryId && deletedIds.has(selectedHistoryId)) {
        closeModal();
      }

      setSelectedComparisonIds((current) => new Set(
        [...current].filter((id) => !deletedIds.has(id)),
      ));
      setComparisonDetails((current) => new Map(
        [...current].filter(([id]) => !deletedIds.has(id)),
      ));
      setSelectedHistoryDeleteIds(new Set(failedIds));

      await loadHistory();

      if (failedIds.length > 0) {
        setHistoryStatus(`Deleted ${deletedIds.size}; ${failedIds.length} failed.`);
        setHistoryError(true);
      } else {
        setHistoryStatus(`Deleted ${deletedIds.size} selected histories.`);
      }
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
  const visibleRoute = !hasWorkScene && isWorkSceneRequiredRoute(route)
    ? SCENE_SELECTION_ROUTE
    : route;

  if (authStatus === "checking") {
    return <p>Checking session...</p>
  }

  if (!currentUser || authStatus === "unauthenticated") {
    return <LoginPage onAuthenticated={authenticate} />;
  }

  return (
    <div className="app-frame">
      <Navbar
        activeScene={activeScene}
        currentUser={currentUser}
        hasWorkScene={hasWorkScene}
        isBusy={Boolean(busyLabel)}
        onChangeScene={changeWorkScene}
        onLogout={logout}
        route={visibleRoute}
        onNavigate={navigate}
      />
      <GlobalProgress active={Boolean(busyLabel)} label={busyLabel} />
      {visibleRoute === "/network" && (
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
      {visibleRoute === "/coverage" && (
        <CoverageApiPage
          activeScene={activeScene}
          onProgressChange={handleApiProgressChange}
          onSceneLoadingChange={setIsSceneLoading}
        />
      )}
      {visibleRoute === "/rsrp" && (
        <RsrpSimulationPage
          activeScene={activeScene}
          antennas={antennas}
          onProgressChange={handleApiProgressChange}
          onSceneLoadingChange={setIsSceneLoading}
        />
      )}
      {visibleRoute === "/sinr" && (
        <SinrApiPage
          activeScene={activeScene}
          onProgressChange={handleApiProgressChange}
          onSceneLoadingChange={setIsSceneLoading}
        />
      )}
      {visibleRoute === "/throughput" && (
        <ThroughputApiPage
          activeScene={activeScene}
          onProgressChange={handleApiProgressChange}
          onSceneLoadingChange={setIsSceneLoading}
        />
      )}
      {visibleRoute === "/history" && (
        <HistoryRoutePage
          activeScene={activeScene}
          comparisonType={comparisonType}
          historyError={historyError}
          historyStatus={historyStatus}
          isLoading={Boolean(historyProgressLabel) || historyPreviewLoadCount > 0}
          items={latestHistory}
          onCancelComparison={cancelComparison}
          onDelete={deleteHistoryItem}
          onDeleteSelected={deleteSelectedHistory}
          onOpen={openHistoryDetail}
          onRefresh={loadHistory}
          onShowComparison={showComparisonResult}
          onToggleCompare={toggleComparisonSelection}
          onToggleDeleteSelection={toggleHistoryDeleteSelection}
          onToggleSelectAll={toggleAllHistoryDeleteSelection}
          selectedComparisonIds={selectedComparisonIds}
          selectedDeleteIds={selectedHistoryDeleteIds}
          selectedHistoryId={selectedHistoryId}
          comparisonSceneId={comparisonSceneId}
          comparisonSceneName={comparisonSceneName}
        />
      )}
      {visibleRoute === "/scenes" && (
        <ScenesPage
          activeSceneId={hasWorkScene ? activeScene?.id : null}
          isLoading={isSceneListLoading || isSceneLoading}
          notice={sceneNotice}
          onCreateScene={chooseScene}
          onRefresh={loadScenes}
          onSceneActivated={handleSceneActivated}
          onSetNotice={setSceneNotice}
          scenes={scenes}
        />
      )}
      {visibleRoute === SCENE_CREATION_ROUTE && (
        <SceneChooserPage
          onCancel={() => navigate(SCENE_SELECTION_ROUTE)}
          onLimitReached={(message) => {
            setSceneNotice(message, true);
            navigate(SCENE_SELECTION_ROUTE);
          }}
          onSceneActivated={handleSceneActivated}
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
    </div>
  );
}

function Navbar({
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

  return (
    <header className="app-navbar">
      <div>
        <strong>Sionna Planner</strong>
      </div>
      <nav aria-label="Primary navigation">
        {visibleRoutes.map((item) => {
          return (
            <button
              key={item.path}
              className={route === item.path ? "active" : ""}
              type="button"
              disabled={isBusy}
              onClick={() => onNavigate(item.path)}
            >
              {item.label}
            </button>
          );
        })}
        <div className="user-menu">
          <button className="user-menu-trigger" type="button">
            {currentUser?.username || "User"}
          </button>
          <div className="user-menu-panel">
            <button
              type="button"
              disabled={isBusy}
              onClick={onChangeScene}
            >
              Change scene
            </button>
            <button type="button" onClick={onLogout}>
              Logout
            </button>
          </div>
        </div>
      </nav>
    </header>
  );
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
  activeScene,
  comparisonSceneId,
  comparisonSceneName,
  comparisonType,
  historyError,
  historyStatus,
  isLoading,
  items,
  onCancelComparison,
  onDelete,
  onDeleteSelected,
  onOpen,
  onRefresh,
  onShowComparison,
  onToggleCompare,
  onToggleDeleteSelection,
  onToggleSelectAll,
  selectedComparisonIds,
  selectedDeleteIds,
  selectedHistoryId,
}) {
  return (
    <main className="route-page">
      <div className="page-title with-action">
        <div>
          <h1>Simulation History</h1>
          <p>Showing saved simulation runs for {activeScene?.name || "the selected scene"} only.</p>
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
          onDeleteSelected={onDeleteSelected}
          onOpen={onOpen}
          onShowComparison={onShowComparison}
          onToggleCompare={onToggleCompare}
          onToggleDeleteSelection={onToggleDeleteSelection}
          onToggleSelectAll={onToggleSelectAll}
          selectedComparisonIds={selectedComparisonIds}
          selectedDeleteIds={selectedDeleteIds}
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

function antennasForActiveScene(scene, sceneAntennaOverrides) {
  const override = sceneAntennaOverrides.get(scene?.id);

  if (Array.isArray(override) && override.length > 0) {
    return clone(override);
  }

  if (Array.isArray(scene?.fixed_antennas) && scene.fixed_antennas.length > 0) {
    return clone(scene.fixed_antennas);
  }

  return [];
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
    return SCENE_SELECTION_ROUTE;
  }

  return ROUTES.some((item) => item.path === pathname) || pathname === SCENE_CREATION_ROUTE
    ? pathname
    : SCENE_SELECTION_ROUTE;
}

function isWorkSceneRequiredRoute(pathname) {
  return pathname !== SCENE_SELECTION_ROUTE && pathname !== SCENE_CREATION_ROUTE;
}

function enrichScene(scene) {
  const cachedFixedAntennas = readSceneFixedAntennas(scene?.id);

  if (cachedFixedAntennas) {
    return {
      ...scene,
      fixed_antennas: cachedFixedAntennas,
    };
  }

  return scene;
}

function readSceneFixedAntennas(sceneId) {
  if (!sceneId) {
    return null;
  }

  try {
    const saved = JSON.parse(localStorage.getItem(SCENE_FIXED_ANTENNAS_STORAGE_KEY) || "{}");
    const antennas = normalizeStoredFixedAntennas(saved[sceneId]);

    if (!antennas) {
      delete saved[sceneId];
      localStorage.setItem(SCENE_FIXED_ANTENNAS_STORAGE_KEY, JSON.stringify(saved));
    }

    return antennas;
  } catch {
    return null;
  }
}

function saveSceneFixedAntennas(sceneId, antennas) {
  if (!sceneId || !Array.isArray(antennas)) {
    return;
  }

  try {
    const saved = JSON.parse(localStorage.getItem(SCENE_FIXED_ANTENNAS_STORAGE_KEY) || "{}");
    const normalized = normalizeStoredFixedAntennas(antennas);

    if (!normalized) {
      return;
    }

    saved[sceneId] = normalized;
    localStorage.setItem(SCENE_FIXED_ANTENNAS_STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Local cache is best-effort; backend scene metadata is the primary store.
  }
}

function normalizeStoredFixedAntennas(antennas) {
  if (!Array.isArray(antennas) || antennas.length === 0) {
    return null;
  }

  const normalized = antennas
    .map((antenna) => {
      const longitude = Number(antenna?.longitude);
      const latitude = Number(antenna?.latitude);
      const height = Number(antenna?.height_m);

      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        return null;
      }

      const { position, ...rest } = antenna;

      return {
        ...rest,
        longitude,
        latitude,
        height_m: Number.isFinite(height) ? height : 0,
      };
    })
    .filter(Boolean);

  return normalized.length ? normalized : null;
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
