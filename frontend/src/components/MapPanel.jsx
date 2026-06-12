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
import Scene3DPreview from "./Scene3DPreview";

export default function MapPanel({
  activeScene,
  antennas,
  coverageImageUrl,
  canvasRef,
  hover,
  isRunning,
  latestGrid,
  latestSolver,
  mapStageRef,
  onHover,
  onHoverEnd,
  onRun,
  runError,
  runStatus,
  summary,
}) {
  const showScene3D = Boolean(activeScene?.bounds);
  const sceneTitle = activeScene?.name || "Munich";
  const [selectedCoverageCell, setSelectedCoverageCell] = useState(null);

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
        <button
          className="primary-button"
          type="button"
          disabled={isRunning}
          onClick={onRun}
        >
          {isRunning ? "Running..." : "Run simulation"}
        </button>
      </div>

      <div ref={mapStageRef} className="map-stage">
        {activeScene?.bounds ? (
          <Scene3DPreview
            antennas={antennas}
            bounds={activeScene.bounds}
            className="network-scene-3d"
            coverageGrid={latestGrid}
            onCoverageCellSelect={setSelectedCoverageCell}
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
            <strong>{activeScene?.name || "Munich"}</strong>
            <span>Run a simulation to render the Sionna coverage map.</span>
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
      </dl>
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
      </dl>
      <CellNeighbors neighbors={cell.neighbors} />
    </div>
  );
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
