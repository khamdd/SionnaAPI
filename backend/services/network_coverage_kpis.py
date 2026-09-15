import math

NO_COVERAGE_LEVEL = "no_coverage"
OVERLAP_MIN_COUNT = 2

MEASUREMENT_FIELDS = {
    "rsrp_dbm": "signal_dbm",
    "sinr_db": "sinr_db",
    "throughput_mbps": "throughput_mbps",
}
PERCENTILES = (10, 50, 90)


def extract_network_coverage_kpis(result_or_grid):
    """Return coverage, overlap, and RF distribution KPIs for a grid result."""
    grid = network_coverage_grid(result_or_grid)
    cells = grid.get("cells") if isinstance(grid, dict) else None
    if not isinstance(cells, list):
        cells = []

    total_cells = len(cells)
    no_coverage_cells = [cell for cell in cells if is_no_coverage_cell(cell)]
    covered_cells = [cell for cell in cells if not is_no_coverage_cell(cell)]
    overlap_summary = grid.get("overlap_summary") if isinstance(grid, dict) else {}
    result = {
        "total_cells": total_cells,
        "covered_cells": len(covered_cells),
        "uncovered_cells": len(no_coverage_cells),
        "uncovered_area_percent": percent(len(no_coverage_cells), total_cells),
        "covered_area_percent": percent(len(covered_cells), total_cells),
        "overlap_area_percent": overlap_percent(cells, overlap_summary, total_cells),
        "average_overlap_count": average_overlap_count(
            cells, overlap_summary, covered_cells,
        ),
    }
    result.update(rf_distribution_kpis(cells))
    return result


def calculate_threshold_area_percent(cells, measurement, operator, threshold):
    """Calculate the share of all scene cells that satisfy an RF threshold."""
    field = measurement_field(measurement)
    if operator not in {">=", ">", "<=", "<"}:
        raise ValueError(f"Unsupported threshold operator: {operator}")
    threshold = numeric_value(threshold)
    if threshold is None:
        raise ValueError("RF threshold must be a finite number")

    cells = cells if isinstance(cells, list) else []
    passing = 0
    for cell in cells:
        value = measurement_value(cell, measurement, field)
        if value is not None and compare_threshold(value, operator, threshold):
            passing += 1
    return {
        "passing_cells": passing,
        "total_cells": len(cells),
        "area_percent": percent(passing, len(cells)),
    }


def calculate_percentile(cells, measurement, percentile_value):
    """Calculate a nearest-rank percentile across every scene cell."""
    field = measurement_field(measurement)
    percentile_value = numeric_value(percentile_value)
    if percentile_value is None or not 0 < percentile_value <= 100:
        raise ValueError("Percentile must be greater than 0 and at most 100")

    cells = cells if isinstance(cells, list) else []
    if not cells:
        return None
    values = [measurement_value(cell, measurement, field) for cell in cells]
    missing_count = sum(value is None for value in values)
    rank = math.ceil((percentile_value / 100.0) * len(values))
    if rank <= missing_count:
        return None
    numeric_values = sorted(value for value in values if value is not None)
    return numeric_values[rank - missing_count - 1]


def rf_distribution_kpis(cells):
    cells = cells if isinstance(cells, list) else []
    result = {}
    for measurement, field in MEASUREMENT_FIELDS.items():
        raw_values = [numeric_value(cell.get(field)) for cell in cells]
        finite_values = [value for value in raw_values if value is not None]
        average_key = {
            "rsrp_dbm": "average_signal_dbm",
            "sinr_db": "average_sinr_db",
            "throughput_mbps": "average_throughput_mbps",
        }[measurement]
        result[average_key] = (
            sum(finite_values) / len(finite_values) if finite_values else None
        )
        valid_count = (
            len(cells) if measurement == "throughput_mbps" else len(finite_values)
        )
        valid_key = {
            "rsrp_dbm": "rsrp_valid_cell_percent",
            "sinr_db": "sinr_valid_cell_percent",
            "throughput_mbps": "throughput_valid_cell_percent",
        }[measurement]
        result[valid_key] = percent(valid_count, len(cells))
        for percentile_value in PERCENTILES:
            result[f"{measurement}_p{percentile_value}"] = calculate_percentile(
                cells, measurement, percentile_value,
            )
    return result


def measurement_field(measurement):
    try:
        return MEASUREMENT_FIELDS[measurement]
    except KeyError as exc:
        raise ValueError(f"Unsupported RF measurement: {measurement}") from exc


def measurement_value(cell, measurement, field=None):
    if not isinstance(cell, dict):
        return 0.0 if measurement == "throughput_mbps" else None
    value = numeric_value(cell.get(field or measurement_field(measurement)))
    if value is None and measurement == "throughput_mbps":
        return 0.0
    return value


def compare_threshold(actual, operator, threshold):
    if operator == ">=":
        return actual >= threshold
    if operator == ">":
        return actual > threshold
    if operator == "<=":
        return actual <= threshold
    return actual < threshold


def network_coverage_grid(result_or_grid):
    if not isinstance(result_or_grid, dict):
        return {}
    grid = result_or_grid.get("grid")
    return grid if isinstance(grid, dict) else result_or_grid


def is_no_coverage_cell(cell):
    if not isinstance(cell, dict):
        return True
    if cell.get("overlap_level") == NO_COVERAGE_LEVEL:
        return True
    overlap_count = numeric_value(cell.get("overlap_count"))
    if overlap_count is not None:
        return overlap_count <= 0
    return numeric_value(cell.get("sinr_db")) is None


def overlap_percent(cells, overlap_summary, total_cells):
    overlap_cells = [
        cell
        for cell in cells
        if numeric_value(cell.get("overlap_count")) is not None
        and numeric_value(cell.get("overlap_count")) >= OVERLAP_MIN_COUNT
    ]
    if cells:
        return percent(len(overlap_cells), total_cells)
    summary_value = numeric_value((overlap_summary or {}).get("overlap_percent"))
    return summary_value if summary_value is not None else 0.0


def average_overlap_count(cells, overlap_summary, covered_cells):
    counts = [numeric_value(cell.get("overlap_count")) for cell in covered_cells]
    counts = [count for count in counts if count is not None and count > 0]
    if counts:
        return sum(counts) / len(counts)
    summary_value = numeric_value(
        (overlap_summary or {}).get("average_overlap_count")
    )
    return summary_value if summary_value is not None else 0.0


def percent(part, total):
    if total <= 0:
        return 0.0
    return (part / total) * 100.0


def numeric_value(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None
