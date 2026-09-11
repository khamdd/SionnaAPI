# Refactor Behavior Contract

Status: Phase 0 baseline  
Recorded: 2026-09-11

## Purpose

This document records observable behavior that structural refactors must preserve.
A change to one of these contracts requires an explicit API, persistence, or
product migration rather than being included silently in a cleanup pass.

Automated companion coverage lives in `test/test_refactor_contracts.py` and
`test/fixtures/refactor/`.

## API Surface

The normalized OpenAPI baseline contains 46 paths and 53 operations. Its SHA-256
digest is recorded in `test/test_refactor_contracts.py`. The digest covers paths,
methods, operation IDs, parameters, schemas, security declarations, documented
responses, and API metadata.

Public operations without bearer authentication:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /health`

Every other operation requires the existing HTTP bearer dependency.

### Authentication

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/verify`

### Manual simulations and optimization

- `POST /api/v1/network-coverage`
- `POST /api/v1/coverage-map`
- `POST /api/v1/rsrp-simulation`
- `POST /api/v1/sinr`
- `POST /api/v1/throughput-comparison`
- `POST /api/v1/optimizations/network-coverage/run`

When a database is configured, these submission endpoints create queue jobs.
Without a database they execute inline. Analytical SINR and Throughput requests
do not require a loaded Sionna scene during inline calculation, but retain the
same request preparation and result-storage boundary.

### Simulation Queue

- `GET /api/v1/simulation-jobs`
- `GET /api/v1/simulation-jobs/{job_id}`
- `GET /api/v1/simulation-jobs/{job_id}/result`
- `POST /api/v1/simulation-jobs/{job_id}/save`
- `POST /api/v1/simulation-jobs/{job_id}/cancel`
- `DELETE /api/v1/simulation-jobs/{job_id}`

Queue invariants:

- Completed jobs remain in the queue until explicitly removed.
- A completed job is not History until its result is explicitly saved.
- Save is idempotent and returns the existing History run when already saved.
- Running jobs cannot be deleted.
- Queued jobs can be cancelled; running jobs use cooperative cancellation.
- Removing a saved queue entry does not remove its History run.

### Simulation History

- `GET /api/v1/simulation-runs`
- `GET /api/v1/simulation-runs/{run_id}`
- `GET /api/v1/simulation-runs/{run_id}/result`
- `DELETE /api/v1/simulation-runs/{run_id}`

History invariants:

- The frontend requests and displays History scoped to the selected scene.
- Comparisons require successful runs with the same simulation type and scene.
- Deleting a run deletes its database rows and owned artifacts.
- Every user-facing delete asks for confirmation first.

### Scenes and offline buildings

- `GET /api/v1/scenes`
- `GET /api/v1/scenes/active`
- `POST /api/v1/scenes/preview`
- `POST /api/v1/scenes/{scene_id}/activate`
- `DELETE /api/v1/scenes/{scene_id}`
- `GET /api/v1/offline-buildings`

Scene invariants:

- There is no built-in default scene.
- The frontend requires an explicit work-scene choice for simulation routes.
- Preview scenes expire and are cleaned if not kept.
- Fixed antennas are stored in scene registry metadata and cached in localStorage.
- Imported antennas outside selected bounds are not saved with the kept scene.
- Deleting a scene removes its generated scene artifacts where applicable.

### Network configuration and profiles

- `GET|POST /api/v1/network-configurations`
- `POST /api/v1/network-configurations/compare`
- `GET /api/v1/network-configurations/{configuration_id}`
- `POST /api/v1/network-configurations/{configuration_id}/publish`
- `GET /api/v1/scenes/{scene_id}/active-configuration`
- `GET|POST /api/v1/simulation-profiles`
- `GET|PUT|DELETE /api/v1/simulation-profiles/{profile_id}`
- `POST /api/v1/simulation-profiles/{profile_id}/enable`
- `POST /api/v1/simulation-profiles/{profile_id}/disable`
- `POST /api/v1/simulation-profiles/{profile_id}/build-request`

Configuration/profile invariants:

- Configuration versions are immutable snapshots.
- Publishing supersedes the prior published version and rejects identical content.
- Draft visibility remains private to the creator; published/superseded visibility
  follows the existing shared-scene rules.
- Profiles are created disabled and require an explicit readable, same-scene
  configuration before becoming eligible.
- An eligible profile must be disabled before changing simulation type or request
  template.
- Impact objectives belong to profile pairs, not reusable profiles.

### Impact planning, studies, reports, and notifications

- `POST /api/v1/configuration-impact/preview`
- `GET|POST /api/v1/impact-studies`
- `GET /api/v1/impact-studies/{study_id}`
- `POST /api/v1/impact-studies/{study_id}/start`
- `POST /api/v1/impact-studies/{study_id}/cancel`
- `GET /api/v1/impact-studies/{study_id}/comparison`
- `GET /api/v1/impact-studies/{study_id}/report`
- `POST /api/v1/impact-studies/{study_id}/profiles/{profile_id}/suggested-configuration`
- `GET /api/v1/notifications`
- `GET /api/v1/notifications/unread-count`
- `POST /api/v1/notifications/read-all`
- `POST /api/v1/notifications/{notification_id}/read`

Impact invariants:

- Preview is a dry run and creates no rows or jobs.
- Durable creation still uses the policy-v1 compatibility path.
- Start is idempotent and creates one baseline and one candidate job per planned
  profile.
- Partial failures remain explicit and do not discard successful siblings.
- Suggested configurations are drafts and are never automatically published.
- Reports are authenticated, idempotent HTML artifacts.
- A terminal study creates at most one in-app notification.

## Request Contract Fixtures

`test/fixtures/refactor/simulation_requests.json` contains canonical, fully
specified requests for:

- Coverage Map
- Network Coverage
- Network Coverage Optimization
- RSRP
- SINR
- Throughput Comparison

The fixtures validate against the current Pydantic models and serialize back to
the same JSON. Future request-building refactors should compare their frontend
output to these shapes before changing the fixture.

## Artifact Ownership

| Artifact | Location | Lifecycle owner |
| --- | --- | --- |
| Kept/imported scenes and previews | `static/scenes/` | Scene service |
| Rendered simulation images | `static/generated/` | Simulation result/history cleanup |
| Saved heavy History results | `static/simulation-results/` | Simulation History store |
| Temporary heavy queue results | `static/simulation-job-results/` | Simulation job store |
| Impact Study reports | `static/impact-reports/` | Impact report service |

Paths must continue to be resolved under `static/`; cleanup must not accept a
public URL that escapes the configured static root. Artifact writes that are
currently atomic must remain atomic.

## Error and Logging Boundaries

- A result whose status begins with `failure` is converted to the result's
  declared HTTP status or HTTP 500.
- Pydantic validation remains HTTP 422.
- Position/bounds errors retain their current HTTP 400 result contract.
- Request logging must continue to redact configured sensitive keys.
- Business events retain their event names and are emitted only after the
  corresponding operation reaches its current success/failure boundary.

## Updating This Contract

For a behavior-preserving refactor, the OpenAPI digest and fixtures must not
change. If a deliberate product or migration task changes them, update the
contract in the same pull request and explain the compatibility and rollout plan.
