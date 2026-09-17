import {
  NETWORK_OPTIMIZATION_ROUTE,
  SCENE_CREATION_ROUTE,
  SCENE_SELECTION_ROUTE,
  SIMULATION_ENTRY_ROUTE,
} from "../utils/routes";
import { buildNetworkCoveragePayload } from "../utils/jobAdapters";
import {
  CoverageApiPage,
  RsrpSimulationPage,
  SinrApiPage,
  ThroughputApiPage,
} from "./ApiPages";
import AntennasPage from "./AntennasPage";
import HistoryRoutePage from "./HistoryRoutePage";
import NetworkCoveragePage from "./NetworkCoveragePage";
import OptimizationObjectivePage from "./OptimizationObjectivePage";
import QueueRoutePage from "./QueueRoutePage";
import SceneChooserPage from "./SceneChooserModal";
import ScenesPage from "./ScenesPage";

export default function AppRouteContent({
  apiPages,
  history,
  network,
  queue,
  route,
  sceneManagement,
  workspace,
}) {
  const {
    activeScene,
    createInventoryAntenna,
    fixedSceneAntennas,
    navigate,
    setIsSceneLoading,
    showQueuedPrompt,
  } = workspace;

  return (
    <>
      {route === "/network" && (
        <NetworkCoveragePage
          activeScene={activeScene}
          antennaPool={fixedSceneAntennas}
          antennas={network.antennas}
          bandwidthMhz={network.bandwidthMhz}
          displayAntennas={network.activeAntennas}
          canvasRef={network.canvasRef}
          coverageImageUrl={network.coverageImageUrl}
          hover={network.hover}
          isSceneLoading={network.isSceneLoading}
          isRunning={network.isRunning}
          latestGrid={network.latestGrid}
          latestSolver={network.latestSolver}
          mapStageRef={network.mapStageRef}
          mimoLayers={network.mimoLayers}
          onHover={network.onHover}
          onHoverEnd={network.onHoverEnd}
          onResetAntennas={network.onResetAntennas}
          onRun={network.onRun}
          onOptimize={() => navigate(NETWORK_OPTIMIZATION_ROUTE)}
          onSceneLoadingChange={setIsSceneLoading}
          onAddType2Antenna={network.onAddType2Antenna}
          onCreateAntenna={createInventoryAntenna}
          onRemoveType2Antenna={network.onRemoveType2Antenna}
          onUpdateAntenna={network.onUpdateAntenna}
          maxAntennas={network.maxAntennas}
          runError={network.runError}
          runStatus={network.runStatus}
          solver={network.solver}
          onSolverChange={network.onSolverChange}
          onBandwidthChange={network.setBandwidthMhz}
          onMimoLayersChange={network.setMimoLayers}
          summary={network.summary}
        />
      )}
      {route === NETWORK_OPTIMIZATION_ROUTE && activeScene && (
        <OptimizationObjectivePage
          key={activeScene.id}
          activeScene={activeScene}
          baseRequest={buildNetworkCoveragePayload(
            network.activeAntennas,
            activeScene,
            undefined,
            network.bandwidthMhz,
            network.mimoLayers,
          )}
          storageKey={network.optimizationStorageKey}
          onBack={() => navigate(SIMULATION_ENTRY_ROUTE)}
          onApply={network.onApplyOptimization}
        />
      )}
      {route === "/coverage" && (
        <CoverageApiPage
          key={activeScene?.id}
          activeScene={activeScene}
          antennas={fixedSceneAntennas}
          onQueueOpen={() => navigate("/queue")}
          onSimulationQueued={showQueuedPrompt}
          onCreateAntenna={createInventoryAntenna}
          onProgressChange={apiPages.onProgressChange}
          onSceneLoadingChange={setIsSceneLoading}
        />
      )}
      {route === "/rsrp" && (
        <RsrpSimulationPage
          activeScene={activeScene}
          antennaPool={fixedSceneAntennas}
          antennas={apiPages.rsrp.antennas}
          simulationAntennas={apiPages.rsrp.activeAntennas}
          maxAntennas={apiPages.rsrp.maxAntennas}
          onAddType2Antenna={apiPages.rsrp.onAddType2Antenna}
          onCreateAntenna={createInventoryAntenna}
          onQueueOpen={() => navigate("/queue")}
          onRemoveType2Antenna={apiPages.rsrp.onRemoveType2Antenna}
          onResetAntennas={apiPages.rsrp.onResetAntennas}
          onSimulationQueued={showQueuedPrompt}
          onUpdateAntenna={apiPages.rsrp.onUpdateAntenna}
          onProgressChange={apiPages.onProgressChange}
          onSceneLoadingChange={setIsSceneLoading}
        />
      )}
      {route === "/sinr" && (
        <SinrApiPage
          activeScene={activeScene}
          antennaPool={fixedSceneAntennas}
          antennas={apiPages.sinr.antennas}
          onAddType2Antenna={apiPages.sinr.onAddType2Antenna}
          onCreateAntenna={createInventoryAntenna}
          onQueueOpen={() => navigate("/queue")}
          onRemoveType2Antenna={apiPages.sinr.onRemoveType2Antenna}
          onResetAntennas={apiPages.sinr.onResetAntennas}
          onRoleSelectionChange={apiPages.sinr.onRoleSelectionChange}
          onSimulationQueued={showQueuedPrompt}
          onUpdateAntenna={apiPages.sinr.onUpdateAntenna}
          onProgressChange={apiPages.onProgressChange}
          onSceneLoadingChange={setIsSceneLoading}
          roleSelection={apiPages.sinr.roleSelection}
        />
      )}
      {route === "/throughput" && (
        <ThroughputApiPage
          activeScene={activeScene}
          antennaPool={fixedSceneAntennas}
          antennas={apiPages.throughput.antennas}
          onAddType2Antenna={apiPages.throughput.onAddType2Antenna}
          onCreateAntenna={createInventoryAntenna}
          onQueueOpen={() => navigate("/queue")}
          onRemoveType2Antenna={apiPages.throughput.onRemoveType2Antenna}
          onResetAntennas={apiPages.throughput.onResetAntennas}
          onRoleSelectionChange={apiPages.throughput.onRoleSelectionChange}
          onSimulationQueued={showQueuedPrompt}
          onUpdateAntenna={apiPages.throughput.onUpdateAntenna}
          onProgressChange={apiPages.onProgressChange}
          onSceneLoadingChange={setIsSceneLoading}
          roleSelection={apiPages.throughput.roleSelection}
        />
      )}
      {route === "/queue" && (
        <QueueRoutePage
          jobError={queue.error}
          jobs={queue.jobs}
          jobStatus={queue.status}
          isLoading={queue.isLoading}
          onDiscard={queue.onDiscard}
          cancellingJobIds={queue.cancellingJobIds}
          onCancel={queue.onCancel}
          onDeleteSelected={queue.onDeleteSelected}
          onOpen={queue.onOpen}
          onOpenHistory={queue.onOpenHistory}
          onRefresh={queue.onRefresh}
          onSave={queue.onSave}
          onToggleDeleteSelection={queue.onToggleDeleteSelection}
          onToggleSelectAll={queue.onToggleSelectAll}
          selectedDeleteIds={queue.selectedDeleteIds}
          selectedJobId={queue.selectedJobId}
        />
      )}
      {route === "/history" && (
        <HistoryRoutePage
          activeScene={activeScene}
          comparisonType={history.comparisonType}
          historyError={history.error}
          historyStatus={history.status}
          isLoading={history.isLoading}
          items={history.items}
          onCancelComparison={history.onCancelComparison}
          onDelete={history.onDelete}
          onDeleteSelected={history.onDeleteSelected}
          onOpen={history.onOpen}
          onRefresh={history.onRefresh}
          onShowComparison={history.onShowComparison}
          onToggleCompare={history.onToggleCompare}
          onToggleDeleteSelection={history.onToggleDeleteSelection}
          onToggleSelectAll={history.onToggleSelectAll}
          selectedComparisonIds={history.selectedComparisonIds}
          selectedDeleteIds={history.selectedDeleteIds}
          selectedHistoryId={history.selectedHistoryId}
          comparisonSceneId={history.comparisonSceneId}
          comparisonSceneName={history.comparisonSceneName}
        />
      )}
      {route === SCENE_SELECTION_ROUTE && (
        <ScenesPage
          activeSceneId={sceneManagement.activeSceneId}
          isLoading={sceneManagement.isLoading}
          notice={sceneManagement.notice}
          onCreateScene={sceneManagement.onCreateScene}
          onRefresh={sceneManagement.onRefresh}
          onSceneActivated={sceneManagement.onSceneActivated}
          onSetNotice={sceneManagement.onSetNotice}
          scenes={sceneManagement.scenes}
        />
      )}
      {route === "/antennas" && (
        <AntennasPage onInventoryChange={sceneManagement.onInventoryChange} />
      )}
      {route === SCENE_CREATION_ROUTE && (
        <SceneChooserPage
          onCancel={() => navigate(SCENE_SELECTION_ROUTE)}
          onLimitReached={sceneManagement.onLimitReached}
          onSceneActivated={sceneManagement.onSceneActivated}
        />
      )}
    </>
  );
}
