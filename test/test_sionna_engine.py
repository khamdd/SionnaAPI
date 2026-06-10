from backend.simulations.sionna_engine import SionnaEngine


def test_sionna_engine_starts_without_loaded_scene():
    engine = SionnaEngine()

    assert engine._scene is None


def test_sionna_engine_loads_scene_lazily_once(monkeypatch):
    engine = SionnaEngine()
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
