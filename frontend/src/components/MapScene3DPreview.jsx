import { memo, useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, MercatorCoordinate, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { EMPTY_ARRAY } from "../constants";
import { getOfflineBuildings } from "../api";
import { scenePositionToLngLat } from "../utils/scene";
import {
  acquirePmtilesProtocol,
  createOfflineSceneMapStyle,
  emptyFeatureCollection,
  offlineMapDataBaseUrl,
  releasePmtilesProtocol,
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
    let fallbackController = null;
    let isLoaded = false;
    let disposed = false;
    const dataBaseUrl = offlineMapDataBaseUrl();

    const constrainSceneCenter = () => {
      if (!map) return;
      const center = map.getCenter();
      const constrained = constrainedSceneCenter(center, activeBounds);
      if (constrained.lng !== center.lng || constrained.lat !== center.lat) {
        map.jumpTo({ center: [constrained.lng, constrained.lat] });
      }
    };

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
        style: createOfflineSceneMapStyle(dataBaseUrl, activeBounds),
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
    map.on("moveend", constrainSceneCenter);
    map.on("load", async () => {
      if (disposed) return;
      isLoaded = true;
      ensureSimulationLayers(map, activeBounds);
      map.fitBounds(
        [[activeBounds.west, activeBounds.south], [activeBounds.east, activeBounds.north]],
        { padding: 24, maxZoom: viewMode === "top" ? 19 : 18, duration: 0 },
      );
      syncSimulationLayers(map, dataRef.current);

      fallbackController = new AbortController();
      try {
        await loadSceneBuildings(map, activeBounds, fallbackController.signal);
        if (!disposed) setStatus("Scene ready · drag to explore.");
      } catch {
        if (!disposed) setStatus("Scene ready · buildings unavailable.");
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
      fallbackController?.abort();
      observer.disconnect();
      map.off("mousemove", handleMouseMove);
      map.off("mouseleave", handleMouseLeave);
      map.off("click", handleClick);
      map.off("moveend", constrainSceneCenter);
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

export function constrainedSceneCenter(center, bounds) {
  return {
    lng: Math.min(Math.max(Number(center.lng), Number(bounds.west)), Number(bounds.east)),
    lat: Math.min(Math.max(Number(center.lat), Number(bounds.south)), Number(bounds.north)),
  };
}

function ensureSimulationLayers(map, bounds) {
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
  if (!map.getLayer("scene-viewport-mask")) {
    map.addLayer(createSceneViewportMaskLayer(bounds));
  }
}

function addGeoJsonSource(map, id, data) {
  if (!map.getSource(id)) map.addSource(id, { type: "geojson", data });
}

function addLayerIfMissing(map, layer) {
  if (!map.getLayer(layer.id)) map.addLayer(layer);
}

async function loadSceneBuildings(map, bounds, signal) {
  const result = await getOfflineBuildings(bounds, signal);
  const data = offlineBuildingFeatureCollection(result?.elements);
  if (!map.getSource("scene-buildings")) {
    map.addSource("scene-buildings", { type: "geojson", data });
  } else {
    map.getSource("scene-buildings").setData(data);
  }
  const buildingLayer = {
    id: "scene-buildings",
    type: "fill-extrusion",
    source: "scene-buildings",
    minzoom: 0,
    paint: {
      "fill-extrusion-color": "#64748b",
      "fill-extrusion-height": [
        "case",
        ["has", "height"],
        ["get", "height"],
        9,
      ],
      "fill-extrusion-base": 0,
      "fill-extrusion-opacity": 0.9,
    },
  };
  if (!map.getLayer(buildingLayer.id)) map.addLayer(buildingLayer);
}

function createSceneViewportMaskLayer(bounds) {
  let program = null;
  let vertexBuffer = null;
  let vertexArray = null;
  let matrixLocation = null;
  const vertices = new Float32Array(viewportMaskVertices(bounds));
  return {
    id: "scene-viewport-mask",
    type: "custom",
    renderingMode: "2d",
    onAdd(_map, gl) {
      const vertexShader = compileMaskShader(gl, gl.VERTEX_SHADER, `#version 300 es
        uniform mat4 u_matrix;
        in vec2 a_position;
        void main() { gl_Position = u_matrix * vec4(a_position, 0.0, 1.0); }
      `);
      const fragmentShader = compileMaskShader(gl, gl.FRAGMENT_SHADER, `#version 300 es
        precision highp float;
        out vec4 color;
        void main() { color = vec4(0.9294118, 0.9490196, 0.9686275, 1.0); }
      `);
      program = gl.createProgram();
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || "Unable to link scene crop shader");
      }
      matrixLocation = gl.getUniformLocation(program, "u_matrix");
      const positionLocation = gl.getAttribLocation(program, "a_position");
      vertexBuffer = gl.createBuffer();
      vertexArray = gl.createVertexArray();
      gl.bindVertexArray(vertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    },
    render(gl, options) {
      const depthEnabled = gl.isEnabled(gl.DEPTH_TEST);
      const cullEnabled = gl.isEnabled(gl.CULL_FACE);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(program);
      gl.uniformMatrix4fv(matrixLocation, false, options.defaultProjectionData.mainMatrix);
      gl.bindVertexArray(vertexArray);
      gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 2);
      gl.bindVertexArray(null);
      if (depthEnabled) gl.enable(gl.DEPTH_TEST);
      if (cullEnabled) gl.enable(gl.CULL_FACE);
    },
    onRemove(_map, gl) {
      if (vertexArray) gl.deleteVertexArray(vertexArray);
      if (vertexBuffer) gl.deleteBuffer(vertexBuffer);
      if (program) gl.deleteProgram(program);
    },
  };
}

function compileMaskShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "Unable to compile scene crop shader";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

export function viewportMaskVertices(bounds) {
  const worldNorthWest = MercatorCoordinate.fromLngLat([-180, 85]);
  const worldSouthEast = MercatorCoordinate.fromLngLat([180, -85]);
  const sceneNorthWest = MercatorCoordinate.fromLngLat([Number(bounds.west), Number(bounds.north)]);
  const sceneSouthEast = MercatorCoordinate.fromLngLat([Number(bounds.east), Number(bounds.south)]);
  const vertices = [];
  pushMaskRectangle(vertices, worldNorthWest.x, worldNorthWest.y, worldSouthEast.x, sceneNorthWest.y);
  pushMaskRectangle(vertices, worldNorthWest.x, sceneSouthEast.y, worldSouthEast.x, worldSouthEast.y);
  pushMaskRectangle(vertices, worldNorthWest.x, sceneNorthWest.y, sceneNorthWest.x, sceneSouthEast.y);
  pushMaskRectangle(vertices, sceneSouthEast.x, sceneNorthWest.y, worldSouthEast.x, sceneSouthEast.y);
  return vertices;
}

function pushMaskRectangle(vertices, west, north, east, south) {
  vertices.push(
    west, north, east, north, east, south,
    west, north, east, south, west, south,
  );
}

function offlineBuildingFeatureCollection(elements) {
  const features = (Array.isArray(elements) ? elements : []).flatMap((element, index) => {
    const points = Array.isArray(element?.geometry) ? element.geometry : [];
    const coordinates = points
      .map((point) => [Number(point.lon), Number(point.lat)])
      .filter(([longitude, latitude]) => Number.isFinite(longitude) && Number.isFinite(latitude));
    if (coordinates.length < 3) return [];
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) coordinates.push(first);
    return [{
      type: "Feature",
      properties: { height: inferOfflineBuildingHeight(element?.tags) },
      geometry: { type: "Polygon", coordinates: [coordinates] },
      id: element?.id || `offline-building-${index}`,
    }];
  });
  return { type: "FeatureCollection", features };
}

function inferOfflineBuildingHeight(tags = {}) {
  const explicit = parseBuildingMeters(tags.height || tags["building:height"]);
  if (Number.isFinite(explicit) && explicit > 0) return Math.min(Math.max(explicit, 2.5), 160);
  const levels = Number.parseFloat(tags["building:levels"] || tags.levels);
  if (Number.isFinite(levels) && levels > 0) return Math.min(Math.max(levels * 3.1, 2.5), 160);
  const type = String(tags.building || "").toLowerCase();
  if (["apartments", "residential", "hotel", "dormitory"].includes(type)) return 18;
  if (["office", "commercial", "retail", "public", "hospital"].includes(type)) return 16;
  if (["industrial", "warehouse", "manufacture"].includes(type)) return 10;
  if (["house", "detached", "semidetached_house", "terrace", "garage"].includes(type)) return 7;
  if (["church", "cathedral", "temple"].includes(type)) return 24;
  return 9;
}

function parseBuildingMeters(value) {
  if (value === null || value === undefined || value === "") return NaN;
  const text = String(value).trim().toLowerCase();
  const numeric = Number.parseFloat(text.replace(",", "."));
  if (!Number.isFinite(numeric)) return NaN;
  return text.includes("ft") || text.includes("feet") ? numeric * 0.3048 : numeric;
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
  offlineBuildingFeatureCollection,
  rsrpUserFeatures,
  signalLinkFeatures,
  worldPositionToLngLat,
};
