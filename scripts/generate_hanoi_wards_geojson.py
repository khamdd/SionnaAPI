"""Generate a Hanoi ward-boundary GeoJSON for the scene chooser map.

Source: https://github.com/ThangLeQuoc/vietnamese-provinces-database (MIT)

Reads the cached per-ward GeoJSON exports, simplifies each ward boundary with
Douglas-Peucker so the whole province fits comfortably in the offline map
assets, and writes a single FeatureCollection to
frontend/public/data/hanoi-wards.geojson. Each feature carries
`ward_code` plus display names so the frontend can match it against
hanoi-wards.csv rows.

Usage:
    python scripts/generate_hanoi_wards_geojson.py [--workdir PATH] [--out PATH]
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from generate_vietnam_admin_csv import ensure_full_dataset, ensure_geojson_root

PROVINCE_CODE = "01"
SIMPLIFY_TOLERANCE_DEG = 1.5e-6
COORD_DECIMALS = 7
MIN_RING_POINTS = 4


def perpendicular_distance(point, line_start, line_end):
    if line_start == line_end:
        dx = point[0] - line_start[0]
        dy = point[1] - line_start[1]
        return (dx * dx + dy * dy) ** 0.5
    dx = line_end[0] - line_start[0]
    dy = line_end[1] - line_start[1]
    denom = dx * dx + dy * dy
    t = ((point[0] - line_start[0]) * dx + (point[1] - line_start[1]) * dy) / denom
    t = max(0.0, min(1.0, t))
    proj_x = line_start[0] + t * dx
    proj_y = line_start[1] + t * dy
    ddx = point[0] - proj_x
    ddy = point[1] - proj_y
    return (ddx * ddx + ddy * ddy) ** 0.5


def douglas_peucker(points, tolerance):
    """Iterative Douglas-Peucker that always keeps the first and last points."""
    count = len(points)
    if count <= 2:
        return list(points)

    keep = [False] * count
    keep[0] = keep[count - 1] = True
    stack = [(0, count - 1)]

    while stack:
        start, end = stack.pop()
        max_distance = 0.0
        index = start
        for i in range(start + 1, end):
            distance = perpendicular_distance(points[i], points[start], points[end])
            if distance > max_distance:
                max_distance = distance
                index = i
        if max_distance > tolerance and start < index < end:
            keep[index] = True
            stack.append((start, index))
            stack.append((index, end))

    return [point for point, kept in zip(points, keep) if kept]


def rounded_ring(ring):
    return [
        [round(point[0], COORD_DECIMALS), round(point[1], COORD_DECIMALS)]
        for point in ring
    ]


def simplify_ring(ring):
    """Simplify one ring, preserving closure and the minimum ring size."""
    if len(ring) <= MIN_RING_POINTS:
        return rounded_ring(ring)

    closed = len(ring) > 1 and ring[0] == ring[-1]
    if closed:
        simplified = douglas_peucker(ring, SIMPLIFY_TOLERANCE_DEG)
    else:
        simplified = douglas_peucker(list(ring) + [ring[0]], SIMPLIFY_TOLERANCE_DEG)

    if len(simplified) < MIN_RING_POINTS:
        return rounded_ring(ring)

    if simplified[0] != simplified[-1]:
        simplified.append(simplified[0])
    return rounded_ring(simplified)


def simplify_polygon(rings):
    return [simplify_ring(ring) for ring in rings]


def simplify_geometry(geometry):
    if geometry["type"] == "Polygon":
        return {
            "type": "Polygon",
            "coordinates": simplify_polygon(geometry["coordinates"]),
        }
    if geometry["type"] == "MultiPolygon":
        return {
            "type": "MultiPolygon",
            "coordinates": [
                simplify_polygon(polygon)
                for polygon in geometry["coordinates"]
            ],
        }
    raise ValueError(f"unsupported geometry type: {geometry['type']}")


def bounds_of(geometry):
    west = south = float("inf")
    east = north = float("-inf")

    polygons = [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        polygons = geometry["coordinates"]
    elif geometry["type"] != "Polygon":
        raise ValueError(f"unsupported geometry type: {geometry['type']}")

    for polygon in polygons:
        for ring in polygon:
            for x, y in ring:
                west = min(west, x)
                east = max(east, x)
                south = min(south, y)
                north = max(north, y)

    return (
        round(west, COORD_DECIMALS),
        round(south, COORD_DECIMALS),
        round(east, COORD_DECIMALS),
        round(north, COORD_DECIMALS),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--workdir",
        type=Path,
        default=Path(__file__).resolve().parent.parent / ".tmp" / "vietnam-admin",
        help="Cache directory for downloaded source files",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "frontend" / "public" / "data",
        help="Output directory for the generated GeoJSON file",
    )
    args = parser.parse_args()

    args.workdir.mkdir(parents=True, exist_ok=True)
    args.out.mkdir(parents=True, exist_ok=True)

    dataset = ensure_full_dataset(args.workdir)
    geojson_root = ensure_geojson_root(args.workdir)

    province = next(
        (item for item in dataset if item["Code"] == PROVINCE_CODE), None
    )
    if province is None:
        print(f"province {PROVINCE_CODE} not found in dataset", file=sys.stderr)
        return 1

    folder = next(
        (
            path
            for path in geojson_root.iterdir()
            if path.is_dir() and path.name.startswith(f"{PROVINCE_CODE}_")
        ),
        None,
    )
    if folder is None:
        print(f"no geojson folder for province {PROVINCE_CODE}", file=sys.stderr)
        return 1

    wards_folder = folder / "wards"
    features = []
    for ward in province["Wards"]:
        ward_code = ward["Code"]
        ward_path = next(wards_folder.glob(f"{ward_code}_*.geojson"), None)
        if ward_path is None:
            print(
                f"WARNING: no geojson for ward {ward_code} {ward['Name']}",
                file=sys.stderr,
            )
            continue

        ward_geo = json.loads(ward_path.read_text(encoding="utf-8"))
        feature = ward_geo["features"][0]
        geometry = simplify_geometry(feature["geometry"])
        west, south, east, north = bounds_of(geometry)
        features.append(
            {
                "type": "Feature",
                "id": ward_code,
                "properties": {
                    "ward_code": ward_code,
                    "ward_name": ward["Name"],
                    "ward_name_en": ward["NameEn"],
                    "ward_full_name": ward["FullName"],
                    "ward_full_name_en": ward["FullNameEn"],
                    "ward_type": ward["AdministrativeUnitShortName"],
                    "bbox": [west, south, east, north],
                },
                "geometry": geometry,
            }
        )

    collection = {
        "type": "FeatureCollection",
        "features": features,
    }

    output_path = args.out / "hanoi-wards.geojson"
    output_path.write_text(
        json.dumps(collection, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    size_kb = output_path.stat().st_size / 1024
    print(f"Wrote {output_path} ({len(features)} features, {size_kb:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
