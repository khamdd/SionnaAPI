import threading

from backend.services.scene_service import (
    get_active_scene,
)


class SionnaEngine:
    def __init__(self):
        self._scene = None
        self._scene_id = None
        self._scene_name = None
        self._scene_path = None
        self._scene_bounds = None
        self._scene_metrics = None
        self._active_scene_synced = False
        self.lock = threading.RLock()

    def get_scene(self):
        with self.lock:
            if self._scene is None:
                if not self._active_scene_synced:
                    self._sync_active_scene()
                self._scene = self._load_scene()

            return self._scene

    def get_active_scene_info(self):
        with self.lock:
            if not self._active_scene_synced:
                self._sync_active_scene()

            return {
                "id": self._scene_id,
                "name": self._scene_name,
                "scene_path": self._scene_path,
                "bounds": self._scene_bounds,
                "metrics": self._scene_metrics,
            }

    def set_active_scene(self, scene):
        with self.lock:
            next_scene_id = scene["id"]
            next_scene_name = scene["name"]
            next_scene_path = scene.get("scene_path")
            next_scene_bounds = scene.get("bounds")
            next_scene_metrics = scene.get("metrics")

            if (
                next_scene_id == self._scene_id
                and next_scene_path == self._scene_path
            ):
                self._active_scene_synced = True
                return

            self._scene = None
            self._scene_id = next_scene_id
            self._scene_name = next_scene_name
            self._scene_path = next_scene_path
            self._scene_bounds = next_scene_bounds
            self._scene_metrics = next_scene_metrics
            self._active_scene_synced = True

    def clear_active_scene(self):
        with self.lock:
            self._scene = None
            self._scene_id = None
            self._scene_name = None
            self._scene_path = None
            self._scene_bounds = None
            self._scene_metrics = None
            self._active_scene_synced = True

    def _sync_active_scene(self):
        active_scene = get_active_scene()
        if str(active_scene.get("status", "")).lower().startswith("failure"):
            raise RuntimeError(active_scene.get("error") or "No active scene is selected.")

        self._scene_id = active_scene["id"]
        self._scene_name = active_scene["name"]
        self._scene_path = active_scene.get("scene_path")
        self._scene_bounds = active_scene.get("bounds")
        self._scene_metrics = active_scene.get("metrics")
        self._active_scene_synced = True

    def _load_scene(self):
        from sionna.rt import load_scene

        if not self._scene_path:
            raise RuntimeError("No active scene is selected.")

        return load_scene(self._scene_path, merge_shapes=True)


engine = SionnaEngine()
