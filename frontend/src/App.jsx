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
  antennasForActiveScene,
  isAntennaEnabled,
  networkCoverageAntennasForScene,
  normalizeAntennaBase,
  simulationSettingsForAntenna,
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
import {
  enrichScene,
  normalizeStoredAntennaSettings,
  normalizeStoredSinrRoles,
  normalizeStoredType2Antennas,
  readStoredSceneMap,
  removeStoredSceneMapValue,
  saveSceneFixedAntennas,
  updateStoredSceneMap,
} from "./utils/sceneStorage";
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
  lngLatBoundsError,
  solverForScene,
} from "./utils/scene";

const HISTORY_PAGE_LIMIT = 200;
const JOB_PAGE_LIMIT = 200;
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
      return updateStoredSceneMap(
        NETWORK_ANTENNA_SETTINGS_STORAGE_KEY,
        current,
        activeScene.id,
        (storedSettings) => {
          const sceneSettings = { ...(storedSettings || {}) };
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
          return sceneSettings;
        },
        normalizeStoredAntennaSettings,
      );
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
      return updateStoredSceneMap(
        NETWORK_TYPE2_ANTENNAS_STORAGE_KEY,
        current,
        activeScene.id,
        (sceneAntennas) => [...(sceneAntennas || []), normalized],
        normalizeStoredType2Antennas,
      );
    });
    setNetworkAntennaSettingsByScene((current) => {
      return updateStoredSceneMap(
        NETWORK_ANTENNA_SETTINGS_STORAGE_KEY,
        current,
        activeScene.id,
        (sceneSettings) => ({
          ...(sceneSettings || {}),
          [normalized.id]: simulationSettingsForAntenna(normalized),
        }),
        normalizeStoredAntennaSettings,
      );
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
      return updateStoredSceneMap(
        NETWORK_TYPE2_ANTENNAS_STORAGE_KEY,
        current,
        activeScene.id,
        (sceneAntennas) => (sceneAntennas || []).filter((item) => item.id !== antennaId),
        normalizeStoredType2Antennas,
      );
    });
    setNetworkAntennaSettingsByScene((current) => {
      return updateStoredSceneMap(
        NETWORK_ANTENNA_SETTINGS_STORAGE_KEY,
        current,
        activeScene.id,
        (storedSettings) => {
          const sceneSettings = { ...(storedSettings || {}) };
          delete sceneSettings[antennaId];
          return sceneSettings;
        },
        normalizeStoredAntennaSettings,
      );
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
      return updateStoredSceneMap(
        RSRP_ANTENNA_SETTINGS_STORAGE_KEY,
        current,
        activeScene.id,
        (storedSettings) => {
          const sceneSettings = { ...(storedSettings || {}) };
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
          return sceneSettings;
        },
        normalizeStoredAntennaSettings,
      );
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
      return updateStoredSceneMap(
        RSRP_TYPE2_ANTENNAS_STORAGE_KEY,
        current,
        activeScene.id,
        (sceneAntennas) => [...(sceneAntennas || []), normalized],
        normalizeStoredType2Antennas,
      );
    });
    setRsrpAntennaSettingsByScene((current) => {
      return updateStoredSceneMap(
        RSRP_ANTENNA_SETTINGS_STORAGE_KEY,
        current,
        activeScene.id,
        (sceneSettings) => ({
          ...(sceneSettings || {}),
          [normalized.id]: simulationSettingsForAntenna(normalized),
        }),
        normalizeStoredAntennaSettings,
      );
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
      return updateStoredSceneMap(
        RSRP_TYPE2_ANTENNAS_STORAGE_KEY,
        current,
        activeScene.id,
        (sceneAntennas) => (sceneAntennas || []).filter((item) => item.id !== antennaId),
        normalizeStoredType2Antennas,
      );
    });
    setRsrpAntennaSettingsByScene((current) => {
      return updateStoredSceneMap(
        RSRP_ANTENNA_SETTINGS_STORAGE_KEY,
        current,
        activeScene.id,
        (storedSettings) => {
          const sceneSettings = { ...(storedSettings || {}) };
          delete sceneSettings[antennaId];
          return sceneSettings;
        },
        normalizeStoredAntennaSettings,
      );
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
      return updateStoredSceneMap(
        SINR_ANTENNA_SETTINGS_STORAGE_KEY,
        current,
        activeScene.id,
        (storedSettings) => {
          const sceneSettings = { ...(storedSettings || {}) };
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
          return sceneSettings;
        },
        normalizeStoredAntennaSettings,
      );
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
      return updateStoredSceneMap(
        SINR_TYPE2_ANTENNAS_STORAGE_KEY,
        current,
        activeScene.id,
        (sceneAntennas) => [...(sceneAntennas || []), normalized],
        normalizeStoredType2Antennas,
      );
    });
    setSinrAntennaSettingsByScene((current) => {
      return updateStoredSceneMap(
        SINR_ANTENNA_SETTINGS_STORAGE_KEY,
        current,
        activeScene.id,
        (sceneSettings) => ({
          ...(sceneSettings || {}),
          [normalized.id]: simulationSettingsForAntenna(normalized),
        }),
        normalizeStoredAntennaSettings,
      );
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
      return updateStoredSceneMap(
        SINR_TYPE2_ANTENNAS_STORAGE_KEY,
        current,
        activeScene.id,
        (sceneAntennas) => (sceneAntennas || []).filter((item) => item.id !== antennaId),
        normalizeStoredType2Antennas,
      );
    });
    setSinrAntennaSettingsByScene((current) => {
      return updateStoredSceneMap(
        SINR_ANTENNA_SETTINGS_STORAGE_KEY,
        current,
        activeScene.id,
        (storedSettings) => {
          const sceneSettings = { ...(storedSettings || {}) };
          delete sceneSettings[antennaId];
          return sceneSettings;
        },
        normalizeStoredAntennaSettings,
      );
    });
    setSinrRoleSelectionsByScene((current) => {
      return updateStoredSceneMap(
        SINR_ROLE_SELECTION_STORAGE_KEY,
        current,
        activeScene.id,
        (storedRoles) => {
          const roles = { ...(storedRoles || {}) };

          for (const [role, selectedId] of Object.entries(roles)) {
            if (selectedId === antennaId) {
              roles[role] = "";
            }
          }

          return roles;
        },
        normalizeStoredSinrRoles,
      );
    });
  }

  function updateSinrRoleSelection(nextRoles) {
    if (!activeScene?.id) {
      return;
    }

    setSinrRoleSelectionsByScene((current) => {
      return updateStoredSceneMap(
        SINR_ROLE_SELECTION_STORAGE_KEY,
        current,
        activeScene.id,
        nextRoles,
        normalizeStoredSinrRoles,
      );
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
      return updateStoredSceneMap(
        THROUGHPUT_ANTENNA_SETTINGS_STORAGE_KEY,
        current,
        activeScene.id,
        (storedSettings) => {
          const sceneSettings = { ...(storedSettings || {}) };
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
          return sceneSettings;
        },
        normalizeStoredAntennaSettings,
      );
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
      return updateStoredSceneMap(
        THROUGHPUT_TYPE2_ANTENNAS_STORAGE_KEY,
        current,
        activeScene.id,
        (sceneAntennas) => [...(sceneAntennas || []), normalized],
        normalizeStoredType2Antennas,
      );
    });
    setThroughputAntennaSettingsByScene((current) => {
      return updateStoredSceneMap(
        THROUGHPUT_ANTENNA_SETTINGS_STORAGE_KEY,
        current,
        activeScene.id,
        (sceneSettings) => ({
          ...(sceneSettings || {}),
          [normalized.id]: simulationSettingsForAntenna(normalized),
        }),
        normalizeStoredAntennaSettings,
      );
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
      return updateStoredSceneMap(
        THROUGHPUT_TYPE2_ANTENNAS_STORAGE_KEY,
        current,
        activeScene.id,
        (sceneAntennas) => (sceneAntennas || []).filter((item) => item.id !== antennaId),
        normalizeStoredType2Antennas,
      );
    });
    setThroughputAntennaSettingsByScene((current) => {
      return updateStoredSceneMap(
        THROUGHPUT_ANTENNA_SETTINGS_STORAGE_KEY,
        current,
        activeScene.id,
        (storedSettings) => {
          const sceneSettings = { ...(storedSettings || {}) };
          delete sceneSettings[antennaId];
          return sceneSettings;
        },
        normalizeStoredAntennaSettings,
      );
    });
    setThroughputRoleSelectionsByScene((current) => {
      return updateStoredSceneMap(
        THROUGHPUT_ROLE_SELECTION_STORAGE_KEY,
        current,
        activeScene.id,
        (storedRoles) => {
          const roles = { ...(storedRoles || {}) };

          for (const [role, selectedId] of Object.entries(roles)) {
            if (selectedId === antennaId) {
              roles[role] = "";
            }
          }

          return roles;
        },
        normalizeStoredSinrRoles,
      );
    });
  }

  function updateThroughputRoleSelection(nextRoles) {
    if (!activeScene?.id) {
      return;
    }

    setThroughputRoleSelectionsByScene((current) => {
      return updateStoredSceneMap(
        THROUGHPUT_ROLE_SELECTION_STORAGE_KEY,
        current,
        activeScene.id,
        nextRoles,
        normalizeStoredSinrRoles,
      );
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
      return removeStoredSceneMapValue(NETWORK_TYPE2_ANTENNAS_STORAGE_KEY, current, sceneId);
    });
    setNetworkAntennaSettingsByScene((current) => {
      return removeStoredSceneMapValue(NETWORK_ANTENNA_SETTINGS_STORAGE_KEY, current, sceneId);
    });
  }

  function clearRsrpDraft(sceneId) {
    if (!sceneId) {
      return;
    }

    setRsrpType2AntennasByScene((current) => {
      return removeStoredSceneMapValue(RSRP_TYPE2_ANTENNAS_STORAGE_KEY, current, sceneId);
    });
    setRsrpAntennaSettingsByScene((current) => {
      return removeStoredSceneMapValue(RSRP_ANTENNA_SETTINGS_STORAGE_KEY, current, sceneId);
    });
  }

  function clearSinrDraft(sceneId) {
    if (!sceneId) {
      return;
    }

    setSinrType2AntennasByScene((current) => {
      return removeStoredSceneMapValue(SINR_TYPE2_ANTENNAS_STORAGE_KEY, current, sceneId);
    });
    setSinrAntennaSettingsByScene((current) => {
      return removeStoredSceneMapValue(SINR_ANTENNA_SETTINGS_STORAGE_KEY, current, sceneId);
    });
    setSinrRoleSelectionsByScene((current) => {
      return removeStoredSceneMapValue(SINR_ROLE_SELECTION_STORAGE_KEY, current, sceneId);
    });
  }

  function clearThroughputDraft(sceneId) {
    if (!sceneId) {
      return;
    }

    setThroughputType2AntennasByScene((current) => {
      return removeStoredSceneMapValue(THROUGHPUT_TYPE2_ANTENNAS_STORAGE_KEY, current, sceneId);
    });
    setThroughputAntennaSettingsByScene((current) => {
      return removeStoredSceneMapValue(THROUGHPUT_ANTENNA_SETTINGS_STORAGE_KEY, current, sceneId);
    });
    setThroughputRoleSelectionsByScene((current) => {
      return removeStoredSceneMapValue(THROUGHPUT_ROLE_SELECTION_STORAGE_KEY, current, sceneId);
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
