import { useEffect, useState } from "react";
import {
  formatMaybeNumber,
  formatNeighborDelta,
  formatPosition,
  formatText,
} from "../utils/format";
import {
  worldToPercentX,
  worldToPercentY,
} from "../utils/map";
import {
  CoverageColorLegend,
  CoverageMapControls,
} from "./CoverageMapPresentation";
import Scene3DPreview from "./Scene3DPreview";

export default function MapPanel({
  activeScene,
  antennas,
  coverageImageUrl,
  canvasRef,
  hover,
  isBusy = false,
  isRunning,
  latestGrid,
  latestSolver,
  mapStageRef,
  onHover,
  onHoverEnd,
  onOptimize,
  onRun,
  onSceneLoadingChange,
  runError,
  runStatus,
  summary,
}) {
  const showScene3D = Boolean(activeScene?.bounds);
  const sceneTitle = activeScene?.name || "Loading scene";
  const [selectedCoverageCell, setSelectedCoverageCell] = useState(null);
  const [coverageDisplayMode, setCoverageDisplayMode] = useState("quality");

  useEffect(() => {
    setSelectedCoverageCell(null);
  }, [activeScene?.id, latestGrid]);

  return (
    <section className="map-panel" aria-label="Coverage map">
      <div className="topbar">
        <div>
          <h1>{sceneTitle} Coverage Planner</h1>
          <p id="run-status" className={runError ? "error-text" : ""}>{runStatus}</p>
        </div>
        <div className="topbar-actions">
          <button
            className="ghost-button"
            type="button"
            disabled={isBusy}
            onClick={onOptimize}
          >
            Optimize tilts
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={isBusy}
            onClick={onRun}
          >
            {isRunning ? "Running..." : isBusy ? "Loading..." : "Run simulation"}
          </button>
        </div>
      </div>

      <div ref={mapStageRef} className="map-stage">
        {activeScene?.bounds ? (
          <Scene3DPreview
            antennas={antennas}
            bounds={activeScene.bounds}
            className="network-scene-3d"
            coverageDisplayMode={coverageDisplayMode}
            coverageGrid={latestGrid}
            onCoverageCellSelect={setSelectedCoverageCell}
            onLoadingChange={onSceneLoadingChange}
            sceneName={activeScene.name}
            selectedCoverageCell={selectedCoverageCell}
            showOverlay={false}
            solver={latestSolver}
            viewMode="top"
          />
        ) : coverageImageUrl ? (
          <img id="coverage-image" src={coverageImageUrl} alt="Top-down coverage map" />
        ) : (
          <div className="network-scene-empty">
            <strong>{activeScene?.name || "Loading active scene"}</strong>
            <span>{activeScene ? "Run a simulation to render the Sionna coverage map." : "Waiting for the backend active scene."}</span>
          </div>
        )}
        {!showScene3D && (
          <>
            <canvas
              id="heat-layer"
              ref={canvasRef}
              onMouseMove={onHover}
              onMouseLeave={onHoverEnd}
            />
            <AntennaLayer antennas={antennas} solver={latestSolver} />
          </>
        )}
        {!showScene3D && hover && <HoverCard hover={hover} />}
        {showScene3D && selectedCoverageCell && (
          <CoverageCellDialog
            cell={selectedCoverageCell}
            onClose={() => setSelectedCoverageCell(null)}
          />
        )}
      </div>

      {(latestGrid?.cells?.length || coverageImageUrl) && (
        <CoverageMapControls
          mode={coverageDisplayMode}
          onModeChange={setCoverageDisplayMode}
        />
      )}
      {(latestGrid?.cells?.length || coverageImageUrl) && (
        <CoverageColorLegend mode={coverageDisplayMode} />
      )}

      <div className="metric-strip">
        <div>
          <span>Cell size</span>
          <strong>{formatMaybeNumber(latestSolver.cell_size)} m</strong>
        </div>
        <div>
          <span>Best SINR</span>
          <strong>{summary.bestSinr}</strong>
        </div>
        <div>
          <span>Median throughput</span>
          <strong>{summary.medianThroughput}</strong>
        </div>
        <div>
          <span>Serving cells</span>
          <strong>{summary.cellCount}</strong>
        </div>
        <div>
          <span>Overlap cells</span>
          <strong>{summary.overlapPercent}</strong>
        </div>
        <div>
          <span>Avg overlap</span>
          <strong>{summary.averageOverlap}</strong>
        </div>
      </div>
    </section>
  );
}

function CoverageCellDialog({ cell, onClose }) {
  return (
    <div className="coverage-cell-dialog" role="dialog" aria-label="Coverage cell detail">
      <button
        className="coverage-cell-close"
        type="button"
        aria-label="Close cell detail"
        onClick={onClose}
      >
        x
      </button>
      <strong>Cell ({formatMaybeNumber(cell.x)} m, {formatMaybeNumber(cell.y)} m)</strong>
      <dl>
        <dt>Serving</dt><dd>{formatText(cell.serving_antenna)}</dd>
        <dt>SINR</dt><dd>{formatMaybeNumber(cell.sinr_db)} dB</dd>
        <dt>Signal</dt><dd>{formatMaybeNumber(cell.signal_dbm)} dBm</dd>
        <dt>Throughput</dt><dd>{formatMaybeNumber(cell.throughput_mbps)} Mbps</dd>
        <dt>Overlap</dt><dd>{formatOverlap(cell)}</dd>
      </dl>
      <CellOverlapAntennas antennas={cell.overlap_antennas} />
      <CellNeighbors neighbors={cell.neighbors} />
    </div>
  );
}

function AntennaLayer({ antennas, solver }) {
  return (
    <div id="antenna-layer">
      {antennas.map((item) => (
        <div
          className="antenna-marker"
          key={item.id}
          title={`${item.id}: ${formatPosition(item.position)}`}
          style={{
            left: `${worldToPercentX(item.position[0], solver)}%`,
            top: `${worldToPercentY(item.position[1], solver)}%`,
            "--azimuth": `${item.azimuth}deg`,
          }}
        >
          {item.id.replace("A", "")}
        </div>
      ))}
    </div>
  );
}

function HoverCard({ hover }) {
  const { cell, left, top } = hover;

  return (
    <div className="hover-card" style={{ left, top }}>
      <strong>Cell ({formatMaybeNumber(cell.x)} m, {formatMaybeNumber(cell.y)} m)</strong>
      <dl>
        <dt>Serving</dt><dd>{formatText(cell.serving_antenna)}</dd>
        <dt>SINR</dt><dd>{formatMaybeNumber(cell.sinr_db)} dB</dd>
        <dt>Signal</dt><dd>{formatMaybeNumber(cell.signal_dbm)} dBm</dd>
        <dt>Throughput</dt><dd>{formatMaybeNumber(cell.throughput_mbps)} Mbps</dd>
        <dt>Overlap</dt><dd>{formatOverlap(cell)}</dd>
      </dl>
      <CellOverlapAntennas antennas={cell.overlap_antennas} />
      <CellNeighbors neighbors={cell.neighbors} />
    </div>
  );
}

function CellOverlapAntennas({ antennas }) {
  if (!Array.isArray(antennas) || antennas.length === 0) {
    return <p className="neighbor-empty">No overlap antennas</p>;
  }

  return (
    <div className="neighbor-list">
      <span>Overlap antennas</span>
      {antennas.map((antenna) => (
        <div key={`${antenna.role}-${antenna.antenna}`}>
          <strong>{formatText(antenna.antenna)} ({formatText(antenna.role)})</strong>
          <small>{formatMaybeNumber(antenna.signal_dbm)} dBm</small>
          <small>{formatNeighborDelta(antenna.weaker_than_serving_db)}</small>
        </div>
      ))}
    </div>
  );
}

function formatOverlap(cell) {
  if (!Number.isFinite(Number(cell.overlap_count))) {
    return "--";
  }

  return `${cell.overlap_count} antenna(s), ${formatText(cell.overlap_level)}`;
}

function CellNeighbors({ neighbors }) {
  if (!Array.isArray(neighbors) || neighbors.length === 0) {
    return <p className="neighbor-empty">No close neighbors</p>;
  }

  return (
    <div className="neighbor-list">
      <span>Neighbors</span>
      {neighbors.map((neighbor) => (
        <div key={neighbor.antenna}>
          <strong>{formatText(neighbor.antenna)}</strong>
          <small>{formatNeighborDelta(neighbor.weaker_than_serving_db)}</small>
          <small>{formatMaybeNumber(neighbor.signal_dbm)} dBm</small>
        </div>
      ))}
    </div>
  );
}
