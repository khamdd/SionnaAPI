import { addProtocol, removeProtocol } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { getWardBoundary } from "../../api";

const WARD_BOUNDARY_CACHE_MAX_ENTRIES = 200;

let pmtilesProtocolRefCount = 0;

function acquirePmtilesProtocol() {
  if (pmtilesProtocolRefCount === 0) {
    const protocol = new Protocol();
    addProtocol("pmtiles", protocol.tile);
  }
  pmtilesProtocolRefCount += 1;
}

function releasePmtilesProtocol() {
  if (pmtilesProtocolRefCount === 0) {
    return;
  }

  pmtilesProtocolRefCount -= 1;

  if (pmtilesProtocolRefCount === 0) {
    try {
      removeProtocol("pmtiles");
    } catch {
      // MapLibre throws if the protocol was already removed by a hot reload.
    }
  }
}

function offlineMapDataBaseUrl() {
  return new URL(
    "data/",
    window.location.origin + import.meta.env.BASE_URL,
  ).toString();
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

function createBuildingRegionManager(map, dataBaseUrl, options = {}) {
  const activeRegionIds = new Set();
  let buildingRegions = [];
  let disposed = false;
  const minZoom = Number.isFinite(Number(options.minZoom))
    ? Number(options.minZoom)
    : 16;

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

    // The chooser stays responsive while browsing provinces and wards. A
    // selected scene is allowed to request buildings earlier because its
    // viewport is already bounded to a small simulation area.
    if (map.getZoom() < minZoom) {
      removeAllRegions();
      return;
    }

    const requiredRegions = buildingRegions.filter((region) =>
      regionIntersectsMap(map, region),
    );
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
        minzoom: minZoom,
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

function createWardBoundaryManager(map, dataBaseUrl, onWardClick) {
  let activeProvinceCode = "";
  let disposed = false;
  let loadSequence = 0;
  const handleMouseEnter = () => {
    map.getCanvas().style.cursor = "pointer";
  };
  const handleMouseLeave = () => {
    map.getCanvas().style.cursor = "";
  };

  async function setProvince(provinceCode) {
    const sequence = ++loadSequence;
    activeProvinceCode = provinceCode || "";

    if (!activeProvinceCode) {
      clear();
      return;
    }

    [
      "vietnam-wards-fill",
      "vietnam-wards-line",
      "vietnam-wards-labels",
    ].forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.moveLayer(layerId);
      }
    });

    try {
      const response = await fetch(
        `${dataBaseUrl}vn-wards-${activeProvinceCode.padStart(2, "0")}.geojson`,
        { headers: { Accept: "application/geo+json, application/json" } },
      );

      if (!response.ok) {
        throw new Error(`ward boundary HTTP ${response.status}`);
      }

      const collection = await response.json();

      if (
        disposed
        || sequence !== loadSequence
        || !collection
        || collection.type !== "FeatureCollection"
        || !Array.isArray(collection.features)
      ) {
        return;
      }

      const source = map.getSource("vietnam-wards");
      source?.setData(collection);
    } catch (error) {
      if (!disposed && sequence === loadSequence) {
        clear();
        throw error;
      }
    }
  }

  function clear() {
    map.getSource("vietnam-wards")?.setData(emptyFeatureCollection());
  }

  function handleClick(event) {
    const feature = event.features?.[0];
    const properties = feature?.properties;

    if (!feature || !properties?.ward_code || typeof onWardClick !== "function") {
      return;
    }

    onWardClick({
      bbox: normalizeWardBbox(properties.bbox),
      ward_code: properties.ward_code,
      ward_full_name: properties.ward_full_name,
      ward_name: properties.ward_name,
      ward_type: properties.ward_type,
      province_code: activeProvinceCode,
      feature,
    });
  }

  map.on("click", "vietnam-wards-fill", handleClick);
  map.on("mouseenter", "vietnam-wards-fill", handleMouseEnter);
  map.on("mouseleave", "vietnam-wards-fill", handleMouseLeave);

  function dispose() {
    disposed = true;
    loadSequence += 1;
    map.off("click", "vietnam-wards-fill", handleClick);
    map.off("mouseenter", "vietnam-wards-fill", handleMouseEnter);
    map.off("mouseleave", "vietnam-wards-fill", handleMouseLeave);
  }

  return { dispose, setProvince };
}

function normalizeWardBbox(bbox) {
  if (Array.isArray(bbox) && bbox.length >= 4) {
    return {
      east: Number(bbox[2]),
      north: Number(bbox[3]),
      south: Number(bbox[1]),
      west: Number(bbox[0]),
    };
  }

  return bbox;
}

function isValidBuildingRegion(region) {
  return (
    region &&
    typeof region.id === "string" &&
    typeof region.file === "string" &&
    Number.isFinite(Number(region.west)) &&
    Number.isFinite(Number(region.east)) &&
    Number.isFinite(Number(region.south)) &&
    Number.isFinite(Number(region.north))
  );
}

function regionIntersectsMap(map, region) {
  const bounds = map.getBounds();

  return (
    Number(region.east) > bounds.getWest() &&
    Number(region.west) < bounds.getEast() &&
    Number(region.north) > bounds.getSouth() &&
    Number(region.south) < bounds.getNorth()
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

function ensureWardLayers(map) {
  if (!map.getSource("vietnam-wards")) {
    map.addSource("vietnam-wards", {
      type: "geojson",
      data: emptyFeatureCollection(),
      buffer: 0,
      maxzoom: 14,
      tolerance: 0.5,
    });
  }

  if (!map.getLayer("vietnam-wards-fill")) {
    map.addLayer({
      id: "vietnam-wards-fill",
      type: "fill",
      source: "vietnam-wards",
      paint: {
        "fill-color": "#ef4444",
        "fill-opacity": 0.025,
        "fill-outline-color": "#dc2626",
      },
    });
  }

  if (!map.getLayer("vietnam-wards-line")) {
    map.addLayer({
      id: "vietnam-wards-line",
      type: "line",
      source: "vietnam-wards",
      paint: {
        "line-color": "#dc2626",
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.7, 12, 1.5, 16, 2.5],
        "line-opacity": 0.9,
      },
    });
  }

  if (!map.getLayer("vietnam-wards-labels")) {
    map.addLayer({
      id: "vietnam-wards-labels",
      type: "symbol",
      source: "vietnam-wards",
      minzoom: 13,
      layout: {
        "text-field": ["coalesce", ["get", "ward_name"], ["get", "ward_name_en"]],
        "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10, 15, 13],
        "text-allow-overlap": false,
        "text-ignore-placement": false,
      },
      paint: {
        "text-color": "#991b1b",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    });
  }

  if (!map.getSource("ward-boundary")) {
    map.addSource("ward-boundary", {
      type: "geojson",
      data: emptyFeatureCollection(),
    });
  }

  // The fill stays on the ground below the 3D building extrusions, but the
  // red outline must render above them or buildings hide it at close zoom.
  const fillBeforeId = map.getLayer("scene-selection-fill")
    ? "scene-selection-fill"
    : undefined;
  const lineBeforeId = map.getLayer("scene-selection-line")
    ? "scene-selection-line"
    : fillBeforeId;

  if (!map.getLayer("ward-boundary-fill")) {
    map.addLayer(
      {
        id: "ward-boundary-fill",
        type: "fill",
        source: "ward-boundary",
        paint: {
          "fill-color": "#dc2626",
          "fill-opacity": 0.07,
        },
      },
      fillBeforeId,
    );
  }

  if (!map.getLayer("ward-boundary-casing")) {
    map.addLayer(
      {
        id: "ward-boundary-casing",
        type: "line",
        source: "ward-boundary",
        paint: {
          "line-color": "#ffffff",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            12,
            4.5,
            15,
            7,
            17,
            9,
          ],
          "line-opacity": 0.85,
        },
      },
      lineBeforeId,
    );
  }

  if (!map.getLayer("ward-boundary-line")) {
    map.addLayer(
      {
        id: "ward-boundary-line",
        type: "line",
        source: "ward-boundary",
        paint: {
          "line-color": "#dc2626",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            12,
            2.5,
            15,
            4,
            17,
            5.5,
          ],
          "line-opacity": 0.98,
        },
      },
      lineBeforeId,
    );
  }
}

const wardFeatureCache = new Map();

async function loadWardFeature(wardCode) {
  if (wardFeatureCache.has(wardCode)) {
    return wardFeatureCache.get(wardCode);
  }

  const result = await getWardBoundary(wardCode);
  const feature = result?.feature || null;

  if (feature && wardFeatureCache.size >= WARD_BOUNDARY_CACHE_MAX_ENTRIES) {
    wardFeatureCache.delete(wardFeatureCache.keys().next().value);
  }

  wardFeatureCache.set(wardCode, feature);

  return feature;
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
          coordinates: [
            [
              [bounds.west, bounds.south],
              [bounds.east, bounds.south],
              [bounds.east, bounds.north],
              [bounds.west, bounds.north],
              [bounds.west, bounds.south],
            ],
          ],
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

function calculateMetrics(bounds) {
  const midLat = ((bounds.south + bounds.north) / 2) * (Math.PI / 180);
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon =
    metersPerDegreeLat * Math.max(Math.cos(midLat), 0.01);
  const widthM = Math.abs(bounds.east - bounds.west) * metersPerDegreeLon;
  const heightM = Math.abs(bounds.north - bounds.south) * metersPerDegreeLat;

  return {
    widthM,
    heightM,
    areaKm2: (widthM * heightM) / 1000000,
  };
}

export {
  acquirePmtilesProtocol,
  boundsFromLngLats,
  calculateMetrics,
  createBuildingRegionManager,
  createWardBoundaryManager,
  createOfflineSceneMapStyle,
  emptyFeatureCollection,
  ensureSelectionLayers,
  ensureWardLayers,
  loadWardFeature,
  offlineMapDataBaseUrl,
  releasePmtilesProtocol,
  updateSelectionBounds,
};
