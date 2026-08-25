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
import Scene3DPreview from "./Scene3DPreview";

export default function SceneChooserModal({
  onClose,
  onLimitReached,
  onSceneActivated,
}) {
  const mapNodeRef = useRef(null);
  const mapRef = useRef(null);
  const drawStartRef = useRef(null);
  const previewSceneRef = useRef(null);
  const keptSceneRef = useRef(false);
  const mapViewRef = useRef(null);
  const [isSelectingArea, setIsSelectingArea] = useState(false);
  const [isMapReady, setIsMapReady] = useState(false);
  const [locationQuery, setLocationQuery] = useState("");
  const [locationResults, setLocationResults] = useState([]);
  const [showLocationResults, setShowLocationResults] = useState(false);
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);
  const [sceneName, setSceneName] = useState("");
  const [bounds, setBounds] = useState(null);
  const [previewBounds, setPreviewBounds] = useState(null);
  const [previewScene, setPreviewScene] = useState(null);
  const [status, setStatus] = useState("Move and zoom the map, then click Select area to draw a scene rectangle.");
  const [sceneNameError, setSceneNameError] = useState("");
  const [error, setError] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const metrics = bounds ? calculateMetrics(bounds) : null;
  const isTooLarge = metrics && metrics.areaKm2 > MAX_SCENE_AREA_KM2;

  useEffect(() => {
    const node = mapNodeRef.current;

    if (previewScene || !node || mapRef.current) {
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
    const map = new Map({
      container: node,
      center: savedView?.center || defaultCenter,
      zoom: savedView?.zoom || SCENE_CHOOSER_DEFAULT_ZOOM,
      minZoom: 2,
      maxZoom: 18,
      pitch: savedView?.pitch ?? 48,
      bearing: savedView?.bearing ?? -18,
      style: createOfflineSceneMapStyle(),
      attributionControl: false,
    });

    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");

    map.on("load", () => {
      ensureSelectionLayers(map);
      setIsMapReady(true);
      setStatus("Offline map loaded. Move and zoom the map, then click Select area to draw a scene rectangle.");
      setError(false);
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
      map.remove();
      mapRef.current = null;

      try {
        removeProtocol("pmtiles");
      } catch {
        // MapLibre throws if the protocol was already removed by a hot reload.
      }
    };
  }, [previewScene]);

  useEffect(() => {
    previewSceneRef.current = previewScene;
  }, [previewScene]);

  useEffect(() => () => {
    const scene = previewSceneRef.current;

    if (scene && !keptSceneRef.current) {
      deleteScene(scene.id).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const query = locationQuery.trim();

    if (query.length < 3 || previewScene) {
      setLocationResults([]);
      setShowLocationResults(false);
      setIsSearchingLocation(false);
      return undefined;
    }

    const controller = new AbortController();
    const timerId = window.setTimeout(async () => {
      setIsSearchingLocation(true);

      try {
        const results = await fetchLocationResults(query, 5, controller.signal);
        setLocationResults(results);
        setShowLocationResults(true);
      } catch (caught) {
        if (caught.name !== "AbortError") {
          setLocationResults([]);
          setShowLocationResults(false);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearchingLocation(false);
        }
      }
    }, 650);

    return () => {
      window.clearTimeout(timerId);
      controller.abort();
    };
  }, [locationQuery, previewScene]);

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !isMapReady) {
      return undefined;
    }

    const container = map.getCanvasContainer();
    container.classList.toggle("selecting-area", isSelectingArea);

    if (!isSelectingArea || previewScene || isBusy) {
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
  }, [isBusy, isMapReady, isSelectingArea, previewScene]);

  function removeRectangle() {
    const map = mapRef.current;

    if (map?.getSource("scene-selection")) {
      map.getSource("scene-selection").setData(emptyFeatureCollection());
    }

  }

  function startSelection() {
    if (previewScene || isBusy || !isMapReady) {
      return;
    }

    setError(false);
    setBounds(null);
    removeRectangle();
    setIsSelectingArea(true);
  }

  async function searchLocation(event) {
    event.preventDefault();

    const query = locationQuery.trim();

    if (!query || isBusy) {
      return;
    }

    setIsBusy(true);
    setError(false);
    setStatus("Searching location...");

    try {
      const results = await fetchLocationResults(query, 5);
      const place = results[0];

      if (!place) {
        setStatus(`No location found for "${query}".`);
        setError(true);
        return;
      }

      selectLocationResult(place);
    } catch (caught) {
      setStatus(`Location search failed: ${caught.message}`);
      setError(true);
    } finally {
      setIsBusy(false);
    }
  }

  function selectLocationResult(place) {
    moveMapToPlace(place);
    setLocationQuery(place.display_name || "");
    setLocationResults([]);
    setShowLocationResults(false);
    setBounds(null);
    removeRectangle();
    setIsSelectingArea(false);
    setStatus(`Moved map to ${place.display_name || "selected location"}.`);
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

  async function previewSelectedArea() {
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

    setIsBusy(true);
    setSceneNameError("");
    setError(false);
    setStatus("Creating scene preview...");

    try {
      const result = await createScenePreview({
        name: trimmedSceneName,
        south: bounds.south,
        west: bounds.west,
        north: bounds.north,
        east: bounds.east,
      });

      setPreviewBounds(bounds);
      setPreviewScene(result.scene);
      setStatus("Preview ready. Keep it, select a new area, or cancel.");
    } catch (caught) {
      if (caught.message.includes("Only 3")) {
        onLimitReached(caught.message);
        return;
      }

      setStatus(`Preview failed: ${caught.message}`);
      setError(true);
    } finally {
      setIsBusy(false);
    }
  }

  async function keepScene() {
    if (!previewScene) {
      return;
    }

    setIsBusy(true);
    setError(false);
    setStatus("Loading scene...");

    try {
      const result = await activateScene(previewScene.id);
      keptSceneRef.current = true;
      onSceneActivated(result.scene);
    } catch (caught) {
      setStatus(`Load failed: ${caught.message}`);
      setError(true);
    } finally {
      setIsBusy(false);
    }
  }

  async function selectNewArea() {
    await cleanupPreview();
    setPreviewScene(null);
    setBounds(null);
    setPreviewBounds(null);
    removeRectangle();
    setError(false);
    setIsSelectingArea(true);
    setStatus("Selection mode enabled. Drag on the map to draw a small scene area.");
  }

  async function cancelSelection() {
    await cleanupPreview();
    onClose();
  }

  async function cleanupPreview() {
    if (!previewScene) {
      return;
    }

    try {
      await deleteScene(previewScene.id);
    } catch {
      // Best effort cleanup. The scene page can still remove abandoned previews.
    }

    previewSceneRef.current = null;
  }

  return (
    <div className="scene-modal">
      <div className="scene-modal-header">
        <div>
          <h2>Choose Scene Area</h2>
          <p className={error ? "error-text" : ""}>{status}</p>
        </div>
      </div>

      {!previewScene && (
        <>
          <form className="scene-location-search" onSubmit={searchLocation}>
            <div className="scene-location-input-wrap">
              <input
                type="search"
                value={locationQuery}
                placeholder="Search location, e.g. Munich, Hanoi, Times Square"
                autoComplete="off"
                disabled={isBusy}
                onBlur={() => window.setTimeout(() => setShowLocationResults(false), 150)}
                onChange={(event) => {
                  setLocationQuery(event.target.value);
                  setShowLocationResults(true);
                }}
                onFocus={() => {
                  if (locationResults.length) {
                    setShowLocationResults(true);
                  }
                }}
              />
              {showLocationResults && (locationResults.length > 0 || isSearchingLocation) && (
                <div className="scene-location-results">
                  {isSearchingLocation && (
                    <div className="scene-location-result muted">Searching...</div>
                  )}
                  {locationResults.map((place) => (
                    <button
                      key={place.place_id}
                      className="scene-location-result"
                      type="button"
                      disabled={isBusy}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectLocationResult(place)}
                    >
                      <strong>{place.name || place.display_name?.split(",")[0] || "Unnamed place"}</strong>
                      <span>{place.display_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="primary-button" type="submit" disabled={isBusy || !isMapReady || !locationQuery.trim()}>
              Search
            </button>
          </form>
          <div className="scene-map-toolbar">
            <button
              className={isSelectingArea ? "primary-button" : "ghost-button"}
              type="button"
              disabled={isBusy || !isMapReady}
              onClick={startSelection}
            >
              Select area
            </button>
            <span>Use the map controls or mouse wheel to zoom.</span>
          </div>
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
          <div
            ref={mapNodeRef}
            className="scene-map"
            role="application"
            aria-label="Selectable offline map area"
          />
          <div className="scene-selection-footer">
            <div>
              <strong>{metrics ? `${formatMaybeNumber(metrics.widthM)} m x ${formatMaybeNumber(metrics.heightM)} m` : "No area selected"}</strong>
              <span>{metrics ? `${formatMaybeNumber(metrics.areaKm2)} km2 selected` : "Maximum 1 km2 per scene"}</span>
              {isTooLarge && <span className="error-text">Selected area is too large.</span>}
            </div>
            <button
              className="primary-button"
              type="button"
              disabled={isBusy || isTooLarge}
              onClick={previewSelectedArea}
            >
              Preview scene
            </button>
          </div>
        </>
      )}

      {previewScene && (
        <div className="scene-preview">
          {previewBounds ? (
            <Scene3DPreview bounds={previewBounds} sceneName={previewScene.name} />
          ) : (
            <img src={previewScene.preview_url} alt={`${previewScene.name} preview`} />
          )}
          <dl className="scene-preview-meta">
            <dt>Scene</dt><dd>{previewScene.name}</dd>
            <dt>Area</dt><dd>{previewScene.metrics?.area_km2 ?? "--"} km2</dd>
            <dt>Size</dt><dd>{previewScene.metrics?.width_m ?? "--"} x {previewScene.metrics?.height_m ?? "--"} m</dd>
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
    </div>
  );
}

function createOfflineSceneMapStyle() {
  const dataBaseUrl = new URL("data/", window.location.origin + import.meta.env.BASE_URL).toString();

  return {
    version: 8,
    sources: {
      vietnam: {
        type: "vector",
        url: `pmtiles://${dataBaseUrl}vietnam.pmtiles`,
      },
      hanoiBuildings: {
        type: "vector",
        url: `pmtiles://${dataBaseUrl}hanoi-buildings.pmtiles`,
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
      {
        id: "offline-hanoi-buildings",
        type: "fill-extrusion",
        source: "hanoiBuildings",
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
    ],
  };
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

async function fetchLocationResults(query, limit, signal) {
  const params = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    limit: String(limit),
    q: query,
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: {
      Accept: "application/json",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

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
