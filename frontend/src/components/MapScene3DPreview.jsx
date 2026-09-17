import { memo, useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { EMPTY_ARRAY } from "../constants";
import { scenePositionToLngLat } from "../utils/scene";
import {
  acquirePmtilesProtocol,
  createBuildingRegionManager,
  createOfflineSceneMapStyle,
  emptyFeatureCollection,
  ensureSelectionLayers,
  offlineMapDataBaseUrl,
  releasePmtilesProtocol,
  updateSelectionBounds,
} from "./scene-chooser/sceneChooserMap";

const previewReadyCache = new Set();

export function hasCachedSceneModel(bounds) {
  return Boolean(bounds && previewReadyCache.has(sceneBoundsKey(bounds)));
}

function MapScene3DPreview({
  antennas = EMPTY_ARRAY,
  bounds,
  className = "",
  coverageGrid = null,
  coverageDisplayMode = "quality",
  coverageImageUrl = "",
  onCoverageCellSelect = null,
  onLoadingChange = null,
  onRsrpUserSelect = null,
  rsrpUsers = EMPTY_ARRAY,
  sceneName,
  selectedCoverageCell = null,
  selectedRsrpUser = null,
  showOverlay = true,
  signalLinks = EMPTY_ARRAY,
  solver = null,
  viewMode = "oblique",
  wardBoundary = null,
}) {
  const mapHostRef = useRef(null);
  const mapRef = useRef(null);
  const dataRef = useRef({});
  const [status, setStatus] = useState("Loading vector scene...");
  const boundsKey = sceneBoundsKey(bounds);

  dataRef.current = {
    antennas,
    bounds,
    coverageDisplayMode,
    coverageGrid,
    coverageImageUrl,
    onCoverageCellSelect,
    onLoadingChange,
    onRsrpUserSelect,
    rsrpUsers,
    selectedCoverageCell,
    selectedRsrpUser,
    signalLinks,
    solver,
    wardBoundary,
  };

  useEffect(() => {
    const map = mapRef.current;
    if (map) {
      syncSimulationLayers(map, dataRef.current);
    }
  }, [
    antennas,
    bounds,
    coverageDisplayMode,
    coverageGrid,
    coverageImageUrl,
    rsrpUsers,
    selectedCoverageCell,
    selectedRsrpUser,
    signalLinks,
    solver,
    wardBoundary,
  ]);

  useEffect(() => {
    const host = mapHostRef.current;
    const activeBounds = dataRef.current.bounds;
    const loadingCallback = dataRef.current.onLoadingChange;
    if (!host || !activeBounds) {
      setStatus("No scene bounds available.");
      loadingCallback?.(false);
      return undefined;
    }

    const isReady = hasCachedSceneModel(activeBounds);
    let map = null;
    let buildingManager = null;
    let isLoaded = false;
    let disposed = false;
    const dataBaseUrl = offlineMapDataBaseUrl();

    setStatus(isReady ? "Cached vector scene ready." : "Loading vector scene...");
    loadingCallback?.(!isReady);
    setWorkerUrl(workerUrl);
    acquirePmtilesProtocol();

    const handleMouseMove = (event) => {
      if (!map || !map.isStyleLoaded() || event.originalEvent.buttons !== 0) return;
      const data = dataRef.current;
      const hits = map.queryRenderedFeatures(event.point, {
        layers: ["scene-rsrp-users"],
      });
      const userHit = hits.find((feature) => feature.layer.id === "scene-rsrp-users");
      const cell = coverageCellAtLngLat(event.lngLat, data);
      map.getCanvas().style.cursor = userHit || cell ? "pointer" : "";
      setHoverCell(
        map,
        cell,
        data,
      );
    };

    const handleMouseLeave = () => {
      if (map) {
        map.getCanvas().style.cursor = "";
        setHoverCell(map, null, dataRef.current);
      }
    };

    const handleClick = (event) => {
      if (!map) return;
      const data = dataRef.current;
      const hits = map.queryRenderedFeatures(event.point, {
        layers: ["scene-rsrp-users"],
      });
      const userHit = hits.find((feature) => feature.layer.id === "scene-rsrp-users");
      if (userHit && data.onRsrpUserSelect) {
        const user = data.rsrpUsers[Number(userHit.properties?.userIndex)];
        if (user) {
          data.onRsrpUserSelect(user);
          return;
        }
      }
      const cell = coverageCellAtLngLat(event.lngLat, data);
      if (cell && data.onCoverageCellSelect) data.onCoverageCellSelect(cell);
    };

    try {
      map = new MapLibreMap({
        container: host,
        style: createOfflineSceneMapStyle(dataBaseUrl),
        attributionControl: false,
        antialias: false,
        renderWorldCopies: false,
        maxZoom: 20,
        minZoom: 5,
        pitch: viewMode === "top" ? 0 : 48,
        bearing: viewMode === "top" ? 0 : -18,
      });
    } catch {
      releasePmtilesProtocol();
      setStatus("Map unavailable.");
      loadingCallback?.(false);
      return undefined;
    }

    mapRef.current = map;
    map.on("mousemove", handleMouseMove);
    map.on("mouseleave", handleMouseLeave);
    map.on("click", handleClick);
    map.on("load", async () => {
      if (disposed) return;
      isLoaded = true;
      ensureSelectionLayers(map);
      updateSelectionBounds(map, activeBounds);
      ensureSimulationLayers(map);
      map.fitBounds(
        [[activeBounds.west, activeBounds.south], [activeBounds.east, activeBounds.north]],
        { padding: 24, maxZoom: viewMode === "top" ? 19 : 18, duration: 0 },
      );
      syncSimulationLayers(map, dataRef.current);

      buildingManager = createBuildingRegionManager(map, dataBaseUrl, { minZoom: 13 });
      try {
        await buildingManager.load();
        if (!disposed) setStatus("Vector scene ready · drag to explore.");
      } catch {
        if (!disposed) setStatus("Vector scene ready · building tiles unavailable.");
      } finally {
        if (!disposed) {
          previewReadyCache.add(boundsKey);
          loadingCallback?.(false);
        }
      }
    });
    map.on("error", () => {
      if (!isLoaded && !disposed) {
        setStatus("Map unavailable.");
        loadingCallback?.(false);
      }
    });

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(host);
    window.setTimeout(() => map.resize(), 0);

    return () => {
      disposed = true;
      buildingManager?.dispose();
      observer.disconnect();
      map.off("mousemove", handleMouseMove);
      map.off("mouseleave", handleMouseLeave);
      map.off("click", handleClick);
      map.remove();
      mapRef.current = null;
      releasePmtilesProtocol();
      loadingCallback?.(false);
    };
  }, [boundsKey, viewMode]);

  return (
    <div className={["scene-3d-preview", className].filter(Boolean).join(" ")}>
      <div
        ref={mapHostRef}
        className="scene-3d-canvas"
        aria-label="Interactive 3D scene. Drag to move, right-drag to rotate, and scroll or pinch to zoom."
      />
      <div className="scene-3d-navigation-hint" aria-hidden="true">
        Drag to move · Right-drag to rotate · Scroll/pinch to zoom
      </div>
      {showOverlay && (
        <div className="scene-3d-overlay">
          <strong>{sceneName || "Selected scene"}</strong>
          <span>{status}</span>
        </div>
      )}
    </div>
  );
}

export default memo(MapScene3DPreview);

function ensureSimulationLayers(map) {
  [
    "scene-coverage-hover", "scene-selected-coverage",
    "scene-antennas", "scene-signal-links",
    "scene-rsrp-users", "scene-selected-rsrp-user", "scene-ward-boundary",
  ].forEach((id) => addGeoJsonSource(map, id, emptyFeatureCollection()));

  addLayerIfMissing(map, {
    id: "scene-coverage-hover", type: "line", source: "scene-coverage-hover",
    paint: { "line-color": "#0f172a", "line-width": 2.5 },
  });
  addLayerIfMissing(map, {
    id: "scene-selected-coverage-fill", type: "fill", source: "scene-selected-coverage",
    paint: { "fill-color": "#ffffff", "fill-opacity": 0.12 },
  });
  addLayerIfMissing(map, {
    id: "scene-selected-coverage-line", type: "line", source: "scene-selected-coverage",
    paint: { "line-color": "#111827", "line-width": 3 },
  });
  addLayerIfMissing(map, {
    id: "scene-signal-links", type: "line", source: "scene-signal-links",
    paint: {
      "line-color": ["get", "color"], "line-opacity": ["get", "opacity"],
      "line-width": ["get", "width"],
    },
  });
  addLayerIfMissing(map, {
    id: "scene-signal-labels", type: "symbol", source: "scene-signal-links",
    layout: {
      "text-field": ["coalesce", ["get", "label"], ""], "text-size": 11,
      "text-allow-overlap": true, "text-ignore-placement": true,
    },
    paint: { "text-color": ["get", "color"], "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
  });
  addLayerIfMissing(map, {
    id: "scene-antenna-direction", type: "line", source: "scene-antennas",
    filter: ["==", ["get", "kind"], "direction"],
    paint: { "line-color": ["get", "color"], "line-width": 2.5 },
  });
  addLayerIfMissing(map, {
    id: "scene-antennas", type: "circle", source: "scene-antennas",
    filter: ["!=", ["get", "kind"], "direction"],
    paint: {
      "circle-radius": ["case", ["==", ["get", "receiver"], true], 5, 7],
      "circle-color": ["get", "color"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 2,
    },
  });
  addLayerIfMissing(map, {
    id: "scene-antenna-labels", type: "symbol", source: "scene-antennas",
    filter: ["!=", ["get", "kind"], "direction"],
    layout: {
      "text-field": ["get", "label"], "text-size": 11, "text-offset": [0, 1.3],
      "text-allow-overlap": true, "text-ignore-placement": true,
    },
    paint: { "text-color": ["get", "labelColor"], "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
  });
  addLayerIfMissing(map, {
    id: "scene-rsrp-users", type: "circle", source: "scene-rsrp-users",
    paint: {
      "circle-radius": 4, "circle-color": ["get", "color"],
      "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5,
    },
  });
  addLayerIfMissing(map, {
    id: "scene-selected-rsrp-user", type: "circle", source: "scene-selected-rsrp-user",
    paint: {
      "circle-radius": 8, "circle-color": "rgba(255,255,255,0.12)",
      "circle-stroke-color": "#0f172a", "circle-stroke-width": 2,
    },
  });
  addLayerIfMissing(map, {
    id: "scene-ward-boundary-fill", type: "fill", source: "scene-ward-boundary",
    paint: { "fill-color": "#dc2626", "fill-opacity": 0.06 },
  });
  addLayerIfMissing(map, {
    id: "scene-ward-boundary-casing", type: "line", source: "scene-ward-boundary",
    paint: { "line-color": "#ffffff", "line-width": 5 },
  });
  addLayerIfMissing(map, {
    id: "scene-ward-boundary-line", type: "line", source: "scene-ward-boundary",
    paint: { "line-color": "#dc2626", "line-width": 3 },
  });
}

function addGeoJsonSource(map, id, data) {
  if (!map.getSource(id)) map.addSource(id, { type: "geojson", data });
}

function addLayerIfMissing(map, layer) {
  if (!map.getLayer(layer.id)) map.addLayer(layer);
}

function syncSimulationLayers(map, data) {
  if (!map.isStyleLoaded() || !data.bounds) return;
  syncCoverageRaster(map, data);
  map.getSource("scene-coverage-hover")?.setData(
    data.hoverCell ? (cellFeature(data.hoverCell, data.solver, data.bounds) || emptyFeatureCollection()) : emptyFeatureCollection(),
  );
  map.getSource("scene-selected-coverage")?.setData(
    data.selectedCoverageCell ? (cellFeature(data.selectedCoverageCell, data.solver, data.bounds) || emptyFeatureCollection()) : emptyFeatureCollection(),
  );
  syncCoverageImage(map, data);
  map.getSource("scene-antennas")?.setData(antennaFeatures(data.antennas, data.solver, data.bounds));
  map.getSource("scene-signal-links")?.setData(signalLinkFeatures(data.signalLinks, data.solver, data.bounds));
  map.getSource("scene-rsrp-users")?.setData(rsrpUserFeatures(data.rsrpUsers, data.solver, data.bounds));
  map.getSource("scene-selected-rsrp-user")?.setData(
    data.selectedRsrpUser ? rsrpUserFeature(data.selectedRsrpUser, data.solver, data.bounds) : emptyFeatureCollection(),
  );
  map.getSource("scene-ward-boundary")?.setData(data.wardBoundary || emptyFeatureCollection());
}

function syncCoverageImage(map, data) {
  const sourceId = "scene-coverage-image";
  const layerId = "scene-coverage-image-layer";
  const shouldShow = Boolean(data.coverageImageUrl && !data.coverageGrid && data.bounds);

  if (!shouldShow) {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    map.__sceneCoverageImageKey = "";
    return;
  }

  const key = `${data.coverageImageUrl}:${sceneBoundsKey(data.bounds)}`;
  if (map.__sceneCoverageImageKey === key && map.getSource(sourceId)) return;
  if (map.getSource(sourceId)) {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    map.removeSource(sourceId);
  }

  map.addSource(sourceId, {
    type: "image",
    url: data.coverageImageUrl,
    coordinates: [
      [data.bounds.west, data.bounds.north],
      [data.bounds.east, data.bounds.north],
      [data.bounds.east, data.bounds.south],
      [data.bounds.west, data.bounds.south],
    ],
  });
  map.addLayer({
    id: layerId,
    type: "raster",
    source: sourceId,
    paint: { "raster-opacity": 0.72 },
  });
  map.__sceneCoverageImageKey = key;
}

function syncCoverageRaster(map, data) {
  const sourceId = "scene-coverage-raster";
  const layerId = "scene-coverage-raster-layer";
  const grid = data.coverageGrid;

  if (!grid || !data.solver || !data.bounds) {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
    map.__sceneCoverageRasterGrid = null;
    map.__sceneCoverageRasterMode = null;
    return;
  }

  if (
    map.__sceneCoverageRasterGrid === grid
    && map.__sceneCoverageRasterMode === data.coverageDisplayMode
    && map.getSource(sourceId)
  ) return;
  if (map.getLayer(layerId)) map.removeLayer(layerId);
  if (map.getSource(sourceId)) map.removeSource(sourceId);

  const image = renderCoverageGrid(grid, data.coverageDisplayMode);
  if (!image) return;
  map.addSource(sourceId, {
    type: "image",
    url: image,
    coordinates: [
      [data.bounds.west, data.bounds.north],
      [data.bounds.east, data.bounds.north],
      [data.bounds.east, data.bounds.south],
      [data.bounds.west, data.bounds.south],
    ],
  });
  map.addLayer({
    id: layerId,
    type: "raster",
    source: sourceId,
    paint: { "raster-opacity": 0.76, "raster-fade-duration": 0 },
  });
  map.__sceneCoverageRasterGrid = grid;
  map.__sceneCoverageRasterMode = data.coverageDisplayMode;
}

function renderCoverageGrid(grid, displayMode) {
  const rows = Number(grid.rows);
  const cols = Number(grid.cols);
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows <= 0 || cols <= 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.clearRect(0, 0, cols, rows);
  grid.cells.forEach((cell) => {
    const row = Number(cell.row);
    const col = Number(cell.col);
    if (!Number.isInteger(row) || !Number.isInteger(col)) return;
    context.fillStyle = colorForCoverageCell(cell, displayMode);
    context.fillRect(col, rows - row - 1, 1, 1);
  });
  return canvas.toDataURL("image/png");
}

function setHoverCell(map, cell, data) {
  data.hoverCell = cell || null;
  map.getSource("scene-coverage-hover")?.setData(
    cell && data.solver && data.bounds
      ? (cellFeature(cell, data.solver, data.bounds) || emptyFeatureCollection())
      : emptyFeatureCollection(),
  );
}

function antennaFeatures(antennas, solver, bounds) {
  if (!solver || !bounds || !Array.isArray(antennas)) return emptyFeatureCollection();
  const features = [];
  antennas.forEach((antenna, index) => {
    const scenePosition = antennaScenePosition(antenna, bounds);
    const position = worldPositionToLngLat(scenePosition, solver, bounds);
    if (!position) return;
    const palette = antennaPalette(antenna.id);
    const id = antenna.id || `A${index + 1}`;
    features.push({
      type: "Feature",
      properties: {
        color: palette.color, kind: antenna.kind === "receiver-point" ? "receiver" : "antenna",
        label: id, labelColor: palette.labelColor, receiver: antenna.kind === "receiver-point",
      },
      geometry: { type: "Point", coordinates: position },
    });
    if (antenna.kind !== "receiver-point") {
      const azimuth = Number(antenna.azimuth);
      const length = Math.max(Number(solver.cell_size) || 5, 5) * 4;
      const end = worldPositionToLngLat([
        Number(scenePosition[0]) + Math.sin((azimuth * Math.PI) / 180) * length,
        Number(scenePosition[1]) + Math.cos((azimuth * Math.PI) / 180) * length,
        0,
      ], solver, bounds);
      if (end) features.push({
        type: "Feature",
        properties: { color: palette.color, kind: "direction" },
        geometry: { type: "LineString", coordinates: [position, end] },
      });
    }
  });
  return { type: "FeatureCollection", features };
}

function signalLinkFeatures(links, solver, bounds) {
  if (!solver || !bounds || !Array.isArray(links)) return emptyFeatureCollection();
  return {
    type: "FeatureCollection",
    features: links.flatMap((link) => {
      const start = worldPositionToLngLat(link.from, solver, bounds);
      const end = worldPositionToLngLat(link.to, solver, bounds);
      if (!start || !end) return [];
      const palette = signalLinkPalette(link.type);
      return [{
        type: "Feature",
        properties: { color: palette.color, label: link.label || "", opacity: palette.opacity, width: palette.width },
        geometry: { type: "LineString", coordinates: [start, [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2], end] },
      }];
    }),
  };
}

function rsrpUserFeatures(users, solver, bounds) {
  if (!solver || !bounds || !Array.isArray(users)) return emptyFeatureCollection();
  return {
    type: "FeatureCollection",
    features: users.flatMap((user, index) => {
      const position = worldPositionToLngLat(user.position, solver, bounds);
      return position ? [{
        type: "Feature",
        properties: { color: rsrpQualityColor(user.quality), userIndex: index },
        geometry: { type: "Point", coordinates: position },
      }] : [];
    }),
  };
}

function rsrpUserFeature(user, solver, bounds) {
  const position = worldPositionToLngLat(user?.position, solver, bounds);
  return position
    ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: position } }] }
    : emptyFeatureCollection();
}

function coverageFeatures(grid, solver, bounds, displayMode) {
  if (!grid || !solver || !bounds || !Array.isArray(grid.cells)) return emptyFeatureCollection();
  return {
    type: "FeatureCollection",
    features: grid.cells.flatMap((cell, index) => {
      const feature = cellFeature(cell, solver, bounds);
      if (!feature) return [];
      feature.properties = { cellIndex: index, color: colorForCoverageCell(cell, displayMode) };
      return [feature];
    }),
  };
}

function cellFeature(cell, solver, bounds) {
  const ring = cellRing(cell, solver, bounds);
  return ring && ring.length >= 4
    ? { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }
    : null;
}

function cellRing(cell, solver, bounds) {
  const sizeX = Number(solver?.size?.[0]) || 300;
  const sizeY = Number(solver?.size?.[1]) || 300;
  const centerX = Number(solver?.center?.[0]) || 0;
  const centerY = Number(solver?.center?.[1]) || 0;
  const cellSize = Number(solver?.cell_size) || 5;
  const row = Number(cell?.row);
  const col = Number(cell?.col);
  if (!Number.isInteger(row) || !Number.isInteger(col)) return null;
  const xMin = centerX - sizeX / 2 + col * cellSize;
  const yMin = centerY - sizeY / 2 + row * cellSize;
  return [[xMin, yMin], [xMin + cellSize, yMin], [xMin + cellSize, yMin + cellSize], [xMin, yMin + cellSize], [xMin, yMin]]
    .map(([x, y]) => {
      const point = scenePositionToLngLat([x - centerX, y - centerY, 0], bounds);
      return point ? [point.longitude, point.latitude] : null;
    })
    .filter(Boolean);
}

function coverageCellAtLngLat(lngLat, data) {
  const grid = data.coverageGrid;
  const solver = data.solver;
  const bounds = data.bounds;
  if (!grid || !solver || !bounds || !lngLat || !Array.isArray(grid.cells)) return null;
  const centerLng = (Number(bounds.west) + Number(bounds.east)) / 2;
  const centerLat = (Number(bounds.south) + Number(bounds.north)) / 2;
  const centerX = Number(solver.center?.[0]) || 0;
  const centerY = Number(solver.center?.[1]) || 0;
  const worldX = centerX + (Number(lngLat.lng) - centerLng) * metersPerDegreeLng(bounds);
  const worldY = centerY + (Number(lngLat.lat) - centerLat) * 111320;
  const cellSize = Number(solver.cell_size) || 5;
  const col = Math.floor((worldX - (centerX - Number(solver.size?.[0] || 300) / 2)) / cellSize);
  const row = Math.floor((worldY - (centerY - Number(solver.size?.[1] || 300) / 2)) / cellSize);
  return grid.cells.find((cell) => Number(cell.row) === row && Number(cell.col) === col) || null;
}

function worldPositionToLngLat(position, solver, bounds) {
  if (!Array.isArray(position) || position.length < 2 || !solver || !bounds) return null;
  const centerX = Number(solver.center?.[0]) || 0;
  const centerY = Number(solver.center?.[1]) || 0;
  const point = scenePositionToLngLat([
    Number(position[0]) - centerX, Number(position[1]) - centerY, Number(position[2]) || 0,
  ], bounds);
  return point ? [point.longitude, point.latitude] : null;
}

function antennaScenePosition(antenna, bounds) {
  if (Number.isFinite(Number(antenna?.longitude)) && Number.isFinite(Number(antenna?.latitude))) {
    return [
      (Number(antenna.longitude) - (bounds.west + bounds.east) / 2) * metersPerDegreeLng(bounds),
      (Number(antenna.latitude) - (bounds.south + bounds.north) / 2) * 111320,
      Number(antenna.height_m) || 0,
    ];
  }
  return Array.isArray(antenna?.position) ? antenna.position : null;
}

function metersPerDegreeLng(bounds) {
  const centerLat = ((Number(bounds.south) + Number(bounds.north)) / 2) * (Math.PI / 180);
  return 111320 * Math.max(Math.cos(centerLat), 0.01);
}

function antennaPalette(id = "") {
  const normalized = String(id).toUpperCase();
  if (normalized.includes("RX")) return { color: "#2563eb", labelColor: "#1d4ed8" };
  if (normalized.includes("INT")) return { color: "#f97316", labelColor: "#c2410c" };
  return { color: "#ef4444", labelColor: "#111827" };
}

function signalLinkPalette(type = "") {
  if (type === "interference") return { color: "#ef4444", opacity: 0.82, width: 3 };
  if (type === "comparison") return { color: "#38bdf8", opacity: 0.7, width: 3 };
  return { color: "#22c55e", opacity: 0.82, width: 4 };
}

function rsrpQualityColor(quality) {
  if (quality === "excellent") return "#16a34a";
  if (quality === "good") return "#84cc16";
  if (quality === "fair") return "#facc15";
  if (quality === "poor") return "#f97316";
  return "#ef4444";
}

function colorForCoverageCell(cell, coverageDisplayMode = "quality") {
  if (coverageDisplayMode === "overlap") {
    const level = String(cell.overlap_level || "no_coverage");
    if (level === "single_coverage") return "rgba(37, 99, 235, 0.58)";
    if (level === "normal_overlap") return "rgba(34, 197, 94, 0.64)";
    if (level === "high_overlap") return "rgba(234, 179, 8, 0.72)";
    if (level === "excessive_overlap") return "rgba(220, 38, 38, 0.76)";
    return "rgba(107, 114, 128, 0.24)";
  }
  const sinr = Number(cell.sinr_db);
  if (Number.isFinite(sinr) && sinr > -80) {
    if (sinr < 0) return "rgba(185, 28, 28, 0.72)";
    if (sinr < 8) return "rgba(234, 179, 8, 0.72)";
    if (sinr < 18) return "rgba(34, 197, 94, 0.68)";
    return "rgba(14, 165, 233, 0.68)";
  }
  const throughput = Number(cell.throughput_mbps);
  if (Number.isFinite(throughput) && throughput > 0) {
    if (throughput < 100) return "rgba(185, 28, 28, 0.66)";
    if (throughput < 500) return "rgba(234, 179, 8, 0.66)";
    if (throughput < 1200) return "rgba(34, 197, 94, 0.62)";
    return "rgba(14, 165, 233, 0.62)";
  }
  const signal = Number(cell.signal_dbm);
  if (Number.isFinite(signal) && signal > -130) {
    if (signal < -105) return "rgba(185, 28, 28, 0.54)";
    if (signal < -90) return "rgba(234, 179, 8, 0.54)";
    if (signal < -75) return "rgba(34, 197, 94, 0.5)";
    return "rgba(14, 165, 233, 0.5)";
  }
  return "rgba(107, 114, 128, 0.28)";
}

function sceneBoundsKey(value) {
  return value ? [value.south, value.west, value.north, value.east].join(":") : "";
}

export {
  antennaFeatures,
  cellFeature,
  colorForCoverageCell,
  coverageFeatures,
  coverageCellAtLngLat,
  rsrpUserFeatures,
  signalLinkFeatures,
  worldPositionToLngLat,
};
