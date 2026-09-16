"""Scene loading using the configured Sionna RT backend."""


def load_scene(scene_path):
    """Load a Sionna scene without falling back to a CPU Mitsuba variant.

    If CUDA/OptiX is unavailable, Sionna raises and the simulation job fails.
    This makes accidental CPU execution visible instead of silently changing
    the execution backend.
    """
    from sionna.rt import load_scene as sionna_load_scene

    return sionna_load_scene(scene_path, merge_shapes=True)
