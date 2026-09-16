"""Scene loading with a runtime fallback for environments without OptiX."""

import logging


logger = logging.getLogger(__name__)


def load_scene(scene_path):
    """Load a Sionna scene, falling back to LLVM when OptiX is unavailable.

    CUDA can be visible in Docker while the OptiX driver library is not exposed
    (notably with some Windows/WSL Docker Desktop configurations). Mitsuba only
    reports that mismatch when a scene is instantiated, so retry with the CPU
    LLVM backend instead of failing the simulation job.
    """
    from sionna.rt import load_scene as sionna_load_scene
    import mitsuba as mi

    try:
        return sionna_load_scene(scene_path, merge_shapes=True)
    except RuntimeError as exc:
        if "OptiX" not in str(exc) or not str(mi.variant()).startswith("cuda"):
            raise

        logger.warning(
            "OptiX is unavailable; retrying Sionna scene load with LLVM CPU backend"
        )
        mi.set_variant("llvm_ad_mono_polarized")
        return sionna_load_scene(scene_path, merge_shapes=True)
