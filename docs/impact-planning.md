# Configuration impact planning

Impact policy `impact-policy-v2` converts the difference between two network
configuration versions and an explicit ordered list of scenario profile pairs
into a dry-run simulation plan. Previewing never creates study rows, jobs, or
simulations.

Each pair is a complete scenario comparison:

```text
Baseline scenario  = baseline configuration + baseline profile
Candidate scenario = candidate configuration + candidate profile
```

## API

`POST /api/v1/configuration-impact/preview`

```json
{
  "baseline_configuration_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "candidate_configuration_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  "profile_pairs": [
    {
      "baseline_profile_id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
      "candidate_profile_id": "dddddddd-dddd-dddd-dddd-dddddddddddd"
    }
  ]
}
```

The request requires one to 20 unique profile pairs. The configurations must be
different, readable, from the same ready scene, and materially different. Every
selected profile must be readable, enabled, and from that scene. Both sides of a
pair must use the same simulation type, while using the same profile ID on both
sides remains valid.

The planner loads only the selected profile IDs and preserves request order. Each
planned or skipped entry receives a stable `pair_id` and `ordinal`, plus immutable
baseline and candidate profile snapshots. A planned entry includes independently
resolved requests, both objective lists, a deterministic profile-template diff,
configuration and profile trigger categories, affected antennas, comparability
warnings, and a job estimate of two. Invalid role resolution or request building
becomes a skip with structured baseline/candidate reasons instead of failing
unrelated pairs.

## Policy v2 behavior

For identical profiles, v2 preserves the established configuration applicability
rules:

| Change | Planned profile pairs |
| --- | --- |
| Tilt | Network Coverage, RSRP, and affected Sionna role pairs |
| Power | Network Coverage, RSRP, and affected role pairs |
| Azimuth | Network Coverage, RSRP, and affected Sionna role pairs |
| Position or height | Network Coverage, RSRP, and affected Sionna role pairs |
| Antenna added, removed, enabled, or disabled | Network-level pairs and affected valid role pairs |

Coverage Map applies when an affected antenna is used by either side's
transmitter role. SINR and Throughput use the union of baseline and candidate
role antennas. With identical analytical UMa, Ericsson, or Friis profiles, tilt,
azimuth, position, and height-only configuration changes remain ignored because
those formulas do not use the fields.

Any profile-template difference is itself a reason to plan an otherwise valid
same-type pair, including when the selected analytical model ignores the antenna
change. `triggering_changes` separates `configuration_changes` from exact
`profile_changes` field paths. Propagation-model changes produce a methodology
warning, RSRP user-count or seed changes produce a sampling warning, and changed
grid geometry/resolution warns that later cell-by-cell spatial comparison may be
unavailable while aggregate comparison can remain meaningful.

Profile differences compare canonical JSON values recursively. Dictionary key
order and equivalent numeric representations do not create false changes;
additions, removals, nested fields, list positions, roles, solver settings,
radio settings, sampling, tilt inputs, and objectives are reported explicitly.

## Durable-study transition

This slice changes only the dry-run preview contract. Existing Impact Study
creation continues through an explicit policy-v1 compatibility entry point until
paired plan persistence and pair-keyed child jobs are implemented in Slice 3.
The public preview never falls back to implicitly loading every enabled scene
profile.
