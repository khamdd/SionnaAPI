import json
import math
import re
import shutil
import struct
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from urllib.error import HTTPError, URLError
from backend.constants.scenes import OVERPASS_URL, OVERPASS_FALLBACK_URL, DEFAULT_BUILDING_HEIGHT_M, MIN_POLYGON_AREA_M2


@dataclass(frozen=True)
class SceneBuildResult:
    scene_path: Path
    building_count: int
    mesh_count: int


@dataclass(frozen=True)
class Building:
    source_id: str
    points: list
    height_m: float
    material: str


def build_osm_sionna_scene(bounds, output_dir, elements=None):
    output_dir = Path(output_dir)

    if output_dir.exists():
        shutil.rmtree(output_dir)

    mesh_dir = output_dir / "meshes"
    mesh_dir.mkdir(parents=True, exist_ok=True)

    osm_elements = elements if elements is not None else fetch_osm_building_elements(bounds)
    buildings = parse_osm_buildings(osm_elements)
    projected = project_buildings_to_local_meters(buildings, bounds)

    if not projected:
        raise ValueError("No valid OSM building footprints were found for the selected area.")

    ground_mesh = mesh_dir / "ground.ply"
    material_meshes = []

    for material in sorted({building.material for building in projected}):
        material_buildings = [
            building
            for building in projected
            if building.material == material
        ]
        mesh_path = mesh_dir / f"buildings_{material}.ply"
        write_binary_ply(mesh_path, build_building_mesh(material_buildings))
        material_meshes.append((material, f"meshes/{mesh_path.name}"))

    write_binary_ply(ground_mesh, build_ground_mesh(bounds))

    scene_path = output_dir / "osm_scene.xml"
    write_scene_xml(scene_path, material_meshes)

    return SceneBuildResult(
        scene_path=scene_path,
        building_count=len(projected),
        mesh_count=len(material_meshes) + 1,
    )


def validate_sionna_scene(scene_path):
    from sionna.rt import load_scene

    load_scene(str(scene_path), merge_shapes=True, remove_duplicate_vertices=True)


def fetch_osm_building_elements(bounds):
    query = f"""
    [out:json][timeout:25][bbox:{bounds.south},{bounds.west},{bounds.north},{bounds.east}];
    way["building"];
    out tags geom;
    """
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")

    last_error = None
    for url in (OVERPASS_URL, OVERPASS_FALLBACK_URL):
        request = urllib.request.Request(
            url,
            data=body,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "User-Agent": "SionnaSimulation/1.0 (local radio planning tool)",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
                return payload.get("elements", [])
        except HTTPError as exc:
            last_error = exc
            if exc.code not in {406, 429, 502, 503, 504}:
                break
        except (TimeoutError, URLError, OSError) as exc:
            last_error = exc

    raise RuntimeError(f"OpenStreetMap building lookup failed: {last_error}")


def parse_osm_buildings(elements):
    buildings = []

    for index, element in enumerate(elements or []):
        tags = element.get("tags") or {}

        if isinstance(element.get("geometry"), list):
            building = building_from_geometry(
                element.get("id", f"osm-{index}"),
                tags,
                element["geometry"],
            )
            if building:
                buildings.append(building)
            continue

        for member_index, member in enumerate(element.get("members") or []):
            if member.get("role") not in ("outer", ""):
                continue
            geometry = member.get("geometry")
            if not isinstance(geometry, list):
                continue
            building = building_from_geometry(
                f"{element.get('id', index)}-{member_index}",
                tags,
                geometry,
            )
            if building:
                buildings.append(building)

    return buildings


def building_from_geometry(source_id, tags, geometry):
    points = [
        (float(point["lon"]), float(point["lat"]))
        for point in geometry
        if "lon" in point and "lat" in point
    ]
    points = remove_duplicate_closing_point(points)

    if len(points) < 3:
        return None

    return Building(
        source_id=str(source_id),
        points=points,
        height_m=infer_building_height(tags),
        material=infer_building_material(tags),
    )


def project_buildings_to_local_meters(buildings, bounds):
    center_lat = (bounds.south + bounds.north) / 2.0
    center_lon = (bounds.west + bounds.east) / 2.0
    meters_per_degree_lat = 111_320.0
    meters_per_degree_lon = meters_per_degree_lat * max(
        math.cos(math.radians(center_lat)),
        0.01,
    )
    projected = []

    for building in buildings:
        points = [
            (
                (lon - center_lon) * meters_per_degree_lon,
                (lat - center_lat) * meters_per_degree_lat,
            )
            for lon, lat in building.points
        ]
        points = remove_duplicate_closing_point(points)

        if len(points) < 3:
            continue

        area = polygon_signed_area(points)
        if abs(area) < MIN_POLYGON_AREA_M2:
            continue

        if area < 0:
            points = list(reversed(points))

        projected.append(
            Building(
                source_id=building.source_id,
                points=points,
                height_m=building.height_m,
                material=building.material,
            )
        )

    return projected


def infer_building_height(tags):
    tags = tags or {}
    explicit_height = parse_meters(tags.get("height") or tags.get("building:height"))
    if math.isfinite(explicit_height) and explicit_height > 0:
        return clamp(explicit_height, 2.5, 160.0)

    min_height = parse_meters(tags.get("min_height") or tags.get("building:min_height"))
    roof_height = parse_meters(tags.get("roof:height"))
    levels = parse_float(tags.get("building:levels") or tags.get("levels"))
    if math.isfinite(levels) and levels > 0:
        extra_height = 0.0
        if math.isfinite(min_height):
            extra_height += min_height
        if math.isfinite(roof_height):
            extra_height += roof_height
        return clamp(levels * 3.1 + extra_height, 2.5, 160.0)

    building_type = str(tags.get("building") or "").lower()
    if building_type in {"apartments", "residential", "hotel", "dormitory"}:
        return 18.0
    if building_type in {"office", "commercial", "retail", "public", "hospital"}:
        return 16.0
    if building_type in {"industrial", "warehouse", "manufacture"}:
        return 10.0
    if building_type in {"house", "detached", "semidetached_house", "terrace", "garage"}:
        return 7.0
    if building_type in {"church", "cathedral", "temple"}:
        return 24.0

    return DEFAULT_BUILDING_HEIGHT_M


def infer_building_material(tags):
    material = str(
        (tags or {}).get("building:material")
        or (tags or {}).get("facade:material")
        or ""
    ).lower()

    if material in {"brick", "bricks"}:
        return "brick"
    if material in {"wood", "timber"}:
        return "wood"
    if material in {"glass"}:
        return "glass"
    if material in {"metal", "steel", "aluminium", "aluminum"}:
        return "metal"

    return "concrete"


def parse_meters(value):
    if value in (None, ""):
        return math.nan

    text = str(value).strip().lower().replace(",", ".")
    number = parse_float(text)
    if not math.isfinite(number):
        return math.nan
    if "ft" in text or "feet" in text:
        return number * 0.3048
    return number


def parse_float(value):
    if value is None:
        return math.nan

    match = re.search(r"[-+]?\d+(?:\.\d+)?", str(value).replace(",", "."))
    if not match:
        return math.nan

    return float(match.group(0))


def build_building_mesh(buildings):
    vertices = []
    faces = []

    for building in buildings:
        add_extruded_polygon(vertices, faces, building.points, building.height_m)

    return vertices, faces


def add_extruded_polygon(vertices, faces, points, height):
    base_index = len(vertices)

    for x, y in points:
        vertices.append((x, y, 0.0))
    for x, y in points:
        vertices.append((x, y, height))

    count = len(points)

    for index in range(count):
        next_index = (index + 1) % count
        bottom_a = base_index + index
        bottom_b = base_index + next_index
        top_a = base_index + count + index
        top_b = base_index + count + next_index
        faces.append((bottom_a, bottom_b, top_b))
        faces.append((bottom_a, top_b, top_a))

    triangles = triangulate_polygon(points)
    for a, b, c in triangles:
        faces.append((base_index + count + a, base_index + count + b, base_index + count + c))
        faces.append((base_index + c, base_index + b, base_index + a))


def triangulate_polygon(points):
    if len(points) == 3:
        return [(0, 1, 2)]

    remaining = list(range(len(points)))
    triangles = []
    guard = len(points) * len(points)

    while len(remaining) > 3 and guard > 0:
        guard -= 1
        ear_found = False

        for position, current in enumerate(remaining):
            previous = remaining[position - 1]
            following = remaining[(position + 1) % len(remaining)]

            if not is_convex(points[previous], points[current], points[following]):
                continue

            if any(
                point_in_triangle(points[candidate], points[previous], points[current], points[following])
                for candidate in remaining
                if candidate not in {previous, current, following}
            ):
                continue

            triangles.append((previous, current, following))
            del remaining[position]
            ear_found = True
            break

        if not ear_found:
            return fan_triangulate(points)

    if len(remaining) == 3:
        triangles.append(tuple(remaining))

    return triangles


def fan_triangulate(points):
    return [
        (0, index, index + 1)
        for index in range(1, len(points) - 1)
    ]


def is_convex(a, b, c):
    return cross_2d(a, b, c) > 1e-9


def point_in_triangle(point, a, b, c):
    area = abs(cross_2d(a, b, c))
    area_1 = abs(cross_2d(point, a, b))
    area_2 = abs(cross_2d(point, b, c))
    area_3 = abs(cross_2d(point, c, a))
    return abs(area - (area_1 + area_2 + area_3)) < 1e-6


def cross_2d(a, b, c):
    return (
        (b[0] - a[0]) * (c[1] - a[1])
        - (b[1] - a[1]) * (c[0] - a[0])
    )


def build_ground_mesh(bounds):
    width = max(calculate_width_m(bounds), 1.0)
    height = max(calculate_height_m(bounds), 1.0)
    padding = 25.0
    half_width = width / 2.0 + padding
    half_height = height / 2.0 + padding

    vertices = [
        (-half_width, -half_height, -0.05),
        (half_width, -half_height, -0.05),
        (half_width, half_height, -0.05),
        (-half_width, half_height, -0.05),
    ]
    faces = [
        (0, 1, 2),
        (0, 2, 3),
    ]
    return vertices, faces


def write_binary_ply(path, mesh):
    vertices, faces = mesh
    header = "\n".join(
        [
            "ply",
            "format binary_little_endian 1.0",
            f"element vertex {len(vertices)}",
            "property float x",
            "property float y",
            "property float z",
            f"element face {len(faces)}",
            "property list uchar int vertex_indices",
            "end_header",
            "",
        ]
    ).encode("ascii")

    with Path(path).open("wb") as file:
        file.write(header)
        for x, y, z in vertices:
            file.write(struct.pack("<fff", float(x), float(y), float(z)))
        for a, b, c in faces:
            file.write(struct.pack("<Biii", 3, int(a), int(b), int(c)))


def write_scene_xml(path, material_meshes):
    root = ET.Element("scene", {"version": "2.1.0"})

    for material in ("concrete", "brick", "wood", "glass", "metal", "wet_ground"):
        bsdf = ET.SubElement(root, "bsdf", {"type": "itu-radio-material", "id": material})
        ET.SubElement(bsdf, "string", {"name": "type", "value": material})
        ET.SubElement(bsdf, "float", {"name": "thickness", "value": "0.1"})

    for material, filename in material_meshes:
        add_ply_shape(root, f"mesh-buildings-{material}", filename, material)

    add_ply_shape(root, "mesh-ground", "meshes/ground.ply", "wet_ground")

    ET.indent(root, space="    ")
    tree = ET.ElementTree(root)
    tree.write(path, encoding="unicode", xml_declaration=False)


def add_ply_shape(root, shape_id, filename, material_id):
    shape = ET.SubElement(root, "shape", {"type": "ply", "id": shape_id})
    ET.SubElement(shape, "string", {"name": "filename", "value": filename})
    ET.SubElement(shape, "boolean", {"name": "face_normals", "value": "true"})
    ET.SubElement(shape, "ref", {"id": material_id, "name": "bsdf"})


def calculate_width_m(bounds):
    mid_lat = math.radians((bounds.south + bounds.north) / 2.0)
    return abs(bounds.east - bounds.west) * 111_320.0 * max(math.cos(mid_lat), 0.01)


def calculate_height_m(bounds):
    return abs(bounds.north - bounds.south) * 111_320.0


def polygon_signed_area(points):
    area = 0.0
    for index, current in enumerate(points):
        following = points[(index + 1) % len(points)]
        area += current[0] * following[1] - following[0] * current[1]
    return area / 2.0


def remove_duplicate_closing_point(points):
    if len(points) < 2:
        return points

    first = points[0]
    last = points[-1]
    if abs(first[0] - last[0]) < 1e-9 and abs(first[1] - last[1]) < 1e-9:
        return points[:-1]

    return points


def clamp(value, minimum, maximum):
    return min(max(value, minimum), maximum)
