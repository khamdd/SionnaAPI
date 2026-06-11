import threading

from backend.services.scene_service import (
    DEFAULT_SCENE_ID,
    DEFAULT_SCENE_NAME,
    get_active_scene,
)


class SionnaEngine:
    def __init__(self):
        self._scene = None
        self._scene_id = DEFAULT_SCENE_ID
        self._scene_name = DEFAULT_SCENE_NAME
        self._scene_path = None
        self.lock = threading.RLock()

    def get_scene(self):
        with self.lock:
            if self._scene is None:
                self._sync_active_scene()
                self._scene = self._load_scene()

            return self._scene

    def get_active_scene_info(self):
        with self.lock:
            return {
                "id": self._scene_id,
                "name": self._scene_name,
                "scene_path": self._scene_path,
            }

    def set_active_scene(self, scene):
        with self.lock:
            next_scene_id = scene["id"]
            next_scene_name = scene["name"]
            next_scene_path = scene.get("scene_path")

            if (
                next_scene_id == self._scene_id
                and next_scene_path == self._scene_path
            ):
                return

            self._scene = None
            self._scene_id = next_scene_id
            self._scene_name = next_scene_name
            self._scene_path = next_scene_path

    def _sync_active_scene(self):
        active_scene = get_active_scene()
        self._scene_id = active_scene["id"]
        self._scene_name = active_scene["name"]
        self._scene_path = active_scene.get("scene_path")

    def _load_scene(self):
        import sionna
        from sionna.rt import load_scene

        scene_source = self._scene_path or sionna.rt.scene.munich

        return load_scene(scene_source, merge_shapes=True)


engine = SionnaEngine()
