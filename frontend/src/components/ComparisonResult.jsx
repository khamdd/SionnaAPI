import {
  firstArtifactUrl,
  formatDateTime,
  formatMaybeNumber,
  formatPositionValue,
  formatText,
} from "../utils/format";
import Scene3DPreview from "./Scene3DPreview";

export default function ComparisonResult({ type, items, onPreviewLoadingChange }) {
  if (type === "coverage_map") {
    return (
      <CoverageMapComparison
        items={items}
        onPreviewLoadingChange={onPreviewLoadingChange}
      />
    );
  }

  if (type === "network_coverage") {
    return (
      <NetworkCoverageComparison
        items={items}
        onPreviewLoadingChange={onPreviewLoadingChange}
      />
    );
  }

  if (type === "sinr") {
    return <SinrComparison items={items} />;
  }

  if (type === "throughput_comparison") {
    return <ThroughputComparison items={items} />;
  }

  return <p className="history-status">No comparison view is available for this simulation type.</p>;
}

function CoverageMapComparison({ items, onPreviewLoadingChange }) {
  return (
    <div className="comparison-grid">
      {items.map((item, index) => {
        const request = item.request_json || {};
        const imageUrl = item.coverage_map_image_url || firstArtifactUrl(item.artifacts);

        return (
          <article className="comparison-card" key={item.id}>
            <h3>Run {index + 1}</h3>
            <dl className="detail-grid">
              <dt>Created</dt><dd>{formatDateTime(item.created_at)}</dd>
              <dt>Status</dt><dd>{formatText(item.status)}</dd>
              <dt>Transmitter</dt><dd>{formatPositionValue(request.transmitter_position)}</dd>
              <dt>Tilt</dt><dd>{formatMaybeNumber(request.tilt)} deg</dd>
              <dt>Power</dt><dd>{formatMaybeNumber(request.tx_power)} dBm</dd>
              <dt>Cell size</dt><dd>{formatMaybeNumber(item.cell_size_m)} m</dd>
              <dt>Area</dt><dd>{formatPositionValue(request.solver?.size)}</dd>
            </dl>
            <ComparisonCoveragePreview
              fallbackImageUrl={imageUrl}
              item={item}
              mode="coverage_map"
              onPreviewLoadingChange={onPreviewLoadingChange}
            />
          </article>
        );
      })}
    </div>
  );
}

function NetworkCoverageComparison({ items, onPreviewLoadingChange }) {
  return (
    <div className="comparison-grid">
      {items.map((item, index) => {
        const response = item.response_json || {};
        const grid = response.grid || {};
        const imageUrl = item.coverage_map_image_url || firstArtifactUrl(item.artifacts);
        const antennaStats = summarizeAntennaSnapshot(item.antennas || []);

        return (
          <article className="comparison-card" key={item.id}>
            <h3>Run {index + 1}</h3>
            <dl className="detail-grid">
              <dt>Created</dt><dd>{formatDateTime(item.created_at)}</dd>
              <dt>Status</dt><dd>{formatText(item.status)}</dd>
              <dt>Cell size</dt><dd>{formatMaybeNumber(item.cell_size_m)} m</dd>
              <dt>Bandwidth</dt><dd>{formatMaybeNumber(item.bandwidth_mhz)} MHz</dd>
              <dt>MIMO layers</dt><dd>{item.mimo_layers || "--"}</dd>
              <dt>Grid</dt><dd>{grid.rows || "--"} x {grid.cols || "--"}</dd>
              <dt>Cells</dt><dd>{grid.cell_count || "--"}</dd>
              <dt>Antennas</dt><dd>{antennaStats.count}</dd>
              <dt>Avg tilt</dt><dd>{formatMaybeNumber(antennaStats.averageTilt)} deg</dd>
              <dt>Avg power</dt><dd>{formatMaybeNumber(antennaStats.averagePower)} dBm</dd>
            </dl>
            <ComparisonCoveragePreview
              fallbackImageUrl={imageUrl}
              item={item}
              mode="network_coverage"
              onPreviewLoadingChange={onPreviewLoadingChange}
            />
          </article>
        );
      })}
    </div>
  );
}

function SinrComparison({ items }) {
  const rows = items.map((item, index) => {
    const request = item.request_json || {};
    const response = item.response_json || {};

    return [
      `Run ${index + 1}`,
      formatDateTime(item.created_at),
      formatText(item.status),
      formatPositionValue(request.transmitter_position),
      formatPositionValue(request.receiver_position),
      `${formatMaybeNumber(request.tilt)} deg`,
      `${formatMaybeNumber(request.tx_power)} dBm`,
      `${formatMaybeNumber(response.sinr_db)} dB`,
      `${formatMaybeNumber(response.signal_power)} dBm`,
      `${formatMaybeNumber(response.noise_power)} dBm`,
    ];
  });

  return (
    <ComparisonTable
      headers={["Run", "Created", "Status", "Transmitter", "Receiver", "Tilt", "Power", "SINR", "Signal", "Noise"]}
      rows={rows}
    />
  );
}

function ThroughputComparison({ items }) {
  const rows = items.map((item, index) => {
    const request = item.request_json || {};
    const response = item.response_json || {};
    const comparison = response.comparison || {};

    return [
      `Run ${index + 1}`,
      formatDateTime(item.created_at),
      formatText(item.status),
      formatPositionValue(request.receiver_position),
      `${formatMaybeNumber(request.bandwidth_mhz)} MHz`,
      request.mimo_layers || "--",
      `${formatMaybeNumber(comparison.base_tilt_deg)} deg`,
      `${formatMaybeNumber(comparison.target_tilt_deg)} deg`,
      `${formatMaybeNumber(comparison.base_throughput_mbps)} Mbps`,
      `${formatMaybeNumber(comparison.target_throughput_mbps)} Mbps`,
      `${formatMaybeNumber(comparison.delta_mbps)} Mbps`,
      `${formatMaybeNumber(comparison.percentage_change)}%`,
      formatText(comparison.direction),
    ];
  });

  return (
    <ComparisonTable
      headers={[
        "Run",
        "Created",
        "Status",
        "Receiver",
        "Bandwidth",
        "Layers",
        "Base tilt",
        "Target tilt",
        "Base throughput",
        "Target throughput",
        "Delta",
        "Change",
        "Direction",
      ]}
      rows={rows}
    />
  );
}

function ComparisonTable({ headers, rows }) {
  return (
    <div className="comparison-table-wrap">
      <table className="comparison-table">
        <thead>
          <tr>
            {headers.map((header) => <th key={header}>{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ComparisonCoveragePreview({
  fallbackImageUrl,
  item,
  mode,
  onPreviewLoadingChange,
}) {
  const grid = comparisonPreviewGrid(item);

  if (item.scene_bounds) {
    return (
      <Scene3DPreview
        antennas={comparisonPreviewAntennas(item, mode)}
        bounds={item.scene_bounds}
        className="comparison-scene-3d"
        coverageGrid={grid}
        coverageImageUrl={grid ? "" : fallbackImageUrl}
        onLoadingChange={onPreviewLoadingChange}
        sceneName={item.scene_name}
        showOverlay={false}
        solver={comparisonPreviewSolver(item)}
        viewMode="top"
      />
    );
  }

  if (fallbackImageUrl) {
    return <img src={fallbackImageUrl} alt="Saved coverage comparison" />;
  }

  return <p className="history-status">No saved preview is available for this run.</p>;
}

function comparisonPreviewGrid(item) {
  const grid = item.response_json?.grid;

  if (!grid || !Array.isArray(grid.cells)) {
    return null;
  }

  return grid;
}

function comparisonPreviewSolver(item) {
  return item.response_json?.solver || item.solver || item.request_json?.solver || null;
}

function comparisonPreviewAntennas(item, mode) {
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

function summarizeAntennaSnapshot(snapshot) {
  const tiltValues = snapshot
    .map((item) => item.tilt?.current)
    .filter((value) => Number.isFinite(Number(value)))
    .map(Number);
  const powerValues = snapshot
    .map((item) => item.tx_power?.current)
    .filter((value) => Number.isFinite(Number(value)))
    .map(Number);

  return {
    count: snapshot.length,
    averageTilt: average(tiltValues),
    averagePower: average(powerValues),
  };
}

function average(values) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
