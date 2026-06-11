export function drawHeatmap(canvas, mapStage, grid) {
  if (!canvas || !mapStage) {
    return;
  }

  const rect = mapStage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!grid) {
    return;
  }

  const cellWidth = canvas.width / grid.cols;
  const cellHeight = canvas.height / grid.rows;

  grid.cells.forEach((cell) => {
    ctx.fillStyle = colorForSinr(cell.sinr_db);
    ctx.fillRect(
      cell.col * cellWidth,
      canvas.height - (cell.row + 1) * cellHeight,
      Math.ceil(cellWidth),
      Math.ceil(cellHeight),
    );
  });
}

export function summarizeGrid(grid) {
  if (!grid || !Array.isArray(grid.cells)) {
    return {
      bestSinr: "--",
      medianThroughput: "--",
      cellCount: "--",
    };
  }

  const validCells = grid.cells.filter((cell) => Number.isFinite(cell.sinr_db));
  const bestSinr = validCells.length
    ? Math.max(...validCells.map((cell) => cell.sinr_db))
    : null;
  const throughput = validCells
    .map((cell) => cell.throughput_mbps)
    .sort((a, b) => a - b);
  const median = throughput.length
    ? throughput[Math.floor(throughput.length / 2)]
    : null;

  return {
    bestSinr: bestSinr === null ? "--" : `${bestSinr.toFixed(2)} dB`,
    medianThroughput: median === null ? "--" : `${median.toFixed(2)} Mbps`,
    cellCount: `${grid.cells.length}`,
  };
}

export function worldToPercentX(x, solver) {
  const xMin = solver.center[0] - solver.size[0] / 2;
  return ((x - xMin) / solver.size[0]) * 100;
}

export function worldToPercentY(y, solver) {
  const yMin = solver.center[1] - solver.size[1] / 2;
  return (1 - (y - yMin) / solver.size[1]) * 100;
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
