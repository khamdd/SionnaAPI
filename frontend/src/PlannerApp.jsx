import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteSimulationJob,
  getSimulationJob,
  getSimulationJobResult,
  saveSimulationJobResult,
} from "./api";
import {
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
} from "./constants";
import { MAX_NETWORK_COVERAGE_ANTENNAS } from "./utils/antennas";
import {
  SCENE_CREATION_ROUTE,
  SCENE_SELECTION_ROUTE,
  SIMULATION_ENTRY_ROUTE,
  isWorkSceneRequiredRoute,
  shouldRedirectToSceneSelection,
} from "./utils/routes";
import useSceneAntennaDraft from "./hooks/useSceneAntennaDraft";
import useAntennaInventory from "./hooks/useAntennaInventory";
import useAppModal from "./hooks/useAppModal";
import useSimulationHistory from "./hooks/useSimulationHistory";
import useSimulationQueue from "./hooks/useSimulationQueue";
import useSceneWorkspace from "./hooks/useSceneWorkspace";
import useNetworkCoverage from "./hooks/useNetworkCoverage";
import usePlannerNavigation from "./hooks/usePlannerNavigation";
import AppOverlays from "./components/AppOverlays";
import AppRouteContent from "./components/AppRouteContent";
import GlobalProgress from "./components/GlobalProgress";
import JobResultDetail from "./components/JobResultDetail";
import Navbar from "./components/Navbar";
import { formatSimulationType } from "./utils/format";
import { lngLatInsideBounds } from "./utils/scene";

const MAX_RSRP_SIMULATION_ANTENNAS = 10;

export default function PlannerApp({ currentUser, isNewSession, onLogout }) {
  const appModal = useAppModal();
  const sceneWorkspace = useSceneWorkspace();
  const {
    content: modalContent,
    handlePreviewLoadingChange,
    previewLoadCount: historyPreviewLoadCount,
    setContent: setModalContent,
  } = appModal;
  const {
    activeScene,
    hasWorkScene,
    isListLoading: isSceneListLoading,
    isSceneLoading,
    load: loadScenes,
    notice: sceneNotice,
    scenes,
    setIsSceneLoading,
    setNotice: setSceneNotice,
  } = sceneWorkspace;
  const {
    antennas: antennaInventory,
    createInventoryAntenna,
    setAntennas: setAntennaInventory,
  } = useAntennaInventory(currentUser);
  const { navigate, route } = usePlannerNavigation({
    hasWorkScene,
    setSceneNotice,
  });
  const queue = useSimulationQueue({
    enabled: true,
    route,
  });
  const {
    error: jobError,
    jobs: simulationJobs,
    load: loadJobs,
    progressLabel: jobProgressLabel,
    selectedDeleteIds: selectedJobDeleteIds,
    selectedJobId,
    setError: setJobError,
    setProgressLabel: setJobProgressLabel,
    setSelectedJobId,
    setStatus: setJobStatus,
    status: jobStatus,
    toggleAllDeleteSelection: toggleAllJobDeleteSelection,
    toggleDeleteSelection: toggleJobDeleteSelection,
  } = queue;
  const [queuedPrompt, setQueuedPrompt] = useState(null);
  const [apiProgressLabel, setApiProgressLabel] = useState("");
  const history = useSimulationHistory({ activeScene, modal: appModal });
  const {
    cancelComparison,
    comparisonSceneId,
    comparisonSceneName,
    comparisonType,
    deleteSelected: deleteSelectedHistory,
    error: historyError,
    items: latestHistory,
    load: loadHistory,
    open: openHistoryDetail,
    progressLabel: historyProgressLabel,
    remove: deleteHistoryItem,
    selectedComparisonIds,
    selectedDeleteIds: selectedHistoryDeleteIds,
    selectedHistoryId,
    showComparison: showComparisonResult,
    status: historyStatus,
    toggleAllDeleteSelection: toggleAllHistoryDeleteSelection,
    toggleComparison: toggleComparisonSelection,
    toggleDeleteSelection: toggleHistoryDeleteSelection,
  } = history;

  const pendingEntryNavigationRef = useRef(isNewSession);
  const fixedSceneAntennas = useMemo(
    () =>
      antennaInventory.filter(
        (antenna) =>
          antenna.status === "active" &&
          lngLatInsideBounds(antenna, activeScene?.bounds),
      ),
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
  const network = useNetworkCoverage({
    activeAntennas: activeNetworkAntennas,
    activeScene,
    draft: networkDraft,
    isSceneListLoading,
    isSceneLoading,
    loadJobs,
    onJobQueued: showQueuedPrompt,
    route,
  });
  const {
    addType2Antenna,
    applyOptimization: applyOptimizationSettings,
    canvasRef,
    coverageImageUrl,
    handleHover,
    hover,
    isRunning,
    latestGrid,
    latestSolver,
    mapStageRef,
    removeType2Antenna,
    resetAntennas,
    run: runSimulation,
    runError,
    runStatus,
    setHover,
    setSolverDraft: setNetworkSolverDraft,
    solver: networkSolver,
    summary,
    updateAntenna,
  } = network;
  const rsrpAntennas = rsrpDraft.antennas;
  const activeRsrpAntennas = rsrpDraft.activeAntennas;
  const sinrAntennas = sinrDraft.antennas;
  const sinrRoleSelection = sinrDraft.roleSelection;
  const throughputAntennas = throughputDraft.antennas;
  const throughputRoleSelection = throughputDraft.roleSelection;

  function logout() {
    sceneWorkspace.clear();
    onLogout();
  }

  const handleApiProgressChange = useCallback((active, label) => {
    setApiProgressLabel(active ? label : "");
  }, []);

  const handleHistoryPreviewLoadingChange = handlePreviewLoadingChange;

  useEffect(() => {
    if (
      shouldRedirectToSceneSelection({
        hasWorkScene,
        isSceneListLoading,
        pathname: route,
      })
    ) {
      setSceneNotice(
        "Select or create a work scene before opening simulations.",
        true,
      );
      navigate(SCENE_SELECTION_ROUTE, { replace: true });
      return;
    }

    if (route === "/history") {
      loadHistory();
    }

    if (route === "/queue") {
      loadJobs();
    }
  }, [
    hasWorkScene,
    isSceneListLoading,
    route,
    loadHistory,
    loadJobs,
    navigate,
    setSceneNotice,
  ]);

  useEffect(() => {
    loadScenes({ syncActiveScene: true })
      .then((result) => {
        if (!pendingEntryNavigationRef.current) {
          return;
        }
        pendingEntryNavigationRef.current = false;
        navigate(
          result.active_scene ? SIMULATION_ENTRY_ROUTE : SCENE_SELECTION_ROUTE,
          { allowWithoutWorkScene: true, replace: true },
        );
      })
      .catch((error) => {
        pendingEntryNavigationRef.current = false;
        setSceneNotice(`Failed to load scenes: ${error.message}`, true);
      });
  }, [loadScenes, navigate, setSceneNotice]);

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

  async function chooseScene() {
    if (
      isRunning ||
      apiProgressLabel ||
      jobProgressLabel ||
      historyProgressLabel ||
      historyPreviewLoadCount > 0 ||
      isSceneLoading ||
      isSceneListLoading
    ) {
      return;
    }

    try {
      const result = await loadScenes();
      const importedCount = result.imported_scene_count || 0;
      const maxScenes = result.max_imported_scenes || 3;

      if (importedCount >= maxScenes) {
        setSceneNotice(
          `Only ${maxScenes} imported scenes are allowed. Delete one before choosing a new scene.`,
          true,
        );
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
    const confirmed = window.confirm(
      "Change scene? The current work scene will be cleared and simulations will be unavailable until you select another scene.",
    );

    if (!confirmed) {
      return;
    }

    networkDraft.clear(activeScene?.id);
    rsrpDraft.clear(activeScene?.id);
    sinrDraft.clear(activeScene?.id);
    throughputDraft.clear(activeScene?.id);
    sceneWorkspace.clear();
    cancelComparison();
    setSceneNotice(
      "No work scene is active. Select or create a scene to continue.",
    );
    navigate(SCENE_SELECTION_ROUTE, { allowWithoutWorkScene: true });
  }

  function handleSceneActivated(scene) {
    sceneWorkspace.activate(scene);
    loadScenes({ syncActiveScene: true }).catch(() => {});
    navigate(SIMULATION_ENTRY_ROUTE, { allowWithoutWorkScene: true });
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
        setModalContent(
          <p className="history-status">Database is not configured.</p>,
        );
        return;
      }

      if (jobResponse.error) {
        throw new Error(jobResponse.error);
      }

      const job = jobResponse.item;
      if (!job) {
        setModalContent(
          <p className="history-status">Simulation job not found.</p>,
        );
        return;
      }

      const fullResult =
        job.status === "succeeded"
          ? await getSimulationJobResult(jobId)
          : job.result;

      setModalContent(
        <HistoryModalBody
          title={`Queue result: ${formatSimulationType(job.simulation_type)}`}
        >
          <JobResultDetail
            job={job}
            result={fullResult}
            onDiscard={() => discardSimulationJob(job)}
            onOpenHistory={
              job.result_run_id
                ? () => openHistoryDetail(job.result_run_id)
                : null
            }
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
      setModalContent(
        <p className="history-status error-text">
          Job detail failed: {error.message}
        </p>,
      );
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

      setJobStatus(
        result.already_saved
          ? "Result is already saved in Simulation History."
          : "Result saved in Simulation History.",
      );
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
      setJobStatus(
        job.result_run_id
          ? "Queue entry removed."
          : "Simulation result discarded.",
      );
    } catch (error) {
      setJobStatus(`Discard failed: ${error.message}`);
      setJobError(true);
    } finally {
      setJobProgressLabel("");
    }
  }

  async function deleteSelectedJobs() {
    const result = await queue.deleteSelected();
    if (result && selectedJobId && result.deletedIds.has(selectedJobId)) {
      closeModal();
    }
  }

  function closeModal() {
    appModal.close();
    history.closeSelection();
    setSelectedJobId(null);
  }

  const modalProgressLabel = modalContent
    ? jobProgressLabel ||
      historyProgressLabel ||
      (historyPreviewLoadCount > 0 ? "Loading history preview..." : "")
    : "";

  const busyLabel = isRunning
    ? "Running simulation..."
    : apiProgressLabel ||
      jobProgressLabel ||
      (!modalContent ? historyProgressLabel : "") ||
      (!modalContent && historyPreviewLoadCount > 0
        ? "Loading history preview..."
        : "") ||
      (isSceneLoading ? "Loading scene..." : "") ||
      (isSceneListLoading ? "Loading scenes..." : "");
  const visibleRoute =
    !hasWorkScene && isWorkSceneRequiredRoute(route)
      ? SCENE_SELECTION_ROUTE
      : route;

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
      <AppRouteContent
        apiPages={{
          onProgressChange: handleApiProgressChange,
          rsrp: {
            activeAntennas: activeRsrpAntennas,
            antennas: rsrpAntennas,
            maxAntennas: MAX_RSRP_SIMULATION_ANTENNAS,
            onAddType2Antenna: addRsrpType2Antenna,
            onRemoveType2Antenna: removeRsrpType2Antenna,
            onResetAntennas: resetRsrpAntennas,
            onUpdateAntenna: updateRsrpAntenna,
          },
          sinr: {
            antennas: sinrAntennas,
            onAddType2Antenna: addSinrType2Antenna,
            onRemoveType2Antenna: removeSinrType2Antenna,
            onResetAntennas: resetSinrAntennas,
            onRoleSelectionChange: updateSinrRoleSelection,
            onUpdateAntenna: updateSinrAntenna,
            roleSelection: sinrRoleSelection,
          },
          throughput: {
            antennas: throughputAntennas,
            onAddType2Antenna: addThroughputType2Antenna,
            onRemoveType2Antenna: removeThroughputType2Antenna,
            onResetAntennas: resetThroughputAntennas,
            onRoleSelectionChange: updateThroughputRoleSelection,
            onUpdateAntenna: updateThroughputAntenna,
            roleSelection: throughputRoleSelection,
          },
        }}
        history={{
          comparisonSceneId,
          comparisonSceneName,
          comparisonType,
          error: historyError,
          isLoading: Boolean(historyProgressLabel) || historyPreviewLoadCount > 0,
          items: latestHistory,
          onCancelComparison: cancelComparison,
          onDelete: deleteHistoryItem,
          onDeleteSelected: deleteSelectedHistory,
          onOpen: openHistoryDetail,
          onRefresh: loadHistory,
          onShowComparison: showComparisonResult,
          onToggleCompare: toggleComparisonSelection,
          onToggleDeleteSelection: toggleHistoryDeleteSelection,
          onToggleSelectAll: toggleAllHistoryDeleteSelection,
          selectedComparisonIds,
          selectedDeleteIds: selectedHistoryDeleteIds,
          selectedHistoryId,
          status: historyStatus,
        }}
        network={{
          activeAntennas: activeNetworkAntennas,
          antennas,
          canvasRef,
          coverageImageUrl,
          hover,
          isRunning,
          isSceneLoading: isSceneLoading || isSceneListLoading || !activeScene,
          latestGrid,
          latestSolver,
          mapStageRef,
          maxAntennas: MAX_NETWORK_COVERAGE_ANTENNAS,
          onAddType2Antenna: addType2Antenna,
          onApplyOptimization: applyOptimizationSettings,
          onHover: handleHover,
          onHoverEnd: () => setHover(null),
          onRemoveType2Antenna: removeType2Antenna,
          onResetAntennas: resetAntennas,
          onRun: runSimulation,
          onSolverChange: setNetworkSolverDraft,
          onUpdateAntenna: updateAntenna,
          optimizationStorageKey: NETWORK_OPTIMIZATION_OBJECTIVES_STORAGE_KEY,
          runError,
          runStatus,
          solver: networkSolver,
          summary,
        }}
        queue={{
          error: jobError,
          isLoading: Boolean(jobProgressLabel),
          jobs: simulationJobs,
          onDeleteSelected: deleteSelectedJobs,
          onDiscard: discardSimulationJob,
          onOpen: openJobDetail,
          onOpenHistory: openHistoryDetail,
          onRefresh: loadJobs,
          onSave: saveSimulationJob,
          onToggleDeleteSelection: toggleJobDeleteSelection,
          onToggleSelectAll: toggleAllJobDeleteSelection,
          selectedDeleteIds: selectedJobDeleteIds,
          selectedJobId,
          status: jobStatus,
        }}
        route={visibleRoute}
        sceneManagement={{
          activeSceneId: hasWorkScene ? activeScene?.id : null,
          isLoading: isSceneListLoading || isSceneLoading,
          notice: sceneNotice,
          onCreateScene: chooseScene,
          onInventoryChange: setAntennaInventory,
          onLimitReached: (message) => {
            setSceneNotice(message, true);
            navigate(SCENE_SELECTION_ROUTE);
          },
          onRefresh: loadScenes,
          onSceneActivated: handleSceneActivated,
          onSetNotice: setSceneNotice,
          scenes,
        }}
        workspace={{
          activeScene,
          createInventoryAntenna,
          fixedSceneAntennas,
          navigate,
          setIsSceneLoading,
          showQueuedPrompt,
        }}
      />

      <AppOverlays
        modal={{ content: modalContent, progressLabel: modalProgressLabel }}
        onCloseModal={closeModal}
        onCloseQueuedPrompt={closeQueuedPrompt}
        onOpenQueue={openQueueFromPrompt}
        queuedPrompt={queuedPrompt}
      />
    </div>
  );
}

