import { useState } from "react";
import {
  firstArtifactUrl,
  formatMaybeNumber,
  formatNeighborDelta,
  formatPositionValue,
  formatRange,
  formatSimulationType,
  formatText,
  formatDateTime,
} from "../utils/format";
import Scene3DPreview from "./Scene3DPreview";

export default function HistoryDetail({ item, onPreviewLoadingChange }) {
  const renderer = {
    coverage_map: (
      <CoverageMapHistory
        item={item}
        onPreviewLoadingChange={onPreviewLoadingChange}
      />
    ),
    network_coverage: (
      <NetworkCoverageHistory
        item={item}
        onPreviewLoadingChange={onPreviewLoadingChange}
      />
    ),
    sinr: <SinrHistory item={item} />,
    throughput_comparison: <ThroughputHistory item={item} />,
  }[item.simulation_type];

  if (renderer) {
    return renderer;
  }

  return (
    <>
      <HistoryHeader item={item} />
      <p className="history-status">No specialized history view for this simulation type.</p>
    </>
  );
}

function HistoryHeader({ item }) {
  return (
    <>
      <strong>{formatSimulationType(item.simulation_type)}</strong>
      <dl className="detail-grid">
        <dt>Scene</dt><dd>{formatText(item.scene_name || item.scene_id)}</dd>
        <dt>Status</dt><dd>{formatText(item.status)}</dd>
        <dt>Created</dt><dd>{formatDateTime(item.created_at)}</dd>
        <dt>Pattern</dt><dd>{formatText(item.transmitter_pattern)}</dd>
      </dl>
    </>
  );
}

function CoverageMapHistory({ item, onPreviewLoadingChange }) {
  const request = item.request_json || {};
  const response = item.response_json || {};
  const imageUrl = item.coverage_map_image_url || firstArtifactUrl(item.artifacts);

  return (
    <>
      <HistoryHeader item={item} />
      <h3>Transmitter</h3>
      <dl className="detail-grid">
        <dt>Position</dt><dd>{formatPositionValue(request.transmitter_position)}</dd>
        <dt>Tilt</dt><dd>{formatMaybeNumber(request.tilt)} deg</dd>
        <dt>Power</dt><dd>{formatMaybeNumber(request.tx_power)} dBm</dd>
      </dl>
      <h3>Simulation area</h3>
      <dl className="detail-grid">
        <dt>Cell size</dt><dd>{formatMaybeNumber(item.cell_size_m)} m</dd>
        <dt>Center</dt><dd>{formatPositionValue(request.solver?.center)}</dd>
        <dt>Size</dt><dd>{formatPositionValue(request.solver?.size)}</dd>
        <dt>Status</dt><dd>{formatText(response.status || item.status)}</dd>
      </dl>
      <HistoryCoveragePreview
        fallbackImageUrl={imageUrl}
        item={item}
        mode="coverage_map"
        onPreviewLoadingChange={onPreviewLoadingChange}
      />
    </>
  );
}

function NetworkCoverageHistory({ item, onPreviewLoadingChange }) {
  const response = item.response_json || {};
  const grid = response.grid || {};
  const imageUrl = item.coverage_map_image_url || firstArtifactUrl(item.artifacts);

  return (
    <>
      <HistoryHeader item={item} />
      <h3>Coverage result</h3>
      <dl className="detail-grid">
        <dt>Cell size</dt><dd>{formatMaybeNumber(item.cell_size_m)} m</dd>
        <dt>Bandwidth</dt><dd>{formatMaybeNumber(item.bandwidth_mhz)} MHz</dd>
        <dt>MIMO layers</dt><dd>{item.mimo_layers || "--"}</dd>
        <dt>Grid</dt><dd>{grid.rows || "--"} x {grid.cols || "--"}</dd>
        <dt>Cells</dt><dd>{grid.cell_count || "--"}</dd>
      </dl>
      <HistoryCoveragePreview
        fallbackImageUrl={imageUrl}
        item={item}
        mode="network_coverage"
        onPreviewLoadingChange={onPreviewLoadingChange}
      />
      <h3>Antenna snapshot</h3>
      {(item.antennas || []).length ? (
        item.antennas.map((antenna) => (
          <dl className="antenna-snapshot" key={antenna.antenna_code}>
            <dt>Antenna</dt><dd>{formatText(antenna.antenna_code)}</dd>
            <dt>Position</dt><dd>{formatPositionValue(antenna.position)}</dd>
            <dt>Azimuth</dt><dd>{formatMaybeNumber(antenna.azimuth_deg)} deg</dd>
            <dt>Tilt</dt><dd>{formatRange(antenna.tilt)} deg</dd>
            <dt>Power</dt><dd>{formatRange(antenna.tx_power)} dBm</dd>
          </dl>
        ))
      ) : (
        <p className="history-status">No antenna snapshot for this simulation type.</p>
      )}
    </>
  );
}

function HistoryCoveragePreview({
  fallbackImageUrl,
  item,
  mode,
  onPreviewLoadingChange,
}) {
  const grid = historyPreviewGrid(item);
  const [selectedCell, setSelectedCell] = useState(null);

  if (item.scene_bounds) {
    return (
      <div className="history-coverage-preview">
        <Scene3DPreview
          antennas={historyPreviewAntennas(item, mode)}
          bounds={item.scene_bounds}
          className="history-scene-3d"
          coverageGrid={grid}
          coverageImageUrl={grid ? "" : fallbackImageUrl}
          onCoverageCellSelect={setSelectedCell}
          onLoadingChange={onPreviewLoadingChange}
          sceneName={item.scene_name}
          selectedCoverageCell={selectedCell}
          showOverlay={false}
          solver={historyPreviewSolver(item)}
          viewMode="top"
        />
        {selectedCell && (
          <HistoryCoverageCellDialog
            cell={selectedCell}
            onClose={() => setSelectedCell(null)}
          />
        )}
      </div>
    );
  }

  if (fallbackImageUrl) {
    return <img src={fallbackImageUrl} alt="Saved coverage map" />;
  }

  return <p className="history-status">No saved preview is available for this run.</p>;
}

function historyPreviewGrid(item) {
  const grid = item.response_json?.grid;

  if (!grid || !Array.isArray(grid.cells)) {
    return null;
  }

  return grid;
}

function HistoryCoverageCellDialog({ cell, onClose }) {
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

function historyPreviewSolver(item) {
  return item.response_json?.solver || item.solver || item.request_json?.solver || null;
}

function historyPreviewAntennas(item, mode) {
  if (mode === "coverage_map") {
    const request = item.request_json || {};

    if (!Array.isArray(request.transmitter_position)) {
      return [];
    }

    return [{
      id: "A1",
      position: request.transmitter_position,
      azimuth: request.azimuth || 0,
    }];
  }

  if (Array.isArray(item.response_json?.antennas)) {
    return item.response_json.antennas;
  }

  return (item.antennas || []).map((antenna) => ({
    id: antenna.antenna_code,
    position: antenna.position,
    azimuth: antenna.azimuth_deg,
  }));
}

function SinrHistory({ item }) {
  const request = item.request_json || {};
  const response = item.response_json || {};

  return (
    <>
      <HistoryHeader item={item} />
      <h3>Transmitter antenna</h3>
      <dl className="detail-grid">
        <dt>Position</dt><dd>{formatPositionValue(request.transmitter_position)}</dd>
        <dt>Tilt</dt><dd>{formatMaybeNumber(request.tilt)} deg</dd>
        <dt>Power</dt><dd>{formatMaybeNumber(request.tx_power)} dBm</dd>
      </dl>
      <h3>Receiver antenna</h3>
      <dl className="detail-grid">
        <dt>Position</dt><dd>{formatPositionValue(request.receiver_position)}</dd>
        <dt>SINR</dt><dd>{formatMaybeNumber(response.sinr_db)} dB</dd>
        <dt>Signal power</dt><dd>{formatMaybeNumber(response.signal_power)} dBm</dd>
        <dt>Noise power</dt><dd>{formatMaybeNumber(response.noise_power)} dBm</dd>
      </dl>
      <h3>Interferer</h3>
      <dl className="detail-grid">
        <dt>Position</dt><dd>{formatPositionValue(request.interferer_position)}</dd>
        <dt>Tilt</dt><dd>{formatMaybeNumber(request.interferer_tilt)} deg</dd>
      </dl>
    </>
  );
}

function ThroughputHistory({ item }) {
  const request = item.request_json || {};
  const response = item.response_json || {};
  const comparison = response.comparison || {};

  return (
    <>
      <HistoryHeader item={item} />
      <h3>Transmitter and receiver</h3>
      <dl className="detail-grid">
        <dt>Transmitter</dt><dd>{formatPositionValue(request.transmitter_position)}</dd>
        <dt>Receiver</dt><dd>{formatPositionValue(request.receiver_position)}</dd>
        <dt>Power</dt><dd>{formatMaybeNumber(request.tx_power)} dBm</dd>
        <dt>Bandwidth</dt><dd>{formatMaybeNumber(request.bandwidth_mhz)} MHz</dd>
        <dt>MIMO layers</dt><dd>{request.mimo_layers || "--"}</dd>
      </dl>
      <h3>Throughput comparison</h3>
      <dl className="detail-grid">
        <dt>Base tilt</dt><dd>{formatMaybeNumber(comparison.base_tilt_deg)} deg</dd>
        <dt>Target tilt</dt><dd>{formatMaybeNumber(comparison.target_tilt_deg)} deg</dd>
        <dt>Base throughput</dt><dd>{formatMaybeNumber(comparison.base_throughput_mbps)} Mbps</dd>
        <dt>Target throughput</dt><dd>{formatMaybeNumber(comparison.target_throughput_mbps)} Mbps</dd>
        <dt>Delta</dt><dd>{formatMaybeNumber(comparison.delta_mbps)} Mbps</dd>
        <dt>Change</dt><dd>{formatMaybeNumber(comparison.percentage_change)}%</dd>
        <dt>Direction</dt><dd>{formatText(comparison.direction)}</dd>
      </dl>
    </>
  );
}
