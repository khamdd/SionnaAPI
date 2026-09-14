import SimulationAntennaPanel from "./SimulationAntennaPanel";
import MapPanel from "./MapPanel";

export default function NetworkCoveragePage({
  activeScene,
  antennaPool,
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
  onSolverChange,
  onUpdateAntenna,
  runError,
  runStatus,
  solver,
  summary,
}) {
  return (
    <main className="app-shell network-page">
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
        onSolverChange={onSolverChange}
        runError={runError}
        runStatus={runStatus}
        solver={solver}
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
        <SimulationAntennaPanel
          activeScene={activeScene}
          antennaPool={antennaPool}
          antennas={antennas}
          disabled={isRunning || isSceneLoading}
          maxAntennas={maxAntennas}
          onAdd={onAddType2Antenna}
          onChange={onUpdateAntenna}
          onRemove={onRemoveType2Antenna}
          showEnabledToggle
        />
      </aside>
    </main>
  );
}
