export function createSceneWardBoundary(feature) {
  const properties = feature?.properties;
  const geometry = feature?.geometry;

  if (
    feature?.type !== "Feature"
    || typeof properties?.ward_code !== "string"
    || typeof properties?.ward_name !== "string"
    || !wardBoundaryCoordinateRings(feature).length
  ) {
    return null;
  }

  return {
    type: "Feature",
    properties: {
      ward_code: properties.ward_code,
      ward_name: properties.ward_name,
      ward_full_name:
        typeof properties.ward_full_name === "string"
          ? properties.ward_full_name
          : null,
    },
    geometry: {
      type: geometry.type,
      coordinates: geometry.coordinates,
    },
  };
}

export function wardBoundaryCoordinateRings(boundary) {
  const geometry = boundary?.geometry;

  if (!Array.isArray(geometry?.coordinates)) {
    return [];
  }

  const polygons = geometry.type === "Polygon"
    ? [geometry.coordinates]
    : geometry.type === "MultiPolygon"
      ? geometry.coordinates
      : [];

  return polygons.flatMap((polygon) => (
    Array.isArray(polygon)
      ? polygon.filter(isCoordinateRing)
      : []
  ));
}

export function projectWardBoundaryRings(boundary, bounds, model) {
  const south = Number(bounds?.south);
  const west = Number(bounds?.west);
  const north = Number(bounds?.north);
  const east = Number(bounds?.east);
  const scale = Number(model?.scale);

  if (
    ![south, west, north, east, scale].every(Number.isFinite)
    || south >= north
    || west >= east
    || scale <= 0
  ) {
    return [];
  }

  const centerLat = (south + north) / 2;
  const centerLon = (west + east) / 2;
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon =
    metersPerDegreeLat * Math.max(Math.cos((centerLat * Math.PI) / 180), 0.01);

  return wardBoundaryCoordinateRings(boundary).map((ring) =>
    ring.map((coordinate) => ({
      x: (Number(coordinate[0]) - centerLon) * metersPerDegreeLon * scale,
      z: -(Number(coordinate[1]) - centerLat) * metersPerDegreeLat * scale,
    })),
  );
}

function isCoordinateRing(ring) {
  return Array.isArray(ring)
    && ring.length >= 4
    && ring.every((coordinate) => (
      Array.isArray(coordinate)
      && coordinate.length >= 2
      && Number.isFinite(Number(coordinate[0]))
      && Number.isFinite(Number(coordinate[1]))
    ));
}
