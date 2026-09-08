from decimal import Decimal, InvalidOperation
from numbers import Number
from typing import Any, Iterable


COMPARABLE_FIELDS = (
    "enabled",
    "longitude",
    "latitude",
    "height_m",
    "tilt.min",
    "tilt.current",
    "tilt.max",
    "tx_power.min",
    "tx_power.current",
    "tx_power.max",
    "azimuth",
)


def compare_configuration_snapshots(
    baseline_antennas: Iterable[dict],
    candidate_antennas: Iterable[dict],
) -> dict:
    """Return a deterministic field-level difference between two snapshots."""
    baseline = _antennas_by_id(baseline_antennas)
    candidate = _antennas_by_id(candidate_antennas)
    antenna_ids = sorted(set(baseline).union(candidate))

    changes = []
    summary = {
        "antennas_added": 0,
        "antennas_removed": 0,
        "antennas_changed": 0,
        "fields_changed": 0,
    }
    changed_antennas = []

    for antenna_id in antenna_ids:
        before = baseline.get(antenna_id)
        after = candidate.get(antenna_id)

        if before is None:
            changes.append(
                _change(
                    antenna_id,
                    "antenna_added",
                    "antenna",
                    None,
                    _canonicalize(after),
                )
            )
            changed_antennas.append(antenna_id)
            summary["antennas_added"] += 1
            continue

        if after is None:
            changes.append(
                _change(
                    antenna_id,
                    "antenna_removed",
                    "antenna",
                    _canonicalize(before),
                    None,
                )
            )
            changed_antennas.append(antenna_id)
            summary["antennas_removed"] += 1
            continue

        antenna_changed = False
        for field_path in COMPARABLE_FIELDS:
            before_value = _get_path(before, field_path)
            after_value = _get_path(after, field_path)
            if _values_equal(before_value, after_value):
                continue

            changes.append(
                _change(
                    antenna_id,
                    "field_changed",
                    field_path,
                    _canonicalize(before_value),
                    _canonicalize(after_value),
                )
            )
            antenna_changed = True
            summary["fields_changed"] += 1

        if antenna_changed:
            changed_antennas.append(antenna_id)
            summary["antennas_changed"] += 1

    return {
        "changed": bool(changes),
        "changed_antennas": changed_antennas,
        "changes": changes,
        "summary": summary,
    }


def _antennas_by_id(antennas: Iterable[dict]) -> dict[str, dict]:
    result = {}
    for antenna in antennas:
        antenna_id = str(antenna.get("id", "")).strip()
        if not antenna_id:
            raise ValueError("Every antenna must have an ID.")
        if antenna_id in result:
            raise ValueError(f"Duplicate antenna ID: {antenna_id}")
        result[antenna_id] = antenna
    return result


def _get_path(value: dict, field_path: str) -> Any:
    current: Any = value
    for part in field_path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def _values_equal(before: Any, after: Any) -> bool:
    if _is_number(before) and _is_number(after):
        try:
            return Decimal(str(before)) == Decimal(str(after))
        except InvalidOperation:
            return False
    return before == after


def _canonicalize(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _canonicalize(nested_value)
            for key, nested_value in sorted(value.items())
        }
    if isinstance(value, list):
        return [_canonicalize(item) for item in value]
    if _is_number(value):
        decimal_value = Decimal(str(value))
        if decimal_value == decimal_value.to_integral_value():
            return int(decimal_value)
        return float(decimal_value.normalize())
    return value


def _is_number(value: Any) -> bool:
    return isinstance(value, Number) and not isinstance(value, bool)


def _change(
    antenna_id: str,
    change_type: str,
    field: str,
    before: Any,
    after: Any,
) -> dict:
    return {
        "antenna_id": antenna_id,
        "change_type": change_type,
        "field": field,
        "before": before,
        "after": after,
    }
