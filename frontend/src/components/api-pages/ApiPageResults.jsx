import { useState } from "react";

import { EMPTY_ARRAY, RSRP_QUALITY_BANDS } from "../../constants";
import { formatAntennaCoordinate } from "../../utils/antennas";
import { formatMaybeNumber, formatPositionValue, formatText } from "../../utils/format";
import { solverForScene } from "../../utils/scene";
import Scene3DPreview from "../Scene3DPreview";
import { formatPropagationModel } from "./ApiPageControls";

function isFormulaPropagationModel(value) {
  return ["uma", "ericsson", "friis"].includes(value);
}

function RsrpSummary({ result }) {
  const summary = result.summary || {};
  const qualityCounts = summary.quality_counts || {};

  return (
    <>
      <h3>Overall user coverage</h3>
      <dl className="detail-grid">
        <dt>Status</dt><dd>{formatText(result.status)}</dd>
        <dt>Users</dt><dd>{summary.user_count || result.user_count || "--"}</dd>
        <dt>Covered users</dt><dd>{summary.covered_user_count ?? "--"}</dd>
        <dt>Coverage</dt><dd>{formatMaybeNumber(summary.coverage_percent)}%</dd>
        <dt>Average best RSRP</dt><dd>{formatMaybeNumber(summary.average_best_rsrp_dbm)} dBm</dd>
        <dt>Overlap users</dt><dd>{formatMaybeNumber(summary.overlap_summary?.overlap_percent)}%</dd>
        <dt>Avg overlap</dt><dd>{formatMaybeNumber(summary.overlap_summary?.average_overlap_count)}</dd>
        <dt>Seed</dt><dd>{result.random_seed}</dd>
      </dl>
      <div className="rsrp-legend-header">
        <h3>RSRP quality legend</h3>
        <p>Higher dBm values indicate stronger received signal at each user point.</p>
      </div>
      <div className="rsrp-quality-strip" aria-label="RSRP quality legend">
        {RSRP_QUALITY_BANDS.map((band) => (
          <div key={band.key} className={`rsrp-quality ${band.key}`}>
            <span className="rsrp-quality-label">{band.label}</span>
            <strong>
              {qualityCounts[band.key] || 0}
              <small> users</small>
            </strong>
            <span className="rsrp-quality-range">{band.range}</span>
            <span className="rsrp-quality-description">{band.description}</span>
          </div>
        ))}
      </div>
      <h3>Antenna average RSRP</h3>
      <table className="rsrp-table">
        <thead>
          <tr>
            <th>Antenna</th>
            <th>Avg all users</th>
            <th>Avg serving users</th>
            <th>Served</th>
            <th>Measured</th>
          </tr>
        </thead>
        <tbody>
          {(result.antenna_summary || []).map((item) => (
            <tr key={item.antenna}>
              <td>{item.antenna}</td>
              <td>{formatMaybeNumber(item.average_rsrp_dbm)} dBm</td>
              <td>{formatMaybeNumber(item.average_serving_rsrp_dbm)} dBm</td>
              <td>{item.served_user_count}</td>
              <td>{item.measured_user_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function RsrpUserDialog({ onClose, user }) {
  return (
    <div className="coverage-cell-dialog rsrp-user-dialog" role="dialog" aria-label="RSRP user detail">
      <button
        className="coverage-cell-close"
        type="button"
        aria-label="Close user detail"
        onClick={onClose}
      >
        x
      </button>
      <strong>{user.id} - {qualityLabel(user.quality)}</strong>
      <dl>
        <dt>Position</dt><dd>{formatPositionValue(user.position)}</dd>
        <dt>Serving antenna</dt><dd>{formatText(user.serving_antenna)}</dd>
        <dt>Best RSRP</dt><dd>{formatMaybeNumber(user.rsrp_dbm)} dBm</dd>
        <dt>Overlap</dt><dd>{formatOverlap(user)}</dd>
        <dt>Grid cell</dt><dd>{user.grid ? `${user.grid.row}, ${user.grid.col}` : "--"}</dd>
      </dl>
      <OverlapAntennaList antennas={user.overlap_antennas} valueField="rsrp_dbm" />
      <div className="neighbor-list">
        <span>Neighbors</span>
        {user.neighbors?.length ? user.neighbors.map((neighbor) => (
          <div key={neighbor.antenna}>
            <strong>{neighbor.antenna}</strong>
            <span>{formatMaybeNumber(neighbor.rsrp_dbm)} dBm</span>
            <small>{formatMaybeNumber(neighbor.weaker_than_serving_db)} dB weaker</small>
          </div>
        )) : (
          <p className="neighbor-empty">No close neighbor antenna for this user.</p>
        )}
      </div>
    </div>
  );
}

function qualityLabel(quality) {
  return String(quality || "unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function QueueNotice({ onQueueOpen, result }) {
  const sceneName = result.scene_name || result.scene?.name || result.scene?.id;

  return (
    <div className="queue-notice">
      <strong>Simulation recorded</strong>
      <p>The job is in Simulation Queue. Open the queue to watch its status and save the result after it finishes.</p>
      <dl className="detail-grid">
        <dt>Scene</dt><dd>{sceneName || "--"}</dd>
        <dt>Type</dt><dd>{result.simulation_type || "--"}</dd>
      </dl>
      {onQueueOpen && (
        <button className="primary-button" type="button" onClick={onQueueOpen}>
          Open Simulation Queue
        </button>
      )}
    </div>
  );
}

function ApiScenePreview({
  activeScene,
  antennas = EMPTY_ARRAY,
  isSceneReady,
  onSceneLoadingChange,
  signalLinks = EMPTY_ARRAY,
  solver = null,
}) {
  return (
    <div className="result-summary">
      <div className="api-result-scene-wrap">
        {activeScene?.bounds ? (
          <Scene3DPreview
            antennas={antennas}
            bounds={activeScene.bounds}
            className="api-result-scene-3d"
            onLoadingChange={onSceneLoadingChange}
            sceneName={activeScene.name}
            showOverlay={false}
            signalLinks={signalLinks}
            solver={solver || solverForScene(activeScene)}
            viewMode="top"
            wardBoundary={activeScene.ward_boundary}
          />
        ) : (
          <p className="history-status">No 3D scene is available for the active scene.</p>
        )}
      </div>
      <p className="history-status">
        {isSceneReady
          ? "Scene is ready. Run the API to see the response summary here."
          : "Loading the 3D scene before simulation can run..."}
      </p>
    </div>
  );
}

function CoverageResult({ activeScene, onSceneLoadingChange, result }) {
  const request = result.request || {};
  const solver = result.solver || request.solver || {};

  return (
    <div className="result-summary">
      <ApiResultScene
        activeScene={activeScene}
        antennas={coverageResultAntennas(result, request)}
        fallbackImageUrl={result.coverage_map_image_url}
        coverageGrid={result.grid}
        onSceneLoadingChange={onSceneLoadingChange}
        result={result}
        solver={solver}
      />
      <h3>Transmitter</h3>
      <dl className="detail-grid">
        <dt>Antenna</dt><dd>{formatText(request.transmitter?.id || "Manual transmitter")}</dd>
        <dt>Coordinates</dt><dd>{formatTransmitterCoordinates(request.transmitter)}</dd>
        <dt>Position</dt><dd>{formatPositionValue(request.transmitter_position)}</dd>
        <dt>Azimuth</dt><dd>{formatMaybeNumber(request.azimuth)} deg</dd>
        <dt>Tilt</dt><dd>{formatMaybeNumber(request.tilt)} deg</dd>
        <dt>Power</dt><dd>{formatMaybeNumber(request.tx_power)} dBm</dd>
        <dt>Pattern</dt><dd>{formatText(request.transmitter_pattern)}</dd>
      </dl>
      <h3>Coverage map</h3>
      <dl className="detail-grid">
        <dt>Status</dt><dd>{formatText(result.status)}</dd>
        <dt>Grid</dt><dd>{result.grid ? `${result.grid.rows} x ${result.grid.cols}` : "PNG preview only"}</dd>
        <dt>Layer source</dt><dd>{result.grid ? "Cell grid" : "Rendered image"}</dd>
        <dt>Cell size</dt><dd>{formatMaybeNumber(solver.cell_size)} m</dd>
        <dt>Center</dt><dd>{formatPositionValue(solver.center)}</dd>
        <dt>Size</dt><dd>{formatPositionValue(solver.size)}</dd>
      </dl>
    </div>
  );
}

function SinrResultDetails({ result }) {
  const request = result.request || {};
  const isAnalytical = isFormulaPropagationModel(result.propagation_model);

  return (
    <>
      <h3>Serving transmitter</h3>
      <dl className="detail-grid">
        <dt>Position</dt><dd>{formatPositionValue(request.transmitter_position)}</dd>
        <dt>Azimuth</dt><dd>{formatMaybeNumber(request.azimuth)} deg</dd>
        <dt>Tilt</dt><dd>{formatMaybeNumber(request.tilt)} deg</dd>
        <dt>Power</dt><dd>{formatMaybeNumber(request.tx_power)} dBm</dd>
        <dt>Interferer power</dt><dd>{request.interferer_position ? `${formatMaybeNumber(request.interferer_tx_power ?? request.tx_power)} dBm` : "None"}</dd>
        <dt>Propagation</dt><dd>{formatPropagationModel(result.propagation_model)}</dd>
        {isAnalytical && <><dt>Frequency</dt><dd>{formatMaybeNumber(request.carrier_frequency_ghz)} GHz</dd></>}
      </dl>
      <h3>Receiver result</h3>
      <dl className="detail-grid">
        <dt>Status</dt><dd>{formatText(result.status)}</dd>
        <dt>Receiver</dt><dd>{formatPositionValue(result.receiver_position || request.receiver_position)}</dd>
        <dt>SINR</dt><dd>{formatMaybeNumber(result.sinr_db)} dB</dd>
        <dt>Signal power</dt><dd>{formatMaybeNumber(result.signal_power)} dBm</dd>
        <dt>Interference + noise</dt><dd>{formatMaybeNumber(result.noise_power)} dBm</dd>
      </dl>
      {request.interferer_position && (
        <>
          <h3>Interferer</h3>
          <dl className="detail-grid">
            <dt>Position</dt><dd>{formatPositionValue(request.interferer_position)}</dd>
            <dt>Azimuth</dt><dd>{formatMaybeNumber(request.interferer_azimuth)} deg</dd>
            <dt>Tilt</dt><dd>{formatMaybeNumber(request.interferer_tilt)} deg</dd>
          </dl>
        </>
      )}
    </>
  );
}

function ThroughputResultDetails({ result }) {
  const request = result.request || {};
  const comparison = result.comparison || {};
  const isAnalytical = isFormulaPropagationModel(result.propagation_model);

  return (
    <>
      <h3>Radio link</h3>
      <dl className="detail-grid">
        <dt>Transmitter</dt><dd>{formatPositionValue(request.transmitter_position)}</dd>
        <dt>Azimuth</dt><dd>{formatMaybeNumber(request.azimuth)} deg</dd>
        <dt>Receiver</dt><dd>{formatPositionValue(result.receiver_position || request.receiver_position)}</dd>
        <dt>Interferer</dt><dd>{request.interferer_position ? `${formatPositionValue(request.interferer_position)} (${formatMaybeNumber(request.interferer_azimuth)} deg)` : "None"}</dd>
        <dt>Power</dt><dd>{formatMaybeNumber(request.tx_power)} dBm</dd>
        <dt>Bandwidth</dt><dd>{formatMaybeNumber(request.bandwidth_mhz)} MHz</dd>
        <dt>Interferer power</dt><dd>{request.interferer_position ? `${formatMaybeNumber(request.interferer_tx_power ?? request.tx_power)} dBm` : "None"}</dd>
        <dt>MIMO layers</dt><dd>{request.mimo_layers || "--"}</dd>
        <dt>Propagation</dt><dd>{formatPropagationModel(result.propagation_model)}</dd>
        {isAnalytical && <><dt>Frequency</dt><dd>{formatMaybeNumber(request.carrier_frequency_ghz)} GHz</dd></>}
      </dl>
      <h3>Throughput comparison</h3>
      <dl className="detail-grid">
        <dt>Status</dt><dd>{formatText(result.status)}</dd>
        <dt>Base tilt</dt><dd>{formatMaybeNumber(comparison.base_tilt_deg)} deg</dd>
        <dt>Target tilt</dt><dd>{formatMaybeNumber(comparison.target_tilt_deg)} deg</dd>
        <dt>Base throughput</dt><dd>{formatMaybeNumber(comparison.base_throughput_mbps)} Mbps</dd>
        <dt>Target throughput</dt><dd>{formatMaybeNumber(comparison.target_throughput_mbps)} Mbps</dd>
        <dt>Delta</dt><dd>{formatMaybeNumber(comparison.delta_mbps)} Mbps</dd>
        <dt>Change</dt><dd>{formatMaybeNumber(comparison.percentage_change)}%</dd>
        <dt>Direction</dt><dd>{formatText(comparison.direction)}</dd>
      </dl>
      {isAnalytical && <p className="form-help">{result.recommendation}</p>}
    </>
  );
}

function ApiResultScene({
  activeScene,
  antennas = EMPTY_ARRAY,
  coverageGrid = null,
  fallbackImageUrl = "",
  onSceneLoadingChange = null,
  sceneBadges = EMPTY_ARRAY,
  signalLinks = EMPTY_ARRAY,
  solver = null,
}) {
  const [selectedCell, setSelectedCell] = useState(null);

  if (activeScene?.bounds) {
    return (
      <div className="api-result-scene-wrap">
        <Scene3DPreview
          antennas={antennas}
          bounds={activeScene.bounds}
          className="api-result-scene-3d"
          coverageGrid={coverageGrid}
          coverageImageUrl={coverageGrid ? "" : fallbackImageUrl}
          onLoadingChange={onSceneLoadingChange}
          onCoverageCellSelect={setSelectedCell}
          sceneName={activeScene.name}
          selectedCoverageCell={selectedCell}
          showOverlay={false}
          signalLinks={signalLinks}
          solver={solver}
          viewMode="top"
          wardBoundary={activeScene.ward_boundary}
        />
        {sceneBadges.length > 0 && (
          <div className="api-result-scene-badges">
            {sceneBadges.map((badge) => (
              <div key={badge.label}>
                <span>{badge.label}</span>
                <strong>{badge.value}</strong>
              </div>
            ))}
          </div>
        )}
        {selectedCell && (
          <ApiCoverageCellDialog
            cell={selectedCell}
            onClose={() => setSelectedCell(null)}
          />
        )}
      </div>
    );
  }

  if (fallbackImageUrl) {
    return <img src={fallbackImageUrl} alt="API result preview" />;
  }

  return <p className="history-status">No scene preview is available for this result.</p>;
}

function radioLinkVisuals(request) {
  const links = [];

  if (
    Array.isArray(request.transmitter_position)
    && Array.isArray(request.receiver_position)
  ) {
    links.push({
      from: request.transmitter_position,
      label: "Serving",
      to: request.receiver_position,
      type: "serving",
    });
  }

  if (
    Array.isArray(request.interferer_position)
    && Array.isArray(request.receiver_position)
  ) {
    links.push({
      from: request.interferer_position,
      label: "Interference",
      to: request.receiver_position,
      type: "interference",
    });
  }

  return links;
}

function sinrSceneBadges(result) {
  return [
    {
      label: "SINR",
      value: `${formatMaybeNumber(result?.sinr_db)} dB`,
    },
    {
      label: "Signal",
      value: `${formatMaybeNumber(result?.signal_power)} dBm`,
    },
    {
      label: "Noise + interference",
      value: `${formatMaybeNumber(result?.noise_power)} dBm`,
    },
  ];
}

function throughputSceneBadges(result) {
  const comparison = result?.comparison || {};

  return [
    {
      label: "Target throughput",
      value: `${formatMaybeNumber(comparison.target_throughput_mbps)} Mbps`,
    },
    {
      label: "Delta",
      value: `${formatMaybeNumber(comparison.delta_mbps)} Mbps`,
    },
    {
      label: "Change",
      value: `${formatMaybeNumber(comparison.percentage_change)}%`,
    },
  ];
}

function coverageResultAntennas(result, request) {
  if (Array.isArray(result.antennas) && result.antennas.length > 0) {
    return result.antennas;
  }

  if (!Array.isArray(request.transmitter_position)) {
    return [];
  }

  return [
    {
      id: request.transmitter?.id || "TX",
      position: request.transmitter_position,
      longitude: request.transmitter?.longitude,
      latitude: request.transmitter?.latitude,
      height_m: request.transmitter?.height_m,
      azimuth: request.transmitter?.azimuth ?? 0,
    },
  ];
}

function formatTransmitterCoordinates(transmitter) {
  if (!transmitter) {
    return "--";
  }

  return `${formatAntennaCoordinate(transmitter.longitude)}, ${formatAntennaCoordinate(transmitter.latitude)}`;
}

function ApiCoverageCellDialog({ cell, onClose }) {
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
      <OverlapAntennaList antennas={cell.overlap_antennas} valueField="signal_dbm" />
    </div>
  );
}

function OverlapAntennaList({ antennas, valueField }) {
  if (!Array.isArray(antennas) || antennas.length === 0) {
    return <p className="neighbor-empty">No overlap antennas</p>;
  }

  return (
    <div className="neighbor-list">
      <span>Overlap antennas</span>
      {antennas.map((antenna) => (
        <div key={`${antenna.role}-${antenna.antenna}`}>
          <strong>{formatText(antenna.antenna)} ({formatText(antenna.role)})</strong>
          <span>{formatMaybeNumber(antenna[valueField])} dBm</span>
          <small>{formatMaybeNumber(antenna.weaker_than_serving_db)} dB weaker</small>
        </div>
      ))}
    </div>
  );
}

function formatOverlap(item) {
  if (!Number.isFinite(Number(item.overlap_count))) {
    return "--";
  }

  return `${item.overlap_count} antenna(s), ${formatText(item.overlap_level)}`;
}


export {
  ApiResultScene,
  ApiScenePreview,
  CoverageResult,
  QueueNotice,
  RsrpSummary,
  RsrpUserDialog,
  SinrResultDetails,
  ThroughputResultDetails,
  radioLinkVisuals,
  sinrSceneBadges,
  throughputSceneBadges,
};
