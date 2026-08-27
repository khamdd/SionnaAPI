import { useEffect, useRef, useState } from "react";
import {
  Map,
  NavigationControl,
  addProtocol,
  removeProtocol,
  setWorkerUrl,
} from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { activateScene, createScenePreview, deleteScene } from "../api";
import {
  MAX_SCENE_AREA_KM2,
  SCENE_CHOOSER_DEFAULT_CENTER,
  SCENE_CHOOSER_DEFAULT_ZOOM,
} from "../constants";
import { formatMaybeNumber } from "../utils/format";

export default function SceneChooserPage({
  onCancel,
  onLimitReached,
  onSceneActivated,
}) {
  const mapNodeRef = useRef(null);
  const mapRef = useRef(null);
  const buildingRegionManagerRef = useRef(null);
  const drawStartRef = useRef(null);
  const mapViewRef = useRef(null);
  const [isSelectingArea, setIsSelectingArea] = useState(false);
  const [isMapReady, setIsMapReady] = useState(false);
  const [selectedCityId, setSelectedCityId] = useState("");
  const [sceneName, setSceneName] = useState("");
  const [bounds, setBounds] = useState(null);
  const [previewBounds, setPreviewBounds] = useState(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [status, setStatus] = useState("Move and zoom the map, then click Select area to draw a scene rectangle.");
  const [sceneNameError, setSceneNameError] = useState("");
  const [error, setError] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const metrics = bounds ? calculateMetrics(bounds) : null;
  const isTooLarge = metrics && metrics.areaKm2 > MAX_SCENE_AREA_KM2;

  useEffect(() => {
    const node = mapNodeRef.current;

    if (!node || mapRef.current) {
      return undefined;
    }

    setWorkerUrl(workerUrl);

    setIsMapReady(false);

    const protocol = new Protocol();
    addProtocol("pmtiles", protocol.tile);

    const savedView = mapViewRef.current;
    const defaultCenter = [
      SCENE_CHOOSER_DEFAULT_CENTER[1],
      SCENE_CHOOSER_DEFAULT_CENTER[0],
    ];
    const dataBaseUrl = offlineMapDataBaseUrl();
    const map = new Map({
      container: node,
      center: savedView?.center || defaultCenter,
      zoom: savedView?.zoom || SCENE_CHOOSER_DEFAULT_ZOOM,
      minZoom: 2,
      maxZoom: 18,
      pitch: savedView?.pitch ?? 48,
      bearing: savedView?.bearing ?? -18,
      style: createOfflineSceneMapStyle(dataBaseUrl),
      attributionControl: false,
    });

    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");

    map.on("load", () => {
      ensureSelectionLayers(map);
      setIsMapReady(true);
      setStatus("Offline map loaded. Move and zoom the map, then click Select area to draw a scene rectangle.");
      setError(false);

      const buildingRegionManager = createBuildingRegionManager(map, dataBaseUrl);
      buildingRegionManagerRef.current = buildingRegionManager;
      buildingRegionManager.load().catch((caught) => {
        setStatus(`Offline map loaded, but buildings could not be loaded: ${caught.message}`);
        setError(true);
      });
    });

    map.on("error", (event) => {
      const message = event?.error?.message || "offline map tiles could not be loaded";
      setIsMapReady(false);
      setStatus(`Map failed to load: ${message}`);
      setError(true);
    });

    mapRef.current = map;

    const observer = new ResizeObserver(() => {
      map.resize();
    });
    observer.observe(node);

    setTimeout(() => map.resize(), 0);

    return () => {
      const center = map.getCenter();
      mapViewRef.current = {
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      };
      observer.disconnect();
      buildingRegionManagerRef.current?.dispose();
      buildingRegionManagerRef.current = null;
      map.remove();
      mapRef.current = null;

      try {
        removeProtocol("pmtiles");
      } catch {
        // MapLibre throws if the protocol was already removed by a hot reload.
      }
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !isMapReady) {
      return undefined;
    }

    const container = map.getCanvasContainer();
    container.classList.toggle("selecting-area", isSelectingArea);

    if (!isSelectingArea || isBusy || isPreviewing) {
      map.dragPan.enable();
      return undefined;
    }

    map.dragPan.disable();
    setStatus("Selection mode enabled. Drag on the map to draw a small scene area.");

    function handleMouseDown(event) {
      if (event.originalEvent.button !== 0) {
        return;
      }

      drawStartRef.current = event.lngLat;
      setBounds(null);
      removeRectangle();
      updateSelectionBounds(map, boundsFromLngLats(event.lngLat, event.lngLat));
    }

    function handleMouseMove(event) {
      if (!drawStartRef.current) {
        return;
      }

      updateSelectionBounds(map, boundsFromLngLats(drawStartRef.current, event.lngLat));
    }

    function handleMouseUp(event) {
      if (!drawStartRef.current) {
        return;
      }

      const nextBounds = boundsFromLngLats(drawStartRef.current, event.lngLat);
      updateSelectionBounds(map, nextBounds);
      drawStartRef.current = null;
      setBounds(nextBounds);
      setIsSelectingArea(false);
      setStatus("Area selected. Preview it or select a different area.");
    }

    map.on("mousedown", handleMouseDown);
    map.on("mousemove", handleMouseMove);
    map.on("mouseup", handleMouseUp);

    return () => {
      map.off("mousedown", handleMouseDown);
      map.off("mousemove", handleMouseMove);
      map.off("mouseup", handleMouseUp);
      map.dragPan.enable();
      container.classList.remove("selecting-area");
      drawStartRef.current = null;
    };
  }, [isBusy, isMapReady, isPreviewing, isSelectingArea]);

  function removeRectangle() {
    const map = mapRef.current;

    if (map?.getSource("scene-selection")) {
      map.getSource("scene-selection").setData(emptyFeatureCollection());
    }
  }

  function startSelection() {
    if (isBusy || !isMapReady) {
      return;
    }

    setError(false);
    setIsPreviewing(false);
    setPreviewBounds(null);
    setBounds(null);
    removeRectangle();
    setIsSelectingArea(true);
  }

  function selectCity(event) {
    const placeId = event.target.value;
    const place = OFFLINE_VIETNAM_PLACES.find((item) => item.place_id === placeId);

    setSelectedCityId(placeId);

    if (!place || isBusy) {
      return;
    }

    moveMapToPlace(place);
    setBounds(null);
    setIsPreviewing(false);
    setPreviewBounds(null);
    removeRectangle();
    setIsSelectingArea(false);
    setError(false);
    setStatus(`Moved map to ${place.name}.`);
  }

  function moveMapToPlace(place) {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    if (Array.isArray(place.boundingbox) && place.boundingbox.length === 4) {
      const [south, north, west, east] = place.boundingbox.map(Number);

      if ([south, north, west, east].every(Number.isFinite)) {
        map.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          {
            maxZoom: 16,
            padding: [30, 30],
          },
        );
        return;
      }
    }

    const lat = Number(place.lat);
    const lon = Number(place.lon);

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      map.flyTo({ center: [lon, lat], zoom: 15 });
    }
  }

  function previewSelectedArea() {
    const trimmedSceneName = sceneName.trim();

    if (!bounds) {
      setStatus("Select an area on the map before previewing.");
      setSceneNameError("");
      setError(true);
      return;
    }

    if (!trimmedSceneName) {
      setStatus("Enter a scene name before previewing.");
      setSceneNameError("Scene name is required.");
      setError(true);
      return;
    }

    if (isTooLarge) {
      setStatus("Selected area is too large. Choose a smaller area.");
      setSceneNameError("");
      setError(true);
      return;
    }

    setPreviewBounds(bounds);
    setIsPreviewing(true);
    setIsSelectingArea(false);
    setSceneNameError("");
    setError(false);
    setStatus("Preview ready. Keep it, select a new area, or cancel.");
    focusMapOnBounds(bounds);
  }

  async function keepScene() {
    const selectedBounds = previewBounds || bounds;
    const trimmedSceneName = sceneName.trim();

    if (!selectedBounds || !trimmedSceneName) {
      return;
    }

    setIsBusy(true);
    setSceneNameError("");
    setError(false);
    setStatus("Creating Sionna scene...");

    let createdScene = null;

    try {
      const previewResult = await createScenePreview({
        name: trimmedSceneName,
        south: selectedBounds.south,
        west: selectedBounds.west,
        north: selectedBounds.north,
        east: selectedBounds.east,
      });
      createdScene = previewResult.scene;

      setStatus("Loading scene...");
      const activationResult = await activateScene(createdScene.id);
      onSceneActivated(activationResult.scene);
    } catch (caught) {
      if (caught.message.includes("Only 3")) {
        onLimitReached(caught.message);
        return;
      }

      if (createdScene?.id) {
        deleteScene(createdScene.id).catch(() => {});
      }

      setStatus(`Scene load failed: ${caught.message}`);
      setError(true);
    } finally {
      setIsBusy(false);
    }
  }

  function selectNewArea() {
    setIsPreviewing(false);
    setPreviewBounds(null);
    setBounds(null);
    removeRectangle();
    setError(false);
    setIsSelectingArea(true);
    setStatus("Selection mode enabled. Drag on the map to draw a small scene area.");
  }

  function cancelSelection() {
    onCancel();
  }

  function focusMapOnBounds(nextBounds) {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    window.setTimeout(() => {
      map.fitBounds(
        [
          [nextBounds.west, nextBounds.south],
          [nextBounds.east, nextBounds.north],
        ],
        {
          duration: 350,
          padding: 52,
        },
      );
    }, 0);
  }

  return (
    <main className="scene-page">
      <div
        ref={mapNodeRef}
        className={`scene-map scene-page-map ${isPreviewing ? "scene-map-previewing" : ""}`}
        role="application"
        aria-label="Selectable offline map area"
      />

      <section className="scene-control-panel" aria-label="Scene selection controls">
        <div className="scene-page-header">
          <div>
            <h1>Choose Scene Area</h1>
            <p className={error ? "error-text" : ""}>{status}</p>
          </div>
          <button className="ghost-button" type="button" disabled={isBusy} onClick={onCancel}>
            Back
          </button>
        </div>

        {!isPreviewing && (
          <div className="scene-page-form">
            <label className="scene-city-field">
              <span>City</span>
              <select value={selectedCityId} disabled={isBusy || !isMapReady} onChange={selectCity}>
                <option value="">Jump to a Vietnam city</option>
                {OFFLINE_VIETNAM_PLACES.map((place) => (
                  <option key={place.place_id} value={place.place_id}>
                    {place.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="scene-name-field">
              <span>Scene name</span>
              <input
                type="text"
                value={sceneName}
                placeholder="Required, e.g. Hanoi test area"
                maxLength={80}
                required
                disabled={isBusy}
                onChange={(event) => {
                  setSceneName(event.target.value);
                  if (event.target.value.trim()) {
                    setSceneNameError("");
                  }
                  if (error) {
                    setError(false);
                  }
                }}
              />
              {sceneNameError && <small className="field-error">{sceneNameError}</small>}
            </label>
            <button
              className={isSelectingArea ? "primary-button" : "ghost-button"}
              type="button"
              disabled={isBusy || !isMapReady}
              onClick={startSelection}
            >
              Select area
            </button>
          </div>
        )}
      </section>

      {!isPreviewing && (
        <div className="scene-selection-footer">
          <div>
            <strong>{metrics ? `${formatMaybeNumber(metrics.widthM)} m x ${formatMaybeNumber(metrics.heightM)} m` : "No area selected"}</strong>
            <span>{metrics ? `${formatMaybeNumber(metrics.areaKm2)} km2 selected` : "Maximum 1 km2 per scene"}</span>
            {isTooLarge && <span className="error-text">Selected area is too large.</span>}
          </div>
          <button
            className="primary-button"
            type="button"
            disabled={isBusy || !isMapReady || isTooLarge}
            onClick={previewSelectedArea}
          >
            Preview scene
          </button>
        </div>
      )}
      {isPreviewing && (
        <div className="scene-preview scene-preview-panel">
          <dl className="scene-preview-meta">
            <dt>Scene</dt><dd>{sceneName.trim()}</dd>
            <dt>Area</dt><dd>{metrics?.areaKm2 ? formatMaybeNumber(metrics.areaKm2) : "--"} km2</dd>
            <dt>Size</dt><dd>{metrics ? `${formatMaybeNumber(metrics.widthM)} x ${formatMaybeNumber(metrics.heightM)} m` : "--"}</dd>
          </dl>
          <div className="scene-preview-actions">
            <button className="ghost-button" type="button" disabled={isBusy} onClick={selectNewArea}>
              Select new area
            </button>
            <button className="ghost-button" type="button" disabled={isBusy} onClick={cancelSelection}>
              Cancel
            </button>
            <button className="primary-button" type="button" disabled={isBusy} onClick={keepScene}>
              Keep and load scene
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function offlineMapDataBaseUrl() {
  return new URL("data/", window.location.origin + import.meta.env.BASE_URL).toString();
}

function createOfflineSceneMapStyle(dataBaseUrl) {
  return {
    version: 8,
    sources: {
      vietnam: {
        type: "vector",
        url: `pmtiles://${dataBaseUrl}vietnam.pmtiles`,
      },
    },
    layers: [
      {
        id: "offline-background",
        type: "background",
        paint: {
          "background-color": "#eef1f4",
        },
      },
      {
        id: "offline-land",
        type: "fill",
        source: "vietnam",
        "source-layer": "land",
        paint: {
          "fill-color": "#dce8c8",
          "fill-opacity": 0.72,
        },
      },
      {
        id: "offline-ocean",
        type: "fill",
        source: "vietnam",
        "source-layer": "ocean",
        paint: {
          "fill-color": "#aad3df",
        },
      },
      {
        id: "offline-water",
        type: "fill",
        source: "vietnam",
        "source-layer": "water_polygons",
        paint: {
          "fill-color": "#9ecae1",
        },
      },
      {
        id: "offline-roads",
        type: "line",
        source: "vietnam",
        "source-layer": "streets",
        paint: {
          "line-color": "#ffffff",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            0.5,
            12,
            1.5,
            16,
            4,
          ],
        },
      },
    ],
  };
}

function createBuildingRegionManager(map, dataBaseUrl) {
  const activeRegionIds = new Set();
  let buildingRegions = [];
  let disposed = false;

  async function load() {
    const response = await fetch(`${dataBaseUrl}building-regions.json`, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`manifest HTTP ${response.status}`);
    }

    const loadedRegions = await response.json();

    if (!Array.isArray(loadedRegions)) {
      throw new Error("building region manifest is invalid");
    }

    buildingRegions = loadedRegions.filter(isValidBuildingRegion);

    if (!buildingRegions.length) {
      throw new Error("building region manifest is empty");
    }

    update();
    map.on("moveend", update);
    map.on("zoomend", update);
  }

  function update() {
    if (disposed || !map.isStyleLoaded()) {
      return;
    }

    if (map.getZoom() < 13.5) {
      removeAllRegions();
      return;
    }

    const requiredRegions = buildingRegions.filter((region) => regionIntersectsMap(map, region));
    const requiredIds = new Set(requiredRegions.map((region) => region.id));

    for (const region of requiredRegions) {
      if (!activeRegionIds.has(region.id)) {
        addRegion(region);
      }
    }

    for (const region of buildingRegions) {
      if (activeRegionIds.has(region.id) && !requiredIds.has(region.id)) {
        removeRegion(region);
      }
    }
  }

  function addRegion(region) {
    const sourceId = buildingSourceId(region);
    const layerId = buildingLayerId(region);

    if (map.getSource(sourceId)) {
      activeRegionIds.add(region.id);
      return;
    }

    map.addSource(sourceId, {
      type: "vector",
      url: `pmtiles://${dataBaseUrl}${region.file}`,
    });

    map.addLayer(
      {
        id: layerId,
        type: "fill-extrusion",
        source: sourceId,
        "source-layer": "buildings",
        minzoom: 14,
        paint: {
          "fill-extrusion-color": "#d18b62",
          "fill-extrusion-height": [
            "case",
            ["has", "height"],
            ["get", "height"],
            ["has", "levels"],
            ["*", ["get", "levels"], 3],
            9,
          ],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.9,
        },
      },
      map.getLayer("scene-selection-fill") ? "scene-selection-fill" : undefined,
    );

    activeRegionIds.add(region.id);
  }

  function removeAllRegions() {
    for (const region of buildingRegions) {
      if (activeRegionIds.has(region.id)) {
        removeRegion(region);
      }
    }
  }

  function removeRegion(region) {
    const sourceId = buildingSourceId(region);
    const layerId = buildingLayerId(region);

    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }

    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }

    activeRegionIds.delete(region.id);
  }

  function dispose() {
    disposed = true;
    map.off("moveend", update);
    map.off("zoomend", update);
    removeAllRegions();
  }

  return {
    dispose,
    load,
  };
}

function isValidBuildingRegion(region) {
  return (
    region
    && typeof region.id === "string"
    && typeof region.file === "string"
    && Number.isFinite(Number(region.west))
    && Number.isFinite(Number(region.east))
    && Number.isFinite(Number(region.south))
    && Number.isFinite(Number(region.north))
  );
}

function regionIntersectsMap(map, region) {
  const bounds = map.getBounds();

  return (
    Number(region.east) > bounds.getWest()
    && Number(region.west) < bounds.getEast()
    && Number(region.north) > bounds.getSouth()
    && Number(region.south) < bounds.getNorth()
  );
}

function buildingSourceId(region) {
  return `building-source-${region.id}`;
}

function buildingLayerId(region) {
  return `building-layer-${region.id}`;
}

function ensureSelectionLayers(map) {
  if (!map.getSource("scene-selection")) {
    map.addSource("scene-selection", {
      type: "geojson",
      data: emptyFeatureCollection(),
    });
  }

  if (!map.getLayer("scene-selection-fill")) {
    map.addLayer({
      id: "scene-selection-fill",
      type: "fill",
      source: "scene-selection",
      paint: {
        "fill-color": "#2563eb",
        "fill-opacity": 0.18,
      },
    });
  }

  if (!map.getLayer("scene-selection-line")) {
    map.addLayer({
      id: "scene-selection-line",
      type: "line",
      source: "scene-selection",
      paint: {
        "line-color": "#2563eb",
        "line-width": 2,
      },
    });
  }
}

function updateSelectionBounds(map, bounds) {
  ensureSelectionLayers(map);
  map.getSource("scene-selection").setData({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [[
            [bounds.west, bounds.south],
            [bounds.east, bounds.south],
            [bounds.east, bounds.north],
            [bounds.west, bounds.north],
            [bounds.west, bounds.south],
          ]],
        },
      },
    ],
  });
}

function emptyFeatureCollection() {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

function boundsFromLngLats(start, end) {
  return {
    south: Math.min(start.lat, end.lat),
    west: Math.min(start.lng, end.lng),
    north: Math.max(start.lat, end.lat),
    east: Math.max(start.lng, end.lng),
  };
}

function buildOfflinePlace({ id, name, displayName, lat, lon, delta = 0.08 }) {
  return {
    boundingbox: [
      String(lat - delta),
      String(lat + delta),
      String(lon - delta),
      String(lon + delta),
    ],
    display_name: `${name}, ${displayName}`,
    lat: String(lat),
    lon: String(lon),
    name,
    place_id: id,
  };
}

const OFFLINE_VIETNAM_PLACES = [
  buildOfflinePlace({
    id: "hanoi",
    name: "Hanoi",
    displayName: "Vietnam",
    lat: 21.0278,
    lon: 105.8342,
  }),
  buildOfflinePlace({
    id: "ho-chi-minh-city",
    name: "Ho Chi Minh City",
    displayName: "Vietnam",
    lat: 10.7769,
    lon: 106.7009,
  }),
  buildOfflinePlace({
    id: "da-nang",
    name: "Da Nang",
    displayName: "Vietnam",
    lat: 16.0544,
    lon: 108.2022,
  }),
  buildOfflinePlace({
    id: "hai-phong",
    name: "Hai Phong",
    displayName: "Vietnam",
    lat: 20.8449,
    lon: 106.6881,
  }),
  buildOfflinePlace({
    id: "can-tho",
    name: "Can Tho",
    displayName: "Vietnam",
    lat: 10.0452,
    lon: 105.7469,
  }),
  buildOfflinePlace({
    id: "hue",
    name: "Hue",
    displayName: "Vietnam",
    lat: 16.4637,
    lon: 107.5909,
  }),
  buildOfflinePlace({
    id: "nha-trang",
    name: "Nha Trang",
    displayName: "Vietnam",
    lat: 12.2388,
    lon: 109.1967,
  }),
  buildOfflinePlace({
    id: "vung-tau",
    name: "Vung Tau",
    displayName: "Vietnam",
    lat: 10.4114,
    lon: 107.1362,
  }),
  buildOfflinePlace({
    id: "da-lat",
    name: "Da Lat",
    displayName: "Vietnam",
    lat: 11.9404,
    lon: 108.4583,
  }),
  buildOfflinePlace({
    id: "vinh",
    name: "Vinh",
    displayName: "Vietnam",
    lat: 18.6796,
    lon: 105.6813,
  }),
  buildOfflinePlace({
    id: "thai-nguyen",
    name: "Thai Nguyen",
    displayName: "Vietnam",
    lat: 21.5672,
    lon: 105.8252,
  }),
  buildOfflinePlace({
    id: "ha-long",
    name: "Ha Long",
    displayName: "Vietnam",
    lat: 20.9712,
    lon: 107.0448,
  }),
];

function calculateMetrics(bounds) {
  const midLat = ((bounds.south + bounds.north) / 2) * (Math.PI / 180);
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = metersPerDegreeLat * Math.max(Math.cos(midLat), 0.01);
  const widthM = Math.abs(bounds.east - bounds.west) * metersPerDegreeLon;
  const heightM = Math.abs(bounds.north - bounds.south) * metersPerDegreeLat;

  return {
    widthM,
    heightM,
    areaKm2: (widthM * heightM) / 1000000,
  };
}
