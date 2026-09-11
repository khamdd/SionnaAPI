# Agent-Executable Codebase Cleanup Walkthrough

Status: ready for execution

Prepared: 2026-09-11

## How to Use This Document

Give this file to an implementation agent and instruct it to execute exactly one
numbered work unit at a time. Each work unit should produce one reviewable commit
unless the unit explicitly says otherwise.

The agent must stop after the requested work unit, report its validation results,
and wait for review before starting the next unit. Do not execute the entire
cleanup as one change.

Phase 0 is already complete in commit `a14b1f7`. Its recorded results are in
`docs/refactor-baseline.md`.

## Copy/Paste Task Brief for Another Agent

```text
Execute the next incomplete work unit from
docs/codebase-cleanup-walkthrough.md.

Before editing:
1. Read AGENTS.md completely.
2. Read docs/codebase-cleanup-plan.md.
3. Read docs/refactor-contract.md.
4. Read docs/refactor-baseline.md.
5. Read the current work unit and every file it names.
6. Check git status and preserve unrelated user changes.

Rules:
- Preserve behavior and public APIs.
- Do not combine work units.
- Add or update characterization coverage before risky movement.
- Do not change runtime dependency versions, database schemas, API contracts,
  routing frameworks, or product behavior.
- Do not update a golden fixture merely to make a surprising failure pass.
  First determine whether the code changed behavior.
- Run every validation command listed for the work unit.
- Complete the mandatory validation gate after every work unit and the full
  application parity gate at the end of every phase.
- If the OpenAPI digest changes unexpectedly, stop and report the diff.
- If existing data requires a migration revision absent from the checkout, do
  not stamp, downgrade, or delete the database. Use a matching branch or an
  isolated clean Compose project.
- Update AGENTS.md only when file ownership, architecture, workflow, or important
  paths materially change.

At completion, report:
- files changed;
- current behavior preserved;
- structural improvement;
- tests/checks and exact results;
- deferred findings;
- proposed commit message.
```

## Global Safety Rules

### Preserve these contracts

- The normalized OpenAPI contract in `test/test_refactor_contracts.py`.
- Canonical requests in `test/fixtures/refactor/simulation_requests.json`.
- Frontend route order and labels in
  `test/fixtures/refactor/frontend_contract.json`.
- localStorage keys and compatible shapes in
  `test/fixtures/refactor/local_storage_contract.json`.
- Queue results remain temporary until explicitly saved to History.
- History and queue artifact lifecycles remain separate.
- Every user-facing delete continues to ask for confirmation.
- Scene selection remains required before protected simulation/result routes.
- Optimization remains deterministic for fixed inputs.
- Durable Impact Studies continue using policy-v1 compatibility until a separate
  migration explicitly changes them.

### Never mix these into cleanup

- React Router, TypeScript, or global state-management migration.
- Runtime dependency upgrades.
- Database schema or Alembic changes.
- Public API removal, renaming, or response changes.
- Durable Impact Study policy-v2 migration.
- New notification UI or other product features.
- Lazy-loading or bundle-performance changes.
- DiffeRT revival as a supported engine.

### Standard validation commands

Backend tests without a compatible host Python environment:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/test-backend.ps1
```

Frontend dependency/build checks:

```powershell
cd frontend
npm ci
npm run build
```

Repository checks:

```powershell
git diff --check
git status --short
git diff --stat
```

Docker configuration:

```powershell
docker compose --env-file .env.docker config --quiet
```

Full-stack check when relevant:

```powershell
docker compose --env-file .env.docker up --build -d
docker compose --env-file .env.docker ps -a
```

Never run `docker compose down -v` against the user's normal project as a cleanup
shortcut. It permanently deletes PostgreSQL and Elasticsearch volumes.

## Mandatory Validation Gates

Validation is part of every cleanup change, not a final step postponed until the
end of the project. An agent must not mark a work unit or phase complete merely
because the code compiles.

### After every work unit

Run all checks that can exercise the touched behavior:

1. Run the work unit's targeted tests first. These must cover the main logic
   moved, deleted, or simplified by that unit.
2. Run the complete backend suite:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/test-backend.ps1
   ```

3. Run the frontend checks. Before Work Unit 1C exists, run the build; after it
   exists, run lint, tests, and the build:

   ```powershell
   cd frontend
   npm run lint
   npm test
   npm run build
   ```

4. Run the OpenAPI and contract checks when an API, schema, router, frontend API
   client, route, or storage path was touched.
5. Run `docker compose --env-file .env.docker config --quiet` when Docker,
   dependencies, startup, database integration, or service wiring was touched.
6. Run `git diff --check`, review `git diff`, and confirm that no unrelated files
   or generated artifacts entered the change.
7. Perform the relevant manual smoke path from
   `docs/refactor-smoke-checklist.md` for the user flow affected by the unit.

If a command is unavailable because of hardware or environment limitations, the
agent must record the exact command, error, and unverified behavior. It must not
claim that check passed.

### At the end of every phase

Treat the work-unit groups below as phases:

- Phase 1: Work Units 1A-1C, guardrails.
- Phase 2: Work Units 2A-2C, dead code and obsolete indirection.
- Phase 3: Work Units 3A-3B, frontend API boundary.
- Phase 4: Work Units 4A-4B, `App.jsx` decomposition.
- Phase 5: Work Units 5A-5C, antenna and draft-state consolidation.
- Phase 6: Work Units 6A-6B, simulation-page decomposition.
- Phase 7: Work Units 7A-7B, backend request and router boundaries.
- Phase 8: Work Units 8A-8C, persistence helpers and job policy.
- Phase 9: Work Unit 9, optimization internals.
- Phase 10: Work Unit 10, Impact Study responsibilities.
- Phase 11: Work Units 11A-11B, scene UI decomposition.

After the final work unit in each phase:

1. Run the complete backend suite and frontend lint, test, and build checks.
2. Verify the normalized OpenAPI contract and frontend route, request, and
   localStorage fixtures remain stable.
3. Start the isolated/full Docker stack when the environment supports it, verify
   `database-migrate` exits successfully, and confirm the backend and frontend
   services become healthy.
4. Exercise the applicable main flows in `docs/refactor-smoke-checklist.md`, not
   only the code directly edited. At minimum verify authentication, scene
   selection, one representative simulation submission/result path, Queue, and
   History. Also exercise configuration, profile, optimization, or Impact Study
   flows when that phase touched them.
5. Compare failures and warnings with `docs/refactor-baseline.md`. Stop on a new
   regression, unexpected API/fixture change, or broken main flow.
6. Record exact commands and results in the phase handoff. Do not begin the next
   phase until the current phase is reviewed and accepted.

Use an isolated Compose project or a database matching the checkout's Alembic
history. Never modify, stamp, downgrade, or delete the user's normal database to
make a parity check pass.

## Work Unit 0: Confirm the Baseline

Status: complete in `a14b1f7`.

Do not recreate Phase 0. Before each new work unit, perform only this abbreviated
check:

1. Run `git status --short`.
2. Confirm the previous work unit is committed or intentionally present.
3. Run the relevant fast contract checks.
4. Read `docs/refactor-baseline.md` for known warnings and environment limits.

Expected baseline:

- Backend: 281 tests passing at Phase 0.
- OpenAPI: 46 paths, 53 operations.
- Frontend: Vite build passing.
- Known warnings: two backend dependency deprecations, two high-severity npm
  audit findings, and a large frontend chunk warning.

Those warnings belong to separate dependency/performance tasks. Do not fix them
inside a cleanup work unit.

## Work Unit 1A: Backend Static-Analysis Guardrails

### Current behavior

Backend quality is protected primarily by pytest. There is no committed Ruff
configuration or repeatable unused-code audit.

### Structural improvement

Add development-only backend static-analysis tooling without modifying the
production image or runtime dependency set.

### Steps

1. Inspect `backend/requirements.txt`, `Dockerfile.backend`, and existing CI files.
2. Choose one development dependency location, such as
   `backend/requirements-dev.txt` or a root `pyproject.toml` optional group.
3. Pin Ruff to an explicit version.
4. Add `pyproject.toml` configuration scoped to `backend/` and `test/`.
5. Begin with behavior-neutral rules:
   - undefined names;
   - unused imports and variables;
   - import ordering;
   - obvious syntax/style errors that cannot change control flow.
6. Run Ruff once and classify findings before applying fixes.
7. Apply safe automatic fixes only to imports/formatting.
8. Handle remaining findings manually in small groups.
9. Do not enable broad complexity, annotation, or formatting rules yet.
10. Add the exact lint command to README and AGENTS.md.

### Validation

```powershell
ruff check backend test
powershell -ExecutionPolicy Bypass -File scripts/test-backend.ps1
git diff --check
```

The OpenAPI digest must remain unchanged.

### Stop conditions

Stop and report instead of suppressing globally if Ruff identifies code that may
be dynamically imported, framework-discovered, or intentionally unused for a
public contract.

### Suggested commit

`chore(quality): add backend static analysis guardrails`

## Work Unit 1B: Frontend ESLint Guardrails

### Current behavior

The frontend has a production build command but no lint command. React hook
dependencies and unused exports are reviewed manually.

### Structural improvement

Add pinned ESLint tooling and a narrow ruleset without upgrading React, Vite, or
other runtime packages.

### Steps

1. Inspect `frontend/package.json` and `frontend/package-lock.json`.
2. Add explicit dev dependencies compatible with the locked React/Vite setup:
   - ESLint;
   - `@eslint/js`;
   - React Hooks plugin;
   - React Refresh plugin only if required by the chosen Vite configuration.
3. Add an ESLint flat configuration scoped to `frontend/src/`.
4. Add `npm run lint`.
5. Enable unused-variable and React Hook rules first.
6. Run lint before editing and capture the finding count.
7. Fix imports, local variables, and trivially stale callbacks.
8. Do not change a hook dependency if it could alter polling, loading, scene
   switching, or persistence behavior. Document or narrowly suppress it and
   create a follow-up characterization task.
9. Do not reformat the entire frontend in this unit.

### Validation

```powershell
cd frontend
npm ci
npm run lint
npm run build
```

Then run `git diff --check` at the repository root.

### Stop conditions

Stop if satisfying a hook rule changes when an effect runs. That is a behavior
refactor and needs characterization coverage first.

### Suggested commit

`chore(frontend): add eslint guardrails`

## Work Unit 1C: Frontend Characterization Harness

### Current behavior

Frontend behavior is validated by builds and manual smoke testing. Pure utilities,
API requests, and local persistence have no frontend test runner.

### Structural improvement

Add pinned Vitest-based characterization tooling and tests around existing
boundaries. Do not restructure production components in this unit.

### Steps

1. Add pinned Vitest and a DOM environment only if a test requires it.
2. Add `npm test` for a single non-watch run and an optional watch command.
3. Begin with pure, stable modules:
   - `src/utils/scene.js`;
   - `src/utils/history.js`;
   - `src/utils/format.js`;
   - route and storage constants.
4. Add mock-fetch characterization tests for `src/api.js`:
   - URL and query parameters;
   - method and body;
   - bearer header behavior;
   - error message extraction;
   - relative and absolute artifact URLs.
5. Do not export private `App.jsx` helpers solely to test them yet.
6. Record uncovered routing/draft behaviors as prerequisites for Units 4 and 5.

### Validation

```powershell
cd frontend
npm ci
npm run lint
npm test
npm run build
```

Also run the backend contract suite because frontend constants are part of the
Phase 0 contract image.

### Suggested commit

`test(frontend): add characterization test harness`

## Work Unit 2A: Remove the Unused Constants Compatibility Module

### Current behavior

`backend/constants/constants.py` re-exports radio constants, while active code
imports from `backend.constants` or domain-specific constants modules.

### Structural improvement

Delete the unused compatibility module only.

### Steps

1. Run:

   ```powershell
   rg "backend\.constants\.constants|constants\.constants" backend test
   ```

2. Inspect dynamic import/configuration paths for the module name.
3. Delete the file if no caller exists.
4. Do not reorganize the remaining constants in this unit.

### Validation

- Ruff/import checks pass.
- Full backend suite passes.
- OpenAPI digest remains unchanged.

### Suggested commit

`cleanup(constants): remove unused compatibility module`

## Work Unit 2B: Decide and Remove or Retain DiffeRT

### Current behavior

`backend/services/differt_service.py` has no repository caller, is not in worker
dispatch, and its dependencies are absent from runtime requirements.

### Structural improvement

Either delete the orphaned experiment or document an explicit owner and removal
condition. Do not wire it into production during cleanup.

### Steps

1. Search code, docs, scripts, environment variables, and Git history for
   `differt` and `execute_differt_simulation`.
2. Confirm with the project owner whether the module is intentionally parked.
3. If not retained, delete only `differt_service.py` and stale references.
4. If retained, add a short status note explaining that it is not a supported
   engine, its owner, and its planned decision date.
5. Do not add dependencies or API flags.

### Validation

- Backend tests and import checks pass.
- Worker dispatch tests still cover every supported simulation type.
- OpenAPI digest remains unchanged.

### Stop conditions

If ownership cannot be established, do not delete it automatically. Report the
decision as blocked and continue only with a separately authorized unit.

### Suggested commit

`cleanup(simulation): remove unused differt experiment`

## Work Unit 2C: Remove the No-Op Simulation API Wrapper

### Current behavior

`runSimulationRequest` in `frontend/src/api.js` calls `requestJson`, then returns
the response unchanged whether or not it contains a job ID.

### Structural improvement

Have the simulation API functions call `requestJson` directly. Preserve every
exported function name and request shape.

### Steps

1. Ensure Unit 1C API tests cover all simulation functions.
2. Replace calls to `runSimulationRequest` with direct `requestJson` calls.
3. Delete the wrapper.
4. Do not split `api.js` in this unit.

### Validation

- API mock tests show identical calls and responses.
- Frontend lint, tests, and build pass.
- Backend OpenAPI contract remains unchanged.

### Suggested commit

`cleanup(api): remove no-op simulation request wrapper`

## Work Unit 3A: Characterize the Frontend API Boundary

Skip this unit if Unit 1C already covers every exported function in
`frontend/src/api.js`.

### Steps

1. Inventory every export from `frontend/src/api.js`.
2. For each export, capture method, path, query defaults, headers, body, response,
   and failure behavior.
3. Add missing mock-fetch tests.
4. Confirm authentication reads the existing localStorage token on every request.
5. Confirm artifact fetching preserves absolute URLs and prefixes relative URLs.

### Validation

- Every exported function has direct or table-driven coverage.
- No production code changes are required.

### Suggested commit

`test(api): characterize frontend request boundary`

## Work Unit 3B: Split Frontend API Clients by Domain

### Current behavior

Components import stable functions from `frontend/src/api.js`. Request helpers and
domain functions share one module, and some deletes duplicate common handling.

### Structural improvement

Move implementations into domain modules while keeping `api.js` as a compatibility
barrel that re-exports the same names.

### Steps

1. Create a small shared HTTP module containing only:
   - authenticated headers;
   - JSON request handling;
   - error extraction;
   - API URL normalization.
2. Create domain clients in separate commits if needed:
   - simulations;
   - jobs and History;
   - scenes;
   - configurations/profiles/Impact Studies/notifications.
3. Move functions without renaming exports.
4. Route delete calls through the common JSON request path only when tests prove
   identical behavior.
5. Keep `frontend/src/api.js` as the stable import boundary during later units.

### Validation

- All API characterization tests pass unchanged.
- Frontend imports continue resolving.
- Frontend build passes.
- OpenAPI contract remains unchanged.

### Suggested commit

`refactor(api): split frontend clients by domain`

## Work Unit 4A: Move Pure Helpers Out of `App.jsx`

### Current behavior

`App.jsx` contains pure route normalization, set/map helpers, antenna/result
adapters, storage normalization, and the application component.

### Structural improvement

Move pure functions into domain-specific utility modules without changing their
logic or call sites beyond imports.

### Steps

1. Group helpers by actual responsibility, not by generic names:
   - route helpers;
   - History/job adapters;
   - antenna normalization and request conversion;
   - scene-keyed storage helpers;
   - immutable Set/Map helpers.
2. Before moving each group, add characterization tests for its current edge
   cases.
3. Move one helper group per commit if the diff becomes difficult to review.
4. Preserve error strings, fallback values, ordering, and null/empty behavior.
5. Do not consolidate duplicated simulation draft handlers yet.

### Validation

- New helper tests pass.
- Existing frontend tests/build pass.
- Golden request and localStorage fixtures remain unchanged.

### Suggested commit

`refactor(app): extract pure orchestration helpers`

## Work Unit 4B: Move Leaf Components Out of `App.jsx`

### Current behavior

`App.jsx` renders the navbar, Network Coverage page, Queue page/rows, History page,
and result details inline while retaining all state.

### Structural improvement

Move leaf rendering into files without changing state ownership or callback
behavior.

### Recommended order

1. Navbar, icons, progress, and queue prompt.
2. Queue page and queue row.
3. History route page and job result detail.
4. Network Coverage page shell.

For each move:

1. Copy the component unchanged.
2. Export/import it.
3. Delete the original definition.
4. Run targeted tests/build before moving the next component.
5. Avoid opportunistic prop renaming or CSS changes.

### Validation

- Route matrix and manual navigation smoke pass.
- Queue/History selection, confirmations, and modals are unchanged.
- Frontend lint, tests, and build pass.

### Suggested commit

`refactor(app): extract route and shell components`

## Work Unit 5A: Establish One Antenna Domain Module

### Current behavior

Antenna normalization, range validation, request conversion, coordinate
formatting, and numeric parsing are duplicated across several components.

### Structural improvement

Create focused, pure antenna-domain utilities and migrate one caller at a time.

### Steps

1. Compare every implementation before selecting canonical semantics.
2. Add table-driven tests for:
   - incomplete base antennas;
   - numeric strings and empty values;
   - range min/current/max validation;
   - longitude/latitude precision;
   - enabled default;
   - request conversion and forbidden extra fields.
3. Extract only functions with identical behavior.
4. Keep context-specific error wording in the caller when wording differs.
5. Migrate `App.jsx`, `AntennaPanel.jsx`, `ApiPages.jsx`, and configuration pages
   one caller at a time.

### Validation

- Golden request fixtures remain identical.
- Antenna import/template tests remain green.
- Frontend tests/build pass.

### Suggested commit

`refactor(antennas): centralize shared domain utilities`

## Work Unit 5B: Extract Scene-Keyed Storage Adapter

### Current behavior

`App.jsx` reads and writes Maps encoded as JSON objects keyed by scene ID. Invalid
JSON falls back safely; invalid normalized values are omitted.

### Structural improvement

Create a pure storage adapter that preserves current keys, JSON shapes, and error
behavior.

### Steps

1. Add tests using the Phase 0 localStorage fixture.
2. Extract read, persist, set, and remove operations.
3. Preserve best-effort behavior for the fixed-antenna cache.
4. Preserve the optimization flow's independent derived run key.
5. Do not introduce React state or a hook yet.

### Validation

- Corrupt JSON, invalid entries, empty normalized values, and write failures have
  the same outcomes.
- Existing localStorage fixture remains unchanged.

### Suggested commit

`refactor(storage): extract scene-scoped draft adapter`

## Work Unit 5C: Consolidate Simulation Draft State

### Current behavior

Network Coverage, RSRP, SINR, and Throughput use separate type 2 antennas,
settings, and role selections. Their differences are intentional.

### Structural improvement

Introduce a focused `useSceneAntennaDraft` hook or equivalent state controller
with explicit capabilities rather than copied handlers.

### Required capabilities

- Network Coverage: enabled state, 10-active limit, result invalidation, no roles.
- RSRP: enabled state, 10-active limit, no roles.
- SINR: unlimited candidates, three roles, role cleanup on deletion.
- Throughput: unlimited candidates, three roles, role cleanup on deletion.

### Steps

1. Characterize add/update/remove/reset for each simulation type.
2. Introduce the shared controller for only one simulation type first.
3. Migrate the remaining types one at a time.
4. Preserve confirmation dialogs in UI callers.
5. Preserve separate localStorage keys.
6. Preserve scene-change clearing behavior.

### Validation

- Reload restoration, scene changes, resets, deletions, role cleanup, enabled
  filtering, and limits match the storage contract.
- Submitted payloads match Phase 0 fixtures.
- Manual checklist covers all four pages.

### Suggested commit

`refactor(drafts): consolidate scene antenna state`

## Work Unit 6A: Split `ApiPages.jsx` by Page

### Current behavior

Coverage, RSRP, SINR, and Throughput pages share a single module.

### Structural improvement

Move each page and only its private helpers into a domain file. Leave genuinely
shared helpers in the original module temporarily or move them to a clearly named
shared module.

### Recommended order

1. Coverage Map.
2. RSRP.
3. SINR.
4. Throughput.

### Steps for each page

1. Add/confirm payload and rendering characterization tests.
2. Move the page without changing JSX, state initialization, or error strings.
3. Preserve the export from the old import boundary until all callers migrate.
4. Build and smoke the page before moving the next one.

### Validation

- Sionna/analytical readiness is unchanged.
- Queued and inline result presentation is unchanged.
- All payload fixtures and frontend checks pass.

### Suggested commit

`refactor(simulation-ui): split api pages by domain`

## Work Unit 6B: Extract Shared Simulation Form Primitives

### Current behavior

The split pages still share solver fields, propagation fields, role selection,
scene readiness, numeric inputs, and queue-aware request state.

### Structural improvement

Extract only primitives demonstrated to be identical after Unit 6A. Do not create
one result component driven by a large mode switch.

### Steps

1. Extract field components first.
2. Extract three-role selection/validation for SINR and Throughput.
3. Extract scene-readiness and queued-result state.
4. Keep Coverage, RSRP, SINR, and Throughput result views domain-specific.

### Validation

- Role initialization, uniqueness, stale cleanup, and Throughput tilt clamping
  retain exact behavior.
- Form accessibility labels and error messages remain unchanged.
- Frontend tests/build and page smoke checks pass.

### Suggested commit

`refactor(simulation-ui): extract shared form primitives`

## Work Unit 7A: Extract Backend Request Pipeline

### Current behavior

`backend/api/sinr.py` aligns solver dimensions, converts geographic antennas to
runtime positions, validates bounds, selects queue/inline execution, and logs
events before calling simulation services.

### Structural improvement

Move the shared preparation pipeline behind an internal service/dependency while
leaving all routes in place.

### Steps

1. Characterize all position and solver-bound errors.
2. Characterize queue versus inline behavior and event ordering.
3. Extract preparation without moving endpoints.
4. Keep exception-to-HTTP conversion identical.
5. Keep Sionna engine locking behavior identical.

### Validation

- API error, request schema, optimization execution, and business-event tests pass.
- OpenAPI digest remains unchanged.
- Smoke one analytical inline and one database-backed queued request.

### Suggested commit

`refactor(api): extract simulation request pipeline`

## Work Unit 7B: Split Backend Routers by Resource

### Current behavior

`backend/api/sinr.py` owns simulations, optimization, jobs, History, scenes, and
offline buildings under one authenticated router.

### Structural improvement

Create routers for simulations, optimization, jobs, History, and scenes/offline
buildings while preserving the complete OpenAPI contract.

### Steps

1. Record the OpenAPI digest immediately before editing.
2. Move one route group at a time.
3. Preserve endpoint function names if they contribute to operation IDs.
4. Preserve router tags, dependencies, parameter aliases/defaults, status codes,
   and response classes.
5. Mount all routers under the existing `/api/v1` prefix.
6. After each group, run the OpenAPI contract test.

### Validation

- OpenAPI digest remains exactly unchanged.
- API, auth, History, job, scene, logging, and optimization tests pass.
- Full Docker health check passes.

### Stop conditions

If the digest changes, inspect the normalized OpenAPI diff. Do not update the
digest in a structural refactor.

### Suggested commit

`refactor(api): split routers by resource`

## Work Unit 8A: Extract Serialization and Time Helpers

### Current behavior

Generic JSON normalization and datetime serialization live in the History store
and are imported by unrelated services.

### Structural improvement

Move pure serialization/time helpers into a neutral module. Keep function
signatures and results unchanged.

### Steps

1. Inventory every import from `simulation_store.py`.
2. Identify only helpers with no History-specific persistence behavior.
3. Add direct unit tests for nested JSON values, datetimes, UUIDs, NaN/Infinity,
   and database JSON values.
4. Move helpers and update imports.
5. Do not move artifact or database operations yet.

### Validation

- Store, job, notification, report, and configuration tests pass.
- Stored JSON fixture outputs remain identical.

### Suggested commit

`refactor(storage): extract serialization utilities`

## Work Unit 8B: Extract Artifact Storage Helpers

### Current behavior

History and queue stores share safe path resolution, heavy-result decisions,
artifact writes, URL handling, summarization, and deletion helpers.

### Structural improvement

Create a neutral artifact module while preserving separate queue and History
lifecycles.

### Steps

1. Add direct tests for path traversal rejection and static-root containment.
2. Add tests for atomic writes and replacement.
3. Add tests for heavy-result thresholds and summaries.
4. Add tests for public URL-to-file resolution and deletion.
5. Move one helper family at a time.
6. Do not merge `simulation_job_store` and `simulation_store`.

### Validation

- Queue save/delete and History delete semantics remain unchanged.
- Existing store suites and full backend suite pass.
- Smoke one queued result saved to History, then delete the queue entry and verify
  History remains.

### Suggested commit

`refactor(storage): centralize artifact handling`

## Work Unit 8C: Separate Pure Job Policy from Persistence

### Current behavior

`simulation_job_store.py` mixes retry delay, transition decisions, serialization,
leases, cancellation, and SQLAlchemy operations.

### Structural improvement

Extract only deterministic retry/transition policy. Keep transaction boundaries,
row locking, and lease-owner checks in the repository/service layer.

### Steps

1. Characterize every allowed status transition.
2. Characterize retry classification, delays, limits, and terminal states.
3. Extract pure functions without changing database queries.
4. Do not restructure worker execution in this unit.

### Validation

- Reliability, job-store, optimization execution, and Impact Study tests pass.
- Expired leases, stale owners, cancellation, and retries retain exact behavior.

### Suggested commit

`refactor(queue): extract deterministic job policy`

## Work Unit 9: Split Optimization Internals

### Current behavior

Optimization is deterministic and combines search orchestration with pure
candidate, objective, ranking, diversity, and result helpers.

### Structural improvement

Split pure policy from orchestration without altering the algorithm.

### Required extraction order

1. Parameter domains and candidate identity.
2. Objective evaluation and ranking.
3. Halton/global candidates and anchors.
4. Beam diversity and local neighbors.
5. Progress and final result assembly.

### Steps

1. Create fixed-input golden tests before each extraction.
2. Move one helper family at a time.
3. Preserve iteration order, stable ties, unrounded KPI ranking, budget accounting,
   and stop conditions.
4. Keep `run_network_coverage_optimization` as the orchestration boundary.
5. Do not edit `simulation_worker.py` except import paths if unavoidable.

### Validation

- Same candidate order, winner, KPI values, target outcomes, counts, stop reason,
  beam width, and rounds for fixed inputs.
- Full optimization and worker execution tests pass.

### Suggested commit

`refactor(optimization): separate search policy modules`

## Work Unit 10: Split Impact Study Responsibilities

### Current behavior

Impact Study creation, starting, cancellation, reconciliation, comparison
triggering, optimization, and suggested configuration creation share one service.

### Structural improvement

Extract responsibilities behind the existing service API without changing
persistence or the active policy-v1 compatibility path.

### Extraction order

1. Suggested-configuration creation.
2. Reconciliation and terminal summary assembly.
3. Start/cancel lifecycle helpers.
4. Comparison/optimization triggering boundaries.

### Steps

1. Run all Impact Study, comparison, report, notification, and optimization tests.
2. Move one responsibility at a time.
3. Preserve transaction scopes, row locks, uniqueness constraints, signatures,
   and idempotency.
4. Do not migrate durable creation to policy-v2.

### Validation

- Idempotent start, partial failure, cancellation, report reuse, terminal
  notification uniqueness, and suggested-draft idempotency remain unchanged.
- OpenAPI digest remains unchanged.

### Suggested commit

`refactor(impact): separate study lifecycle services`

## Work Unit 11A: Decompose `Scene3DPreview.jsx`

### Current behavior

The component owns Three.js lifecycle, camera, antennas, result overlays, links,
RSRP users, interaction, loading, and cleanup.

### Structural improvement

Extract pure visual adapters first, then isolate imperative renderer subsystems.

### Extraction order

1. Pure scene/result-to-visual-model adapters.
2. Antenna marker creation/update/disposal.
3. Coverage/result overlays.
4. Links and RSRP user layers.
5. Camera controls.
6. Renderer/scene lifecycle orchestration.

### Steps

1. Add tests for pure visual models.
2. Capture representative screenshots for top/3D views and result types.
3. Move one subsystem per commit.
4. Keep resource ownership explicit.
5. Verify each Three.js resource is disposed exactly once.
6. Do not change visual styling, camera defaults, or interaction behavior.

### Validation

- Screenshot/manual parity for antennas, grids, links, users, hover, selection,
  loading, and scene changes.
- Frontend lint, tests, and build pass.

### Suggested commit

`refactor(visualization): separate threejs preview subsystems`

## Work Unit 11B: Decompose `SceneChooserModal.jsx`

### Current behavior

The scene chooser owns MapLibre lifecycle, PMTiles building regions, drawing,
antenna import, preview creation/cleanup, and keep/load actions.

### Structural improvement

Separate map/resource lifecycle from drawing, import, and presentation.

### Extraction order

1. Region selection and layer/source naming helpers.
2. Building-region load/unload controller.
3. Area drawing state and geometry validation.
4. Antenna import panel.
5. Preview card and keep/load actions.
6. Page-level orchestration.

### Steps

1. Add tests for pure region and geometry helpers.
2. Capture the current scene-chooser smoke path.
3. Move one responsibility at a time.
4. Preserve zoom thresholds, bounds, size limits, imported-antenna filtering,
   preview cleanup, and error messages.
5. Verify MapLibre listeners, sources, and layers are removed exactly once.

### Validation

- Draw/clear, region load/unload, import before/after drawing, preview, cancel,
  keep, load, expiry, and cleanup pass the smoke checklist.
- Frontend checks/build pass.

### Suggested commit

`refactor(scenes): separate scene chooser subsystems`

## Final Cleanup Review

After Work Unit 11B:

1. Run the full backend suite.
2. Run frontend lint, tests, and build.
3. Run the complete OpenAPI contract test.
4. Run the full Docker smoke checklist.
5. Re-run dead-code analysis and classify remaining findings.
6. Update module size/ownership measurements in
   `docs/codebase-cleanup-plan.md`.
7. Update AGENTS.md with final module ownership and paths.
8. Confirm no migration-only tasks were accidentally included.
9. Create a final summary comparing the Phase 0 baseline with the final state.

## Handoff Report Template

Use this after every work unit:

```markdown
## Work unit completed

<number and name>

## Current behavior preserved

<observable behavior protected by this change>

## Structural improvement

<what moved, was deleted, or became a single source of truth>

## Files changed

- <file and purpose>

## Validation

- `<command>`: <result>
- OpenAPI: unchanged / not applicable
- Frontend payload/storage fixtures: unchanged / not applicable
- Manual smoke: <path exercised>

## Deferred findings

- <finding and the work unit or separate migration that owns it>

## Suggested commit message

`<type(scope): summary>`
```
