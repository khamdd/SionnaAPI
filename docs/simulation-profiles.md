# Saved simulation profiles

Simulation profiles store repeatable simulation settings separately from versioned
antenna configurations. The configuration answers **what network is being tested**;
the profile answers **how it should be tested**.

Profiles support `network_coverage`, `coverage_map`, `rsrp_simulation`, `sinr`, and
`throughput_comparison`. A profile can be saved while incomplete, but it cannot be
made eligible until its template and a selected readable network configuration
combine into the existing Pydantic request model.

## Template rules

- Include every non-antenna simulation setting explicitly, including a complete
  `solver` object. This avoids silently changing behavior if an application
  default changes later.
- Do not include fields owned by the network configuration, such as `antennas`,
  transmitter positions, power, or SINR tilt.
- Do not include `objectives`. Decision thresholds belong to an Impact Study
  profile pair so both scenario results are judged against the same target.
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
  "bandwidth_mhz": 100,
  "mimo_layers": 4
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

The enable endpoint requires the validation configuration explicitly:

```json
{
  "configuration_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
}
```

The configuration must be readable, belong to the profile's scene, and may be
published, superseded, or a draft owned by the caller. The build-request endpoint
accepts the same `configuration_id` shape and returns the exact validated request
that later automation can submit. Preview validates the profile again against the
scenario's actual configuration; earlier eligibility does not override scenario
validation.

All endpoints require a configured database and authentication. Eligible profiles
are readable to users of the shared project scenes; only their creator can change
eligibility, rename, or delete them. New profiles must be created disabled.
Simulation type or request-template edits on an eligible profile return
`enabled_profile_must_be_disabled`; disable it first, make the changes, then
validate it again. A name-only update is allowed because it does not affect a
simulation request.

The current simulation pages and their localStorage drafts are unchanged. A future
frontend step can add **Save as automation profile** controls to those individual
simulation pages without changing this profile workspace.

## Frontend workflow

The scene-scoped `/profiles` page provides a profile ledger, structured editor,
and server-authoritative readiness panel. The editor exposes the applicable
solver, radio, user-sampling, and antenna-role fields for each
simulation type instead of requiring raw JSON editing.

Profile create and update requests reject an `objectives` field. Objectives are
selected later for a specific Impact Study pair and are not part of profile
eligibility or profile differences.

Camera settings are not simulation-profile inputs. Coverage services never used
the former request field, so it was removed from the API and profile editor. The
interactive 3D preview manages its own frontend-only camera.

New profiles are always saved disabled. A separate **Validate and make eligible**
action builds the exact request against the configuration selected in the
eligibility panel. The active published version is selected by default, while
readable draft and superseded versions remain available so candidate-only antennas
can be assigned and validated. The same selector supplies antenna choices to the
structured role editor.

Eligible means available for either side of a scenario comparison; it does not
mean the profile is automatically used for both sides or for every study. Disabled
profiles may remain incomplete, and the eligibility panel explains missing
configuration, role assignments, or settings. Eligible profiles are read-only for
users other than their creator, and owners must disable one before opening its full
simulation-settings editor. Deleting a profile requires explicit confirmation.
