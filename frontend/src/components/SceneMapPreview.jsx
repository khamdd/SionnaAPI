import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const DEFAULT_PADDING = [8, 8];

export default function SceneMapPreview({
  bounds,
  className = "scene-preview-map",
  maxZoom = 18,
  padding = DEFAULT_PADDING,
}) {
  const nodeRef = useRef(null);

  useEffect(() => {
    const node = nodeRef.current;

    if (!node || !bounds) {
      return undefined;
    }

    const map = L.map(node, {
      attributionControl: false,
      dragging: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      scrollWheelZoom: false,
      touchZoom: false,
      zoomControl: false,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    const leafletBounds = [
      [bounds.south, bounds.west],
      [bounds.north, bounds.east],
    ];

    map.fitBounds(leafletBounds, {
      padding,
      maxZoom,
    });

    L.rectangle(leafletBounds, {
      color: "#2563eb",
      weight: 3,
      fillColor: "#2563eb",
      fillOpacity: 0.12,
      interactive: false,
    }).addTo(map);

    setTimeout(() => map.invalidateSize(), 0);

    return () => map.remove();
  }, [bounds, maxZoom, padding]);

  return (
    <div
      ref={nodeRef}
      className={className}
      aria-label="Selected scene area preview"
    />
  );
}
