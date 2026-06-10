from backend.services import coverage_service


class FakeArray:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


class FakeScene:
    def __init__(self):
        self.tx_array = None


class FakeAntenna:
    def __init__(self, antenna_id):
        self.id = antenna_id
        self.position = (0.0, 0.0, 30.0)
        self.tilt = type("Tilt", (), {"current": 8.0})()
        self.tx_power = type("Power", (), {"current": 30.0})()
        self.azimuth = 45.0

    def model_dump(self):
        return {
            "id": self.id,
        }


class FakeRequest:
    def __init__(self):
        self.antennas = [
            FakeAntenna("A1"),
            FakeAntenna("A2"),
        ]
        self.transmitter_pattern = "iso"
        self.solver = type(
            "Solver",
            (),
            {
                "cell_size": 5.0,
                "center": (0.0, 0.0, 0.0),
                "size": (100.0, 100.0),
            },
        )()
        self.camera = object()


def test_network_coverage_uses_one_global_transmitter_pattern(monkeypatch):
    fake_scene = FakeScene()
    sync_calls = []

    monkeypatch.setattr(coverage_service, "scene", fake_scene)
    monkeypatch.setattr(coverage_service, "PlanarArray", FakeArray)
    monkeypatch.setattr(
        coverage_service,
        "sync_transmitter",
        lambda *args, **kwargs: sync_calls.append((args, kwargs)),
    )
    monkeypatch.setattr(
        coverage_service,
        "execute_network_radio_map",
        lambda solver: object(),
    )
    monkeypatch.setattr(
        coverage_service,
        "render_network_coverage_image",
        lambda radio_map, camera, base_url: "http://test/static/map.png",
    )
    monkeypatch.setattr(
        coverage_service,
        "build_network_grid",
        lambda radio_map, req: {
            "rows": 0,
            "cols": 0,
            "cells": [],
        },
    )
    monkeypatch.setattr(
        coverage_service,
        "remove_entity",
        lambda scene, name: None,
    )

    result = coverage_service.calculate_network_coverage_service(
        FakeRequest(),
        "http://test",
    )

    assert result["status"] == "success"
    assert result["transmitter_pattern"] == "iso"
    assert fake_scene.tx_array.kwargs["pattern"] == "iso"
    assert len(sync_calls) == 2
    assert all(
        call_kwargs["configure_tx_array"] is False
        for _, call_kwargs in sync_calls
    )
    assert all(
        "pattern" not in call_kwargs
        for _, call_kwargs in sync_calls
    )
