import numpy as np

from backend.schemas.requests import RSRPRequest
from backend.services.rsrp_service import build_rsrp_result


class ArrayWrapper:
    def __init__(self, value):
        self.value = value

    def numpy(self):
        return self.value


class FakeRadioMap:
    def __init__(self, rss):
        self.rss = ArrayWrapper(rss)


def watts_from_dbm(dbm):
    return 10 ** ((dbm - 30.0) / 10.0)


def make_request():
    return RSRPRequest(
        antennas=[
            {
                "id": "A1",
                "position": [0.0, 0.0, 30.0],
                "tilt": {
                    "min": 2.0,
                    "current": 8.0,
                    "max": 16.0,
                },
                "azimuth": 0.0,
                "tx_power": {
                    "min": 20.0,
                    "current": 30.0,
                    "max": 40.0,
                },
            },
            {
                "id": "A2",
                "position": [10.0, 0.0, 30.0],
                "tilt": {
                    "min": 2.0,
                    "current": 8.0,
                    "max": 16.0,
                },
                "azimuth": 90.0,
                "tx_power": {
                    "min": 20.0,
                    "current": 30.0,
                    "max": 40.0,
                },
            },
        ],
        solver={
            "max_depth": 1,
            "samples_per_tx": 100,
            "cell_size": 10.0,
            "center": [0.0, 0.0, 0.0],
            "size": [10.0, 10.0],
        },
        user_count=1,
    )


def test_build_rsrp_result_selects_serving_antenna_and_neighbor():
    req = make_request()
    rss = np.array(
        [
            [[watts_from_dbm(-70.0)]],
            [[watts_from_dbm(-75.0)]],
        ],
        dtype=float,
    )

    result = build_rsrp_result(
        FakeRadioMap(rss),
        req,
        [
            {
                "id": "U0001",
                "position": [0.0, 0.0, 1.5],
            }
        ],
    )

    user = result["users"][0]

    assert user["serving_antenna"] == "A1"
    assert user["rsrp_dbm"] == -70.0
    assert user["quality"] == "excellent"
    assert user["neighbors"] == [
        {
            "antenna": "A2",
            "rsrp_dbm": -75.0,
            "weaker_than_serving_db": 5.0,
        }
    ]
    assert result["antenna_summary"] == [
        {
            "antenna": "A1",
            "average_rsrp_dbm": -70.0,
            "average_serving_rsrp_dbm": -70.0,
            "served_user_count": 1,
            "measured_user_count": 1,
        },
        {
            "antenna": "A2",
            "average_rsrp_dbm": -75.0,
            "average_serving_rsrp_dbm": None,
            "served_user_count": 0,
            "measured_user_count": 1,
        },
    ]


def test_build_rsrp_result_omits_neighbors_for_no_coverage_user():
    req = make_request()
    rss = np.zeros(
        (2, 1, 1),
        dtype=float,
    )

    result = build_rsrp_result(
        FakeRadioMap(rss),
        req,
        [
            {
                "id": "U0001",
                "position": [0.0, 0.0, 1.5],
            }
        ],
    )

    user = result["users"][0]

    assert user["rsrp_dbm"] == -140.0
    assert user["quality"] == "no_coverage"
    assert user["neighbors"] == []
    assert result["summary"]["covered_user_count"] == 0
    assert result["summary"]["coverage_percent"] == 0.0
