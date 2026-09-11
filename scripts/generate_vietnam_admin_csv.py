"""Generate Vietnamese province/ward CSV datasets for the choose-scene flow.

Source: https://github.com/ThangLeQuoc/vietnamese-provinces-database (MIT)

Downloads (or reuses) the official name dataset and the GeoJSON boundary
archive, then writes two CSVs into frontend/public/data/:

- vietnam-provinces.csv : one row per province (34 rows)
- vietnam-wards.csv     : one row per ward/commune (3321 rows)

Each row carries center coordinates plus the geographic bounding box
(south/north/west/east) so the frontend can fly the map to the selected
area and prepare a Sionna scene for preview and simulation.

Usage:
    python scripts/generate_vietnam_admin_csv.py [--workdir PATH] [--out PATH]
"""

import argparse
import csv
import json
import sys
import unicodedata
import zipfile
from io import BytesIO
from pathlib import Path
from urllib.request import urlopen

BASE_URL = "https://raw.githubusercontent.com/thanglequoc/vietnamese-provinces-database/master/json"
FULL_JSON_NAME = "full_json_generated_data_vn_units.json"
GEOJSON_ZIP_NAME = "vn_provinces_wards_geojson.zip"


def download(url: str) -> bytes:
    print(f"Downloading {url}")
    with urlopen(url, timeout=120) as response:  # nosec B310 - fixed trusted host
        return response.read()


def ring_centroid_and_area(ring):
    """Signed shoelace centroid and area for a single closed ring."""
    area_sum = 0.0
    cx_sum = 0.0
    cy_sum = 0.0
    count = len(ring)
    for index in range(count - 1):
        x1, y1 = ring[index][0], ring[index][1]
        x2, y2 = ring[index + 1][0], ring[index + 1][1]
        cross = x1 * y2 - x2 * y1
        area_sum += cross
        cx_sum += (x1 + x2) * cross
        cy_sum += (y1 + y2) * cross
    area = area_sum / 2.0
    if area == 0:
        return None
    return area, cx_sum / (3.0 * area_sum), cy_sum / (3.0 * area_sum)


def polygon_parts(rings):
    """Yield (centroid_x, centroid_y, abs_area) for one polygon (list of rings)."""
    total_area = 0.0
    cx_sum = 0.0
    cy_sum = 0.0
    for ring in rings:
        computed = ring_centroid_and_area(ring)
        if computed is None:
            continue
        area, cx, cy = computed
        total_area += area
        cx_sum += area * cx
        cy_sum += area * cy
    if total_area == 0:
        return []
    return [(cx_sum / total_area, cy_sum / total_area, abs(total_area))]


def geometry_center(geometry):
    """Area-weighted centroid of a Polygon/MultiPolygon, bbox-center fallback."""
    coordinates = geometry["coordinates"]
    if geometry["type"] == "Polygon":
        polygons = [coordinates]
    elif geometry["type"] == "MultiPolygon":
        polygons = coordinates
    else:
        return None
    total_area = 0.0
    cx_sum = 0.0
    cy_sum = 0.0
    largest = None
    for polygon in polygons:
        for cx, cy, area in polygon_parts(polygon):
            total_area += area
            cx_sum += area * cx
            cy_sum += area * cy
            if largest is None or area > largest[2]:
                largest = (cx, cy, area)
    if total_area > 0:
        return cx_sum / total_area, cy_sum / total_area
    if largest is not None:
        return largest[0], largest[1]
    return None


def strip_diacritics(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    return "".join(char for char in decomposed if unicodedata.category(char) != "Mn")


def format_number(value) -> str:
    text = f"{value:.6f}".rstrip("0").rstrip(".")
    return text if text else "0"


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
        help="Output directory for the generated CSV files",
    )
    args = parser.parse_args()

    args.workdir.mkdir(parents=True, exist_ok=True)
    args.out.mkdir(parents=True, exist_ok=True)

    full_json_path = args.workdir / FULL_JSON_NAME
    if not full_json_path.exists():
        full_json_path.write_bytes(download(f"{BASE_URL}/{FULL_JSON_NAME}"))
    dataset = json.loads(full_json_path.read_text(encoding="utf-8"))

    geojson_root = args.workdir / "geojson"
    if not geojson_root.exists():
        archive = download(f"{BASE_URL}/{GEOJSON_ZIP_NAME}")
        with zipfile.ZipFile(BytesIO(archive)) as zip_file:
            zip_file.extractall(args.workdir)

    # The archive contains a top-level "geojson" folder; accept either layout.
    def has_province_folders(path):
        return path.exists() and any(
            child.is_dir() and child.name[:2].isdigit() and "_" in child.name
            for child in path.iterdir()
        )

    if not has_province_folders(geojson_root):
        candidates = [
            path
            for path in [geojson_root / "geojson", args.workdir / "geojson" / "geojson"]
            if has_province_folders(path)
        ] or [path for path in args.workdir.rglob("geojson") if has_province_folders(path)]
        if candidates:
            geojson_root = candidates[0]

    provinces_out = []
    wards_out = []

    for province in dataset:
        province_code = province["Code"]
        folder = next(
            (path for path in geojson_root.iterdir() if path.is_dir() and path.name.startswith(f"{province_code}_")),
            None,
        )
        if folder is None:
            print(f"WARNING: no geojson folder for province {province_code} {province['Name']}", file=sys.stderr)
            continue

        province_geo_path = folder / f"{folder.name}.geojson"
        province_geo = json.loads(province_geo_path.read_text(encoding="utf-8"))
        west, south, east, north = province_geo["bbox"]
        center = geometry_center(province_geo["features"][0]["geometry"]) or ((west + east) / 2, (south + north) / 2)
        provinces_out.append(
            {
                "code": province_code,
                "name": province["Name"],
                "name_en": province["NameEn"],
                "full_name": province["FullName"],
                "full_name_en": province["FullNameEn"],
                "code_name": province["CodeName"],
                "unit_type": province["AdministrativeUnitShortName"],
                "center_lat": format_number(center[1]),
                "center_lng": format_number(center[0]),
                "bbox_south": format_number(south),
                "bbox_north": format_number(north),
                "bbox_west": format_number(west),
                "bbox_east": format_number(east),
                "area_km2": province_geo["features"][0]["properties"].get("areaKm2", ""),
                "ward_count": len(province["Wards"]),
            }
        )

        wards_folder = folder / "wards"
        for ward in province["Wards"]:
            ward_code = ward["Code"]
            ward_path = next(
                (path for path in wards_folder.glob(f"{ward_code}_*.geojson")),
                None,
            )
            if ward_path is None:
                print(f"WARNING: no geojson for ward {ward_code} {ward['Name']}", file=sys.stderr)
                continue
            ward_geo = json.loads(ward_path.read_text(encoding="utf-8"))
            feature = ward_geo["features"][0]
            west, south, east, north = ward_geo["bbox"]
            center = geometry_center(feature["geometry"]) or ((west + east) / 2, (south + north) / 2)
            wards_out.append(
                {
                    "ward_code": ward_code,
                    "ward_name": ward["Name"],
                    "ward_name_en": ward["NameEn"],
                    "ward_full_name": ward["FullName"],
                    "ward_full_name_en": ward["FullNameEn"],
                    "ward_type": ward["AdministrativeUnitShortName"],
                    "province_code": province_code,
                    "province_name": province["Name"],
                    "province_name_en": province["NameEn"],
                    "center_lat": format_number(center[1]),
                    "center_lng": format_number(center[0]),
                    "bbox_south": format_number(south),
                    "bbox_north": format_number(north),
                    "bbox_west": format_number(west),
                    "bbox_east": format_number(east),
                    "area_km2": feature["properties"].get("areaKm2", ""),
                }
            )

    provinces_out.sort(key=lambda row: strip_diacritics(row["name"]).lower())
    wards_out.sort(key=lambda row: (row["province_code"], strip_diacritics(row["ward_name"]).lower()))

    province_fields = [
        "code", "name", "name_en", "full_name", "full_name_en", "code_name",
        "unit_type", "center_lat", "center_lng",
        "bbox_south", "bbox_north", "bbox_west", "bbox_east", "area_km2", "ward_count",
    ]
    ward_fields = [
        "ward_code", "ward_name", "ward_name_en", "ward_full_name", "ward_full_name_en",
        "ward_type", "province_code", "province_name", "province_name_en",
        "center_lat", "center_lng",
        "bbox_south", "bbox_north", "bbox_west", "bbox_east", "area_km2",
    ]

    provinces_path = args.out / "vietnam-provinces.csv"
    with provinces_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=province_fields)
        writer.writeheader()
        writer.writerows(provinces_out)

    wards_path = args.out / "vietnam-wards.csv"
    with wards_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=ward_fields)
        writer.writeheader()
        writer.writerows(wards_out)

    print(f"Wrote {provinces_path} ({len(provinces_out)} rows)")
    print(f"Wrote {wards_path} ({len(wards_out)} rows)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
