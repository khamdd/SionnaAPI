import AntennaPanel from "./AntennaPanel";
import MapPanel from "./MapPanel";

export default function NetworkCoveragePage({
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
