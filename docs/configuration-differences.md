# Network configuration differences

The configuration difference service compares two immutable network configuration
versions and returns a deterministic engineering change list.

It detects:

- Antennas added or removed.
- Enabled status changes.
- Longitude, latitude, or height changes.
- Tilt minimum, current, or maximum changes.
- Transmit-power minimum, current, or maximum changes.
- Azimuth changes.

Antenna ordering does not affect the result. Equivalent numeric representations,
such as `4`, `4.0`, and `4.0000`, compare as equal.

## API

`POST /api/v1/network-configurations/compare`

```json
{
  "baseline_configuration_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "candidate_configuration_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
}
```

Both versions must belong to the same scene and must be readable by the current
user. The response includes version identities, whether their hashes match, a
sorted list of changed antennas, individual before/after values, and summary
counts.

```json
{
  "changed": true,
  "changed_antennas": ["A1"],
  "changes": [
    {
      "antenna_id": "A1",
      "change_type": "field_changed",
      "field": "tilt.current",
      "before": 4,
      "after": 7
    }
  ]
}
```

This output is intended to become the change section of future impact studies and
before/after reports.
