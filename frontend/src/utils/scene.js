import { DEFAULT_SOLVER } from "../constants";

export function sceneSizeMeters(scene) {
  const metricsWidth = Number(scene?.metrics?.width_m);
  const metricsHeight = Number(scene?.metrics?.height_m);

  if (isPositiveFinite(metricsWidth) && isPositiveFinite(metricsHeight)) {
    return {
      height: Number(metricsHeight.toFixed(2)),
      width: Number(metricsWidth.toFixed(2)),
    };
  }

  const bounds = scene?.bounds;
  if (!bounds) {
    return null;
  }

  const south = Number(bounds.south);
  const west = Number(bounds.west);
  const north = Number(bounds.north);
  const east = Number(bounds.east);

  if (
    !Number.isFinite(south)
    || !Number.isFinite(west)
    || !Number.isFinite(north)
    || !Number.isFinite(east)
    || south >= north
    || west >= east
  ) {
    return null;
  }

  const centerLat = (south + north) / 2;
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = metersPerDegreeLat * Math.max(
    Math.cos((centerLat * Math.PI) / 180),
    0.01,
  );

  return {
    height: Number(((north - south) * metersPerDegreeLat).toFixed(2)),
    width: Number(((east - west) * metersPerDegreeLon).toFixed(2)),
  };
}

export function solverForScene(scene, baseSolver = DEFAULT_SOLVER) {
  const size = sceneSizeMeters(scene);

  if (!size) {
    return {
      ...baseSolver,
      center: [0, 0, 0],
      size: DEFAULT_SOLVER.size,
    };
  }

  const maxGridCells = 50000;
  const area = size.width * size.height;
  const minimumCellSize = Math.ceil(Math.sqrt(area / maxGridCells));

  return {
    ...baseSolver,
    center: [0, 0, 0],
    size: [
      size.width,
      size.height,
    ],
    cell_size: Math.max(
      Number(baseSolver.cell_size) || DEFAULT_SOLVER.cell_size,
      DEFAULT_SOLVER.cell_size,
      minimumCellSize,
    ),
  };
}

export function solverBounds(solver) {
  const center = Array.isArray(solver?.center) ? solver.center : DEFAULT_SOLVER.center;
  const size = Array.isArray(solver?.size) ? solver.size : DEFAULT_SOLVER.size;
  const width = Number(size[0]);
  const height = Number(size[1]);
  const centerX = Number(center[0]);
  const centerY = Number(center[1]);

  if (
    !isPositiveFinite(width)
    || !isPositiveFinite(height)
    || !Number.isFinite(centerX)
    || !Number.isFinite(centerY)
  ) {
    return null;
  }

  return {
    xMax: centerX + width / 2,
    xMin: centerX - width / 2,
    yMax: centerY + height / 2,
    yMin: centerY - height / 2,
  };
}

export function validatePositionInsideSolver(position, solver) {
  const bounds = solverBounds(solver);

  if (!bounds) {
    return "";
  }

  if (
    position?.[0] === ""
    || position?.[1] === ""
    || position?.[2] === ""
    || position?.[0] == null
    || position?.[1] == null
    || position?.[2] == null
  ) {
    return "Enter numeric x, y, and z coordinates.";
  }

  const x = Number(position?.[0]);
  const y = Number(position?.[1]);
  const z = Number(position?.[2]);

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return "Enter numeric x, y, and z coordinates.";
  }

  if (x < bounds.xMin || x > bounds.xMax || y < bounds.yMin || y > bounds.yMax) {
    return `Must stay inside x ${formatLimit(bounds.xMin)} to ${formatLimit(bounds.xMax)} m and y ${formatLimit(bounds.yMin)} to ${formatLimit(bounds.yMax)} m.`;
  }

  return "";
}

function formatLimit(value) {
  return Number(value.toFixed(2));
}

function isPositiveFinite(value) {
  return Number.isFinite(value) && value > 0;
}
