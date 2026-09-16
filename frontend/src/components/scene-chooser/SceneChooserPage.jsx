import { useEffect, useRef, useState } from "react";
import {
  Map as MapLibreMap,
  NavigationControl,
  addProtocol,
  removeProtocol,
  setWorkerUrl,
} from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import {
  activateScene,
  createScenePreview,
  deleteScene,
  listProvinces,
  searchWards,
} from "../../api";
import {
  SCENE_CHOOSER_DEFAULT_CENTER,
  SCENE_CHOOSER_DEFAULT_ZOOM,
} from "../../constants";
import { createSceneWardBoundary } from "../../utils/wardBoundary";
import {
  boundsFromLngLats,
  calculateMetrics,
  createBuildingRegionManager,
  createOfflineSceneMapStyle,
  emptyFeatureCollection,
  ensureSelectionLayers,
  ensureWardLayers,
  loadWardFeature,
  offlineMapDataBaseUrl,
  updateSelectionBounds,
} from "./sceneChooserMap";
import SceneChooserView from "./SceneChooserView";

const WARD_SEARCH_DEBOUNCE_MS = 250;
const WARD_SEARCH_LIMIT = 12;

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
  const [selectedProvinceCode, setSelectedProvinceCode] = useState("");
  const [sceneName, setSceneName] = useState("");
  const [bounds, setBounds] = useState(null);
  const [previewBounds, setPreviewBounds] = useState(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [provinces, setProvinces] = useState([]);
  const [wardOptions, setWardOptions] = useState([]);
  const [isSearchingWards, setIsSearchingWards] = useState(false);
  const [wardQuery, setWardQuery] = useState("");
  const [isWardOptionsOpen, setIsWardOptionsOpen] = useState(false);
  const [status, setStatus] = useState(
    "Move and zoom the map, then click Select area to draw a scene rectangle.",
  );
  const [sceneNameError, setSceneNameError] = useState("");
  const [error, setError] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isControlPanelVisible, setIsControlPanelVisible] = useState(true);
  const selectedWardCodeRef = useRef(null);
  const autoSceneNameRef = useRef(null);
  const wardSearchSequenceRef = useRef(0);

  const metrics = bounds ? calculateMetrics(bounds) : null;
  const selectedProvince =
    provinces.find((province) => province.code === selectedProvinceCode) ||
    null;

  useEffect(() => {
    let cancelled = false;

    listProvinces()
      .then((result) => {
        if (!cancelled) {
          setProvinces(Array.isArray(result?.items) ? result.items : []);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setStatus(
            `Province and ward data could not be loaded: ${caught.message}`,
          );
          setError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const query = wardQuery.trim();

    if (
      !isWardOptionsOpen
      || !selectedProvinceCode
      || !query
      || !isMapReady
    ) {
      wardSearchSequenceRef.current += 1;
      setWardOptions([]);
      setIsSearchingWards(false);
      return undefined;
    }

    const requestId = wardSearchSequenceRef.current + 1;
    wardSearchSequenceRef.current = requestId;
    setIsSearchingWards(true);

    const timer = window.setTimeout(() => {
      searchWards(query, {
        provinceCode: selectedProvinceCode,
        limit: WARD_SEARCH_LIMIT,
      })
        .then((result) => {
          if (wardSearchSequenceRef.current !== requestId) {
            return;
          }

          setWardOptions(Array.isArray(result?.items) ? result.items : []);
          setIsSearchingWards(false);
        })
        .catch((caught) => {
          if (wardSearchSequenceRef.current !== requestId) {
            return;
          }

          setWardOptions([]);
          setIsSearchingWards(false);
          setStatus(`Ward search failed: ${caught.message}`);
          setError(true);
        });
    }, WARD_SEARCH_DEBOUNCE_MS);

    return () => {
      wardSearchSequenceRef.current += 1;
      window.clearTimeout(timer);
    };
  }, [isMapReady, isWardOptionsOpen, selectedProvinceCode, wardQuery]);

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
    const map = new MapLibreMap({
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

    map.addControl(
      new NavigationControl({ visualizePitch: true }),
      "top-right",
    );

    map.on("load", () => {
      ensureSelectionLayers(map);
      ensureWardLayers(map);
      setIsMapReady(true);
      setStatus(
        "Offline map loaded. Move and zoom the map, then click Select area to draw a scene rectangle.",
      );
      setError(false);

      const buildingRegionManager = createBuildingRegionManager(
        map,
        dataBaseUrl,
      );
      buildingRegionManagerRef.current = buildingRegionManager;
      buildingRegionManager.load().catch((caught) => {
        setStatus(
          `Offline map loaded, but buildings could not be loaded: ${caught.message}`,
        );
        setError(true);
      });
    });

    map.on("error", (event) => {
      const message =
        event?.error?.message || "offline map tiles could not be loaded";
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
    setStatus(
      "Selection mode enabled. Drag on the map to draw a small scene area.",
    );

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

      updateSelectionBounds(
        map,
        boundsFromLngLats(drawStartRef.current, event.lngLat),
      );
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

  function clearWardOverlay() {
    const map = mapRef.current;
    selectedWardCodeRef.current = null;

    if (map?.getSource("ward-boundary")) {
      map.getSource("ward-boundary").setData(emptyFeatureCollection());
    }
  }

  async function showWardBoundary(ward) {
    const map = mapRef.current;

    if (!map || !isMapReady) {
      return;
    }

    ensureWardLayers(map);
    selectedWardCodeRef.current = ward.ward_code;

    try {
      const feature = await loadWardFeature(ward.ward_code);

      if (selectedWardCodeRef.current !== ward.ward_code) {
        return;
      }

      const source = map.getSource("ward-boundary");

      if (!source) {
        return;
      }

      source.setData(
        feature
          ? { type: "FeatureCollection", features: [feature] }
          : emptyFeatureCollection(),
      );

      if (!feature) {
        setStatus(`Ward boundary geometry was not found for ${ward.ward_name}.`);
        setError(true);
      }
    } catch (caught) {
      if (selectedWardCodeRef.current === ward.ward_code) {
        setStatus(`Ward boundary could not be displayed: ${caught.message}`);
        setError(true);
      }
    }
  }

  function selectWard(ward) {
    if (isBusy || !isMapReady) {
      return;
    }

    const wardBbox = ward?.bbox || {};
    const wardBounds = {
      south: Number(wardBbox.south),
      west: Number(wardBbox.west),
      north: Number(wardBbox.north),
      east: Number(wardBbox.east),
    };

    if (
      ![
        wardBounds.south,
        wardBounds.west,
        wardBounds.north,
        wardBounds.east,
      ].every(Number.isFinite)
    ) {
      return;
    }

    setIsWardOptionsOpen(false);
    setWardQuery(ward.ward_name);
    setBounds(wardBounds);
    setPreviewBounds(wardBounds);
    setIsPreviewing(true);
    setIsSelectingArea(false);
    setSceneNameError("");
    setError(false);

    if (!sceneName.trim()) {
      setSceneName(ward.ward_name);
      autoSceneNameRef.current = ward.ward_name;
    }

    setStatus(
      `Selected ${ward.ward_full_name}. The covering rectangle is ready for preview.`,
    );

    const map = mapRef.current;

    if (map) {
      updateSelectionBounds(map, wardBounds);
    }

    showWardBoundary(ward);
    focusMapOnBounds(wardBounds);
  }

  function resetAutoSceneName() {
    if (autoSceneNameRef.current !== null) {
      if (sceneName === autoSceneNameRef.current) {
        setSceneName("");
        setSceneNameError("");
      }
      autoSceneNameRef.current = null;
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
    clearWardOverlay();
    setWardQuery("");
    setIsWardOptionsOpen(false);
    resetAutoSceneName();
    setIsSelectingArea(true);
  }

  function selectProvince(event) {
    const provinceCode = event.target.value;
    const province = provinces.find((item) => item.code === provinceCode);

    setSelectedProvinceCode(provinceCode);

    if (!province || isBusy) {
      return;
    }

    moveMapToProvince(province);
    setBounds(null);
    setIsPreviewing(false);
    setPreviewBounds(null);
    removeRectangle();
    clearWardOverlay();
    setWardQuery("");
    setIsWardOptionsOpen(false);
    resetAutoSceneName();
    setIsSelectingArea(false);
    setError(false);
    setStatus(`Moved map to ${province.name}.`);
  }

  function moveMapToProvince(province) {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    const provinceBbox = province?.bbox || {};
    const south = Number(provinceBbox.south);
    const west = Number(provinceBbox.west);
    const north = Number(provinceBbox.north);
    const east = Number(provinceBbox.east);

    if ([south, west, north, east].every(Number.isFinite)) {
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

    const lat = Number(province?.center?.lat);
    const lng = Number(province?.center?.lng);

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      map.flyTo({ center: [lng, lat], zoom: 15 });
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
      const selectedWardCode = selectedWardCodeRef.current;
      const wardBoundary = selectedWardCode
        ? createSceneWardBoundary(await loadWardFeature(selectedWardCode))
        : null;

      if (selectedWardCode && !wardBoundary) {
        throw new Error("The selected ward boundary could not be loaded.");
      }

      const previewResult = await createScenePreview({
        name: trimmedSceneName,
        ward_boundary: wardBoundary,
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
    clearWardOverlay();
    setWardQuery("");
    setIsWardOptionsOpen(false);
    resetAutoSceneName();
    setError(false);
    setIsSelectingArea(true);
    setStatus(
      "Selection mode enabled. Drag on the map to draw a small scene area.",
    );
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
    <SceneChooserView
      {...{
        autoSceneNameRef,
        cancelSelection,
        error,
           isBusy,
           isControlPanelVisible,
           isMapReady,
           isWardOptionsOpen,
           isPreviewing,
        isSelectingArea,
        keepScene,
        mapNodeRef,
        metrics,
        onCancel,
        previewSelectedArea,
        provinces,
        selectNewArea,
        selectProvince,
        selectWard,
        selectedProvince,
        selectedProvinceCode,
        sceneName,
        sceneNameError,
        setError,
        setIsControlPanelVisible,
        setIsWardOptionsOpen,
        setSceneName,
        setSceneNameError,
        setWardQuery,
        startSelection,
        status,
        wardOptions,
        wardQuery,
        isSearchingWards,
      }}
    />
  );
}


