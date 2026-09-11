from decimal import Decimal, InvalidOperation
from numbers import Number
from typing import Any

_MISSING = object()


def compare_profile_templates(
    baseline_template: dict[str, Any],
    candidate_template: dict[str, Any],
) -> dict:
    """Return a deterministic, field-level difference between profile templates."""
    if not isinstance(baseline_template, dict) or not isinstance(
        candidate_template,
        dict,
    ):
        raise ValueError("Profile templates must be JSON objects.")

    changes: list[dict] = []
    _compare_values(baseline_template, candidate_template, "", changes)
    return {
        "changed": bool(changes),
        "changed_fields": [change["field"] for change in changes],
        "changes": changes,
        "summary": {"fields_changed": len(changes)},
    }


def _compare_values(before: Any, after: Any, path: str, changes: list[dict]) -> None:
    if isinstance(before, dict) and isinstance(after, dict):
        for key in sorted(set(before).union(after)):
            child_path = f"{path}.{key}" if path else key
            _compare_values(
                before.get(key, _MISSING),
                after.get(key, _MISSING),
                child_path,
                changes,
            )
        return

    if isinstance(before, list) and isinstance(after, list):
        for index in range(max(len(before), len(after))):
            child_path = f"{path}[{index}]"
            _compare_values(
                before[index] if index < len(before) else _MISSING,
                after[index] if index < len(after) else _MISSING,
                child_path,
                changes,
            )
        return

    if before is not _MISSING and after is not _MISSING and _values_equal(before, after):
        return

    if before is _MISSING:
        change_type = "field_added"
    elif after is _MISSING:
        change_type = "field_removed"
    else:
        change_type = "field_changed"
    changes.append(
        {
            "change_type": change_type,
            "field": path,
            "before": None if before is _MISSING else _canonicalize(before),
            "after": None if after is _MISSING else _canonicalize(after),
        }
    )


def _values_equal(before: Any, after: Any) -> bool:
    if isinstance(before, bool) or isinstance(after, bool):
        return type(before) is type(after) and before == after
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
