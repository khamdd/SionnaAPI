# Impact Study optimization

Impact Studies can optionally run the existing Network Coverage optimizer after
their baseline/candidate comparison. Optimization is disabled by default and is
controlled by the policy saved with the study, so creating an ordinary study
does not add optimization work.

## Create policy

Add `optimization_policy` when creating a study:

```json
{
  "baseline_configuration_id": "...",
  "candidate_configuration_id": "...",
  "optimization_policy": {
    "mode": "if_objectives_fail",
    "tilt_step": 2,
    "power_step": 2,
    "azimuth_step": 30,
    "max_candidates": 300,
    "variables": [
      {"field": "tilt", "scope": "enabled_antennas"},
      {"field": "tx_power", "scope": "enabled_antennas"},
      {"field": "azimuth", "scope": "enabled_antennas"}
    ]
  }
}
```

Supported modes are `disabled` and `if_objectives_fail`. In conditional mode,
the parent queues one `network_coverage_optimization` job only when a comparable
candidate Network Coverage result fails at least one configured objective. The
job uses the candidate request as its starting point and carries
`scenario_role=optimization`. Existing worker progress, retries, leases,
cancellation, and resume behavior are unchanged.

The comparison response shows baseline, candidate, and optimized objective
outcomes. It also records the exact candidate configuration ID and content hash
used as the optimization source.

Network Coverage objectives support three shapes. Existing aggregate objectives
remain unchanged. Threshold-area objectives express requirements such as “at
least 95% of cells have RSRP at least -110 dBm”:

```json
{
  "kind": "threshold_area",
  "measurement": "rsrp_dbm",
  "threshold_operator": ">=",
  "threshold": -110,
  "operator": ">=",
  "target": 95
}
```

Percentile objectives express requirements such as “P10 SINR is at least 5 dB”:

```json
{
  "kind": "percentile",
  "measurement": "sinr_db",
  "percentile": 10,
  "operator": ">=",
  "target": 5
}
```

Supported RF measurements are `rsrp_dbm`, `sinr_db`, and `throughput_mbps`.
An optimization request accepts up to four objectives. It searches the available
budget instead of stopping at the first passing setup, then returns the
lowest-change recommendation and up to three ranked alternatives. The legacy
`best` and `best_request` fields continue to identify the recommendation.

## Create a suggested draft

After a profile's optimization job succeeds, call:

```text
POST /api/v1/impact-studies/{study_id}/profiles/{profile_id}/suggested-configuration
```

This creates a new `draft` network configuration whose parent is the study's
exact candidate version. Only optimized tilt, transmit-power, and azimuth values
are copied; antenna identity, position, height, enabled state, and allowed ranges
remain inherited from the candidate. Repeating the request returns the already
created configuration. The operation never publishes the draft or modifies a
live network.

