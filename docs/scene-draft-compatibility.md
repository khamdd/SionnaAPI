# Scene Draft Compatibility Contract

Status: Phase 0 baseline  
Recorded: 2026-09-11

Simulation drafts are frontend-only, scene-scoped localStorage data. Refactors
must preserve the keys and readable value shapes below so users do not lose work
after an application update.

`test/fixtures/refactor/local_storage_contract.json` contains the machine-readable
key list and representative state.

## Authentication and scene cache

| Constant | Key | Shape | Removal behavior |
| --- | --- | --- | --- |
| `USER_STORAGE_KEY` | `sionna_user` | JSON user object | Removed on logout or failed token verification |
| `AUTH_TOKEN_STORAGE_KEY` | `sionna_auth_token` | Raw bearer token string | Removed on logout or failed token verification |
| `SCENE_FIXED_ANTENNAS_STORAGE_KEY` | `sionna_scene_fixed_antennas` | `{[sceneId]: Antenna[]}` | Best-effort backup; stale invalid scene entries are removed when read |

Fixed antenna entries preserve geographic base data. Any obsolete internal
`position` field is discarded when restored. A finite longitude and latitude are
required; invalid or empty arrays normalize to no cached value.

## Simulation draft keys

| Simulation | Type 2 antennas | Per-antenna settings | Roles |
| --- | --- | --- | --- |
| Network Coverage | `sionna_network_type2_antennas` | `sionna_network_antenna_settings` | None |
| RSRP | `sionna_rsrp_type2_antennas` | `sionna_rsrp_antenna_settings` | None |
| SINR | `sionna_sinr_type2_antennas` | `sionna_sinr_antenna_settings` | `sionna_sinr_role_selection` |
| Throughput | `sionna_throughput_type2_antennas` | `sionna_throughput_antenna_settings` | `sionna_throughput_role_selection` |

All values are JSON objects keyed by scene ID.

Type 2 antenna value:

```json
{
  "scene-id": [
    {
      "id": "A2",
      "longitude": 105.834,
      "latitude": 21.0278,
      "height_m": 30,
      "tilt": {"min": 2, "current": 8, "max": 18},
      "azimuth": 45,
      "tx_power": {"min": 20, "current": 30, "max": 40}
    }
  ]
}
```

Per-antenna setting value:

```json
{
  "scene-id": {
    "A2": {
      "azimuth": 45,
      "enabled": true,
      "tilt_current": 8,
      "tx_power_current": 30
    }
  }
}
```

Missing `enabled` reads as `true`. Network Coverage and RSRP edit it; SINR and
Throughput currently keep antennas enabled implicitly.

Role value:

```json
{
  "scene-id": {
    "transmitter": "A1",
    "receiver": "A2",
    "interferer": "A3"
  }
}
```

Blank or unknown role selections are cleaned when candidates change. A removed
type 2 antenna is also removed from any role that references it.

## Optimization keys

Objectives use `sionna_network_optimization_objectives`:

```json
{
  "scene-id": {
    "simulation_type": "network_coverage",
    "objectives": [
      {"metric": "uncovered_area_percent", "operator": "<=", "target": 2}
    ]
  }
}
```

The latest resumable job is stored separately at the derived key
`sionna_network_optimization_objectives:run:<scene-id>` with `{jobId, signature}`.
A missing/deleted/wrong-scene job clears that derived entry.

## Reset and scene-change behavior

| Action | Cleared data |
| --- | --- |
| Reset Network Coverage antennas | Network type 2 antennas and settings for current scene; displayed Network result |
| Reset RSRP antennas | RSRP type 2 antennas and settings for current scene |
| Reset SINR antennas | SINR type 2 antennas, settings, and roles for current scene |
| Reset Throughput antennas | Throughput type 2 antennas, settings, and roles for current scene |
| Confirm Change scene | All four simulation draft families for the old scene, current result and comparison state |
| Cancel Change scene | Nothing |
| Logout | Auth token and user; simulation draft keys remain stored |

Optimization objectives and the fixed-antenna backup are not part of the four
draft-clear helpers and remain unless their owning flow removes or replaces them.

## Invalid storage behavior

- Invalid JSON reads as an empty map or no cached value.
- Invalid individual type 2 antennas/settings/roles are filtered out.
- Empty normalized scene values are removed from in-memory maps.
- Fixed-antenna persistence is best-effort because backend scene metadata is the
  primary store.
- Storage write failure in optimization is ignored so a run can continue without
  persistence.
