import os 
from pathlib import Path

DEFAULT_SCENE_ID = "munich"
DEFAULT_SCENE_NAME = "Munich"
DEFAULT_SCENE_BOUNDS = {
    "south": 48.1344,
    "west": 11.5715,
    "north": 48.1404,
    "east": 11.5795,
}

PROJECT_ROOT = Path(__file__).resolve().parents[2]
OFFLINE_BUILDINGS_DIR = Path(
    os.getenv("OFFLINE_BUILDINGS_DIR", PROJECT_ROOT / "static" / "offline-buildings")
)

MAX_IMPORTED_SCENES = 3
MAX_SCENE_AREA_KM2 = 5.0
MAX_SCENE_SIDE_M = 1500.0
SCENE_PREVIEW_TTL_HOURS = 2

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_FALLBACK_URL = "https://overpass.kumi.systems/api/interpreter"
OVERPASS_QUERY_TIMEOUT_SECONDS = 60
OVERPASS_HTTP_TIMEOUT_SECONDS = 90
DEFAULT_BUILDING_HEIGHT_M = 9.0
MIN_POLYGON_AREA_M2 = 4.0
