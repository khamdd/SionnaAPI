# Saved simulation profiles

Simulation profiles store repeatable simulation settings separately from versioned
antenna configurations. The configuration answers **what network is being tested**;
the profile answers **how it should be tested**.

Profiles support `network_coverage`, `coverage_map`, `rsrp_simulation`, `sinr`, and
`throughput_comparison`. A profile can be saved while incomplete, but it cannot be
enabled until its template and the scene's active published configuration combine
into the existing Pydantic request model.

## Template rules

- Include every non-antenna setting explicitly, including complete `solver` and
  `camera` objects where applicable. This avoids silently changing behavior if an
  application default changes later.
- Do not include fields owned by the network configuration, such as `antennas`,
  transmitter positions, power, or SINR tilt.
- Coverage Map requires a `roles.transmitter` antenna ID.
- SINR and Throughput require distinct `roles.transmitter`, `roles.receiver`, and
  `roles.interferer` IDs. Missing or disabled role antennas produce an explicit
  skip reason.
- Throughput templates still provide `base_tilt` and `target_tilt`, because those
  values define the comparison performed by the existing request model.

Example Network Coverage template:

```json
{
  "transmitter_pattern": "tr38901",
  "solver": {
    "max_depth": 5,
    "samples_per_tx": 1000000,
    "cell_size": 2,
    "center": [0, 0, 0],
    "size": [400, 400]
  },
  "camera": {
    "position": [0, 0, 650],
    "look_at": [0, 0, 0]
  },
  "bandwidth_mhz": 100,
  "mimo_layers": 4,
  "objectives": [
    {
      "metric": "covered_area_percent",
      "operator": ">=",
      "target": 90
    }
  ]
}
```

## Endpoints

- `POST /api/v1/simulation-profiles`
- `GET /api/v1/simulation-profiles`
- `GET /api/v1/simulation-profiles/{id}`
- `PUT /api/v1/simulation-profiles/{id}`
- `DELETE /api/v1/simulation-profiles/{id}`
- `POST /api/v1/simulation-profiles/{id}/enable`
- `POST /api/v1/simulation-profiles/{id}/disable`
- `POST /api/v1/simulation-profiles/{id}/build-request`

The build-request endpoint accepts a `configuration_id` and returns the exact
validated request that later automation can submit. All endpoints require a
configured database and authentication. Enabled profiles are readable to users of
the shared project scenes; only their creator can update, enable, disable, or
delete them.

The current simulation pages and their localStorage drafts are unchanged. A future
frontend step can add **Save as automation profile** controls using these APIs.
