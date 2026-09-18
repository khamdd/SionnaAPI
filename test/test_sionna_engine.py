from backend.simulations import sionna_engine as sionna_engine_module
from backend.simulations.sionna_engine import SionnaEngine


def test_sionna_engine_starts_without_loaded_scene():
    engine = SionnaEngine()

    assert engine._scene is None


def test_sionna_engine_loads_scene_lazily_once(monkeypatch):
    engine = SionnaEngine()
    active_scene = {
        "id": "test-scene",
        "name": "Test scene",
        "scene_path": "static/scenes/test-scene/runtime_scene/osm_scene.xml",
    }
    monkeypatch.setattr(
        sionna_engine_module,
        "get_active_scene",
        lambda: active_scene,
    )
    engine.set_active_scene(active_scene)
    loaded_scene = object()
    calls = []

    def fake_load_scene():
        calls.append("load")
        return loaded_scene

    monkeypatch.setattr(engine, "_load_scene", fake_load_scene)

    first = engine.get_scene()
    second = engine.get_scene()

    assert first is loaded_scene
    assert second is loaded_scene
    assert calls == ["load"]


def test_sionna_engine_refreshes_and_reloads_when_active_scene_changes(monkeypatch):
    active_scene = {
        "id": "scene-a",
        "name": "Scene A",
        "scene_path": "static/scenes/scene-a/runtime_scene/osm_scene.xml",
    }
    monkeypatch.setattr(
        sionna_engine_module,
        "get_active_scene",
        lambda: active_scene,
    )

    engine = SionnaEngine()
    loaded_scenes = [object(), object()]

    def fake_load_scene():
        return loaded_scenes.pop(0)

    monkeypatch.setattr(engine, "_load_scene", fake_load_scene)

    first = engine.get_scene()
    active_scene = {
        "id": "scene-b",
        "name": "Scene B",
        "scene_path": "static/scenes/scene-b/runtime_scene/osm_scene.xml",
    }
    second = engine.get_scene()

    assert first is not second
    assert engine.get_active_scene_info()["id"] == "scene-b"
