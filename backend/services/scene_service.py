import json
import math
import shutil
import threading
import uuid
from datetime import timezone
from pathlib import Path

from backend.constants import (
    DEFAULT_SCENE_ID,
    DEFAULT_SCENE_NAME,
    MAX_IMPORTED_SCENES,
    MAX_SCENE_AREA_KM2,
    MAX_SCENE_SIDE_M,
    SCENE_REGISTRY_PATH,
    SCENE_ROOT,
)
from backend.schemas.requests import SceneBoundsRequest
from backend.services.osm_scene_builder import (
    build_osm_sionna_scene,
    validate_sionna_scene,
)
from backend.services.simulation_store import utc_now


_lock = threading.RLock()


def list_scenes():
    with _lock:
        registry = load_registry()
        scenes = [
            serialize_scene(scene)
            for scene in registry["scenes"]
        ]

        active_scene_id = registry.get("active_scene_id") or DEFAULT_SCENE_ID

        return {
            "active_scene_id": active_scene_id,
            "active_scene": find_scene(registry, active_scene_id),
            "max_imported_scenes": MAX_IMPORTED_SCENES,
            "imported_scene_count": count_imported_scenes(registry),
            "scenes": scenes,
        }


def get_active_scene():
    with _lock:
        registry = load_registry()
        active_scene_id = registry.get("active_scene_id") or DEFAULT_SCENE_ID
        scene = find_scene(registry, active_scene_id)

        if scene is None:
            scene = default_scene()

        return serialize_scene(scene)


def create_scene_preview(req: SceneBoundsRequest, base_url):
    with _lock:
        registry = load_registry()

        if count_imported_scenes(registry) >= MAX_IMPORTED_SCENES:
            return {
                "status": "failure",
                "status_code": 409,
                "error": f"Only {MAX_IMPORTED_SCENES} imported scenes are allowed.",
            }

        metrics = calculate_bounds_metrics(req)
        validation_error = validate_scene_metrics(metrics)
        if validation_error:
            return {
                "status": "failure",
                "status_code": 400,
                "error": validation_error,
                "metrics": metrics,
            }

        scene_id = str(uuid.uuid4())
        scene_name = (req.name or f"Imported scene {scene_id[:8]}").strip()
        scene_dir = SCENE_ROOT / scene_id
        runtime_dir = scene_dir / "runtime_scene"

        try:
            build_result = build_osm_sionna_scene(req, runtime_dir)
            validate_sionna_scene(build_result.scene_path)
        except ValueError as exc:
            shutil.rmtree(scene_dir, ignore_errors=True)
            return {
                "status": "failure",
                "status_code": 400,
                "error": str(exc),
            }
        except Exception as exc:
            shutil.rmtree(scene_dir, ignore_errors=True)
            return {
                "status": "failure",
                "status_code": 502,
                "error": f"Failed to build Sionna scene from OpenStreetMap data: {exc}",
            }

        write_preview_svg(scene_dir / "preview.svg", scene_name, req, metrics)

        scene = {
            "id": scene_id,
            "name": scene_name,
            "status": "preview",
            "is_default": False,
            "bounds": req.model_dump(mode="json"),
            "metrics": metrics,
            "scene_path": str(build_result.scene_path),
            "building_count": build_result.building_count,
            "mesh_count": build_result.mesh_count,
            "preview_url": public_static_url(base_url, f"scenes/{scene_id}/preview.svg"),
            "created_at": utc_now().isoformat(),
        }

        registry["scenes"].append(scene)
        save_registry(registry)

        return {
            "status": "success",
            "scene": serialize_scene(scene),
        }


def activate_scene(scene_id):
    with _lock:
        registry = load_registry()
        scene = find_scene(registry, scene_id)

        if scene is None:
            return {
                "status": "failure",
                "status_code": 404,
                "error": "Scene not found.",
            }

        if scene.get("status") == "preview":
            scene["status"] = "ready"

        registry["active_scene_id"] = scene_id
        save_registry(registry)

        return {
            "status": "success",
            "scene": serialize_scene(scene),
        }


def delete_scene(scene_id):
    with _lock:
        registry = load_registry()
        active_scene_id = registry.get("active_scene_id") or DEFAULT_SCENE_ID
        scene = find_scene(registry, scene_id)

        if scene is None:
            return {
                "status": "failure",
                "status_code": 404,
                "error": "Scene not found.",
            }

        if scene.get("is_default"):
            return {
                "status": "failure",
                "status_code": 400,
                "error": "The default Munich scene cannot be deleted.",
            }

        if scene_id == active_scene_id:
            return {
                "status": "failure",
                "status_code": 400,
                "error": "The active scene cannot be deleted.",
            }

        registry["scenes"] = [
            item
            for item in registry["scenes"]
            if item.get("id") != scene_id
        ]
        save_registry(registry)
        delete_scene_files(scene_id)

        return {
            "status": "success",
            "deleted": True,
        }


def calculate_bounds_metrics(req: SceneBoundsRequest):
    mid_lat = math.radians((req.south + req.north) / 2.0)
    meters_per_degree_lat = 111_320.0
    meters_per_degree_lon = meters_per_degree_lat * max(math.cos(mid_lat), 0.01)
    width_m = abs(req.east - req.west) * meters_per_degree_lon
    height_m = abs(req.north - req.south) * meters_per_degree_lat
    area_km2 = (width_m * height_m) / 1_000_000.0

    return {
        "width_m": round(width_m, 2),
        "height_m": round(height_m, 2),
        "area_km2": round(area_km2, 4),
    }


def validate_scene_metrics(metrics):
    if metrics["area_km2"] > MAX_SCENE_AREA_KM2:
        return f"Selected area is too large. Maximum allowed area is {MAX_SCENE_AREA_KM2} km²."

    if metrics["width_m"] > MAX_SCENE_SIDE_M or metrics["height_m"] > MAX_SCENE_SIDE_M:
        return f"Selected area is too wide. Maximum width/height is {MAX_SCENE_SIDE_M:.0f} m."

    return None


def load_registry():
    SCENE_ROOT.mkdir(parents=True, exist_ok=True)

    if SCENE_REGISTRY_PATH.exists():
        registry = json.loads(SCENE_REGISTRY_PATH.read_text(encoding="utf-8"))
    else:
        registry = {
            "active_scene_id": DEFAULT_SCENE_ID,
            "scenes": [],
        }

    ensure_default_scene(registry)
    return registry


def save_registry(registry):
    SCENE_ROOT.mkdir(parents=True, exist_ok=True)
    SCENE_REGISTRY_PATH.write_text(
        json.dumps(registry, indent=2),
        encoding="utf-8",
    )


def ensure_default_scene(registry):
    scenes = registry.setdefault("scenes", [])

    if find_scene(registry, DEFAULT_SCENE_ID) is None:
        scenes.insert(0, default_scene())

    if not registry.get("active_scene_id"):
        registry["active_scene_id"] = DEFAULT_SCENE_ID


def default_scene():
    return {
        "id": DEFAULT_SCENE_ID,
        "name": DEFAULT_SCENE_NAME,
        "status": "ready",
        "is_default": True,
        "bounds": None,
        "metrics": None,
        "scene_path": None,
        "preview_url": None,
        "created_at": None,
    }


def find_scene(registry, scene_id):
    for scene in registry.get("scenes", []):
        if scene.get("id") == scene_id:
            return scene

    return None


def count_imported_scenes(registry):
    return sum(
        1
        for scene in registry.get("scenes", [])
        if not scene.get("is_default") and scene.get("status") == "ready"
    )


def serialize_scene(scene):
    if scene is None:
        return None

    return dict(scene)


def public_static_url(base_url, relative_path):
    return str(base_url).rstrip("/") + "/static/" + relative_path


def copy_demo_scene(target_dir):
    source_dir = get_demo_scene_source_dir()

    if target_dir.exists():
        shutil.rmtree(target_dir)

    shutil.copytree(source_dir, target_dir)


def get_demo_scene_source_dir():
    import sionna

    return Path(sionna.rt.scene.simple_street_canyon).resolve().parent


def write_preview_svg(path, scene_name, req, metrics):
    escaped_name = escape_xml(scene_name)
    created_at = utc_now().astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    label = (
        f"{metrics['width_m']:.0f} m x {metrics['height_m']:.0f} m, "
        f"{metrics['area_km2']:.3f} km²"
    )

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
  <rect width="960" height="540" fill="#edf2f7"/>
  <rect x="80" y="70" width="800" height="380" rx="10" fill="#dbeafe" stroke="#2563eb" stroke-width="4"/>
  <path d="M120 120 L840 420 M160 390 L830 110 M90 250 L870 250" stroke="#93c5fd" stroke-width="8" opacity="0.65"/>
  <g fill="#64748b" opacity="0.72">
    <rect x="170" y="145" width="130" height="74" rx="4"/>
    <rect x="365" y="105" width="98" height="160" rx="4"/>
    <rect x="570" y="160" width="180" height="90" rx="4"/>
    <rect x="245" y="300" width="180" height="76" rx="4"/>
    <rect x="520" y="310" width="105" height="95" rx="4"/>
    <rect x="675" y="300" width="115" height="68" rx="4"/>
  </g>
  <rect x="80" y="70" width="800" height="380" rx="10" fill="none" stroke="#0f172a" stroke-width="2" opacity="0.7"/>
  <text x="80" y="500" fill="#0f172a" font-family="Arial, sans-serif" font-size="30" font-weight="700">{escaped_name}</text>
  <text x="80" y="528" fill="#475569" font-family="Arial, sans-serif" font-size="18">{escape_xml(label)} · created {created_at}</text>
  <text x="880" y="38" text-anchor="end" fill="#64748b" font-family="Arial, sans-serif" font-size="16">Demo Sionna scene preview</text>
</svg>
"""
    path.write_text(svg, encoding="utf-8")


def escape_xml(value):
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def delete_scene_files(scene_id):
    path = SCENE_ROOT / scene_id

    if not path.exists():
        return

    shutil.rmtree(path, ignore_errors=True)
