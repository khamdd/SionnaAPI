import numpy as np
import pytest

from backend.services.coverage_service import build_network_grid


class ArrayWrapper:
    def __init__(self, value):
        self.value = value

    def numpy(self):
        return self.value


class FakeRadioMap:
    def __init__(self, sinr, rss):
        self.sinr = ArrayWrapper(sinr)
        self.rss = ArrayWrapper(rss)


class FakeAntenna:
    def __init__(self, antenna_id):
        self.id = antenna_id


class FakeRequest:
    def __init__(self):
        self.antennas = [
            FakeAntenna("A1"),
            FakeAntenna("A2"),
            FakeAntenna("A3"),
        ]
        self.solver = type(
            "Solver",
            (),
            {
                "cell_size": 5.0,
                "center": (0.0, 0.0, 0.0),
                "size": (5.0, 5.0),
            },
        )()
        self.bandwidth_mhz = 100.0
        self.mimo_layers = 4


def watts_from_dbm(dbm):
    return 10 ** ((dbm - 30.0) / 10.0)


def test_build_network_grid_adds_signal_strength_neighbors():
    sinr = np.array(
        [
            [[10.0]],
            [[3.0]],
            [[1.0]],
        ],
        dtype=float,
    )
    rss = np.array(
        [
            [[watts_from_dbm(-50.0)]],
            [[watts_from_dbm(-54.2)]],
            [[watts_from_dbm(-70.0)]],
        ],
        dtype=float,
    )

    grid = build_network_grid(
        FakeRadioMap(sinr, rss),
        FakeRequest(),
    )

    cell = grid["cells"][0]

    assert cell["serving_antenna"] == "A1"
    assert cell["signal_dbm"] == -50.0
    assert cell["neighbors"] == [
        {
            "antenna": "A2",
            "signal_dbm": -54.2,
            "sinr_db": pytest.approx(4.77),
            "weaker_than_serving_db": pytest.approx(4.2),
        }
    ]


def test_build_network_grid_does_not_add_neighbors_for_no_coverage_cell():
    sinr = np.zeros(
        (3, 1, 1),
        dtype=float,
    )
    rss = np.zeros(
        (3, 1, 1),
        dtype=float,
    )

    grid = build_network_grid(
        FakeRadioMap(sinr, rss),
        FakeRequest(),
    )

    cell = grid["cells"][0]

    assert cell["throughput_mbps"] == 0.0
    assert cell["signal_dbm"] == -140.0
    assert cell["neighbors"] == []
