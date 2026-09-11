import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteSimulationJob,
  listScenes,
  deleteSimulationRun,
  getSimulationJob,
  getSimulationRun,
  listSimulationRuns,
  listSimulationJobs,
  runNetworkCoverage,
  getCurrentUser,
  saveSimulationJobResult,
} from "./api";
import {
  DEFAULT_SOLVER,
  ROUTES,
  TRANSMITTER_PATTERN,
  AUTH_TOKEN_STORAGE_KEY,
  NETWORK_ANTENNA_SETTINGS_STORAGE_KEY,
  NETWORK_OPTIMIZATION_OBJECTIVES_STORAGE_KEY,
  NETWORK_TYPE2_ANTENNAS_STORAGE_KEY,
  RSRP_ANTENNA_SETTINGS_STORAGE_KEY,
  RSRP_TYPE2_ANTENNAS_STORAGE_KEY,
  SCENE_FIXED_ANTENNAS_STORAGE_KEY,
  SINR_ANTENNA_SETTINGS_STORAGE_KEY,
  SINR_ROLE_SELECTION_STORAGE_KEY,
  SINR_TYPE2_ANTENNAS_STORAGE_KEY,
  THROUGHPUT_ANTENNA_SETTINGS_STORAGE_KEY,
  THROUGHPUT_ROLE_SELECTION_STORAGE_KEY,
  THROUGHPUT_TYPE2_ANTENNAS_STORAGE_KEY,
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
import HistoryPanel, { BulkDeletePanel } from "./components/HistoryPanel";
import { TrashIcon } from "./components/Icons";
import LoginPage from "./components/LoginPage";
import MapPanel from "./components/MapPanel";
import OptimizationObjectivePage from "./components/OptimizationObjectivePage";
import NetworkConfigurationsPage from "./components/NetworkConfigurationsPage";
import SimulationProfilesPage from "./components/SimulationProfilesPage";
import SceneChooserPage from "./components/SceneChooserModal";
import ScenesPage from "./components/ScenesPage";
import { formatDateTime, formatSimulationType, formatText } from "./utils/format";
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
  lngLatBoundsError,
  lngLatInsideBounds,
  lngLatToScenePosition,
  solverForScene,
} from "./utils/scene";

function clone(value) {
  return structuredClone(value);
}

const SCENE_SELECTION_ROUTE = "/scenes";
const SCENE_CREATION_ROUTE = "/choose-scene";
const SIMULATION_ENTRY_ROUTE = "/network";
const NETWORK_OPTIMIZATION_ROUTE = "/network/optimization";
const HISTORY_PAGE_LIMIT = 200;
const JOB_PAGE_LIMIT = 200;
const MAX_NETWORK_COVERAGE_ANTENNAS = 10;
const MAX_RSRP_SIMULATION_ANTENNAS = 10;

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [route, setRoute] = useState(() => normalizeRoute(window.location.pathname));
  const [networkType2AntennasByScene, setNetworkType2AntennasByScene] = useState(() => (
    readStoredSceneMap(NETWORK_TYPE2_ANTENNAS_STORAGE_KEY, normalizeStoredType2Antennas)
  ));
  const [networkAntennaSettingsByScene, setNetworkAntennaSettingsByScene] = useState(() => (
    readStoredSceneMap(NETWORK_ANTENNA_SETTINGS_STORAGE_KEY, normalizeStoredAntennaSettings)
  ));
  const [rsrpType2AntennasByScene, setRsrpType2AntennasByScene] = useState(() => (
    readStoredSceneMap(RSRP_TYPE2_ANTENNAS_STORAGE_KEY, normalizeStoredType2Antennas)
  ));
  const [rsrpAntennaSettingsByScene, setRsrpAntennaSettingsByScene] = useState(() => (
    readStoredSceneMap(RSRP_ANTENNA_SETTINGS_STORAGE_KEY, normalizeStoredAntennaSettings)
  ));
  const [sinrType2AntennasByScene, setSinrType2AntennasByScene] = useState(() => (
    readStoredSceneMap(SINR_TYPE2_ANTENNAS_STORAGE_KEY, normalizeStoredType2Antennas)
  ));
  const [sinrAntennaSettingsByScene, setSinrAntennaSettingsByScene] = useState(() => (
    readStoredSceneMap(SINR_ANTENNA_SETTINGS_STORAGE_KEY, normalizeStoredAntennaSettings)
  ));
  const [sinrRoleSelectionsByScene, setSinrRoleSelectionsByScene] = useState(() => (
    readStoredSceneMap(SINR_ROLE_SELECTION_STORAGE_KEY, normalizeStoredSinrRoles)
  ));
  const [throughputType2AntennasByScene, setThroughputType2AntennasByScene] = useState(() => (
    readStoredSceneMap(THROUGHPUT_TYPE2_ANTENNAS_STORAGE_KEY, normalizeStoredType2Antennas)
  ));
  const [throughputAntennaSettingsByScene, setThroughputAntennaSettingsByScene] = useState(() => (
    readStoredSceneMap(THROUGHPUT_ANTENNA_SETTINGS_STORAGE_KEY, normalizeStoredAntennaSettings)
  ));
  const [throughputRoleSelectionsByScene, setThroughputRoleSelectionsByScene] = useState(() => (
    readStoredSceneMap(THROUGHPUT_ROLE_SELECTION_STORAGE_KEY, normalizeStoredSinrRoles)
  ));
  const [latestGrid, setLatestGrid] = useState(null);
  const [latestSolver, setLatestSolver] = useState(() => clone(DEFAULT_SOLVER));
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
  const [sceneAntennaOverrides, setSceneAntennaOverrides] = useState(() => new Map());
  const [hasWorkScene, setHasWorkScene] = useState(false);

  const canvasRef = useRef(null);
  const mapStageRef = useRef(null);
  const summary = useMemo(() => summarizeGrid(latestGrid), [latestGrid]);
  const fixedSceneAntennas = useMemo(
    () => antennasForActiveScene(activeScene, sceneAntennaOverrides),
    [activeScene, sceneAntennaOverrides],
  );
  const antennas = useMemo(
    () => networkCoverageAntennasForScene(
      activeScene,
      fixedSceneAntennas,
      networkType2AntennasByScene,
      networkAntennaSettingsByScene,
    ),
    [
      activeScene,
      fixedSceneAntennas,
      networkType2AntennasByScene,
      networkAntennaSettingsByScene,
    ],
  );
  const activeNetworkAntennas = useMemo(
    () => antennas.filter(isAntennaEnabled),
    [antennas],
  );
  const rsrpAntennas = useMemo(
    () => networkCoverageAntennasForScene(
      activeScene,
      fixedSceneAntennas,
      rsrpType2AntennasByScene,
      rsrpAntennaSettingsByScene,
    ),
    [
      activeScene,
      fixedSceneAntennas,
      rsrpType2AntennasByScene,
      rsrpAntennaSettingsByScene,
    ],
  );
  const activeRsrpAntennas = useMemo(
    () => rsrpAntennas.filter(isAntennaEnabled),
    [rsrpAntennas],
  );
  const sinrAntennas = useMemo(
    () => networkCoverageAntennasForScene(
      activeScene,
      fixedSceneAntennas,
      sinrType2AntennasByScene,
      sinrAntennaSettingsByScene,
    ),
    [
      activeScene,
      fixedSceneAntennas,
      sinrType2AntennasByScene,
      sinrAntennaSettingsByScene,
    ],
  );
  const throughputAntennas = useMemo(
    () => networkCoverageAntennasForScene(
      activeScene,
      fixedSceneAntennas,
      throughputType2AntennasByScene,
      throughputAntennaSettingsByScene,
    ),
    [
      activeScene,
      fixedSceneAntennas,
      throughputType2AntennasByScene,
      throughputAntennaSettingsByScene,
    ],
  );
  const sinrRoleSelection = useMemo(
    () => sinrRoleSelectionsByScene.get(activeScene?.id) || {},
    [activeScene?.id, sinrRoleSelectionsByScene],
  );
  const throughputRoleSelection = useMemo(
    () => throughputRoleSelectionsByScene.get(activeScene?.id) || {},
    [activeScene?.id, throughputRoleSelectionsByScene],
  );

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

      const result = await runNetworkCoverage(buildNetworkCoveragePayload(activeNetworkAntennas, activeScene));

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
    if (!activeScene?.id) {
      return;
    }

    if (value === "") {
      return;
    }

    const antenna = antennas.find((item) => item.id === antennaId);
    if (!antenna) {
      return;
    }

    setNetworkAntennaSettingsByScene((current) => {
      const next = new Map(current);
      const sceneSettings = {
        ...(next.get(activeScene.id) || {}),
      };
      const currentSetting = {
        ...simulationSettingsForAntenna(antenna),
        ...(sceneSettings[antennaId] || {}),
      };

      if (field === "tilt") {
        currentSetting.tilt_current = value;
      } else if (field === "tx_power") {
        currentSetting.tx_power_current = value;
      } else if (field === "azimuth") {
        currentSetting.azimuth = value;
      } else if (field === "enabled") {
        currentSetting.enabled = Boolean(value);
      }

      sceneSettings[antennaId] = currentSetting;
      setSceneMapValue(next, activeScene.id, sceneSettings, normalizeStoredAntennaSettings);
      persistSceneMap(NETWORK_ANTENNA_SETTINGS_STORAGE_KEY, next);
      return next;
    });
  }

  function addType2Antenna(antenna) {
    if (!activeScene?.id) {
      return { error: "Select a scene before adding an antenna." };
    }

    if (activeNetworkAntennas.length >= MAX_NETWORK_COVERAGE_ANTENNAS) {
      return { error: `Network Coverage supports up to ${MAX_NETWORK_COVERAGE_ANTENNAS} active antennas. Uncheck one antenna before adding another.` };
    }

    const normalized = normalizeAntennaBase(antenna);
    if (!normalized) {
      return { error: "Antenna base config is incomplete." };
    }

    const coordinateError = lngLatBoundsError(
      normalized,
      activeScene.bounds,
      "Type 2 antenna coordinates",
    );
    if (coordinateError) {
      return { error: coordinateError };
    }

    if (antennas.some((item) => item.id.toLowerCase() === normalized.id.toLowerCase())) {
      return { error: `antenna_id "${normalized.id}" is already used.` };
    }

    setNetworkType2AntennasByScene((current) => {
      const next = new Map(current);
      const sceneAntennas = [
        ...(next.get(activeScene.id) || []),
        normalized,
      ];
      setSceneMapValue(next, activeScene.id, sceneAntennas, normalizeStoredType2Antennas);
      persistSceneMap(NETWORK_TYPE2_ANTENNAS_STORAGE_KEY, next);
      return next;
    });
    setNetworkAntennaSettingsByScene((current) => {
      const next = new Map(current);
      const sceneSettings = {
        ...(next.get(activeScene.id) || {}),
        [normalized.id]: simulationSettingsForAntenna(normalized),
      };
      setSceneMapValue(next, activeScene.id, sceneSettings, normalizeStoredAntennaSettings);
      persistSceneMap(NETWORK_ANTENNA_SETTINGS_STORAGE_KEY, next);
      return next;
    });
    clearLatestNetworkResult();
    return { ok: true };
  }

  function removeType2Antenna(antennaId) {
    if (!activeScene?.id) {
      return;
    }

    const confirmed = window.confirm(`Delete type 2 antenna "${antennaId}"?`);

    if (!confirmed) {
      return;
    }

    setNetworkType2AntennasByScene((current) => {
      const next = new Map(current);
      const sceneAntennas = (next.get(activeScene.id) || []).filter((item) => (
        item.id !== antennaId
      ));
      setSceneMapValue(next, activeScene.id, sceneAntennas, normalizeStoredType2Antennas);
      persistSceneMap(NETWORK_TYPE2_ANTENNAS_STORAGE_KEY, next);
      return next;
    });
    setNetworkAntennaSettingsByScene((current) => {
      const next = new Map(current);
      const sceneSettings = {
        ...(next.get(activeScene.id) || {}),
      };
      delete sceneSettings[antennaId];
      setSceneMapValue(next, activeScene.id, sceneSettings, normalizeStoredAntennaSettings);
      persistSceneMap(NETWORK_ANTENNA_SETTINGS_STORAGE_KEY, next);
      return next;
    });
    clearLatestNetworkResult();
  }

  function updateRsrpAntenna(antennaId, field, value) {
    if (!activeScene?.id || value === "") {
      return;
    }

    const antenna = rsrpAntennas.find((item) => item.id === antennaId);
    if (!antenna) {
      return;
    }

    setRsrpAntennaSettingsByScene((current) => {
      const next = new Map(current);
      const sceneSettings = {
        ...(next.get(activeScene.id) || {}),
      };
      const currentSetting = {
        ...simulationSettingsForAntenna(antenna),
        ...(sceneSettings[antennaId] || {}),
      };

      if (field === "tilt") {
        currentSetting.tilt_current = value;
      } else if (field === "tx_power") {
        currentSetting.tx_power_current = value;
      } else if (field === "azimuth") {
        currentSetting.azimuth = value;
      } else if (field === "enabled") {
        currentSetting.enabled = Boolean(value);
      }

      sceneSettings[antennaId] = currentSetting;
      setSceneMapValue(next, activeScene.id, sceneSettings, normalizeStoredAntennaSettings);
      persistSceneMap(RSRP_ANTENNA_SETTINGS_STORAGE_KEY, next);
      return next;
    });
  }

  function addRsrpType2Antenna(antenna) {
    if (!activeScene?.id) {
      return { error: "Select a scene before adding an antenna." };
    }

    if (activeRsrpAntennas.length >= MAX_RSRP_SIMULATION_ANTENNAS) {
      return { error: `RSRP Simulation supports up to ${MAX_RSRP_SIMULATION_ANTENNAS} active antennas. Uncheck one antenna before adding another.` };
    }

    const normalized = normalizeAntennaBase(antenna);
    if (!normalized) {
      return { error: "Antenna base config is incomplete." };
    }

    const coordinateError = lngLatBoundsError(
      normalized,
      activeScene.bounds,
      "Type 2 antenna coordinates",
    );
    if (coordinateError) {
      return { error: coordinateError };
    }

    if (rsrpAntennas.some((item) => item.id.toLowerCase() === normalized.id.toLowerCase())) {
      return { error: `antenna_id "${normalized.id}" is already used.` };
    }

    setRsrpType2AntennasByScene((current) => {
      const next = new Map(current);
      const sceneAntennas = [
        ...(next.get(activeScene.id) || []),
        normalized,
      ];
      setSceneMapValue(next, activeScene.id, sceneAntennas, normalizeStoredType2Antennas);
      persistSceneMap(RSRP_TYPE2_ANTENNAS_STORAGE_KEY, next);
      return next;
    });
    setRsrpAntennaSettingsByScene((current) => {
      const next = new Map(current);
      const sceneSettings = {
        ...(next.get(activeScene.id) || {}),
        [normalized.id]: simulationSettingsForAntenna(normalized),
      };
      setSceneMapValue(next, activeScene.id, sceneSettings, normalizeStoredAntennaSettings);
      persistSceneMap(RSRP_ANTENNA_SETTINGS_STORAGE_KEY, next);
      return next;
    });
    return { ok: true };
  }

  function removeRsrpType2Antenna(antennaId) {
    if (!activeScene?.id) {
      return;
    }

    const confirmed = window.confirm(`Delete type 2 antenna "${antennaId}"?`);

    if (!confirmed) {
      return;
    }

    setRsrpType2AntennasByScene((current) => {
      const next = new Map(current);
      const sceneAntennas = (next.get(activeScene.id) || []).filter((item) => (
        item.id !== antennaId
      ));
      setSceneMapValue(next, activeScene.id, sceneAntennas, normalizeStoredType2Antennas);
      persistSceneMap(RSRP_TYPE2_ANTENNAS_STORAGE_KEY, next);
      return next;
    });
    setRsrpAntennaSettingsByScene((current) => {
      const next = new Map(current);
      const sceneSettings = {
        ...(next.get(activeScene.id) || {}),
      };
      delete sceneSettings[antennaId];
      setSceneMapValue(next, activeScene.id, sceneSettings, normalizeStoredAntennaSettings);
      persistSceneMap(RSRP_ANTENNA_SETTINGS_STORAGE_KEY, next);
      return next;
    });
  }

  function updateSinrAntenna(antennaId, field, value) {
    if (!activeScene?.id || value === "") {
      return;
    }

    const antenna = sinrAntennas.find((item) => item.id === antennaId);
    if (!antenna) {
      return;
    }

    setSinrAntennaSettingsByScene((current) => {
      const next = new Map(current);
      const sceneSettings = {
        ...(next.get(activeScene.id) || {}),
      };
      const currentSetting = {
        ...simulationSettingsForAntenna(antenna),
        ...(sceneSettings[antennaId] || {}),
      };

      if (field === "tilt") {
        currentSetting.tilt_current = value;
      } else if (field === "tx_power") {
        currentSetting.tx_power_current = value;
      } else if (field === "azimuth") {
        currentSetting.azimuth = value;
      }

      sceneSettings[antennaId] = currentSetting;
      setSceneMapValue(next, activeScene.id, sceneSettings, normalizeStoredAntennaSettings);
      persistSceneMap(SINR_ANTENNA_SETTINGS_STORAGE_KEY, next);
      return next;
    });
  }

  function addSinrType2Antenna(antenna) {
    if (!activeScene?.id) {
      return { error: "Select a scene before adding an antenna." };
    }

    const normalized = normalizeAntennaBase(antenna);
    if (!normalized) {
      return { error: "Antenna base config is incomplete." };
    }

    const coordinateError = lngLatBoundsError(
      normalized,
      activeScene.bounds,
      "Type 2 antenna coordinates",
    );
    if (coordinateError) {
      return { error: coordinateError };
    }

    if (sinrAntennas.some((item) => item.id.toLowerCase() === normalized.id.toLowerCase())) {
      return { error: `antenna_id "${normalized.id}" is already used.` };
    }

    setSinrType2AntennasByScene((current) => {
      const next = new Map(current);
      const sceneAntennas = [
        ...(next.get(activeScene.id) || []),
        normalized,
      ];
      setSceneMapValue(next, activeScene.id, sceneAntennas, normalizeStoredType2Antennas);
      persistSceneMap(SINR_TYPE2_ANTENNAS_STORAGE_KEY, next);
      return next;
    });
    setSinrAntennaSettingsByScene((current) => {
      const next = new Map(current);
      const sceneSettings = {
        ...(next.get(activeScene.id) || {}),
        [normalized.id]: simulationSettingsForAntenna(normalized),
      };
      setSceneMapValue(next, activeScene.id, sceneSettings, normalizeStoredAntennaSettings);
      persistSceneMap(SINR_ANTENNA_SETTINGS_STORAGE_KEY, next);
      return next;
    });
    return { ok: true };
  }

  function removeSinrType2Antenna(antennaId) {
    if (!activeScene?.id) {
      return;
    }

    const confirmed = window.confirm(`Delete type 2 antenna "${antennaId}"?`);

    if (!confirmed) {
      return;
    }

    setSinrType2AntennasByScene((current) => {
      const next = new Map(current);
      const sceneAntennas = (next.get(activeScene.id) || []).filter((item) => (
        item.id !== antennaId
      ));
      setSceneMapValue(next, activeScene.id, sceneAntennas, normalizeStoredType2Antennas);
      persistSceneMap(SINR_TYPE2_ANTENNAS_STORAGE_KEY, next);
      return next;
    });
    setSinrAntennaSettingsByScene((current) => {
      const next = new Map(current);
      const sceneSettings = {
        ...(next.get(activeScene.id) || {}),
      };
      delete sceneSettings[antennaId];
      setSceneMapValue(next, activeScene.id, sceneSettings, normalizeStoredAntennaSettings);
      persistSceneMap(SINR_ANTENNA_SETTINGS_STORAGE_KEY, next);
      return next;
    });
    setSinrRoleSelectionsByScene((current) => {
      const next = new Map(current);
      const roles = {
        ...(next.get(activeScene.id) || {}),
      };

      for (const [role, selectedId] of Object.entries(roles)) {
        if (selectedId === antennaId) {
          roles[role] = "";
        }
      }

      setSceneMapValue(next, activeScene.id, roles, normalizeStoredSinrRoles);
      persistSceneMap(SINR_ROLE_SELECTION_STORAGE_KEY, next);
      return next;
    });
  }

  function updateSinrRoleSelection(nextRoles) {
    if (!activeScene?.id) {
      return;
    }

    setSinrRoleSelectionsByScene((current) => {
      const next = new Map(current);
      setSceneMapValue(next, activeScene.id, nextRoles, normalizeStoredSinrRoles);
      persistSceneMap(SINR_ROLE_SELECTION_STORAGE_KEY, next);
      return next;
    });
  }

  function updateThroughputAntenna(antennaId, field, value) {
    if (!activeScene?.id || value === "") {
      return;
    }

    const antenna = throughputAntennas.find((item) => item.id === antennaId);
    if (!antenna) {
      return;
    }

    setThroughputAntennaSettingsByScene((current) => {
      const next = new Map(current);
      const sceneSettings = {
        ...(next.get(activeScene.id) || {}),
      };
      const currentSetting = {
        ...simulationSettingsForAntenna(antenna),
        ...(sceneSettings[antennaId] || {}),
      };

      if (field === "tilt") {
        currentSetting.tilt_current = value;
      } else if (field === "tx_power") {
        currentSetting.tx_power_current = value;
      } else if (field === "azimuth") {
        currentSetting.azimuth = value;
      }

      sceneSettings[antennaId] = currentSetting;
      setSceneMapValue(next, activeScene.id, sceneSettings, normalizeStoredAntennaSettings);
      persistSceneMap(THROUGHPUT_ANTENNA_SETTINGS_STORAGE_KEY, next);
      return next;
    });
  }

  function addThroughputType2Antenna(antenna) {
    if (!activeScene?.id) {
      return { error: "Select a scene before adding an antenna." };
    }

    const normalized = normalizeAntennaBase(antenna);
    if (!normalized) {
      return { error: "Antenna base config is incomplete." };
    }

    const coordinateError = lngLatBoundsError(
      normalized,
      activeScene.bounds,
      "Type 2 antenna coordinates",
    );
    if (coordinateError) {
      return { error: coordinateError };
    }

    if (throughputAntennas.some((item) => item.id.toLowerCase() === normalized.id.toLowerCase())) {
      return { error: `antenna_id "${normalized.id}" is already used.` };
    }

    setThroughputType2AntennasByScene((current) => {
      const next = new Map(current);
      const sceneAntennas = [
        ...(next.get(activeScene.id) || []),
        normalized,
      ];
      setSceneMapValue(next, activeScene.id, sceneAntennas, normalizeStoredType2Antennas);
      persistSceneMap(THROUGHPUT_TYPE2_ANTENNAS_STORAGE_KEY, next);
      return next;
    });
    setThroughputAntennaSettingsByScene((current) => {
      const next = new Map(current);
      const sceneSettings = {
        ...(next.get(activeScene.id) || {}),
        [normalized.id]: simulationSettingsForAntenna(normalized),
      };
      setSceneMapValue(next, activeScene.id, sceneSettings, normalizeStoredAntennaSettings);
      persistSceneMap(THROUGHPUT_ANTENNA_SETTINGS_STORAGE_KEY, next);
      return next;
    });
    return { ok: true };
  }

  function removeThroughputType2Antenna(antennaId) {
    if (!activeScene?.id) {
      return;
    }

    const confirmed = window.confirm(`Delete type 2 antenna "${antennaId}"?`);

    if (!confirmed) {
      return;
    }

    setThroughputType2AntennasByScene((current) => {
      const next = new Map(current);
      const sceneAntennas = (next.get(activeScene.id) || []).filter((item) => (
        item.id !== antennaId
      ));
      setSceneMapValue(next, activeScene.id, sceneAntennas, normalizeStoredType2Antennas);
      persistSceneMap(THROUGHPUT_TYPE2_ANTENNAS_STORAGE_KEY, next);
      return next;
    });
    setThroughputAntennaSettingsByScene((current) => {
      const next = new Map(current);
      const sceneSettings = {
        ...(next.get(activeScene.id) || {}),
      };
      delete sceneSettings[antennaId];
      setSceneMapValue(next, activeScene.id, sceneSettings, normalizeStoredAntennaSettings);
      persistSceneMap(THROUGHPUT_ANTENNA_SETTINGS_STORAGE_KEY, next);
      return next;
    });
    setThroughputRoleSelectionsByScene((current) => {
      const next = new Map(current);
      const roles = {
        ...(next.get(activeScene.id) || {}),
      };

      for (const [role, selectedId] of Object.entries(roles)) {
        if (selectedId === antennaId) {
          roles[role] = "";
        }
      }

      setSceneMapValue(next, activeScene.id, roles, normalizeStoredSinrRoles);
      persistSceneMap(THROUGHPUT_ROLE_SELECTION_STORAGE_KEY, next);
      return next;
    });
  }

  function updateThroughputRoleSelection(nextRoles) {
    if (!activeScene?.id) {
      return;
    }

    setThroughputRoleSelectionsByScene((current) => {
      const next = new Map(current);
      setSceneMapValue(next, activeScene.id, nextRoles, normalizeStoredSinrRoles);
      persistSceneMap(THROUGHPUT_ROLE_SELECTION_STORAGE_KEY, next);
      return next;
    });
  }

  function resetRsrpAntennas() {
    clearRsrpDraft(activeScene?.id);
  }

  function resetSinrAntennas() {
    clearSinrDraft(activeScene?.id);
  }

  function resetThroughputAntennas() {
    clearThroughputDraft(activeScene?.id);
  }

  function resetAntennas() {
    clearNetworkCoverageDraft(activeScene?.id);
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

  function clearNetworkCoverageDraft(sceneId) {
    if (!sceneId) {
      return;
    }

    setNetworkType2AntennasByScene((current) => {
      const next = new Map(current);
      next.delete(sceneId);
      persistSceneMap(NETWORK_TYPE2_ANTENNAS_STORAGE_KEY, next);
      return next;
    });
    setNetworkAntennaSettingsByScene((current) => {
      const next = new Map(current);
      next.delete(sceneId);
      persistSceneMap(NETWORK_ANTENNA_SETTINGS_STORAGE_KEY, next);
      return next;
    });
  }

  function clearRsrpDraft(sceneId) {
    if (!sceneId) {
      return;
    }

    setRsrpType2AntennasByScene((current) => {
      const next = new Map(current);
      next.delete(sceneId);
      persistSceneMap(RSRP_TYPE2_ANTENNAS_STORAGE_KEY, next);
      return next;
    });
    setRsrpAntennaSettingsByScene((current) => {
      const next = new Map(current);
      next.delete(sceneId);
      persistSceneMap(RSRP_ANTENNA_SETTINGS_STORAGE_KEY, next);
      return next;
    });
  }

  function clearSinrDraft(sceneId) {
    if (!sceneId) {
      return;
    }

    setSinrType2AntennasByScene((current) => {
      const next = new Map(current);
      next.delete(sceneId);
      persistSceneMap(SINR_TYPE2_ANTENNAS_STORAGE_KEY, next);
      return next;
    });
    setSinrAntennaSettingsByScene((current) => {
      const next = new Map(current);
      next.delete(sceneId);
      persistSceneMap(SINR_ANTENNA_SETTINGS_STORAGE_KEY, next);
      return next;
    });
    setSinrRoleSelectionsByScene((current) => {
      const next = new Map(current);
      next.delete(sceneId);
      persistSceneMap(SINR_ROLE_SELECTION_STORAGE_KEY, next);
      return next;
    });
  }

  function clearThroughputDraft(sceneId) {
    if (!sceneId) {
      return;
    }

    setThroughputType2AntennasByScene((current) => {
      const next = new Map(current);
      next.delete(sceneId);
      persistSceneMap(THROUGHPUT_TYPE2_ANTENNAS_STORAGE_KEY, next);
      return next;
    });
    setThroughputAntennaSettingsByScene((current) => {
      const next = new Map(current);
      next.delete(sceneId);
      persistSceneMap(THROUGHPUT_ANTENNA_SETTINGS_STORAGE_KEY, next);
      return next;
    });
    setThroughputRoleSelectionsByScene((current) => {
      const next = new Map(current);
      next.delete(sceneId);
      persistSceneMap(THROUGHPUT_ROLE_SELECTION_STORAGE_KEY, next);
      return next;
    });
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

    clearNetworkCoverageDraft(activeScene?.id);
    clearRsrpDraft(activeScene?.id);
    clearSinrDraft(activeScene?.id);
    clearThroughputDraft(activeScene?.id);
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
          onRemoveType2Antenna={removeType2Antenna}
          onUpdateAntenna={updateAntenna}
          maxAntennas={MAX_NETWORK_COVERAGE_ANTENNAS}
          runError={runError}
          runStatus={runStatus}
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
          activeScene={activeScene}
          antennas={fixedSceneAntennas}
          onQueueOpen={() => navigate("/queue")}
          onSimulationQueued={showQueuedPrompt}
          onProgressChange={handleApiProgressChange}
          onSceneLoadingChange={setIsSceneLoading}
        />
      )}
      {visibleRoute === "/rsrp" && (
        <RsrpSimulationPage
          activeScene={activeScene}
          antennas={rsrpAntennas}
          simulationAntennas={activeRsrpAntennas}
          maxAntennas={MAX_RSRP_SIMULATION_ANTENNAS}
          onAddType2Antenna={addRsrpType2Antenna}
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
          antennas={sinrAntennas}
          onAddType2Antenna={addSinrType2Antenna}
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
          antennas={throughputAntennas}
          onAddType2Antenna={addThroughputType2Antenna}
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

function Navbar({
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

function QueueSubmissionPrompt({ job, onClose, onOpenQueue }) {
  const sceneName = job.scene_name || job.scene?.name || job.scene?.id;

  return (
    <section className="prompt-backdrop" onClick={onClose}>
      <div
        className="queue-prompt"
        role="dialog"
        aria-modal="true"
        aria-label="Simulation queued"
        onClick={(event) => event.stopPropagation()}
      >
        <strong>Simulation recorded</strong>
        <p>The simulation is recorded in the queue. You can open Simulation Queue to track its status and save the result after it finishes.</p>
        <dl className="detail-grid">
          <dt>Scene</dt><dd>{formatText(sceneName)}</dd>
          <dt>Type</dt><dd>{formatSimulationType(job.simulation_type)}</dd>
        </dl>
        <div>
          <button className="ghost-button" type="button" onClick={onClose}>
            Stay here
          </button>
          <button className="primary-button" type="button" onClick={onOpenQueue}>
            Open Simulation Queue
          </button>
        </div>
      </div>
    </section>
  );
}

function NetworkCoveragePage({
  activeScene,
  antennas,
  canvasRef,
  coverageImageUrl,
  displayAntennas = antennas,
  hover,
  isSceneLoading,
  isRunning,
  latestGrid,
  latestSolver,
  mapStageRef,
  maxAntennas,
  onAddType2Antenna,
  onHover,
  onHoverEnd,
  onRemoveType2Antenna,
  onResetAntennas,
  onOptimize,
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
        antennas={displayAntennas}
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
        onOptimize={onOptimize}
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
          activeScene={activeScene}
          antennas={antennas}
          disabled={isRunning || isSceneLoading}
          maxAntennas={maxAntennas}
          onAddType2={onAddType2Antenna}
          onChange={onUpdateAntenna}
          onRemoveType2={onRemoveType2Antenna}
          showEnabledToggle
        />
      </aside>
    </main>
  );
}

function QueueRoutePage({
  isLoading,
  jobError,
  jobs,
  jobStatus,
  onDiscard,
  onDeleteSelected,
  onOpen,
  onOpenHistory,
  onRefresh,
  onSave,
  onToggleDeleteSelection,
  onToggleSelectAll,
  selectedDeleteIds,
  selectedJobId,
}) {
  const deletableJobs = jobs.filter((job) => (
    String(job.status || "").toLowerCase() !== "running"
  ));
  const allSelected = deletableJobs.length > 0 && deletableJobs.every((job) => (
    selectedDeleteIds.has(job.id)
  ));
  const someSelected = selectedDeleteIds.size > 0 && !allSelected;

  return (
    <main className="route-page">
      <div className="page-title with-action">
        <div>
          <h1>Simulation Queue</h1>
          <p>Track submitted simulations, inspect completed results, then save only the results you want in history.</p>
        </div>
        <button className="ghost-button" type="button" disabled={isLoading} onClick={onRefresh}>
          Refresh
        </button>
      </div>
      <section className="history-page-panel queue-page-panel">
        <div className="history-view">
          <p className={`history-status ${jobError ? "error-text" : ""}`}>{jobStatus}</p>
          <BulkDeletePanel
            allSelected={allSelected}
            isLoading={isLoading}
            itemCount={deletableJobs.length}
            onDeleteSelected={onDeleteSelected}
            onToggleSelectAll={onToggleSelectAll}
            selectedCount={selectedDeleteIds.size}
            someSelected={someSelected}
          />
          <div className="history-list">
            {jobs.map((job) => (
              <QueueRow
                key={job.id}
                isLoading={isLoading}
                isSelected={job.id === selectedJobId}
                isSelectedForDelete={selectedDeleteIds.has(job.id)}
                job={job}
                onDiscard={onDiscard}
                onOpen={onOpen}
                onOpenHistory={onOpenHistory}
                onSave={onSave}
                onToggleDeleteSelection={onToggleDeleteSelection}
              />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function QueueRow({
  isLoading,
  isSelected,
  isSelectedForDelete,
  job,
  onDiscard,
  onOpen,
  onOpenHistory,
  onSave,
  onToggleDeleteSelection,
}) {
  const status = String(job.status || "").toLowerCase();
  const isSucceeded = status === "succeeded";
  const isRunning = status === "running";
  const isQueued = status === "queued";
  const isSaved = Boolean(job.result_run_id);
  const canOpen = isSucceeded || status === "failed";
  const canDiscard = !isRunning;

  return (
    <div className="queue-row">
      <label
        className="history-select"
        title={isRunning ? "Running jobs cannot be deleted" : "Select queue entry for bulk deletion"}
      >
        <input
          type="checkbox"
          checked={isSelectedForDelete}
          disabled={isLoading || isRunning}
          aria-label={`Select ${formatSimulationType(job.simulation_type)} queue entry`}
          onChange={() => onToggleDeleteSelection(job.id)}
        />
      </label>
      <button
        className={`history-item ${isSelected ? "active" : ""}`}
        type="button"
        disabled={isLoading || !canOpen}
        onClick={() => onOpen(job.id)}
      >
        <strong>{formatSimulationType(job.simulation_type)} - {formatJobStatus(job)}</strong>
        <span>{formatDateTime(job.queued_at)}</span>
        <span>{formatText(job.scene?.name || job.scene?.id)}{isQueued || isRunning ? " | Waiting for worker" : ""}</span>
      </button>
      <button
        className="history-compare"
        type="button"
        disabled={isLoading || !isSucceeded || isSaved}
        onClick={() => onSave(job)}
      >
        {isSaved ? "Saved" : "Save"}
      </button>
      <button
        className="ghost-button queue-open-history"
        type="button"
        disabled={isLoading || !isSaved}
        onClick={() => onOpenHistory(job.result_run_id)}
      >
        History
      </button>
      <button
        className="history-delete queue-discard"
        type="button"
        title={isSaved ? "Remove queue entry" : "Discard simulation result"}
        aria-label={isSaved ? "Remove queue entry" : "Discard simulation result"}
        disabled={isLoading || !canDiscard}
        onClick={() => onDiscard(job)}
      >
        <TrashIcon />
      </button>
    </div>
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

function JobResultDetail({
  job,
  onDiscard,
  onOpenHistory,
  onPreviewLoadingChange,
  onSave,
  result,
}) {
  const status = String(job.status || "").toLowerCase();
  const isSucceeded = status === "succeeded";
  const isSaved = Boolean(job.result_run_id);
  const detailItem = simulationJobToHistoryItem(job, result);

  return (
    <div className="queue-result-detail">
      <div className="queue-result-actions">
        <dl className="detail-grid">
          <dt>Queue status</dt><dd>{formatJobStatus(job)}</dd>
          <dt>Queued</dt><dd>{formatDateTime(job.queued_at)}</dd>
          <dt>Finished</dt><dd>{formatDateTime(job.finished_at)}</dd>
        </dl>
        <div>
          <button
            className="primary-button"
            type="button"
            disabled={!isSucceeded || isSaved}
            onClick={onSave}
          >
            {isSaved ? "Saved to history" : "Save to history"}
          </button>
          {isSaved && onOpenHistory && (
            <button className="ghost-button" type="button" onClick={onOpenHistory}>
              Open history
            </button>
          )}
          <button
            className="ghost-button danger-button"
            type="button"
            disabled={status === "running"}
            onClick={onDiscard}
          >
            {isSaved ? "Remove queue entry" : "Discard result"}
          </button>
        </div>
      </div>
      {isSucceeded && result ? (
        <HistoryDetail
          item={detailItem}
          onPreviewLoadingChange={onPreviewLoadingChange}
        />
      ) : (
        <>
          <strong>{formatSimulationType(job.simulation_type)}</strong>
          <p className="history-status error-text">
            {job.error_message || result?.error || "This simulation has not produced a result yet."}
          </p>
        </>
      )}
    </div>
  );
}

function buildNetworkCoveragePayload(antennas, activeScene) {
  return {
    antennas: antennas.map(toAntennaRequest),
    transmitter_pattern: TRANSMITTER_PATTERN,
    solver: solverForScene(activeScene),
    bandwidth_mhz: 100,
    mimo_layers: 4,
  };
}

function simulationJobToHistoryItem(job, result = null) {
  const response = result || job.result || {};
  const isOptimization = job.simulation_type === "network_coverage_optimization";
  const request = isOptimization
    ? response.optimization?.best_request || job.request?.base_request || {}
    : job.request || {};
  const scene = job.scene || {};

  return {
    id: job.result_run_id || job.id,
    simulation_type: isOptimization ? "network_coverage" : job.simulation_type,
    status: response.status || (job.status === "succeeded" ? "success" : job.status),
    transmitter_pattern: request.transmitter_pattern || TRANSMITTER_PATTERN,
    scene_id: scene.id,
    scene_name: scene.name || scene.id,
    scene_bounds: scene.bounds,
    cell_size_m: request.solver?.cell_size,
    bandwidth_mhz: request.bandwidth_mhz,
    mimo_layers: request.mimo_layers,
    coverage_map_image_url: response.coverage_map_image_url,
    error_message: job.error_message || response.error,
    started_at: job.started_at,
    finished_at: job.finished_at,
    created_at: job.queued_at,
    solver: response.solver || request.solver,
    request_json: request,
    response_json: response,
    antennas: antennaSnapshotsForJob(request, scene.bounds),
    artifacts: [],
  };
}

function antennaSnapshotsForJob(request, sceneBounds) {
  if (!Array.isArray(request.antennas)) {
    return [];
  }

  return request.antennas.map((antenna) => ({
    antenna_code: antenna.id,
    position: Array.isArray(antenna.position)
      ? antenna.position
      : lngLatToScenePosition(antenna, sceneBounds),
    azimuth_deg: antenna.azimuth,
    tilt: antenna.tilt,
    tx_power: antenna.tx_power,
  }));
}

function formatJobStatus(job) {
  if (job.result_run_id) {
    return "Saved";
  }

  return formatText(job.status);
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

function networkCoverageAntennasForScene(
  scene,
  fixedAntennas,
  type2AntennasByScene,
  settingsByScene,
) {
  if (!scene?.id) {
    return [];
  }

  const settings = settingsByScene.get(scene.id) || {};
  const type1Antennas = fixedAntennas
    .map((antenna) => applySimulationSettings(antenna, settings[antenna.id], "type1"))
    .filter(Boolean);
  const type2Antennas = (type2AntennasByScene.get(scene.id) || [])
    .map((antenna) => applySimulationSettings(antenna, settings[antenna.id], "type2"))
    .filter(Boolean);

  return [
    ...type1Antennas,
    ...type2Antennas,
  ];
}

function applySimulationSettings(antenna, settings = {}, type) {
  const base = normalizeAntennaBase(antenna);

  if (!base) {
    return null;
  }

  return {
    ...base,
    _type: type,
    azimuth: settings.azimuth ?? base.azimuth,
    enabled: settings.enabled ?? true,
    tilt: {
      ...base.tilt,
      current: settings.tilt_current ?? base.tilt.current,
    },
    tx_power: {
      ...base.tx_power,
      current: settings.tx_power_current ?? base.tx_power.current,
    },
  };
}

function simulationSettingsForAntenna(antenna) {
  return {
    azimuth: antenna.azimuth,
    enabled: antenna.enabled ?? true,
    tilt_current: antenna.tilt?.current,
    tx_power_current: antenna.tx_power?.current,
  };
}

function isAntennaEnabled(antenna) {
  return antenna?.enabled !== false;
}

function validateNetworkCoverageSimulationAntennas(
  antennas,
  activeScene,
  maxAntennas = MAX_NETWORK_COVERAGE_ANTENNAS,
) {
  if (!Array.isArray(antennas) || antennas.length === 0) {
    return "Add or check at least one antenna for Network Coverage.";
  }

  if (antennas.length > maxAntennas) {
    return `Network Coverage supports up to ${maxAntennas} active antennas. The selected scene currently has ${antennas.length}.`;
  }

  const seenIds = new Set();
  for (const antenna of antennas) {
    const base = normalizeAntennaBase(antenna);
    if (!base) {
      return `Antenna ${antenna?.id || ""} has incomplete base configuration.`;
    }

    const idKey = base.id.toLowerCase();
    if (seenIds.has(idKey)) {
      return `Antenna ID ${base.id} is duplicated.`;
    }
    seenIds.add(idKey);

    if (!lngLatInsideBounds(base, activeScene?.bounds)) {
      return `Antenna ${base.id} must stay inside the selected scene.`;
    }

    if (base.height_m <= 0) {
      return `Antenna ${base.id} height_m must be greater than 0.`;
    }

    if (base.azimuth < 0 || base.azimuth > 360) {
      return `Antenna ${base.id} azimuth must be between 0 and 360.`;
    }

    const tiltError = validateRange(base.tilt, "tilt");
    if (tiltError) {
      return `Antenna ${base.id}: ${tiltError}`;
    }

    const powerError = validateRange(base.tx_power, "tx_power");
    if (powerError) {
      return `Antenna ${base.id}: ${powerError}`;
    }
  }

  return "";
}

function validateRange(range, label) {
  if (range.min > range.max) {
    return `${label}_min must be less than or equal to ${label}_max.`;
  }

  if (range.current < range.min || range.current > range.max) {
    return `${label}_current must be between ${label}_min and ${label}_max.`;
  }

  return "";
}

function toAntennaRequest(antenna) {
  const base = normalizeAntennaBase(antenna);

  return {
    id: base.id,
    longitude: base.longitude,
    latitude: base.latitude,
    height_m: base.height_m,
    tilt: base.tilt,
    azimuth: base.azimuth,
    tx_power: base.tx_power,
  };
}

function normalizeAntennaBase(antenna) {
  const id = String(antenna?.id || "").trim();
  const longitude = Number(antenna?.longitude);
  const latitude = Number(antenna?.latitude);
  const heightM = Number(antenna?.height_m);
  const azimuth = Number(antenna?.azimuth);
  const tilt = normalizeRangeValue(antenna?.tilt);
  const txPower = normalizeRangeValue(antenna?.tx_power);

  if (
    !id
    || !Number.isFinite(longitude)
    || !Number.isFinite(latitude)
    || !Number.isFinite(heightM)
    || !Number.isFinite(azimuth)
    || !tilt
    || !txPower
  ) {
    return null;
  }

  return {
    id,
    longitude,
    latitude,
    height_m: heightM,
    azimuth,
    tilt,
    tx_power: txPower,
  };
}

function normalizeRangeValue(range) {
  const min = Number(range?.min);
  const current = Number(range?.current);
  const max = Number(range?.max);

  if (
    !Number.isFinite(min)
    || !Number.isFinite(current)
    || !Number.isFinite(max)
  ) {
    return null;
  }

  return {
    min,
    current,
    max,
  };
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

  return ROUTES.some((item) => item.path === pathname)
    || pathname === SCENE_CREATION_ROUTE
    || pathname === NETWORK_OPTIMIZATION_ROUTE
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

function readStoredSceneMap(storageKey, normalizeValue) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    return new Map(
      Object.entries(saved)
        .map(([sceneId, value]) => [sceneId, normalizeValue(value)])
        .filter(([, value]) => value !== null),
    );
  } catch {
    return new Map();
  }
}

function persistSceneMap(storageKey, sceneMap) {
  const saved = {};

  for (const [sceneId, value] of sceneMap) {
    saved[sceneId] = value;
  }

  localStorage.setItem(storageKey, JSON.stringify(saved));
}

function setSceneMapValue(sceneMap, sceneId, value, normalizeValue) {
  const normalized = normalizeValue(value);

  if (normalized === null) {
    sceneMap.delete(sceneId);
  } else {
    sceneMap.set(sceneId, normalized);
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

function normalizeStoredType2Antennas(antennas) {
  if (!Array.isArray(antennas)) {
    return null;
  }

  const normalized = antennas
    .map(normalizeAntennaBase)
    .filter(Boolean);

  return normalized.length ? normalized : null;
}

function normalizeStoredAntennaSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return null;
  }

  const normalized = {};

  for (const [antennaId, value] of Object.entries(settings)) {
    const azimuth = Number(value?.azimuth);
    const tiltCurrent = Number(value?.tilt_current);
    const txPowerCurrent = Number(value?.tx_power_current);
    const enabled = value?.enabled === undefined ? true : Boolean(value.enabled);

    if (
      !antennaId
      || !Number.isFinite(azimuth)
      || !Number.isFinite(tiltCurrent)
      || !Number.isFinite(txPowerCurrent)
    ) {
      continue;
    }

    normalized[antennaId] = {
      azimuth,
      enabled,
      tilt_current: tiltCurrent,
      tx_power_current: txPowerCurrent,
    };
  }

  return Object.keys(normalized).length ? normalized : null;
}

function normalizeStoredSinrRoles(roles) {
  if (!roles || typeof roles !== "object" || Array.isArray(roles)) {
    return null;
  }

  const normalized = {};

  for (const role of ["transmitter", "receiver", "interferer"]) {
    const antennaId = String(roles[role] || "").trim();

    if (antennaId) {
      normalized[role] = antennaId;
    }
  }

  return Object.keys(normalized).length ? normalized : null;
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

      const { position: _position, ...rest } = antenna;

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
