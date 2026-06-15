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
  isBusy = false,
  isRunning,
  latestGrid,
  latestSolver,
  mapStageRef,
  onHover,
  onHoverEnd,
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
        <button
          className="primary-button"
          type="button"
          disabled={isBusy}
          onClick={onRun}
        >
          {isRunning ? "Running..." : isBusy ? "Loading..." : "Run simulation"}
        </button>
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

function CoverageMapControls({ mode, onModeChange }) {
  return (
    <div className="coverage-map-controls" aria-label="Coverage map display mode">
      <span>Map layer</span>
      <div>
        <button
          className={mode === "quality" ? "active" : ""}
          type="button"
          onClick={() => onModeChange("quality")}
        >
          Quality
        </button>
        <button
          className={mode === "overlap" ? "active" : ""}
          type="button"
          onClick={() => onModeChange("overlap")}
        >
          Overlap
        </button>
      </div>
    </div>
  );
}

function CoverageColorLegend({ mode }) {
  const qualityRows = [
    {
      color: "#b91c1c",
      label: "Poor",
      range: "SINR < 0 dB",
      meaning: "Weak or noisy connection",
    },
    {
      color: "#eab308",
      label: "Fair",
      range: "0 to 8 dB",
      meaning: "Usable but unstable",
    },
    {
      color: "#22c55e",
      label: "Good",
      range: "8 to 18 dB",
      meaning: "Stable connection",
    },
    {
      color: "#0ea5e9",
      label: "Excellent",
      range: ">= 18 dB",
      meaning: "Strong connection",
    },
    {
      color: "#6b7280",
      label: "No coverage",
      range: "No valid value",
      meaning: "No usable serving signal",
    },
  ];
  const overlapRows = [
    {
      color: "#6b7280",
      label: "No coverage",
      range: "0 antennas",
      meaning: "No usable serving signal",
    },
    {
      color: "#2563eb",
      label: "Single coverage",
      range: "1 antenna",
      meaning: "Only one antenna is strong enough",
    },
    {
      color: "#22c55e",
      label: "Normal overlap",
      range: "2 antennas",
      meaning: "Good handover candidate area",
    },
    {
      color: "#eab308",
      label: "High overlap",
      range: "3 antennas",
      meaning: "Watch for extra interference",
    },
    {
      color: "#dc2626",
      label: "Excessive overlap",
      range: "4+ antennas",
      meaning: "Likely too many antennas affect this cell",
    },
  ];
  const rows = mode === "overlap" ? overlapRows : qualityRows;

  return (
    <div className="coverage-legend" aria-label="Coverage color legend">
      <div>
        <strong>{mode === "overlap" ? "Overlap colors" : "Coverage colors"}</strong>
        <span>
          {mode === "overlap"
            ? "Counts serving antenna plus neighbor antennas close enough to affect the same cell."
            : "Uses SINR when available. If SINR is missing, the map falls back to throughput or signal power."}
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Color</th>
            <th>Quality</th>
            <th>Range</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td><span className="coverage-swatch" style={{ background: row.color }} /></td>
              <td>{row.label}</td>
              <td>{row.range}</td>
              <td>{row.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
