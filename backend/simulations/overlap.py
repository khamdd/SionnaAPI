from backend.constants import (
    MIN_NEIGHBOR_SIGNAL_DBM,
    OVERLAP_EXCESSIVE_COUNT,
    OVERLAP_HIGH_COUNT,
    OVERLAP_NORMAL_COUNT,
)


def build_overlap_info(
    serving_antenna,
    serving_signal_dbm,
    neighbors,
    value_field="signal_dbm",
):
    if serving_signal_dbm < MIN_NEIGHBOR_SIGNAL_DBM:
        return {
            "antennas": [],
            "count": 0,
            "level": overlap_level(0),
        }

    antennas = [
        {
            "antenna": serving_antenna,
            "role": "serving",
            value_field: round(serving_signal_dbm, 2),
            "weaker_than_serving_db": 0.0,
        }
    ]
    antennas.extend(
        {
            "antenna": neighbor["antenna"],
            "role": "neighbor",
            value_field: neighbor.get(value_field),
            "weaker_than_serving_db": neighbor["weaker_than_serving_db"],
        }
        for neighbor in neighbors
    )

    return {
        "antennas": antennas,
        "count": len(antennas),
        "level": overlap_level(len(antennas)),
    }


def overlap_level(overlap_count):
    if overlap_count <= 0:
        return "no_coverage"
    if overlap_count < OVERLAP_NORMAL_COUNT:
        return "single_coverage"
    if overlap_count < OVERLAP_HIGH_COUNT:
        return "normal_overlap"
    if overlap_count < OVERLAP_EXCESSIVE_COUNT:
        return "high_overlap"
    return "excessive_overlap"


def summarize_overlap(items):
    total_items = len(items)
    counts = {
        "no_coverage": 0,
        "single_coverage": 0,
        "normal_overlap": 0,
        "high_overlap": 0,
        "excessive_overlap": 0,
    }

    for item in items:
        level = item.get("overlap_level", "no_coverage")
        counts[level] = counts.get(level, 0) + 1

    overlap_items = (
        counts["normal_overlap"]
        + counts["high_overlap"]
        + counts["excessive_overlap"]
    )
    excessive_items = counts["excessive_overlap"]
    covered_items = total_items - counts["no_coverage"]
    average_overlap = (
        sum(
            item.get("overlap_count", 0)
            for item in items
            if item.get("overlap_count", 0) > 0
        )
        / covered_items
        if covered_items
        else 0.0
    )

    return {
        "counts": counts,
        "covered_items": covered_items,
        "overlap_items": overlap_items,
        "overlap_percent": round((overlap_items / total_items) * 100, 2)
        if total_items else 0.0,
        "excessive_overlap_items": excessive_items,
        "excessive_overlap_percent": round((excessive_items / total_items) * 100, 2)
        if total_items else 0.0,
        "average_overlap_count": round(average_overlap, 2),
    }
