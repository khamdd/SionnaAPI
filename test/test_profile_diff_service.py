from backend.services.profile_diff_service import compare_profile_templates


def test_dictionary_order_and_equivalent_numbers_do_not_create_profile_changes():
    baseline = {
        "carrier_frequency_ghz": 3.5,
        "solver": {"max_depth": 5, "cell_size": 2},
        "camera": {"position": [0, 0, 650], "look_at": [0, 0, 0]},
    }
    candidate = {
        "camera": {"look_at": [0.0, 0.0, 0.0], "position": [0, 0, 650.0]},
        "solver": {"cell_size": 2.0, "max_depth": 5.0},
        "carrier_frequency_ghz": 3.5000,
    }

    result = compare_profile_templates(baseline, candidate)

    assert result == {
        "changed": False,
        "changed_fields": [],
        "changes": [],
        "summary": {"fields_changed": 0},
    }


def test_nested_profile_changes_are_reported_in_deterministic_field_order():
    result = compare_profile_templates(
        {
            "bandwidth_mhz": 100,
            "objectives": [{"metric": "coverage", "target": 90}],
            "roles": {"transmitter": "A1"},
            "solver": {"cell_size": 2, "max_depth": 5},
        },
        {
            "bandwidth_mhz": 80,
            "noise_figure_db": 7,
            "objectives": [{"metric": "coverage", "target": 95}],
            "roles": {"transmitter": "A2"},
            "solver": {"cell_size": 4, "max_depth": 5},
        },
    )

    assert result["changed_fields"] == [
        "bandwidth_mhz",
        "noise_figure_db",
        "objectives[0].target",
        "roles.transmitter",
        "solver.cell_size",
    ]
    assert result["changes"][1] == {
        "field": "noise_figure_db",
        "change_type": "field_added",
        "before": None,
        "after": 7,
    }


def test_list_additions_and_removals_are_explicit():
    result = compare_profile_templates(
        {"solver": {"center": [0, 0, 0]}},
        {"solver": {"center": [0, 1]}},
    )

    assert result["changes"] == [
        {
            "field": "solver.center[1]",
            "change_type": "field_changed",
            "before": 0,
            "after": 1,
        },
        {
            "field": "solver.center[2]",
            "change_type": "field_removed",
            "before": 0,
            "after": None,
        },
    ]


def test_boolean_and_numeric_values_are_not_equivalent():
    result = compare_profile_templates(
        {"enabled": True},
        {"enabled": 1},
    )

    assert result["changed_fields"] == ["enabled"]
