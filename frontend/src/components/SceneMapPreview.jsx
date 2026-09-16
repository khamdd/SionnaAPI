import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { SCENE_MAP_PREVIEW_PADDING } from "../constants";
import {
  acquirePmtilesProtocol,
  createOfflineSceneMapStyle,
  offlineMapDataBaseUrl,
  releasePmtilesProtocol,
} from "./scene-chooser/sceneChooserMap";

export default function SceneMapPreview({
  bounds,
  className = "scene-preview-map",
  maxZoom = 18,
  padding = SCENE_MAP_PREVIEW_PADDING,
}) {
  const nodeRef = useRef(null);
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    const node = nodeRef.current;

    if (!node || !bounds || hasFailed) {
      return undefined;
    }

    setWorkerUrl(workerUrl);
    acquirePmtilesProtocol();

    let isLoaded = false;
    let map = null;

    try {
      map = new MapLibreMap({
        container: node,
        style: createOfflineSceneMapStyle(offlineMapDataBaseUrl()),
        attributionControl: false,
        interactive: false,
        maxZoom: 19,
      });
    } catch {
      releasePmtilesProtocol();
      setHasFailed(true);
      return undefined;
    }

    map.on("load", () => {
      isLoaded = true;
      map.addSource("scene-preview-bounds", {
        type: "geojson",
        data: sceneBoundsPolygon(bounds),
      });
      map.addLayer({
        id: "scene-preview-bounds-fill",
        type: "fill",
        source: "scene-preview-bounds",
        paint: {
          "fill-color": "#2563eb",
          "fill-opacity": 0.12,
        },
      });
      map.addLayer({
        id: "scene-preview-bounds-line",
        type: "line",
        source: "scene-preview-bounds",
        paint: {
          "line-color": "#2563eb",
          "line-width": 3,
        },
      });
    });

    map.on("error", () => {
      if (!isLoaded) {
        setHasFailed(true);
      }
    });

    map.fitBounds(
      [
        [bounds.west, bounds.south],
        [bounds.east, bounds.north],
      ],
      {
        padding: {
          top: padding[1],
          bottom: padding[1],
          left: padding[0],
          right: padding[0],
        },
        maxZoom,
        duration: 0,
      },
    );

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(node);
    setTimeout(() => map.resize(), 0);

    return () => {
      observer.disconnect();
      map.remove();
      releasePmtilesProtocol();
    };
  }, [bounds, maxZoom, padding, hasFailed]);

  if (hasFailed) {
    return (
      <div className={className}>
        <div className="scene-preview-placeholder">Map unavailable</div>
      </div>
    );
  }

  return (
    <div
      ref={nodeRef}
      className={className}
      aria-label="Selected scene area preview"
    />
  );
}

function sceneBoundsPolygon(bounds) {
  return {
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
  };
}
