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
            self._sync_active_scene()
            if self._scene is None:
                self._scene = self._load_scene()

            return self._scene

    def get_active_scene_info(self):
        with self.lock:
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

            self._update_active_scene(
                next_scene_id,
                next_scene_name,
                next_scene_path,
                next_scene_bounds,
                next_scene_metrics,
            )

    def _update_active_scene(
        self,
        scene_id,
        scene_name,
        scene_path,
        scene_bounds,
        scene_metrics,
    ):
        scene_changed = (
            scene_id != self._scene_id
            or scene_path != self._scene_path
        )

        if scene_changed:
            self._scene = None

        self._scene_id = scene_id
        self._scene_name = scene_name
        self._scene_path = scene_path
        self._scene_bounds = scene_bounds
        self._scene_metrics = scene_metrics
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

        self._update_active_scene(
            active_scene["id"],
            active_scene["name"],
            active_scene.get("scene_path"),
            active_scene.get("bounds"),
            active_scene.get("metrics"),
        )

    def _load_scene(self):
        from backend.simulations.sionna_scene import load_scene

        if not self._scene_path:
            raise RuntimeError("No active scene is selected.")

        return load_scene(self._scene_path)


engine = SionnaEngine()
