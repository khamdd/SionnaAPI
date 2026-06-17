from pathlib import Path
from types import SimpleNamespace
import xml.etree.ElementTree as ET

import pytest

from backend.services.osm_scene_builder import (
    build_osm_sionna_scene,
    infer_building_height,
    parse_osm_buildings,
    project_buildings_to_local_meters,
)


def bounds():
    return SimpleNamespace(
        south=10.0,
        west=106.0,
        north=10.001,
        east=106.001,
    )


def osm_way(tags=None):
    return {
        "type": "way",
        "id": 123,
        "tags": {
            "building": "office",
            **(tags or {}),
        },
        "geometry": [
            {"lat": 10.0002, "lon": 106.0002},
            {"lat": 10.0002, "lon": 106.0005},
            {"lat": 10.0005, "lon": 106.0005},
            {"lat": 10.0005, "lon": 106.0002},
            {"lat": 10.0002, "lon": 106.0002},
        ],
    }


def test_build_osm_sionna_scene_writes_xml_and_ply_meshes(tmp_path):
    result = build_osm_sionna_scene(
        bounds(),
        tmp_path / "runtime_scene",
        elements=[osm_way({"height": "12 m"})],
    )

    assert result.building_count == 1
    assert result.mesh_count == 2
    assert result.scene_path == tmp_path / "runtime_scene" / "osm_scene.xml"
    assert result.scene_path.exists()

    building_mesh = tmp_path / "runtime_scene" / "meshes" / "buildings_concrete.ply"
    ground_mesh = tmp_path / "runtime_scene" / "meshes" / "ground.ply"
    assert building_mesh.exists()
    assert ground_mesh.exists()

    mesh_text = building_mesh.read_text(encoding="ascii")
    assert "format ascii 1.0" in mesh_text
    assert "element vertex 8" in mesh_text
    assert "element face 12" in mesh_text

    root = ET.parse(result.scene_path).getroot()
    assert root.tag == "scene"
    assert root.find("./bsdf[@id='concrete']") is not None
    assert root.find("./shape[@id='mesh-buildings-concrete']") is not None
    assert root.find("./shape[@id='mesh-ground']") is not None


def test_osm_parser_and_projection_filter_invalid_or_tiny_polygons():
    buildings = parse_osm_buildings([
        osm_way({"building:levels": "5"}),
        {
            "type": "way",
            "id": 456,
            "tags": {"building": "yes"},
            "geometry": [
                {"lat": 10.0001, "lon": 106.0001},
                {"lat": 10.0001, "lon": 106.0001001},
                {"lat": 10.0001001, "lon": 106.0001001},
            ],
        },
    ])

    projected = project_buildings_to_local_meters(buildings, bounds())

    assert len(projected) == 1
    assert projected[0].height_m == pytest.approx(15.5)
    assert len(projected[0].points) == 4


def test_infer_building_height_uses_osm_tags():
    assert infer_building_height({"height": "30 ft"}) == pytest.approx(9.144)
    assert infer_building_height({"building:levels": "3", "roof:height": "1.2"}) == pytest.approx(10.5)
    assert infer_building_height({"building": "industrial"}) == 10.0


def test_build_osm_sionna_scene_rejects_empty_area(tmp_path):
    with pytest.raises(ValueError, match="No valid OSM building footprints"):
        build_osm_sionna_scene(
            bounds(),
            tmp_path / "runtime_scene",
            elements=[],
        )
