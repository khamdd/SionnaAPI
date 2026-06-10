from backend.services import sinr_service, throughput_service


class FakeSolver:
    pass


class FakeSINRRequest:
    transmitter_position = (0.0, 0.0, 30.0)
    receiver_position = (10.0, 10.0, 1.5)
    interferer_position = (20.0, 20.0, 30.0)
    tilt = 8.0
    interferer_tilt = 12.0
    tx_power = 30.0
    transmitter_pattern = "iso"
    solver = FakeSolver()


class FakeThroughputRequest:
    transmitter_position = (0.0, 0.0, 30.0)
    receiver_position = (10.0, 10.0, 1.5)
    interferer_position = (20.0, 20.0, 30.0)
    base_tilt = 8.0
    target_tilt = 12.0
    interferer_tilt = 12.0
    tx_power = 30.0
    transmitter_pattern = "iso"
    bandwidth_mhz = 100.0
    mimo_layers = 4
    solver = FakeSolver()


def test_sinr_service_passes_request_pattern_to_transmitters(monkeypatch):
    sync_calls = []

    monkeypatch.setattr(
        sinr_service,
        "sync_transmitter",
        lambda *args, **kwargs: sync_calls.append((args, kwargs)),
    )
    monkeypatch.setattr(
        sinr_service,
        "execute_radio_map",
        lambda scene, solver: object(),
    )
    monkeypatch.setattr(
        sinr_service,
        "extract_linear_sinr_at_point",
        lambda radio_map, solver, receiver_position: 10.0,
    )
    monkeypatch.setattr(
        sinr_service,
        "extract_signal_power_at_point",
        lambda radio_map, solver, receiver_position: 1.0,
    )
    monkeypatch.setattr(
        sinr_service,
        "remove_entity",
        lambda scene, name: None,
    )

    result = sinr_service.calculate_sinr_service(FakeSINRRequest())

    assert result["status"] == "success"
    assert len(sync_calls) == 2
    assert all(
        call_kwargs["pattern"] == "iso"
        for _, call_kwargs in sync_calls
    )


def test_throughput_service_passes_request_pattern_to_transmitters(monkeypatch):
    sync_calls = []

    monkeypatch.setattr(
        throughput_service,
        "sync_transmitter",
        lambda *args, **kwargs: sync_calls.append((args, kwargs)),
    )
    monkeypatch.setattr(
        throughput_service,
        "execute_radio_map",
        lambda scene, solver: object(),
    )
    monkeypatch.setattr(
        throughput_service,
        "extract_linear_sinr_at_point",
        lambda radio_map, solver, receiver_position: 10.0,
    )
    monkeypatch.setattr(
        throughput_service,
        "remove_entity",
        lambda scene, name: None,
    )

    result = throughput_service.compare_throughput_service(
        FakeThroughputRequest()
    )

    assert result["status"] == "success"
    assert len(sync_calls) == 3
    assert all(
        call_kwargs["pattern"] == "iso"
        for _, call_kwargs in sync_calls
    )
