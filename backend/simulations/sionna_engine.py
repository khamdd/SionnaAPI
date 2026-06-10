import threading


class SionnaEngine:
    def __init__(self):
        self._scene = None
        self.lock = threading.RLock()

    def get_scene(self):
        with self.lock:
            if self._scene is None:
                self._scene = self._load_scene()

            return self._scene

    def _load_scene(self):
        import sionna
        from sionna.rt import load_scene

        return load_scene(
            sionna.rt.scene.munich,
            merge_shapes=True,
        )


engine = SionnaEngine()
