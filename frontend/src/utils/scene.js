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

function isPositiveFinite(value) {
  return Number.isFinite(value) && value > 0;
}
