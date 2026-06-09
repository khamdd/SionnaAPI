import threading
import sionna

from sionna.rt import load_scene

scene = load_scene(
    sionna.rt.scene.munich,
    merge_shapes=True
)

sionna_lock = threading.Lock()