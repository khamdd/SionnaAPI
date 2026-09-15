import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteSimulationJob,
  listScenes,
  deleteSimulationRun,
  getSimulationJob,
  getSimulationJobResult,
  getSimulationRun,
  listSimulationRuns,
  listSimulationJobs,
  runNetworkCoverage,
  getCurrentUser,
  saveSimulationJobResult,
  listAntennas,
  createAntenna,
} from "./api";
import {
  DEFAULT_SOLVER,
  AUTH_TOKEN_STORAGE_KEY,
  NETWORK_ANTENNA_SETTINGS_STORAGE_KEY,
  NETWORK_OPTIMIZATION_OBJECTIVES_STORAGE_KEY,
  NETWORK_TYPE2_ANTENNAS_STORAGE_KEY,
  RSRP_ANTENNA_SETTINGS_STORAGE_KEY,
  RSRP_TYPE2_ANTENNAS_STORAGE_KEY,
  SINR_ANTENNA_SETTINGS_STORAGE_KEY,
  SINR_ROLE_SELECTION_STORAGE_KEY,
  SINR_TYPE2_ANTENNAS_STORAGE_KEY,
  THROUGHPUT_ANTENNA_SETTINGS_STORAGE_KEY,
  THROUGHPUT_ROLE_SELECTION_STORAGE_KEY,
  THROUGHPUT_TYPE2_ANTENNAS_STORAGE_KEY,
  USER_STORAGE_KEY,
} from "./constants";
import {
  MAX_NETWORK_COVERAGE_ANTENNAS,
  validateNetworkCoverageSimulationAntennas,
} from "./utils/antennas";
import {
  clone,
  removeMapValue,
  removeSetValue,
  toggleSetValue,
} from "./utils/collections";
import {
  buildNetworkCoveragePayload,
} from "./utils/jobAdapters";
import {
  NETWORK_OPTIMIZATION_ROUTE,
  SCENE_CREATION_ROUTE,
  SCENE_SELECTION_ROUTE,
  SIMULATION_ENTRY_ROUTE,
  isWorkSceneRequiredRoute,
  normalizeRoute,
} from "./utils/routes";
import useSceneAntennaDraft from "./hooks/useSceneAntennaDraft";
import {
  CoverageApiPage,
  RsrpSimulationPage,
  SinrApiPage,
  ThroughputApiPage,
} from "./components/ApiPages";
import ComparisonResult from "./components/ComparisonResult";
import GlobalProgress from "./components/GlobalProgress";
import HistoryDetail from "./components/HistoryDetail";
import HistoryModal, { HistoryModalBody } from "./components/HistoryModal";
import HistoryRoutePage from "./components/HistoryRoutePage";
import JobResultDetail from "./components/JobResultDetail";
import LoginPage from "./components/LoginPage";
import Navbar from "./components/Navbar";
import OptimizationObjectivePage from "./components/OptimizationObjectivePage";
import NetworkCoveragePage from "./components/NetworkCoveragePage";
import QueueRoutePage from "./components/QueueRoutePage";
import NetworkConfigurationsPage from "./components/NetworkConfigurationsPage";
import QueueSubmissionPrompt from "./components/QueueSubmissionPrompt";
import SimulationProfilesPage from "./components/SimulationProfilesPage";
import SceneChooserPage from "./components/SceneChooserModal";
import ScenesPage from "./components/ScenesPage";
import AntennasPage from "./components/AntennasPage";
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
import { lngLatInsideBounds, solverForScene } from "./utils/scene";

const HISTORY_PAGE_LIMIT = 200;
const JOB_PAGE_LIMIT = 200;
const MAX_RSRP_SIMULATION_ANTENNAS = 10;

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [route, setRoute] = useState(() => normalizeRoute(window.location.pathname));
  const [latestGrid, setLatestGrid] = useState(null);
  const [latestSolver, setLatestSolver] = useState(() => clone(DEFAULT_SOLVER));
  const [networkSolverDraft, setNetworkSolverDraft] = useState(() => clone(DEFAULT_SOLVER));
  const [coverageImageUrl, setCoverageImageUrl] = useState("");
  const [runStatus, setRunStatus] = useState("Ready");
  const [runError, setRunError] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [historyStatus, setHistoryStatus] = useState("No history loaded.");
  const [historyError, setHistoryError] = useState(false);
  const [jobStatus, setJobStatus] = useState("No queue loaded.");
  const [jobError, setJobError] = useState(false);
  const [jobProgressLabel, setJobProgressLabel] = useState("");
  const [simulationJobs, setSimulationJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [selectedJobDeleteIds, setSelectedJobDeleteIds] = useState(() => new Set());
  const [queuedPrompt, setQueuedPrompt] = useState(null);
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
  const [antennaInventory, setAntennaInventory] = useState([]);
  const [hasWorkScene, setHasWorkScene] = useState(false);

  const canvasRef = useRef(null);
  const mapStageRef = useRef(null);
  const summary = useMemo(() => summarizeGrid(latestGrid), [latestGrid]);
  const fixedSceneAntennas = useMemo(
    () => antennaInventory.filter((antenna) => (
      antenna.status === "active" && lngLatInsideBounds(antenna, activeScene?.bounds)
    )),
    [activeScene?.bounds, antennaInventory],
  );
  const networkDraft = useSceneAntennaDraft({
    activeScene,
    fixedAntennas: fixedSceneAntennas,
    maxActiveAntennas: MAX_NETWORK_COVERAGE_ANTENNAS,
    settingsStorageKey: NETWORK_ANTENNA_SETTINGS_STORAGE_KEY,
    simulationLabel: "Network Coverage",
    supportsEnabled: true,
    type2StorageKey: NETWORK_TYPE2_ANTENNAS_STORAGE_KEY,
  });
  const rsrpDraft = useSceneAntennaDraft({
    activeScene,
    fixedAntennas: fixedSceneAntennas,
    maxActiveAntennas: MAX_RSRP_SIMULATION_ANTENNAS,
    settingsStorageKey: RSRP_ANTENNA_SETTINGS_STORAGE_KEY,
    simulationLabel: "RSRP Simulation",
    supportsEnabled: true,
    type2StorageKey: RSRP_TYPE2_ANTENNAS_STORAGE_KEY,
  });
  const sinrDraft = useSceneAntennaDraft({
    activeScene,
    fixedAntennas: fixedSceneAntennas,
    rolesStorageKey: SINR_ROLE_SELECTION_STORAGE_KEY,
    settingsStorageKey: SINR_ANTENNA_SETTINGS_STORAGE_KEY,
    simulationLabel: "SINR",
    type2StorageKey: SINR_TYPE2_ANTENNAS_STORAGE_KEY,
  });
  const throughputDraft = useSceneAntennaDraft({
    activeScene,
    fixedAntennas: fixedSceneAntennas,
    rolesStorageKey: THROUGHPUT_ROLE_SELECTION_STORAGE_KEY,
    settingsStorageKey: THROUGHPUT_ANTENNA_SETTINGS_STORAGE_KEY,
    simulationLabel: "Throughput",
    type2StorageKey: THROUGHPUT_TYPE2_ANTENNAS_STORAGE_KEY,
  });
  const antennas = networkDraft.antennas;
  const activeNetworkAntennas = networkDraft.activeAntennas;
  const rsrpAntennas = rsrpDraft.antennas;
  const activeRsrpAntennas = rsrpDraft.activeAntennas;
  const sinrAntennas = sinrDraft.antennas;
  const sinrRoleSelection = sinrDraft.roleSelection;
  const throughputAntennas = throughputDraft.antennas;
  const throughputRoleSelection = throughputDraft.roleSelection;

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

  useEffect(() => {
    if (!currentUser) {
      setAntennaInventory([]);
      return;
    }
    listAntennas().then((result) => {
      setAntennaInventory(result.antennas || []);
    }).catch(() => {
      setAntennaInventory([]);
    });
  }, [currentUser]);

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

  const loadJobs = useCallback(async () => {
    setJobProgressLabel("Loading queue...");
    setJobStatus("Loading simulation queue...");
    setJobError(false);

    try {
      const result = await listSimulationJobs(JOB_PAGE_LIMIT);

      if (!result.database_configured) {
        setSimulationJobs([]);
        setSelectedJobId(null);
        setSelectedJobDeleteIds(new Set());
        setJobStatus("Database is not configured. Set DATABASE_URL to use the simulation queue.");
        setJobError(true);
        return;
      }

      if (result.error) {
        throw new Error(result.error);
      }

      const items = result.items || [];
      setSimulationJobs(items);
      setSelectedJobId((current) => (
        items.some((item) => item.id === current) ? current : null
      ));
      setSelectedJobDeleteIds((current) => new Set(
        [...current].filter((id) => items.some((item) => (
          item.id === id && String(item.status || "").toLowerCase() !== "running"
        ))),
      ));
      setJobStatus(items.length ? `${items.length} simulation jobs recorded.` : "No simulation jobs recorded.");
    } catch (error) {
      setJobStatus(`Queue failed: ${error.message}`);
      setJobError(true);
    } finally {
      setJobProgressLabel("");
    }
  }, []);

  const loadScenes = useCallback(async (options = {}) => {
    const syncActiveScene = options.syncActiveScene ?? hasWorkScene;
    setIsSceneListLoading(true);

    try {
      const result = await listScenes();
      const nextScenes = result.scenes || [];
      const nextActiveScene = result.active_scene || null;

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

    if (route === "/queue") {
      loadJobs();
    }
  }, [authStatus, hasWorkScene, route, loadHistory, loadJobs]);

  useEffect(() => {
    if (authStatus !== "authenticated" || route !== "/queue") {
      return undefined;
    }

    const hasPendingJob = simulationJobs.some((job) => (
      job.status === "queued" || job.status === "running"
    ));

    if (!hasPendingJob) {
      return undefined;
    }

    const timerId = window.setInterval(() => {
      loadJobs();
    }, 5000);

    return () => window.clearInterval(timerId);
  }, [authStatus, loadJobs, route, simulationJobs]);

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

    setLatestSolver(solverForScene(activeScene));
    setLatestGrid(null);
    setCoverageImageUrl("");
    setHover(null);
    setRunStatus("Ready");
    setRunError(false);
  }, [activeScene?.id]);

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
    let frame = 0;
    function handleResize() {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        drawHeatmap(canvasRef.current, mapStageRef.current, latestGrid);
      });
    }

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [latestGrid]);

  useEffect(() => {
    if (!modalContent && !queuedPrompt) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        if (modalContent) {
          closeModal();
        } else {
          closeQueuedPrompt();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [modalContent, queuedPrompt]);

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
      const validationError = validateNetworkCoverageSimulationAntennas(
        activeNetworkAntennas,
        activeScene,
      );

      if (validationError) {
        throw new Error(validationError);
      }

      const result = await runNetworkCoverage(buildNetworkCoveragePayload(activeNetworkAntennas, activeScene, networkSolverDraft));

      if (result.status === "queued") {
        showQueuedPrompt({
          ...result,
          scene_name: activeScene?.name,
        });
        setRunStatus("Simulation recorded in the queue.");
        loadJobs().catch(() => {});
        return;
      }

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

  function updateAntenna(antennaId, field, value) {
    networkDraft.updateAntenna(antennaId, field, value);
  }

  async function createInventoryAntenna(payload) {
    const result = await createAntenna(payload);
    const antenna = result.antenna || result;
    setAntennaInventory((current) => [...current, antenna]);
    return antenna;
  }

  function addType2Antenna(antenna) {
    const result = networkDraft.addAntennas(antenna);
    if (result.ok) {
      clearLatestNetworkResult();
    }
    return result;
  }

  function removeType2Antenna(antennaId) {
    if (!activeScene?.id) {
      return;
    }

    networkDraft.removeAntenna(antennaId);
    clearLatestNetworkResult();
  }

  function updateRsrpAntenna(antennaId, field, value) {
    rsrpDraft.updateAntenna(antennaId, field, value);
  }

  function addRsrpType2Antenna(antenna) {
    return rsrpDraft.addAntennas(antenna);
  }

  function removeRsrpType2Antenna(antennaId) {
    if (!activeScene?.id) {
      return;
    }

    rsrpDraft.removeAntenna(antennaId);
  }

  function updateSinrAntenna(antennaId, field, value) {
    sinrDraft.updateAntenna(antennaId, field, value);
  }

  function addSinrType2Antenna(antenna) {
    return sinrDraft.addAntennas(antenna);
  }

  function removeSinrType2Antenna(antennaId) {
    if (!activeScene?.id) {
      return;
    }

    sinrDraft.removeAntenna(antennaId);
  }

  function updateSinrRoleSelection(nextRoles) {
    sinrDraft.updateRoleSelection(nextRoles);
  }

  function updateThroughputAntenna(antennaId, field, value) {
    throughputDraft.updateAntenna(antennaId, field, value);
  }

  function addThroughputType2Antenna(antenna) {
    return throughputDraft.addAntennas(antenna);
  }

  function removeThroughputType2Antenna(antennaId) {
    if (!activeScene?.id) {
      return;
    }

    throughputDraft.removeAntenna(antennaId);
  }

  function updateThroughputRoleSelection(nextRoles) {
    throughputDraft.updateRoleSelection(nextRoles);
  }

  function resetRsrpAntennas() {
    rsrpDraft.clear();
  }

  function resetSinrAntennas() {
    sinrDraft.clear();
  }

  function resetThroughputAntennas() {
    throughputDraft.clear();
  }

  function resetAntennas() {
    networkDraft.clear();
    clearLatestNetworkResult();
  }

  function clearLatestNetworkResult() {
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
    if (isRunning || apiProgressLabel || jobProgressLabel || historyProgressLabel || historyPreviewLoadCount > 0 || isSceneLoading || isSceneListLoading) {
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

    networkDraft.clear(activeScene?.id);
    rsrpDraft.clear(activeScene?.id);
    sinrDraft.clear(activeScene?.id);
    throughputDraft.clear(activeScene?.id);
    setHasWorkScene(false);
    setActiveScene(null);
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

  function handleSceneActivated(scene) {
    setActiveScene(scene);
    setHasWorkScene(true);
    setSceneNotice(`${scene.name} is now active.`);
    loadScenes({ syncActiveScene: true }).catch(() => {});
    navigate(SIMULATION_ENTRY_ROUTE, { allowWithoutWorkScene: true });
  }

  function setSceneNotice(message, error = false) {
    setSceneNoticeState({ message, error });
  }

  function showQueuedPrompt(job) {
    setQueuedPrompt(job);
  }

  function closeQueuedPrompt() {
    setQueuedPrompt(null);
  }

  function openQueueFromPrompt() {
    closeQueuedPrompt();
    navigate("/queue");
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
            wardBoundary={activeScene?.ward_boundary}
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
          wardBoundary={
            result.item.scene_id === activeScene?.id
              ? activeScene?.ward_boundary
              : null
          }
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

  async function openJobDetail(jobId) {
    if (jobProgressLabel || historyPreviewLoadCount > 0) {
      return;
    }

    setSelectedJobId(jobId);
    setJobProgressLabel("Loading job result...");
    setModalContent(<p className="history-status">Loading job result...</p>);

    try {
      const jobResponse = await getSimulationJob(jobId);

      if (!jobResponse.database_configured) {
        setModalContent(<p className="history-status">Database is not configured.</p>);
        return;
      }

      if (jobResponse.error) {
        throw new Error(jobResponse.error);
      }

      const job = jobResponse.item;
      if (!job) {
        setModalContent(<p className="history-status">Simulation job not found.</p>);
        return;
      }

      const fullResult = job.status === "succeeded"
        ? await getSimulationJobResult(jobId)
        : job.result;

      setModalContent(
        <HistoryModalBody title={`Queue result: ${formatSimulationType(job.simulation_type)}`}>
          <JobResultDetail
            job={job}
            result={fullResult}
            onDiscard={() => discardSimulationJob(job)}
            onOpenHistory={job.result_run_id ? () => openHistoryDetail(job.result_run_id) : null}
            onPreviewLoadingChange={handleHistoryPreviewLoadingChange}
            onSave={() => saveSimulationJob(job)}
            wardBoundary={
              job.scene_id === activeScene?.id
                ? activeScene?.ward_boundary
                : null
            }
          />
        </HistoryModalBody>,
      );
    } catch (error) {
      setModalContent(<p className="history-status error-text">Job detail failed: {error.message}</p>);
    } finally {
      setJobProgressLabel("");
    }
  }

  async function saveSimulationJob(job) {
    if (jobProgressLabel) {
      return;
    }

    setJobProgressLabel("Saving result...");
    setJobStatus("Saving result to history...");
    setJobError(false);

    try {
      const result = await saveSimulationJobResult(job.id);
      await loadJobs();

      if (route === "/history") {
        await loadHistory();
      }

      setJobStatus(result.already_saved ? "Result is already saved in Simulation History." : "Result saved in Simulation History.");
      if (result.run_id) {
        await openHistoryDetail(result.run_id);
      } else {
        closeModal();
      }
    } catch (error) {
      setJobStatus(`Save failed: ${error.message}`);
      setJobError(true);
    } finally {
      setJobProgressLabel("");
    }
  }

  async function discardSimulationJob(job) {
    if (jobProgressLabel || job.status === "running") {
      return;
    }

    const confirmed = window.confirm(
      job.result_run_id
        ? "Remove this job from the queue? The saved history result will remain."
        : "Discard this simulation result? It will not be saved to Simulation History.",
    );

    if (!confirmed) {
      return;
    }

    setJobProgressLabel("Discarding job...");
    setJobStatus("Discarding simulation job...");
    setJobError(false);

    try {
      await deleteSimulationJob(job.id);
      closeModal();
      await loadJobs();
      setJobStatus(job.result_run_id ? "Queue entry removed." : "Simulation result discarded.");
    } catch (error) {
      setJobStatus(`Discard failed: ${error.message}`);
      setJobError(true);
    } finally {
      setJobProgressLabel("");
    }
  }

  function toggleJobDeleteSelection(jobId) {
    const job = simulationJobs.find((item) => item.id === jobId);
    if (!job || String(job.status || "").toLowerCase() === "running") {
      return;
    }
    setSelectedJobDeleteIds((current) => toggleSetValue(current, jobId));
  }

  function toggleAllJobDeleteSelection() {
    const deletableIds = simulationJobs
      .filter((job) => String(job.status || "").toLowerCase() !== "running")
      .map((job) => job.id);
    setSelectedJobDeleteIds((current) => (
      deletableIds.length > 0 && deletableIds.every((id) => current.has(id))
        ? new Set()
        : new Set(deletableIds)
    ));
  }

  async function deleteSelectedJobs() {
    if (jobProgressLabel || selectedJobDeleteIds.size === 0) {
      return;
    }

    const selectedIds = [...selectedJobDeleteIds];
    const confirmed = window.confirm(
      `Delete ${selectedIds.length} selected simulation queue entries? Saved History results will remain.`,
    );

    if (!confirmed) {
      return;
    }

    setJobProgressLabel("Deleting selected queue entries...");
    setJobStatus(`Deleting ${selectedIds.length} selected queue entries...`);
    setJobError(false);

    try {
      const results = await Promise.allSettled(
        selectedIds.map((jobId) => deleteSimulationJob(jobId)),
      );
      const deletedIds = new Set(
        selectedIds.filter((id, index) => (
          results[index].status === "fulfilled" && results[index].value?.deleted
        )),
      );
      const failedIds = selectedIds.filter((id) => !deletedIds.has(id));

      if (selectedJobId && deletedIds.has(selectedJobId)) {
        closeModal();
      }

      setSelectedJobDeleteIds(new Set(failedIds));
      await loadJobs();

      if (failedIds.length > 0) {
        setJobStatus(`Deleted ${deletedIds.size}; ${failedIds.length} failed or started running.`);
        setJobError(true);
      } else {
        setJobStatus(`Deleted ${deletedIds.size} selected queue entries.`);
      }
    } finally {
      setJobProgressLabel("");
    }
  }

  function closeModal() {
    setModalContent(null);
    setSelectedHistoryId(null);
    setSelectedJobId(null);
    setHistoryPreviewLoadCount(0);
  }

  const cellIndex = useMemo(() => {
    const index = new Map();
    if (latestGrid) {
      for (const cell of latestGrid.cells) {
        index.set(cell.row * latestGrid.cols + cell.col, cell);
      }
    }
    return index;
  }, [latestGrid]);

  const hoverFrameRef = useRef(0);
  const hoverPointRef = useRef(null);

  const handleHover = useCallback((event) => {
    hoverPointRef.current = { clientX: event.clientX, clientY: event.clientY };
    if (hoverFrameRef.current) {
      return;
    }
    hoverFrameRef.current = window.requestAnimationFrame(() => {
      hoverFrameRef.current = 0;
      const point = hoverPointRef.current;
      const canvas = canvasRef.current;
      if (!point || !canvas) {
        return;
      }
      if (!latestGrid) {
        setHover(null);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const x = point.clientX - rect.left;
      const y = point.clientY - rect.top;
      const col = Math.floor((x / rect.width) * latestGrid.cols);
      const row = latestGrid.rows - 1 - Math.floor((y / rect.height) * latestGrid.rows);
      const cell = cellIndex.get(row * latestGrid.cols + col) || null;

      if (!cell) {
        setHover(null);
        return;
      }

      setHover({
        cell,
        left: Math.min(x + 14, rect.width - 252),
        top: Math.max(y - 80, 10),
      });
    });
  }, [cellIndex, latestGrid]);

  useEffect(() => () => {
    if (hoverFrameRef.current) {
      window.cancelAnimationFrame(hoverFrameRef.current);
    }
  }, []);

  const networkSolver = useMemo(
    () => solverForScene(activeScene, networkSolverDraft),
    [activeScene, networkSolverDraft],
  );

  const modalProgressLabel = modalContent
    ? jobProgressLabel
      || historyProgressLabel
      || (historyPreviewLoadCount > 0 ? "Loading history preview..." : "")
    : "";

  const busyLabel = isRunning
    ? "Running simulation..."
    : apiProgressLabel
      || jobProgressLabel
      || (!modalContent ? historyProgressLabel : "")
      || (!modalContent && historyPreviewLoadCount > 0 ? "Loading history preview..." : "")
      || (isSceneLoading ? "Loading scene..." : "")
      || (isSceneListLoading ? "Loading scenes..." : "");
  const visibleRoute = !hasWorkScene && isWorkSceneRequiredRoute(route)
    ? SCENE_SELECTION_ROUTE
    : route;

  if (authStatus === "checking") {
    return (
      <main className="session-check" role="status">
        <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
        <strong>Opening Sionna Planner</strong>
        <p>Checking your workspace session...</p>
      </main>
    );
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
          antennaPool={fixedSceneAntennas}
          antennas={antennas}
          displayAntennas={activeNetworkAntennas}
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
          onOptimize={() => navigate(NETWORK_OPTIMIZATION_ROUTE)}
          onSceneLoadingChange={setIsSceneLoading}
          onAddType2Antenna={addType2Antenna}
          onCreateAntenna={createInventoryAntenna}
          onRemoveType2Antenna={removeType2Antenna}
          onUpdateAntenna={updateAntenna}
          maxAntennas={MAX_NETWORK_COVERAGE_ANTENNAS}
          runError={runError}
          runStatus={runStatus}
          solver={networkSolver}
          onSolverChange={setNetworkSolverDraft}
          summary={summary}
        />
      )}
      {visibleRoute === NETWORK_OPTIMIZATION_ROUTE && activeScene && (
        <OptimizationObjectivePage
          key={activeScene.id}
          activeScene={activeScene}
          baseRequest={buildNetworkCoveragePayload(activeNetworkAntennas, activeScene)}
          storageKey={NETWORK_OPTIMIZATION_OBJECTIVES_STORAGE_KEY}
          onBack={() => navigate(SIMULATION_ENTRY_ROUTE)}
          onApply={(settings) => {
            Object.entries(settings).forEach(([id, values]) => {
              if (values && typeof values === "object") {
                updateAntenna(id, "tilt", values.tilt);
                updateAntenna(id, "tx_power", values.tx_power);
                updateAntenna(id, "azimuth", values.azimuth);
                return;
              }
              updateAntenna(id, "tilt", values);
            });
            setLatestGrid(null);
            setCoverageImageUrl("");
            setRunStatus("Optimized antenna settings applied. Run Network Coverage to view the updated map.");
          }}
        />
      )}
      {visibleRoute === "/configurations" && activeScene && (
        <NetworkConfigurationsPage
          key={activeScene.id}
          activeScene={activeScene}
          fixedAntennas={fixedSceneAntennas}
        />
      )}
      {visibleRoute === "/profiles" && activeScene && (
        <SimulationProfilesPage
          key={activeScene.id}
          activeScene={activeScene}
          currentUser={currentUser}
        />
      )}
      {visibleRoute === "/coverage" && (
        <CoverageApiPage
          key={activeScene?.id}
          activeScene={activeScene}
          antennas={fixedSceneAntennas}
          onQueueOpen={() => navigate("/queue")}
          onSimulationQueued={showQueuedPrompt}
          onCreateAntenna={createInventoryAntenna}
          onProgressChange={handleApiProgressChange}
          onSceneLoadingChange={setIsSceneLoading}
        />
      )}
      {visibleRoute === "/rsrp" && (
        <RsrpSimulationPage
          activeScene={activeScene}
          antennaPool={fixedSceneAntennas}
          antennas={rsrpAntennas}
          simulationAntennas={activeRsrpAntennas}
          maxAntennas={MAX_RSRP_SIMULATION_ANTENNAS}
          onAddType2Antenna={addRsrpType2Antenna}
          onCreateAntenna={createInventoryAntenna}
          onQueueOpen={() => navigate("/queue")}
          onRemoveType2Antenna={removeRsrpType2Antenna}
          onResetAntennas={resetRsrpAntennas}
          onSimulationQueued={showQueuedPrompt}
          onUpdateAntenna={updateRsrpAntenna}
          onProgressChange={handleApiProgressChange}
          onSceneLoadingChange={setIsSceneLoading}
        />
      )}
      {visibleRoute === "/sinr" && (
        <SinrApiPage
          activeScene={activeScene}
          antennaPool={fixedSceneAntennas}
          antennas={sinrAntennas}
          onAddType2Antenna={addSinrType2Antenna}
          onCreateAntenna={createInventoryAntenna}
          onQueueOpen={() => navigate("/queue")}
          onRemoveType2Antenna={removeSinrType2Antenna}
          onResetAntennas={resetSinrAntennas}
          onRoleSelectionChange={updateSinrRoleSelection}
          onSimulationQueued={showQueuedPrompt}
          onUpdateAntenna={updateSinrAntenna}
          onProgressChange={handleApiProgressChange}
          onSceneLoadingChange={setIsSceneLoading}
          roleSelection={sinrRoleSelection}
        />
      )}
      {visibleRoute === "/throughput" && (
        <ThroughputApiPage
          activeScene={activeScene}
          antennaPool={fixedSceneAntennas}
          antennas={throughputAntennas}
          onAddType2Antenna={addThroughputType2Antenna}
          onCreateAntenna={createInventoryAntenna}
          onQueueOpen={() => navigate("/queue")}
          onRemoveType2Antenna={removeThroughputType2Antenna}
          onResetAntennas={resetThroughputAntennas}
          onRoleSelectionChange={updateThroughputRoleSelection}
          onSimulationQueued={showQueuedPrompt}
          onUpdateAntenna={updateThroughputAntenna}
          onProgressChange={handleApiProgressChange}
          onSceneLoadingChange={setIsSceneLoading}
          roleSelection={throughputRoleSelection}
        />
      )}
      {visibleRoute === "/queue" && (
        <QueueRoutePage
          jobError={jobError}
          jobs={simulationJobs}
          jobStatus={jobStatus}
          isLoading={Boolean(jobProgressLabel)}
          onDiscard={discardSimulationJob}
          onDeleteSelected={deleteSelectedJobs}
          onOpen={openJobDetail}
          onOpenHistory={openHistoryDetail}
          onRefresh={loadJobs}
          onSave={saveSimulationJob}
          onToggleDeleteSelection={toggleJobDeleteSelection}
          onToggleSelectAll={toggleAllJobDeleteSelection}
          selectedDeleteIds={selectedJobDeleteIds}
          selectedJobId={selectedJobId}
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
      {visibleRoute === "/antennas" && (
        <AntennasPage onInventoryChange={setAntennaInventory} />
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
      {queuedPrompt && (
        <QueueSubmissionPrompt
          job={queuedPrompt}
          onClose={closeQueuedPrompt}
          onOpenQueue={openQueueFromPrompt}
        />
      )}
    </div>
  );
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
