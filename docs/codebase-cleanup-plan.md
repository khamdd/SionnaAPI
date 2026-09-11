# Codebase Modernization and Refactor Plan

Status: proposed

Last audited: 2026-09-11

## Purpose

Modernize the codebase through small, reviewable, behavior-preserving changes.
Public APIs, stored data, simulation behavior, and user workflows remain stable
unless a separate migration or product change explicitly authorizes a change.

This plan replaces the earlier cleanup plan. That version had become stale: it
proposed deleting optimization preview endpoints that were removed in commit
`540a850`, and it treated the absence of a frontend caller as sufficient evidence
that an API was dead. Backend endpoints may have external consumers, so API
removal requires stronger evidence and is not ordinary cleanup.

## Refactor Rules

Every implementation pass must document:

1. The current behavior being preserved.
2. The structural change being made.
3. The automated and manual checks that prove parity.

Additional rules:

- Keep public paths, methods, authentication requirements, status codes, response
  shapes, and generated-client operation IDs stable.
- Keep localStorage key names and compatible stored shapes stable.
- Keep queued simulation results separate from saved History.
- Do not combine dependency upgrades, framework migrations, schema changes, and
  structural refactors in one pull request.
- Do not delete an API merely because `frontend/src/api.js` does not call it.
- Do not refactor `simulation_worker.py` and `optimization_service.py` in the
  same pull request.
- Prefer moving and testing existing logic before introducing a generalized
  abstraction.
- One pull request should have one structural theme and be independently
  revertible.
- Reduced file size is useful evidence, but behavioral parity is the acceptance
  criterion.

## Canonical Behavior to Preserve

### Manual simulation workflow

```text
Login
  -> select or create a work scene
  -> configure and submit a simulation
  -> run inline when no database is configured, otherwise create a queue job
  -> review a completed job in Simulation Queue
  -> explicitly save selected results to History
```

Supported simulation types remain:

- `network_coverage`
- `coverage_map`
- `rsrp_simulation`
- `sinr`
- `throughput_comparison`
- `network_coverage_optimization`

### Automation workflow

```text
Network configuration versions
  -> eligible simulation profiles
  -> baseline/candidate Impact Study jobs
  -> comparison
  -> optional optimization
  -> report and notification
```

The durable Impact Study creation path still uses
`preview_configuration_impact_legacy`. Despite its name, it is active production
code and must remain until the paired policy-v2 persistence migration is complete.

### State and persistence invariants

- Auth and simulation drafts retain their existing localStorage keys.
- Scene changes and reset actions retain their current draft-clearing behavior.
- Running queue entries cannot be selected for deletion.
- User-facing deletes continue to require confirmation.
- Saving a queue result creates History; deleting the queue entry does not delete
  an already saved History result.
- Heavy results remain in their current artifact directories and retain their
  current URL and cleanup semantics.
- Database-backed execution retains leases, heartbeats, retries, cancellation,
  priorities, and worker ownership checks.

## Audit Findings

### Oversized modules

Measured during the 2026-09-11 audit:

| File | Lines | Mixed responsibilities |
| --- | ---: | --- |
| `frontend/src/App.jsx` | 2,791 | Auth, routing, scenes, four draft families, simulations, queue, History, modals |
| `frontend/src/components/ApiPages.jsx` | 2,269 | Four pages, forms, validation, payloads, role selection, results |
| `frontend/src/components/Scene3DPreview.jsx` | 1,529 | Three.js lifecycle, camera, antennas, overlays, result interaction |
| `frontend/src/components/SceneChooserModal.jsx` | 1,096 | Map lifecycle, regional buildings, drawing, import, preview, keep/load |
| `frontend/src/components/SimulationProfilesPage.jsx` | 870 | Ledger, editor, eligibility, configurations, roles |
| `backend/services/optimization_service.py` | 828 | Search, candidates, ranking, objectives, progress |
| `backend/services/simulation_job_store.py` | 731 | Persistence, transitions, retry, leases, cancellation, artifacts |
| `backend/services/impact_study_service.py` | 706 | Creation, start/cancel, reconciliation, comparison, suggestions |
| `backend/api/sinr.py` | 701 | Simulations, optimization, jobs, History, scenes, offline buildings |
| `backend/services/simulation_store.py` | 701 | History, serialization, artifacts, scene references |
| `backend/services/impact_planner.py` | 633 | Policy-v1 compatibility and policy-v2 planning |

These sizes are symptoms of mixed ownership, not targets to reduce mechanically.

### Confirmed duplication

- `App.jsx` repeats scene-scoped add, update, remove, reset, normalization, and
  localStorage paths for Network Coverage, RSRP, SINR, and Throughput.
- SINR and Throughput repeat the same three-role antenna workflow.
- Antenna validation, request conversion, numeric parsing, coordinate formatting,
  and range checks appear in `App.jsx`, `ApiPages.jsx`, `AntennaPanel.jsx`, and
  `NetworkConfigurationsPage.jsx`.
- Frontend API deletes hand-roll fetch/error handling while other requests use
  `requestJson`.
- Job, notification, report, and configuration services import generic
  serialization, time, and artifact helpers from `simulation_store.py`, giving
  the History store responsibilities that are not specific to History.

### Dead-code candidates requiring final confirmation

- `backend/services/differt_service.py` has no repository caller, is not wired
  into inline or worker execution, and its runtime dependencies are absent from
  `backend/requirements.txt`. Confirm it is not an intentionally parked
  experiment before deleting it.
- `backend/constants/constants.py` only re-exports radio constants and has no
  repository caller.

Static analysis findings are candidates, not automatic deletion authorization.
Dynamic imports, scripts, generated clients, and external API consumers must be
considered.

### Stale abstractions and legacy patterns

- `frontend/src/api.js::runSimulationRequest` adds no behavior beyond
  `requestJson`.
- `App.jsx` implements routing directly with `window.history` and literal route
  comparisons. The behavior works but is tightly coupled to the application.
- `frontend/package.json` uses `latest` for React and Vite packages. The lockfile
  makes `npm ci` reproducible, but the declaration policy should be hardened
  separately from refactoring.
- The frontend has no test or lint script, making large extractions depend too
  heavily on manual testing.
- `preview_configuration_impact_legacy` is intentionally retained until the
  durable paired-profile migration. It is compatibility code, not dead code.

## Baseline Before Implementation

The frontend production build passed during this audit. It produced a roughly
2.15 MB main JavaScript chunk and a Vite chunk-size warning. Bundle optimization
is a separate performance task because lazy loading can change loading behavior.

Backend tests could not be executed from the audit shell because neither Python
nor Conda was discoverable and the backend container was not running. This is a
test-runner availability issue, not a known test failure. No refactor pass should
begin until a reproducible backend test command is documented and the baseline
suite is green.

Required baseline checks:

```powershell
python -m pytest test -q
cd frontend
npm ci
npm run build
docker compose --env-file .env.docker up --build -d
```

If host Python is not the supported path, document and use an equivalent Docker
test command in developer guidance and CI.

## Required Contracts and Parity Assets

Create these before substantial implementation work:

1. `docs/refactor-contract.md`
   - Public routes, methods, auth requirements, important status codes, and
     response shapes.
   - Queue versus inline behavior.
   - Queue-to-History save and deletion semantics.
   - Artifact locations, URL shapes, and cleanup ownership.
2. `docs/frontend-route-matrix.md`
   - Authenticated and unauthenticated entry behavior.
   - Scene gating and redirects.
   - Browser back/forward behavior.
   - Visible navigation with and without a work scene.
3. A normalized OpenAPI snapshot or equivalent contract test.
4. Golden request fixtures for every simulation type and optimization.
5. A scene-draft compatibility matrix for all localStorage keys, stored shapes,
   reset actions, and scene-change behavior.
6. A Docker smoke checklist covering login, scene selection, a touched
   simulation, queue completion, save to History, History detail/comparison, and
   automation paths when those areas are touched.
7. A recorded frontend bundle report so performance work can be measured
   independently.

## Refactor Passes

### Pass 0: Establish the safety net

Execution status: complete on 2026-09-11. See `docs/refactor-baseline.md` for the
commands, results, known environment mismatch, and validation limits.

Current behavior:

- Backend pytest coverage is broad, but the supported invocation is not available
  from every development shell.
- The frontend build is the only automated frontend validation command.

Structural improvement:

- Document one reproducible backend test entry point.
- Add normalized API contract coverage.
- Add the route, payload, storage, and smoke-test parity assets above.

Validation:

- Full backend suite and frontend build are green.
- Docker services start and pass health checks.
- OpenAPI and behavioral fixtures are committed as the baseline.

### Pass 1: Add analysis and frontend test guardrails

Current behavior:

- Dead files and exports are discovered manually.
- No frontend lint or characterization-test command exists.

Structural improvement:

- Add a tooling-only backend configuration for Ruff and unused-code auditing.
- Add pinned frontend lint and characterization-test tooling.
- Enable rules incrementally, starting with unused imports/variables and React
  hook dependencies.
- Keep development tools separate from runtime dependencies where practical.

Validation:

- CI runs the new checks reproducibly.
- Production dependencies and generated application output are unchanged.
- Existing backend tests and frontend build remain green.

This pass adds development dependencies and must be its own pull request. It must
not include runtime dependency upgrades.

### Pass 2: Delete confirmed dead code and no-op paths

Current behavior:

- DiffeRT is not reachable through the API, worker, or frontend.
- The duplicate constants module is not imported.
- `runSimulationRequest` returns the same value as `requestJson`.

Structural improvement:

- Delete `differt_service.py` after confirming it is not intentionally retained.
- Delete the unused constants re-export module.
- Remove the no-op simulation request wrapper.
- Remove stale comments and documentation found by the same audit.
- Keep independent deletions in small commits or pull requests.

Validation:

- Reference scans are empty for every removed symbol or file.
- Backend imports/tests and frontend build pass.
- OpenAPI is unchanged.
- Worker dispatch still covers every supported simulation type.

### Pass 3: Normalize the frontend API boundary

Current behavior:

- `frontend/src/api.js` exports the functions consumed by the UI.
- Most functions use `requestJson`; deletes and artifact paths duplicate fetch,
  authentication, and error handling.

Structural improvement:

- Split implementation into domain clients for simulations, jobs, History,
  scenes, and automation.
- Re-export the existing public function names from `api.js` while components
  migrate incrementally.
- Route compatible JSON requests through one auth and error path.

Validation:

- Mock-fetch tests compare URL, method, query, body, authorization header,
  response parsing, and error text for every exported API function.
- Missing-token and expired-session behavior remain unchanged.
- Frontend build and route smoke checks pass.

### Pass 4: Mechanically split `App.jsx`

Current behavior:

- `App` owns application state and renders every route plus leaf components and
  pure conversion helpers.

Structural improvement:

- Move leaf UI without changing state ownership: navbar, Network Coverage page,
  Queue page/rows, History page, job-result detail, and pure route/result helpers.
- Keep current props, callbacks, and render conditions.
- Do not introduce global state or a routing framework.

Validation:

- Route matrix passes for login, scene gating, direct URLs, unknown URLs, and
  browser back/forward.
- Queue and History selection, bulk actions, confirmations, and modals behave
  identically.
- Network Coverage request and result fixtures remain unchanged.

### Pass 5: Consolidate antenna domain and scene drafts

Current behavior:

- Four simulation areas maintain separate scene-scoped type 2 antennas,
  per-antenna settings, and optional roles.
- Network Coverage and RSRP support enabled state and at most 10 active antennas.
- SINR and Throughput have uncapped candidates but submit three distinct roles.
- Each type has intentionally separate localStorage keys.

Structural improvement:

- Extract pure antenna normalization, range validation, request conversion, and
  simulation-setting functions.
- Extract a scene-keyed localStorage adapter while preserving keys and shapes.
- Introduce a focused `useSceneAntennaDraft` hook after pure functions are
  characterized.
- Express differences as explicit capabilities: active limit, enabled toggle,
  roles, and result invalidation.

Validation:

- Golden tests compare stored JSON and outgoing requests before and after.
- Cover duplicate IDs, invalid ranges, empty numeric edits, coordinate bounds,
  enabled state, role uniqueness, deletion cleanup, reload, reset, and scene
  changes.
- Every user-facing antenna delete still asks for confirmation.

### Pass 6: Split `ApiPages.jsx`

Current behavior:

- Coverage, RSRP, SINR, and Throughput share one module.
- SINR and Throughput share role setup and propagation controls but have different
  payload and result requirements.

Structural improvement:

- Move each page to its own file without redesigning it.
- Then extract demonstrated shared primitives: scene readiness, solver and
  propagation fields, numeric/position fields, role validation, queue-aware
  request state, and antenna request conversion.
- Keep result components domain-specific unless genuinely identical. Avoid a
  large component controlled by many mode flags.

Validation:

- Payload fixtures for all four pages are identical.
- Test Sionna and analytical readiness separately.
- Test role initialization, uniqueness, stale-role cleanup, and Throughput tilt
  clamping.
- Queued and inline responses retain their current presentation.

### Pass 7: Split backend routers by resource

Current behavior:

- `backend/api/sinr.py` registers simulation, optimization, job, History, scene,
  and offline-building endpoints under one authenticated router.
- Shared preparation aligns solver bounds, converts antenna positions, validates
  them, chooses queue or inline execution, and records events.

Structural improvement:

- Create resource routers for simulation submission, optimization, jobs, History,
  and scenes/offline buildings.
- Extract the runtime-request pipeline into a focused internal service or
  dependency.
- Mount the new routers under the same `/api/v1` paths and retain authentication.

Validation:

- Normalized OpenAPI before and after is identical, including operation IDs if
  clients consume them.
- Path, method, auth, query defaults, status codes, errors, and responses remain
  unchanged.
- Run API error, schema, job, History, scene, auth, and event-logging tests.
- Smoke one inline analytical and one database-backed queued request.

### Pass 8: Clarify persistence and artifact ownership

Current behavior:

- Queue results are temporary; History results are durable.
- Heavy JSON and rendered artifacts live outside PostgreSQL.
- Generic serialization and artifact helpers live in `simulation_store.py` and
  are imported by unrelated services.

Structural improvement:

- Extract JSON/datetime serialization, safe path/URL handling, atomic writes,
  heavy-result policy, summarization, and deletion in separate steps.
- Keep job and History stores separate because they model different lifecycles.
- Later separate pure job transition/retry policy from SQLAlchemy operations if
  tests support it.

Validation:

- Existing store and job suites remain green.
- Cover traversal rejection, atomic replacement, URL resolution, heavy-result
  thresholds, save-to-History, queue deletion after save, and unsaved cleanup.
- Rows and files are removed under the same conditions as before.

### Pass 9: Split deterministic optimization internals

Current behavior:

- `optimization_service.py` performs candidate generation, global sampling,
  beam selection, local refinement, objectives, ranking, progress, and result
  construction.

Structural improvement:

- Extract pure modules for parameter domains/candidate identity, global
  candidates, objective ranking, beam diversity/local neighbors, and result
  assembly.
- Leave `run_network_coverage_optimization` as the orchestration boundary.
- Do not change search order, rounding, ranking, or stopping behavior.

Validation:

- Fixed inputs produce the same candidate order, winner, KPIs, objective outcomes,
  budget counts, stop reason, global/local counts, beam width, and rounds.
- Exact ties still preserve the earlier setup, including baseline.
- Existing optimization tests remain green.
- Worker behavior is not refactored in this pass.

### Pass 10: Separate Impact Study lifecycle responsibilities

Current behavior:

- Durable creation uses policy-v1 compatibility.
- Starting is idempotent and creates one baseline/candidate pair per profile.
- Reconciliation preserves successful siblings, computes comparisons, may queue
  optimization, creates reports, and emits one terminal notification.

Structural improvement:

- Mechanically extract lifecycle, reconciliation, comparison triggering, and
  suggested-configuration creation behind the existing service API.
- Keep the legacy planner call and persistence fields unchanged.
- Do not combine this with policy-v2 durable migration.

Validation:

- Existing Impact Study, comparison, optimization, report, and notification tests
  remain green.
- Verify idempotent start, partial failure, cancellation, notification uniqueness,
  report reuse, and suggested-draft idempotency.

### Pass 11: Decompose visual modules

Current behavior:

- `Scene3DPreview.jsx` owns Three.js resources, camera, antennas, grids, links,
  RSRP users, interaction, and loading.
- `SceneChooserModal.jsx` owns MapLibre, PMTiles regions, drawing, antenna import,
  preview lifecycle, and keep/load actions.

Structural improvement:

- Extract pure scene/result adapters before renderer lifecycle code.
- Split 3D responsibilities into renderer lifecycle, camera, antenna markers,
  overlays, links, RSRP users, and interaction state.
- Split scene choosing into map lifecycle, region management, area drawing,
  antenna import, preview card, and keep/load orchestration.
- Keep imperative Three.js and MapLibre ownership explicit.

Validation:

- Browser/screenshot checks cover views, antennas, grids, links, RSRP users,
  hover/selection, loading, and scene changes.
- Scene checks cover region load/unload, draw/clear, size validation, imports,
  preview cleanup, keep, cancel, and load.
- WebGL and MapLibre resources are disposed exactly once.

## Separate Migration and Product Tasks

Do not fold these into behavior-preserving refactor passes.

### Framework and architecture migrations

- Replace manual routing with React Router or another framework.
- Migrate JavaScript to TypeScript.
- Introduce global state management.
- Replace the CSS/component architecture.
- Make broader SQLAlchemy repository/model architecture changes.

Each requires a design note, migration strategy, rollback plan, and parity suite.

### Dependency changes

- React, Vite, Three.js, MapLibre, PMTiles, Sionna, FastAPI, Pydantic,
  SQLAlchemy, Alembic, PostgreSQL, or Elasticsearch upgrades.
- Replace `latest` frontend declarations with an explicit version policy.
- Add DiffeRT as a supported engine and install its runtime dependencies.

Pinning versions already represented by the lockfile may be a small dependency
hardening task. Actual upgrades should be isolated by dependency family.

### API, persistence, and product changes

- Remove or rename public API endpoints.
- Change response schemas or error contracts.
- Add database schema or Alembic migrations.
- Migrate durable Impact Studies from policy-v1 compatibility to explicit
  policy-v2 profile pairs.
- Add the frontend notification badge/list or other features.
- Add lazy route loading and bundle-performance changes.

## Recommended Execution Order

1. Pass 0: contracts and reproducible baseline.
2. Pass 1: analysis and frontend characterization tooling.
3. Pass 2: confirmed dead-code deletion.
4. Pass 3: frontend API boundary.
5. Pass 4: mechanical `App.jsx` split.
6. Pass 5: antenna and draft consolidation.
7. Pass 6: `ApiPages.jsx` split.
8. Pass 7: backend router split.
9. Pass 8: persistence and artifact helpers.
10. Pass 9: optimization internals.
11. Pass 10: Impact Study service extraction.
12. Pass 11: visual module decomposition.

Passes 9 through 11 may be reprioritized according to the next product area, but
only after the relevant characterization coverage exists.

## Pull Request Template

```markdown
## Current behavior

Describe the observable behavior and invariants being preserved.

## Structural change

Describe moved, deleted, or extracted responsibilities. State that public APIs
and persisted shapes are unchanged, or identify the separately approved exception.

## Parity evidence

- [ ] Targeted automated tests
- [ ] Full backend test suite
- [ ] Frontend build
- [ ] OpenAPI diff where applicable
- [ ] LocalStorage/payload fixture diff where applicable
- [ ] Docker smoke flow where applicable
- [ ] Visual check where applicable

## Risks and rollback

Name the highest-risk coupling and explain how this pull request can be reverted
without depending on later passes.
```

## Completion Criteria

The modernization effort is complete when:

- Routine changes no longer require editing unrelated simulation paths.
- `App.jsx`, `ApiPages.jsx`, and `backend/api/sinr.py` no longer coordinate
  unrelated domains.
- Antenna, draft, API, request-pipeline, serialization, and artifact behavior each
  have one tested source of truth.
- Optimization and Impact Study behavior retain deterministic parity.
- Dead code and compatibility shims are removed or documented with an owner and
  removal condition.
- Public API, database, artifact, and localStorage compatibility checks are
  automated.
- Backend tests, frontend checks/builds, and scoped Docker smoke flows are green.
