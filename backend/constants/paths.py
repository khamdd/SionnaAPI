from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
STATIC_DIR = PROJECT_ROOT / "static"
SCENE_ROOT = STATIC_DIR / "scenes"
SCENE_REGISTRY_PATH = SCENE_ROOT / "scenes.json"
