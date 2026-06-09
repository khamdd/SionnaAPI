const API_BASE_URL = "http://127.0.0.1:8000";

const DEFAULT_SOLVER = {
  max_depth: 2,
  samples_per_tx: 20000,
  cell_size: 5,
  center: [0, 0, 0],
  size: [300, 300],
};

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

const antennaList = document.querySelector("#antenna-list");
const antennaLayer = document.querySelector("#antenna-layer");
const mapStage = document.querySelector("#map-stage");
const coverageImage = document.querySelector("#coverage-image");
const heatLayer = document.querySelector("#heat-layer");
const hoverCard = document.querySelector("#hover-card");
const runButton = document.querySelector("#run-simulation");
const resetButton = document.querySelector("#reset-antennas");
const statusLabel = document.querySelector("#run-status");
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
    pattern: "tr38901",
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
  } catch (error) {
    setStatus(`Simulation failed: ${error.message}`, true);
  } finally {
    setLoading(false);
  }
}

function buildPayload() {
  return {
    antennas,
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

runButton.addEventListener("click", runSimulation);
resetButton.addEventListener("click", resetAntennas);
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
