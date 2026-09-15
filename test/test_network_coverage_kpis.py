import pytest

from backend.services.network_coverage_kpis import (
    calculate_percentile,
    calculate_threshold_area_percent,
    extract_network_coverage_kpis,
)


def cell(*, rsrp=None, sinr=None, throughput=None, overlap_count=1):
    return {
        "signal_dbm": rsrp,
        "sinr_db": sinr,
        "throughput_mbps": throughput,
        "overlap_count": overlap_count,
        "overlap_level": "single_coverage" if overlap_count else "no_coverage",
    }


def test_threshold_area_percent_supports_all_rf_measurements():
    cells = [
        cell(rsrp=-120, sinr=-2, throughput=0),
        cell(rsrp=-110, sinr=5, throughput=5),
        cell(rsrp=-100, sinr=10, throughput=20),
        cell(rsrp=None, sinr=None, throughput=None, overlap_count=0),
    ]

    assert calculate_threshold_area_percent(cells, "rsrp_dbm", ">=", -110) == {
        "passing_cells": 2,
        "total_cells": 4,
        "area_percent": 50.0,
    }
    assert calculate_threshold_area_percent(cells, "sinr_db", ">=", 5)[
        "area_percent"
    ] == 50.0
    assert calculate_threshold_area_percent(cells, "throughput_mbps", ">=", 5)[
        "area_percent"
    ] == 50.0


def test_threshold_area_counts_missing_signal_as_failure_and_missing_throughput_as_zero():
    cells = [cell(rsrp=None, sinr=None, throughput=None, overlap_count=0)]

    assert calculate_threshold_area_percent(cells, "rsrp_dbm", ">=", -140)[
        "passing_cells"
    ] == 0
    assert calculate_threshold_area_percent(cells, "sinr_db", ">=", -20)[
        "passing_cells"
    ] == 0
    assert calculate_threshold_area_percent(cells, "throughput_mbps", "<=", 0)[
        "passing_cells"
    ] == 1


def test_threshold_area_uses_unrounded_values():
    cells = [cell(sinr=4.999, throughput=1, rsrp=-100)]

    result = calculate_threshold_area_percent(cells, "sinr_db", ">=", 5)

    assert result["passing_cells"] == 0
    assert result["area_percent"] == 0.0


def test_nearest_rank_percentiles_are_deterministic():
    cells = [cell(rsrp=-121 + index, sinr=index, throughput=index * 10) for index in range(1, 11)]

    assert calculate_percentile(cells, "sinr_db", 10) == 1
    assert calculate_percentile(cells, "sinr_db", 50) == 5
    assert calculate_percentile(cells, "sinr_db", 90) == 9


def test_percentile_returns_none_when_rank_lands_in_missing_signal_cells():
    cells = [
        cell(rsrp=None, sinr=None, throughput=None, overlap_count=0),
        cell(rsrp=None, sinr=None, throughput=None, overlap_count=0),
        *[cell(rsrp=-110 + index, sinr=index, throughput=index) for index in range(1, 9)],
    ]

    assert calculate_percentile(cells, "sinr_db", 10) is None
    assert calculate_percentile(cells, "sinr_db", 50) == 3
    assert calculate_percentile(cells, "throughput_mbps", 10) == 0


def test_extractor_preserves_existing_kpis_and_adds_rf_statistics():
    cells = [
        cell(rsrp=-100, sinr=2, throughput=10, overlap_count=1),
        cell(rsrp=-80, sinr=8, throughput=30, overlap_count=2),
        cell(rsrp=None, sinr=None, throughput=None, overlap_count=0),
    ]

    kpis = extract_network_coverage_kpis({"grid": {"cells": cells}})

    assert kpis["total_cells"] == 3
    assert kpis["covered_cells"] == 2
    assert kpis["uncovered_cells"] == 1
    assert kpis["covered_area_percent"] == pytest.approx(200 / 3)
    assert kpis["uncovered_area_percent"] == pytest.approx(100 / 3)
    assert kpis["overlap_area_percent"] == pytest.approx(100 / 3)
    assert kpis["average_overlap_count"] == 1.5
    assert kpis["average_signal_dbm"] == -90
    assert kpis["average_sinr_db"] == 5
    assert kpis["average_throughput_mbps"] == 20
    assert kpis["rsrp_dbm_p50"] == -100
    assert kpis["sinr_db_p50"] == 2
    assert kpis["throughput_mbps_p50"] == 10
    assert kpis["rsrp_valid_cell_percent"] == pytest.approx(200 / 3)
    assert kpis["sinr_valid_cell_percent"] == pytest.approx(200 / 3)
    assert kpis["throughput_valid_cell_percent"] == 100


def test_empty_grid_has_zero_counts_and_no_percentiles():
    kpis = extract_network_coverage_kpis({"cells": []})

    assert kpis["total_cells"] == 0
    assert kpis["covered_area_percent"] == 0.0
    assert kpis["rsrp_dbm_p10"] is None
    assert kpis["sinr_db_p50"] is None
    assert kpis["throughput_mbps_p90"] is None
    assert kpis["rsrp_valid_cell_percent"] == 0.0


@pytest.mark.parametrize(
    ("measurement", "operator", "threshold"),
    [("unknown", ">=", 1), ("sinr_db", "=", 1), ("sinr_db", ">=", float("nan"))],
)
def test_threshold_area_rejects_invalid_inputs(measurement, operator, threshold):
    with pytest.raises(ValueError):
        calculate_threshold_area_percent([], measurement, operator, threshold)
