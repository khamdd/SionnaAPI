import json
from datetime import timedelta
from pathlib import Path

from backend.schemas.requests import SceneBoundsRequest
from backend.services import scene_service
from backend.services.osm_scene_builder import SceneBuildResult


def make_request():
    return SceneBoundsRequest(
        name="Hanoi test scene",
        south=21.0000,
        west=105.8000,
        north=21.0010,
        east=105.8010,
    )


def test_empty_registry_has_no_default_scene(tmp_path, monkeypatch):
    scene_root = tmp_path / "scenes"
    monkeypatch.setattr(scene_service, "SCENE_ROOT", scene_root)
    monkeypatch.setattr(scene_service, "SCENE_REGISTRY_PATH", scene_root / "scenes.json")

    result = scene_service.list_scenes()

    assert result["active_scene_id"] is None
    assert result["active_scene"] is None
    assert result["scenes"] == []
    assert result["imported_scene_count"] == 0


def test_get_active_scene_fails_when_no_scene_is_selected(tmp_path, monkeypatch):
    scene_root = tmp_path / "scenes"
    monkeypatch.setattr(scene_service, "SCENE_ROOT", scene_root)
    monkeypatch.setattr(scene_service, "SCENE_REGISTRY_PATH", scene_root / "scenes.json")

    result = scene_service.get_active_scene()

    assert result["status"] == "failure"
    assert result["status_code"] == 404
    assert result["error"] == "No active scene is selected."


def test_create_scene_preview_registers_generated_osm_scene(tmp_path, monkeypatch):
    scene_root = tmp_path / "scenes"
    monkeypatch.setattr(scene_service, "SCENE_ROOT", scene_root)
    monkeypatch.setattr(scene_service, "SCENE_REGISTRY_PATH", scene_root / "scenes.json")

    def fake_build_osm_sionna_scene(req, output_dir):
        output_dir = Path(output_dir)
        (output_dir / "meshes").mkdir(parents=True)
        scene_path = output_dir / "osm_scene.xml"
        scene_path.write_text("<scene version=\"2.1.0\"/>", encoding="utf-8")
        return SceneBuildResult(
            scene_path=scene_path,
            building_count=7,
            mesh_count=2,
        )

    monkeypatch.setattr(scene_service, "build_osm_sionna_scene", fake_build_osm_sionna_scene)
    monkeypatch.setattr(scene_service, "validate_sionna_scene", lambda scene_path: None)

    result = scene_service.create_scene_preview(
        make_request(),
        "http://127.0.0.1:8000/",
    )

    assert result["status"] == "success"
    scene = result["scene"]
    assert scene["name"] == "Hanoi test scene"
    assert scene["status"] == "preview"
    assert scene["expires_at"]
    assert scene["building_count"] == 7
    assert scene["mesh_count"] == 2
    assert scene["scene_path"].endswith("runtime_scene\\osm_scene.xml") or scene["scene_path"].endswith("runtime_scene/osm_scene.xml")
    assert (scene_root / scene["id"] / "preview.svg").exists()

    activate_result = scene_service.activate_scene(scene["id"])
    assert activate_result["status"] == "success"
    assert activate_result["scene"]["status"] == "ready"

    list_result = scene_service.list_scenes()
    assert list_result["active_scene_id"] == scene["id"]
    assert list_result["imported_scene_count"] == 1


def test_expired_preview_scenes_are_removed_from_registry_and_disk(tmp_path, monkeypatch):
    scene_root = tmp_path / "scenes"
    expired_path = scene_root / "expired-preview"
    fresh_path = scene_root / "fresh-preview"
    expired_path.mkdir(parents=True)
    fresh_path.mkdir(parents=True)
    registry_path = scene_root / "scenes.json"
    now = scene_service.utc_now()
    registry_path.write_text(
        json.dumps(
            {
                "active_scene_id": None,
                "scenes": [
                    {
                        "id": "expired-preview",
                        "name": "Expired preview",
                        "status": "preview",
                        "is_default": False,
                        "created_at": (now - timedelta(hours=4)).isoformat(),
                        "expires_at": (now - timedelta(hours=1)).isoformat(),
                    },
                    {
                        "id": "fresh-preview",
                        "name": "Fresh preview",
                        "status": "preview",
                        "is_default": False,
                        "created_at": now.isoformat(),
                        "expires_at": (now + timedelta(hours=1)).isoformat(),
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(scene_service, "SCENE_ROOT", scene_root)
    monkeypatch.setattr(scene_service, "SCENE_REGISTRY_PATH", registry_path)

    result = scene_service.list_scenes()

    scene_ids = {scene["id"] for scene in result["scenes"]}
    assert "expired-preview" not in scene_ids
    assert "fresh-preview" in scene_ids
    assert result["imported_scene_count"] == 1
    assert not expired_path.exists()
    assert fresh_path.exists()


def test_legacy_munich_scene_is_removed_from_registry(tmp_path, monkeypatch):
    scene_root = tmp_path / "scenes"
    registry_path = scene_root / "scenes.json"
    scene_root.mkdir(parents=True)
    registry_path.write_text(
        json.dumps(
            {
                "active_scene_id": "munich",
                "scenes": [
                    {
                        "id": "munich",
                        "name": "Munich",
                        "status": "ready",
                        "is_default": True,
                    },
                    {
                        "id": "scene-1",
                        "name": "Imported scene",
                        "status": "ready",
                        "is_default": False,
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(scene_service, "SCENE_ROOT", scene_root)
    monkeypatch.setattr(scene_service, "SCENE_REGISTRY_PATH", registry_path)

    result = scene_service.list_scenes()

    assert result["active_scene_id"] is None
    assert [scene["id"] for scene in result["scenes"]] == ["scene-1"]


def test_preview_scenes_count_toward_import_limit(tmp_path, monkeypatch):
    scene_root = tmp_path / "scenes"
    registry_path = scene_root / "scenes.json"
    scene_root.mkdir(parents=True)
    now = scene_service.utc_now()
    registry_path.write_text(
        json.dumps(
            {
                "active_scene_id": None,
                "scenes": [
                    {
                        "id": f"preview-{index}",
                        "name": f"Preview {index}",
                        "status": "preview",
                        "is_default": False,
                        "created_at": now.isoformat(),
                        "expires_at": (now + timedelta(hours=1)).isoformat(),
                    }
                    for index in range(scene_service.MAX_IMPORTED_SCENES)
                ],
            }
        ),
        encoding="utf-8",
    )
    build_called = False

    def fake_build_osm_sionna_scene(req, output_dir):
        nonlocal build_called
        build_called = True
        raise AssertionError("Scene build should not start after limit is reached.")

    monkeypatch.setattr(scene_service, "SCENE_ROOT", scene_root)
    monkeypatch.setattr(scene_service, "SCENE_REGISTRY_PATH", registry_path)
    monkeypatch.setattr(scene_service, "build_osm_sionna_scene", fake_build_osm_sionna_scene)

    result = scene_service.create_scene_preview(
        make_request(),
        "http://127.0.0.1:8000/",
    )

    assert result["status"] == "failure"
    assert result["status_code"] == 409
    assert "preview scenes" in result["error"]
    assert build_called is False


def test_delete_scene_marks_database_reference_deleted(tmp_path, monkeypatch):
    scene_root = tmp_path / "scenes"
    scene_path = scene_root / "scene-to-delete"
    scene_path.mkdir(parents=True)
    registry_path = scene_root / "scenes.json"
    registry_path.write_text(
        json.dumps(
            {
                "active_scene_id": None,
                "scenes": [
                    {
                        "id": "scene-to-delete",
                        "name": "Old scene",
                        "status": "ready",
                        "is_default": False,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    marked_scene_ids = []

    monkeypatch.setattr(scene_service, "SCENE_ROOT", scene_root)
    monkeypatch.setattr(scene_service, "SCENE_REGISTRY_PATH", registry_path)
    monkeypatch.setattr(
        scene_service,
        "mark_scene_reference_deleted",
        lambda scene_id: marked_scene_ids.append(scene_id) or {
            "database_configured": True,
            "updated": True,
        },
    )

    result = scene_service.delete_scene("scene-to-delete")

    assert result == {
        "status": "success",
        "deleted": True,
        "active_scene_reset": False,
        "database_status_updated": True,
    }
    assert marked_scene_ids == ["scene-to-delete"]
    assert not scene_path.exists()
    saved_registry = json.loads(registry_path.read_text(encoding="utf-8"))
    assert all(scene["id"] != "scene-to-delete" for scene in saved_registry["scenes"])


def test_delete_imported_registry_active_scene_clears_active_scene(tmp_path, monkeypatch):
    scene_root = tmp_path / "scenes"
    scene_path = scene_root / "scene-to-delete"
    scene_path.mkdir(parents=True)
    registry_path = scene_root / "scenes.json"
    registry_path.write_text(
        json.dumps(
            {
                "active_scene_id": "scene-to-delete",
                "scenes": [
                    {
                        "id": "scene-to-delete",
                        "name": "Old active scene",
                        "status": "ready",
                        "is_default": False,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(scene_service, "SCENE_ROOT", scene_root)
    monkeypatch.setattr(scene_service, "SCENE_REGISTRY_PATH", registry_path)
    monkeypatch.setattr(
        scene_service,
        "mark_scene_reference_deleted",
        lambda scene_id: {
            "database_configured": True,
            "updated": True,
        },
    )

    result = scene_service.delete_scene("scene-to-delete")

    assert result["status"] == "success"
    assert result["active_scene_reset"] is True
    assert not scene_path.exists()
    saved_registry = json.loads(registry_path.read_text(encoding="utf-8"))
    assert saved_registry["active_scene_id"] is None
    assert all(scene["id"] != "scene-to-delete" for scene in saved_registry["scenes"])


def test_delete_scene_stops_when_database_status_update_fails(tmp_path, monkeypatch):
    scene_root = tmp_path / "scenes"
    scene_path = scene_root / "scene-to-delete"
    scene_path.mkdir(parents=True)
    registry_path = scene_root / "scenes.json"
    registry_path.write_text(
        json.dumps(
            {
                "active_scene_id": None,
                "scenes": [
                    {
                        "id": "scene-to-delete",
                        "name": "Old scene",
                        "status": "ready",
                        "is_default": False,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(scene_service, "SCENE_ROOT", scene_root)
    monkeypatch.setattr(scene_service, "SCENE_REGISTRY_PATH", registry_path)
    monkeypatch.setattr(
        scene_service,
        "mark_scene_reference_deleted",
        lambda scene_id: {
            "database_configured": True,
            "updated": False,
            "error": "Failed to update the scene status in the database.",
        },
    )

    result = scene_service.delete_scene("scene-to-delete")

    assert result["status"] == "failure"
    assert result["status_code"] == 503
    assert scene_path.exists()
    saved_registry = json.loads(registry_path.read_text(encoding="utf-8"))
    assert any(scene["id"] == "scene-to-delete" for scene in saved_registry["scenes"])
