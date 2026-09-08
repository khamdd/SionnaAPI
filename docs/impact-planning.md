# Configuration impact planning

Impact policy `impact-policy-v1` converts the difference between two network
configuration versions into a dry-run simulation plan. Previewing never creates
jobs or runs simulations.

## API

`POST /api/v1/configuration-impact/preview`

```json
{
  "baseline_configuration_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "candidate_configuration_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
}
```

Both configurations must belong to the same scene and be readable by the current
user. The planner loads all enabled profiles for that scene and returns:

- The configuration difference.
- Paired baseline and candidate requests for every planned profile.
- Skipped profiles with stable reason codes and readable explanations.
- The estimated job count; each planned profile currently represents two jobs.
- The policy version used for the decision.
- Whether optimization is planned. Policy v1 always reports `false` because
  automatic optimization policy is a later milestone.

## Policy v1 behavior

| Change | Planned profiles |
| --- | --- |
| Tilt | Network Coverage, RSRP, and affected Sionna role profiles |
| Power | Network Coverage, RSRP, and affected role profiles |
| Azimuth | Network Coverage, RSRP, and affected Sionna role profiles |
| Position or height | Network Coverage, RSRP, and affected Sionna role profiles |
| Antenna added, removed, enabled, or disabled | Enabled network-level profiles and affected valid role profiles |

Coverage Map remains optional and is planned only when an enabled profile uses an
affected transmitter. SINR and Throughput are planned only when an affected
antenna appears in their saved roles. For tilt, azimuth, position, and height-only
changes, UMa, Ericsson, and Friis SINR/Throughput profiles are skipped because the
current analytical implementations do not use those configuration fields.

Before including a profile, the planner builds and validates both its baseline and
candidate request. An incomplete profile, missing role, removed role antenna, or
disabled role antenna becomes a skip entry rather than failing the entire plan.
