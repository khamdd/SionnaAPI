const API_BASE_URL = "http://127.0.0.1:8000";

const DEFAULT_SOLVER = {
  max_depth: 2,
  samples_per_tx: 20000,
  cell_size: 5,
  center: [0, 0, 0],
  size: [300, 300],
};

const TRANSMITTER_PATTERN = "tr38901";

const DEFAULT_ANTENNAS = [
  antenna("A1", [-120, -105, 30], 2, 8, 16, 45, 20, 30, 40),
  antenna("A2", [-45, -120, 28], 2, 10, 18, 20, 20, 30, 40),
  antenna("A3", [35, -112, 29], 2, 9, 16, 335, 20, 30, 40),
  antenna("A4", [118, -85, 31], 2, 11, 20, 305, 20, 30, 40),
  antenna("A5", [-132, -5, 27], 2, 7, 15, 92, 20, 30, 40),
  antenna("A6", [-48, -8, 30], 2, 12, 22, 75, 20, 30, 40),
  antenna("A7", [42, 4, 29], 2, 10, 18, 250, 20, 30, 40),
  antenna("A8", [128, 18, 30], 2, 8, 17, 275, 20, 30, 40),
  antenna("A9", [-78, 108, 28], 2, 13, 24, 135, 20, 30, 40),
  antenna("A10", [72, 116, 31], 2, 9, 19, 215, 20, 30, 40),
];

let antennas = structuredClone(DEFAULT_ANTENNAS);
let latestGrid = null;
let latestSolver = structuredClone(DEFAULT_SOLVER);
let latestHistory = [];
let selectedHistoryId = null;

const antennaList = document.querySelector("#antenna-list");
const historyView = document.querySelector("#history-view");
const historyList = document.querySelector("#history-list");
const historyDetail = document.querySelector("#history-detail");
const historyStatus = document.querySelector("#history-status");
const antennaLayer = document.querySelector("#antenna-layer");
const mapStage = document.querySelector("#map-stage");
const coverageImage = document.querySelector("#coverage-image");
const heatLayer = document.querySelector("#heat-layer");
const hoverCard = document.querySelector("#hover-card");
const runButton = document.querySelector("#run-simulation");
const resetButton = document.querySelector("#reset-antennas");
const refreshHistoryButton = document.querySelector("#refresh-history");
const statusLabel = document.querySelector("#run-status");
const panelTitle = document.querySelector("#panel-title");
const antennasTab = document.querySelector("#antennas-tab");
const historyTab = document.querySelector("#history-tab");
const cellSizeLabel = document.querySelector("#cell-size-label");
const bestSinrLabel = document.querySelector("#best-sinr-label");
const medianThroughputLabel = document.querySelector("#median-throughput-label");
const cellCountLabel = document.querySelector("#cell-count-label");

function antenna(
  id,
  position,
  tiltMin,
  tiltCurrent,
  tiltMax,
  azimuth,
  powerMin,
  powerCurrent,
  powerMax,
) {
  return {
    id,
    position,
    tilt: {
      min: tiltMin,
      current: tiltCurrent,
      max: tiltMax,
    },
    azimuth,
    tx_power: {
      min: powerMin,
      current: powerCurrent,
      max: powerMax,
    },
  };
}

function renderControls() {
  antennaList.innerHTML = "";

  antennas.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "antenna-card";
    card.innerHTML = `
      <h3>
        <span>${item.id}</span>
        <small>${formatPosition(item.position)}</small>
      </h3>
      <div class="antenna-meta">
        <span>Azimuth ${item.azimuth} deg</span>
        <span>Height ${item.position[2]} m</span>
      </div>
      <div class="control-row">
        <label for="tilt-${index}">Tilt</label>
        <input id="tilt-${index}" type="range"
          min="${item.tilt.min}" max="${item.tilt.max}" step="0.5"
          value="${item.tilt.current}" data-index="${index}" data-field="tilt" />
        <span class="control-value" id="tilt-value-${index}">
          ${item.tilt.current.toFixed(1)}
        </span>
      </div>
      <div class="control-row">
        <label for="power-${index}">Power</label>
        <input id="power-${index}" type="range"
          min="${item.tx_power.min}" max="${item.tx_power.max}" step="0.5"
          value="${item.tx_power.current}" data-index="${index}" data-field="tx_power" />
        <span class="control-value" id="power-value-${index}">
          ${item.tx_power.current.toFixed(1)}
        </span>
      </div>
    `;
    antennaList.appendChild(card);
  });

  antennaList.querySelectorAll("input[type='range']").forEach((input) => {
    input.addEventListener("input", handleAntennaChange);
  });
}

function handleAntennaChange(event) {
  const index = Number(event.target.dataset.index);
  const field = event.target.dataset.field;
  const value = Number(event.target.value);
  antennas[index][field].current = value;

  const targetId = field === "tilt"
    ? `#tilt-value-${index}`
    : `#power-value-${index}`;
  document.querySelector(targetId).textContent = value.toFixed(1);
  renderAntennaMarkers();
}

function renderAntennaMarkers() {
  antennaLayer.innerHTML = "";
  antennas.forEach((item) => {
    const marker = document.createElement("div");
    marker.className = "antenna-marker";
    marker.textContent = item.id.replace("A", "");
    marker.title = `${item.id}: ${formatPosition(item.position)}`;
    marker.style.left = `${worldToPercentX(item.position[0], latestSolver)}%`;
    marker.style.top = `${worldToPercentY(item.position[1], latestSolver)}%`;
    marker.style.setProperty("--azimuth", `${item.azimuth}deg`);
    antennaLayer.appendChild(marker);
  });
}

async function runSimulation() {
  setLoading(true);
  setStatus("Running GPU simulation...");

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/network-coverage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildPayload()),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();
    if (result.status !== "success") {
      throw new Error(result.error || "Simulation failed");
    }

    latestGrid = result.grid;
    latestSolver = result.solver;
    coverageImage.src = `${result.coverage_map_image_url}?t=${Date.now()}`;
    cellSizeLabel.textContent = `${result.solver.cell_size} m`;
    drawHeatmap();
    renderAntennaMarkers();
    updateSummary(result.grid);
    setStatus("Simulation complete");
    loadHistory();
  } catch (error) {
    setStatus(`Simulation failed: ${error.message}`, true);
  } finally {
    setLoading(false);
  }
}

function showAntennaPanel() {
  panelTitle.textContent = "Antenna sectors";
  antennaList.classList.remove("hidden");
  historyView.classList.add("hidden");
  resetButton.classList.remove("hidden");
  refreshHistoryButton.classList.add("hidden");
  antennasTab.classList.add("active");
  historyTab.classList.remove("active");
}

function showHistoryPanel() {
  panelTitle.textContent = "Simulation history";
  antennaList.classList.add("hidden");
  historyView.classList.remove("hidden");
  resetButton.classList.add("hidden");
  refreshHistoryButton.classList.remove("hidden");
  antennasTab.classList.remove("active");
  historyTab.classList.add("active");
  loadHistory();
}

async function loadHistory() {
  if (historyView.classList.contains("hidden")) {
    return;
  }

  historyStatus.textContent = "Loading history...";
  historyStatus.classList.remove("error-text");

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/simulation-runs?limit=25`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();

    if (!result.database_configured) {
      latestHistory = [];
      historyList.innerHTML = "";
      historyDetail.classList.add("hidden");
      historyStatus.textContent = "Database is not configured. Set DATABASE_URL to use history.";
      return;
    }

    if (result.error) {
      throw new Error(result.error);
    }

    latestHistory = result.items || [];
    renderHistoryList();
    historyStatus.textContent = latestHistory.length
      ? `${latestHistory.length} saved simulations`
      : "No saved simulations yet.";
  } catch (error) {
    historyStatus.textContent = `History failed: ${error.message}`;
    historyStatus.classList.add("error-text");
  }
}

function renderHistoryList() {
  historyList.innerHTML = "";

  latestHistory.forEach((item) => {
    const row = document.createElement("div");
    row.className = "history-row";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item";
    button.classList.toggle("active", item.id === selectedHistoryId);
    button.innerHTML = `
      <strong>${formatSimulationType(item.simulation_type)} - ${item.status}</strong>
      <span>${formatDateTime(item.created_at)}</span>
      <span>${historyListSubtitle(item)}</span>
    `;
    button.addEventListener("click", () => {
      loadHistoryDetail(item.id);
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "history-delete";
    deleteButton.title = "Delete simulation history";
    deleteButton.setAttribute("aria-label", `Delete ${formatSimulationType(item.simulation_type)} history`);
    deleteButton.innerHTML = trashIconSvg();
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteHistoryItem(item);
    });

    row.appendChild(button);
    row.appendChild(deleteButton);
    historyList.appendChild(row);
  });
}

async function deleteHistoryItem(item) {
  const confirmed = window.confirm(
    `Delete ${formatSimulationType(item.simulation_type)} history from ${formatDateTime(item.created_at)}?`
  );

  if (!confirmed) {
    return;
  }

  historyStatus.textContent = "Deleting history...";
  historyStatus.classList.remove("error-text");

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/simulation-runs/${item.id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    if (selectedHistoryId === item.id) {
      selectedHistoryId = null;
      historyDetail.classList.add("hidden");
      historyDetail.innerHTML = "";
    }

    await loadHistory();
  } catch (error) {
    historyStatus.textContent = `Delete failed: ${error.message}`;
    historyStatus.classList.add("error-text");
  }
}

async function loadHistoryDetail(runId) {
  selectedHistoryId = runId;
  renderHistoryList();
  historyDetail.classList.remove("hidden");
  historyDetail.innerHTML = "<p class=\"history-status\">Loading detail...</p>";

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/simulation-runs/${runId}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();

    if (!result.database_configured) {
      historyDetail.innerHTML = "<p class=\"history-status\">Database is not configured.</p>";
      return;
    }

    if (result.error) {
      throw new Error(result.error);
    }

    if (!result.item) {
      historyDetail.innerHTML = "<p class=\"history-status\">Simulation not found.</p>";
      return;
    }

    renderHistoryDetail(result.item);
  } catch (error) {
    historyDetail.innerHTML = `<p class="history-status error-text">Detail failed: ${error.message}</p>`;
  }
}

function renderHistoryDetail(item) {
  const renderer = {
    coverage_map: renderCoverageMapHistory,
    network_coverage: renderNetworkCoverageHistory,
    sinr: renderSinrHistory,
    throughput_comparison: renderThroughputHistory,
  }[item.simulation_type];

  if (renderer) {
    historyDetail.innerHTML = renderer(item);
    return;
  }

  historyDetail.innerHTML = `
    ${renderHistoryHeader(item)}
    <p class="history-status">No specialized history view for this simulation type.</p>
  `;
}

function renderHistoryHeader(item) {
  return `
    <strong>${formatSimulationType(item.simulation_type)}</strong>
    <dl class="detail-grid">
      <dt>Status</dt><dd>${formatText(item.status)}</dd>
      <dt>Created</dt><dd>${formatDateTime(item.created_at)}</dd>
      <dt>Pattern</dt><dd>${formatText(item.transmitter_pattern)}</dd>
    </dl>
  `;
}

function renderCoverageMapHistory(item) {
  const request = item.request_json || {};
  const response = item.response_json || {};
  const imageUrl = item.coverage_map_image_url || firstArtifactUrl(item.artifacts);

  return `
    ${renderHistoryHeader(item)}
    <h3>Transmitter</h3>
    <dl class="detail-grid">
      <dt>Position</dt><dd>${formatPositionValue(request.transmitter_position)}</dd>
      <dt>Tilt</dt><dd>${formatMaybeNumber(request.tilt)} deg</dd>
      <dt>Power</dt><dd>${formatMaybeNumber(request.tx_power)} dBm</dd>
    </dl>
    <h3>Simulation area</h3>
    <dl class="detail-grid">
      <dt>Cell size</dt><dd>${formatMaybeNumber(item.cell_size_m)} m</dd>
      <dt>Center</dt><dd>${formatPositionValue(request.solver?.center)}</dd>
      <dt>Size</dt><dd>${formatPositionValue(request.solver?.size)}</dd>
      <dt>Status</dt><dd>${formatText(response.status || item.status)}</dd>
    </dl>
    ${imageUrl ? `<img src="${formatAttribute(imageUrl)}" alt="Saved coverage map" />` : ""}
  `;
}

function renderNetworkCoverageHistory(item) {
  const response = item.response_json || {};
  const grid = response.grid || {};
  const imageUrl = item.coverage_map_image_url || firstArtifactUrl(item.artifacts);
  const antennasHtml = (item.antennas || [])
    .map((antenna) => `
      <dl class="antenna-snapshot">
        <dt>Antenna</dt><dd>${formatText(antenna.antenna_code)}</dd>
        <dt>Position</dt><dd>${formatPositionValue(antenna.position)}</dd>
        <dt>Azimuth</dt><dd>${formatMaybeNumber(antenna.azimuth_deg)} deg</dd>
        <dt>Tilt</dt><dd>${formatRange(antenna.tilt)} deg</dd>
        <dt>Power</dt><dd>${formatRange(antenna.tx_power)} dBm</dd>
      </dl>
    `)
    .join("");

  return `
    ${renderHistoryHeader(item)}
    <h3>Coverage result</h3>
    <dl class="detail-grid">
      <dt>Cell size</dt><dd>${formatMaybeNumber(item.cell_size_m)} m</dd>
      <dt>Bandwidth</dt><dd>${formatMaybeNumber(item.bandwidth_mhz)} MHz</dd>
      <dt>MIMO layers</dt><dd>${item.mimo_layers || "--"}</dd>
      <dt>Grid</dt><dd>${grid.rows || "--"} x ${grid.cols || "--"}</dd>
      <dt>Cells</dt><dd>${grid.cell_count || "--"}</dd>
    </dl>
    ${imageUrl ? `<img src="${formatAttribute(imageUrl)}" alt="Saved coverage map" />` : ""}
    <h3>Antenna snapshot</h3>
    ${antennasHtml || "<p class=\"history-status\">No antenna snapshot for this simulation type.</p>"}
  `;
}

function renderSinrHistory(item) {
  const request = item.request_json || {};
  const response = item.response_json || {};

  return `
    ${renderHistoryHeader(item)}
    <h3>Transmitter antenna</h3>
    <dl class="detail-grid">
      <dt>Position</dt><dd>${formatPositionValue(request.transmitter_position)}</dd>
      <dt>Tilt</dt><dd>${formatMaybeNumber(request.tilt)} deg</dd>
      <dt>Power</dt><dd>${formatMaybeNumber(request.tx_power)} dBm</dd>
    </dl>
    <h3>Receiver antenna</h3>
    <dl class="detail-grid">
      <dt>Position</dt><dd>${formatPositionValue(request.receiver_position)}</dd>
      <dt>SINR</dt><dd>${formatMaybeNumber(response.sinr_db)} dB</dd>
      <dt>Signal power</dt><dd>${formatMaybeNumber(response.signal_power)} dBm</dd>
      <dt>Noise power</dt><dd>${formatMaybeNumber(response.noise_power)} dBm</dd>
    </dl>
    <h3>Interferer</h3>
    <dl class="detail-grid">
      <dt>Position</dt><dd>${formatPositionValue(request.interferer_position)}</dd>
      <dt>Tilt</dt><dd>${formatMaybeNumber(request.interferer_tilt)} deg</dd>
    </dl>
  `;
}

function renderThroughputHistory(item) {
  const request = item.request_json || {};
  const response = item.response_json || {};
  const comparison = response.comparison || {};

  return `
    ${renderHistoryHeader(item)}
    <h3>Transmitter and receiver</h3>
    <dl class="detail-grid">
      <dt>Transmitter</dt><dd>${formatPositionValue(request.transmitter_position)}</dd>
      <dt>Receiver</dt><dd>${formatPositionValue(request.receiver_position)}</dd>
      <dt>Power</dt><dd>${formatMaybeNumber(request.tx_power)} dBm</dd>
      <dt>Bandwidth</dt><dd>${formatMaybeNumber(request.bandwidth_mhz)} MHz</dd>
      <dt>MIMO layers</dt><dd>${request.mimo_layers || "--"}</dd>
    </dl>
    <h3>Throughput comparison</h3>
    <dl class="detail-grid">
      <dt>Base tilt</dt><dd>${formatMaybeNumber(comparison.base_tilt_deg)} deg</dd>
      <dt>Target tilt</dt><dd>${formatMaybeNumber(comparison.target_tilt_deg)} deg</dd>
      <dt>Base throughput</dt><dd>${formatMaybeNumber(comparison.base_throughput_mbps)} Mbps</dd>
      <dt>Target throughput</dt><dd>${formatMaybeNumber(comparison.target_throughput_mbps)} Mbps</dd>
      <dt>Delta</dt><dd>${formatMaybeNumber(comparison.delta_mbps)} Mbps</dd>
      <dt>Change</dt><dd>${formatMaybeNumber(comparison.percentage_change)}%</dd>
      <dt>Direction</dt><dd>${formatText(comparison.direction)}</dd>
    </dl>
  `;
}

function buildPayload() {
  return {
    antennas,
    transmitter_pattern: TRANSMITTER_PATTERN,
    solver: DEFAULT_SOLVER,
    camera: {
      position: [0, 0, 650],
      look_at: [0, 0, 0],
    },
    bandwidth_mhz: 100,
    mimo_layers: 4,
  };
}

function drawHeatmap() {
  resizeCanvas();
  const ctx = heatLayer.getContext("2d");
  ctx.clearRect(0, 0, heatLayer.width, heatLayer.height);

  if (!latestGrid) {
    return;
  }

  const cellWidth = heatLayer.width / latestGrid.cols;
  const cellHeight = heatLayer.height / latestGrid.rows;

  latestGrid.cells.forEach((cell) => {
    ctx.fillStyle = colorForSinr(cell.sinr_db);
    ctx.fillRect(
      cell.col * cellWidth,
      heatLayer.height - (cell.row + 1) * cellHeight,
      Math.ceil(cellWidth),
      Math.ceil(cellHeight),
    );
  });
}

function handleHover(event) {
  if (!latestGrid) {
    hoverCard.classList.add("hidden");
    return;
  }

  const rect = heatLayer.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const col = Math.floor((x / rect.width) * latestGrid.cols);
  const row = latestGrid.rows - 1 - Math.floor((y / rect.height) * latestGrid.rows);

  const cell = latestGrid.cells.find((item) => item.row === row && item.col === col);
  if (!cell) {
    hoverCard.classList.add("hidden");
    return;
  }

  hoverCard.innerHTML = `
    <strong>Cell (${cell.x} m, ${cell.y} m)</strong>
    <dl>
      <dt>Serving</dt><dd>${cell.serving_antenna}</dd>
      <dt>SINR</dt><dd>${cell.sinr_db} dB</dd>
      <dt>Signal</dt><dd>${cell.signal_dbm} dBm</dd>
      <dt>Throughput</dt><dd>${cell.throughput_mbps} Mbps</dd>
    </dl>
  `;
  hoverCard.style.left = `${Math.min(x + 14, rect.width - 252)}px`;
  hoverCard.style.top = `${Math.max(y - 80, 10)}px`;
  hoverCard.classList.remove("hidden");
}

function updateSummary(grid) {
  const validCells = grid.cells.filter((cell) => Number.isFinite(cell.sinr_db));
  const bestSinr = Math.max(...validCells.map((cell) => cell.sinr_db));
  const throughput = validCells
    .map((cell) => cell.throughput_mbps)
    .sort((a, b) => a - b);
  const median = throughput.length
    ? throughput[Math.floor(throughput.length / 2)]
    : 0;

  bestSinrLabel.textContent = `${bestSinr.toFixed(2)} dB`;
  medianThroughputLabel.textContent = `${median.toFixed(2)} Mbps`;
  cellCountLabel.textContent = `${grid.cells.length}`;
}

function resizeCanvas() {
  const rect = mapStage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  heatLayer.width = Math.max(1, Math.floor(rect.width * dpr));
  heatLayer.height = Math.max(1, Math.floor(rect.height * dpr));
  heatLayer.style.width = `${rect.width}px`;
  heatLayer.style.height = `${rect.height}px`;
}

function colorForSinr(sinrDb) {
  if (!Number.isFinite(sinrDb) || sinrDb <= -80) {
    return "rgba(88, 96, 105, 0.30)";
  }
  if (sinrDb < 0) {
    return "rgba(185, 28, 28, 0.42)";
  }
  if (sinrDb < 8) {
    return "rgba(234, 179, 8, 0.42)";
  }
  if (sinrDb < 18) {
    return "rgba(34, 197, 94, 0.38)";
  }
  return "rgba(14, 165, 233, 0.38)";
}

function worldToPercentX(x, solver) {
  const xMin = solver.center[0] - solver.size[0] / 2;
  return ((x - xMin) / solver.size[0]) * 100;
}

function worldToPercentY(y, solver) {
  const yMin = solver.center[1] - solver.size[1] / 2;
  return (1 - (y - yMin) / solver.size[1]) * 100;
}

function formatPosition(position) {
  return `${position[0]}, ${position[1]}, ${position[2]}`;
}

function setLoading(isLoading) {
  runButton.disabled = isLoading;
  runButton.textContent = isLoading ? "Running..." : "Run simulation";
}

function setStatus(message, isError = false) {
  statusLabel.textContent = message;
  statusLabel.classList.toggle("error-text", isError);
}

function resetAntennas() {
  antennas = structuredClone(DEFAULT_ANTENNAS);
  latestGrid = null;
  latestSolver = structuredClone(DEFAULT_SOLVER);
  coverageImage.removeAttribute("src");
  hoverCard.classList.add("hidden");
  bestSinrLabel.textContent = "--";
  medianThroughputLabel.textContent = "--";
  cellCountLabel.textContent = "--";
  cellSizeLabel.textContent = `${DEFAULT_SOLVER.cell_size} m`;
  setStatus("Ready");
  renderControls();
  renderAntennaMarkers();
  drawHeatmap();
}

function formatSimulationType(type) {
  return String(type || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function historyListSubtitle(item) {
  if (item.simulation_type === "sinr") {
    return `SINR point | ${formatText(item.status)}`;
  }

  if (item.simulation_type === "throughput_comparison") {
    return `${formatMaybeNumber(item.bandwidth_mhz)} MHz | ${item.mimo_layers || "--"} layers`;
  }

  if (item.simulation_type === "coverage_map") {
    return `Cell ${formatMaybeNumber(item.cell_size_m)} m | coverage image`;
  }

  return `Cell ${formatMaybeNumber(item.cell_size_m)} m | ${formatMaybeNumber(item.bandwidth_mhz)} MHz | ${item.mimo_layers || "--"} layers`;
}

function formatDateTime(value) {
  if (!value) {
    return "--";
  }

  return new Date(value).toLocaleString();
}

function formatMaybeNumber(value) {
  if (value === null || value === undefined) {
    return "--";
  }

  return Number(value).toFixed(Number.isInteger(Number(value)) ? 0 : 1);
}

function formatRange(range) {
  if (!range) {
    return "--";
  }

  return `${formatMaybeNumber(range.min)} / ${formatMaybeNumber(range.current)} / ${formatMaybeNumber(range.max)}`;
}

function formatPositionValue(value) {
  if (!Array.isArray(value)) {
    return "--";
  }

  return value.map(formatMaybeNumber).join(", ");
}

function formatText(value) {
  if (value === null || value === undefined || value === "") {
    return "--";
  }

  return escapeHtml(String(value));
}

function formatAttribute(value) {
  return escapeHtml(String(value || ""));
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function firstArtifactUrl(artifacts) {
  const artifact = (artifacts || []).find((item) => item.public_url);
  return artifact ? artifact.public_url : "";
}

function trashIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 3h6l1 2h4v2H4V5h4l1-2Z"></path>
      <path d="M6 9h12l-1 12H7L6 9Zm4 2v8h2v-8h-2Zm4 0v8h2v-8h-2Z"></path>
    </svg>
  `;
}

runButton.addEventListener("click", runSimulation);
resetButton.addEventListener("click", resetAntennas);
refreshHistoryButton.addEventListener("click", loadHistory);
antennasTab.addEventListener("click", showAntennaPanel);
historyTab.addEventListener("click", showHistoryPanel);
heatLayer.addEventListener("mousemove", handleHover);
heatLayer.addEventListener("mouseleave", () => {
  hoverCard.classList.add("hidden");
});
window.addEventListener("resize", () => {
  drawHeatmap();
  renderAntennaMarkers();
});

renderControls();
renderAntennaMarkers();
drawHeatmap();
