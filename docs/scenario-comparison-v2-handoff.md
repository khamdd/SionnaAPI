# Scenario Comparison v2 — Development Handoff

Updated: 2026-09-10

This document is a standalone implementation plan for continuing the Nationwide
Network Impact Playground from the current repository state. Treat it as project
context and a proposed sequence; the user's latest request always takes priority.

## How to use this handoff

Give this file to a new Codex chat and say:

> Read `AGENTS.md` and this handoff completely. Execute only the next unfinished
> slice, verify it, update both documents when architecture or workflow changes,
> do not commit, and give me the suggested commit message.

Do not implement the entire roadmap in one turn. Each slice below is intended to
be independently reviewable and commit-ready.

## User workflow being built

An engineer changes a network configuration. The application detects the changed
fields and affected antennas/area, determines which simulation types are relevant,
and builds a reviewable impact plan. Each side of the comparison is a complete
scenario:

```text
Baseline scenario  = Configuration A + Profile A
Candidate scenario = Configuration B + Profile B
```

The two configurations must be different. The two profiles may be the same or
different. A direct pair must use the same simulation type, but its radio, solver,
role, and sampling settings may differ intentionally. Each pair has one shared
objective list so both scenario results are judged against the same decision target.

The product is therefore a **scenario comparison**, not a controlled experiment
that always holds the profile constant. When profiles differ, the result represents
the combined effect of configuration and test-profile changes. The UI and report
must show both categories of change so that this is never hidden.

## Current repository state

At the time of this handoff:

- Git HEAD is `1feaebd feat(profiles): validate eligibility and remove unused camera inputs`.
- Slice work is intentionally left uncommitted so each completed step can be
  reviewed before the user commits it.
- The backend already has immutable network configurations, saved simulation
  profiles, configuration diffs, durable policy-v1-compatible Impact Studies,
  paired child jobs, KPI/spatial comparison, conditional coverage optimization,
  HTML reports, job reliability, Alembic migrations, and completion notifications.
- The frontend has `/configurations` and `/profiles` workflows.
- There is no Impact Preview or Impact Studies frontend workflow yet.
- Dry-run impact preview now uses `impact-policy-v2`, requires explicit ordered
  profile pairs, independently resolves both scenario requests, and returns
  stable pair IDs, profile snapshots/diffs, shared pair objectives, side-specific
  skips, and comparability warnings. It remains side-effect free.
- Durable Impact Study creation/execution and downstream comparison still assume
  one profile is reused for both scenarios. Study creation temporarily uses an
  explicit policy-v1 compatibility entry point until Slice 3 migrates persistence.
- Profile eligibility now validates against an explicit caller-readable,
  same-scene configuration. The Profiles GUI defaults to the published version,
  also offers readable drafts and superseded versions, and describes enabled
  profiles as eligible for either scenario side.
- The unused camera request/profile field was removed before Slice 3. It never
  affected backend simulation; the interactive 3D camera remains frontend-only.
- Objectives were removed from reusable simulation profiles before Slice 3. The
  policy-v2 preview now accepts one shared objective list per pair; durable study
  persistence still needs to carry that list forward in Slice 3.
- Existing manual scene-first simulation pages and their browser localStorage
  drafts must remain unchanged.

## Remaining assumptions that must be replaced

The following durable-study behavior remains after Slice 2:

1. Child jobs are grouped by `simulation_profile_id` plus `scenario_role`.
2. Comparison groups jobs by one shared profile ID.
3. SINR/Throughput pairs with different propagation models, RSRP pairs with
   different sampling, and grids with different coordinates can currently make
   the whole pair incompatible.
4. Optimization and suggested-configuration endpoints identify work by the one
   shared profile ID.
5. Reports and durable-study docs imply the profile is constant across both sides.

Primary files containing these assumptions:

- `backend/schemas/configuration_impact.py`
- `backend/schemas/impact_studies.py`
- `backend/api/configuration_impact.py`
- `backend/api/impact_studies.py`
- `backend/services/impact_planner.py`
- `backend/services/impact_study_service.py`
- `backend/services/impact_comparison_service.py`
- `backend/services/impact_decision_service.py`
- `backend/services/impact_report_service.py`
- `backend/services/simulation_job_store.py`
- `backend/models.py`
- `docs/impact-*.md`

## Scenario-pair contract

Use an explicit list of profile pairs because one study may contain several
simulation types selected by the impact policy.

Proposed preview and study-create input:

```json
{
  "baseline_configuration_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "candidate_configuration_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  "profile_pairs": [
    {
      "baseline_profile_id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
      "candidate_profile_id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
      "objectives": [
        {
          "metric": "covered_area_percent",
          "operator": ">=",
          "target": 90
        }
      ]
    },
    {
      "baseline_profile_id": "dddddddd-dddd-dddd-dddd-dddddddddddd",
      "candidate_profile_id": "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
    }
  ]
}
```

`ImpactStudyCreateRequest` continues to accept `optimization_policy` in addition
to these fields.

Contract rules:

- Require at least one and at most 20 profile pairs.
- Configuration IDs must differ, be readable, belong to the same ready scene,
  and have a material configuration difference.
- Both profiles in a pair must be readable, enabled, and belong to the same scene
  as the configurations.
- Both profiles in a pair must have the same `simulation_type`.
- The baseline and candidate profile IDs may be identical.
- Reject duplicate `(baseline_profile_id, candidate_profile_id)` tuples.
- Network Coverage pairs require one or two objectives with unique metrics.
- Other simulation types require no objectives until supported decision metrics
  are defined for them.
- Do not infer profile pairs by loading every enabled scene profile.
- Assign each accepted pair a stable `pair_id` in the saved plan. Use a UUID or a
  deterministic hash of the pair ordinal and selected IDs; never use one profile
  ID as the pair identity.
- Preserve the selection order for presentation. Do not rely on database query
  order.
- Return explicit validation and skip reasons per side.

Recommended planned-entry shape:

```json
{
  "pair_id": "...",
  "ordinal": 0,
  "simulation_type": "network_coverage",
  "baseline_profile": {
    "id": "...",
    "name": "Standard coverage",
    "template": {}
  },
  "candidate_profile": {
    "id": "...",
    "name": "Dense urban coverage",
    "template": {}
  },
  "profile_difference": {},
  "triggering_changes": [],
  "affected_antennas": [],
  "baseline_request": {},
  "candidate_request": {},
  "objectives": [],
  "comparability_warnings": [],
  "job_count": 2
}
```

The saved execution plan is the immutable audit snapshot. It must contain the
selected profile identities, templates, resolved requests, configuration hashes,
profile difference, objectives, and policy version. Editing a profile later must
not alter an existing preview converted into a study.

## Planning and compatibility semantics

### Automatic policy remains responsible for relevance

The user selects scenario inputs; the policy still decides whether each selected
profile pair needs to run and which antennas/area are affected.

- If the profiles are identical, apply the existing configuration-change rules.
- If the profiles differ in any simulation-affecting field, plan that pair even
  when the configuration change alone would normally be ignored by that model.
- For role-based simulations, determine affected roles from the union of baseline
  and candidate role antenna IDs.
- If a role exists only in one configuration or is disabled, return a side-specific
  skip reason instead of failing the whole preview.
- A changed analytical-model setting such as frequency, bandwidth, noise figure,
  or propagation model is itself a reason to run that pair.
- Continue returning `triggering_changes`, but distinguish
  `configuration_changes` and `profile_changes`.

### Profile difference

Add a deterministic profile-template diff service. Compare canonical JSON values
by field path and report before/after values. At minimum include:

- propagation model, frequency, bandwidth, MIMO, and noise figure;
- solver depth, samples, cell size, center, and size;
- user count, height, and random seed;
- antenna roles;
- base/target tilt fields;
- any other simulation-affecting template fields.

Equivalent numeric values and dictionary key order must not produce false changes.

### KPI and spatial compatibility are different

Different profiles are an intentional feature. Do not mark the entire result pair
incompatible merely because profile settings differ.

- Scalar KPI deltas remain comparable when the simulation type and KPI unit/schema
  match.
- Different propagation models should produce a visible methodology warning, not
  automatically suppress every scalar KPI delta.
- Different RSRP user counts or random seeds should produce a sampling warning.
- Different grid resolution, dimensions, or coordinates may disable cell-by-cell
  spatial comparison while preserving aggregate KPI comparison.
- Store a specific `spatial_unavailable_reason` when spatial grids cannot align.
- Mark a pair fully incompatible only when simulation types or result metric
  schemas cannot be compared meaningfully.

### Objective semantics

- Objectives belong to the Impact Study profile pair, not either reusable profile.
- Evaluate both baseline and candidate KPIs against the pair's same `objectives`
  list so the decision target remains fixed across the comparison.
- Network Coverage requires one or two objectives with unique metrics. Other
  simulation types currently carry no objectives until their metrics are defined.
- Raw KPI deltas do not depend on objectives.
- Baseline objective outcomes provide the starting context; candidate outcomes
  determine whether the proposed scenario meets the shared target.
- The final decision uses candidate outcomes plus the existing conservative
  spatial regression checks.
- If a future simulation type has no supported objectives, the result should be
  `review`, not `pass` based on an invented threshold.

## Profile lifecycle adjustment

Implemented in Slice 2.

Candidate profiles may reference antennas that exist only in a draft configuration.
Therefore, a profile cannot be enabled exclusively against the active published
configuration.

Implemented behavior:

- Change profile enablement so the caller supplies a readable
  `configuration_id` used for validation.
- Default the Profiles GUI validation selector to the published configuration,
  but allow selecting a readable draft or superseded version.
- Continue validating again against the actual selected configuration during
  preview; prior enablement is not a substitute for scenario validation.
- If simulation-affecting fields of an enabled profile are edited, require it to
  be disabled first or atomically return it to disabled. Prefer the explicit
  disable-first workflow so state changes are visible.
- Rename “enabled run stack” language to “eligible profiles.” Enabled means the
  profile is valid and available for selection, not that it is automatically used
  on both sides of every comparison.
- Remove copy claiming settings are shared by baseline and candidate requests.
- Keep shared enabled profiles read-only for non-owners.

Do not add organization-wide administrator roles in this refactor. Formal
system-default governance can be added later. The first Impact Preview UI may
preselect the same compatible enabled profile on both sides, remember the user's
last selections per scene, and always allow either side to be changed.

## Ordered implementation slices

### Slice 1 — Scenario-pair schemas and planner v2

Status: **complete (2026-09-09)**

Implemented:

- Added reusable `ImpactProfilePairRequest` input and required one to 20 unique
  explicit pairs on the public preview request.
- Added deterministic recursive profile-template comparison with stable field
  paths and canonical numeric handling.
- Added policy-v2 explicit-pair loading, visibility/scene/enabled/type validation,
  independent request resolution, stable pair IDs, side-specific skips,
  profile/configuration trigger separation, union role handling, and preview
  comparability warnings. The initial side-specific objective snapshot was later
  replaced by the shared-objective correction gate below.
- Kept durable study creation on a named policy-v1 compatibility entry point;
  pair-keyed study persistence remains exclusively Slice 3 work.

Verification:

- Focused planner/profile-diff suite: 33 passed.
- Existing Impact Study/comparison/optimization/report compatibility suite:
  31 passed.
- Full backend suite: 262 passed and three unrelated pre-existing schema-drift
  failures remain in `test_rsrp_service.py` (two) and `test_scene_service.py`
  (one); those tests still submit the now-forbidden antenna `position` field.
- `git diff --check` passed (line-ending conversion warnings only).

Goal: make dry-run preview accept explicit profile pairs and build each scenario
with its selected configuration and profile. Do not create jobs in this slice.

Work:

- Add profile-pair request schemas shared by preview and study creation.
- Change the preview API/service signature to accept `profile_pairs`.
- Load only explicitly selected profiles with existing visibility rules.
- Validate scene, enabled state, pair uniqueness, and matching simulation types.
- Add deterministic profile-template comparison.
- Build baseline request using Configuration A + Profile A.
- Build candidate request using Configuration B + Profile B.
- Update applicability logic for profile changes and the union of role antennas.
- Bump the policy identifier to `impact-policy-v2`.
- Return the v2 planned/skipped shape with `pair_id`, both profile snapshots,
  pair objectives, profile diff, and warnings.
- Update `test/test_impact_planner.py` and add focused profile-diff tests.
- Update `docs/impact-planning.md` and `AGENTS.md`.

Acceptance criteria:

- Same profile on both sides remains valid.
- Different same-type profiles produce two independently resolved requests.
- Different simulation types are rejected clearly.
- Profiles from another scene or without visibility are rejected.
- Duplicate pairs are rejected.
- Profile-only settings changes trigger a run even when that model ignores the
  antenna change.
- Preview remains dry-run and creates no jobs or study rows.
- Existing manual simulation tests remain unchanged.

Suggested commit message:

```text
refactor(impact): plan explicit scenario profile pairs
```

### Slice 2 — Profile validation against selectable configurations

Status: **complete (2026-09-09)**

Implemented:

- The enable-profile endpoint now requires a `configuration_id` and validates
  against that readable, same-scene configuration instead of implicitly loading
  the published version.
- Published and superseded versions are readable validation targets; drafts are
  valid only for their creator. The response records the configuration identity
  used for successful validation.
- Profiles are created disabled. Eligible profiles reject simulation-type or
  request-template edits until explicitly disabled; name-only edits remain valid.
- The Profiles GUI defaults its compact validation selector to the published
  configuration, exposes all readable versions, supplies the selected version's
  antennas to role editing, and consistently uses eligible-profile language.
- Preview behavior remains authoritative and revalidates each selected profile
  against the actual scenario configuration. Manual simulation localStorage keys
  and drafts were not changed.

Verification:

- Focused profile/planner/profile-diff suite: 55 passed.
- Frontend production build passed; the existing large-chunk warning remains.
- Full backend suite: 271 passed and the same three unrelated schema-drift
  failures remain in `test_rsrp_service.py` (two) and `test_scene_service.py`
  (one); those tests still submit the forbidden antenna `position` field.

Goal: make candidate-specific profiles eligible without requiring their role
antennas to exist in the published baseline.

Work:

- Add a configuration ID to the enable-profile request.
- Validate the profile against that readable same-scene configuration.
- Define and test the enabled-profile edit rule.
- Update the Profiles GUI with a validation-configuration selector.
- Change “run stack” wording to “eligible profiles.”
- Update API documentation and frontend API wrappers.

Acceptance criteria:

- A profile referencing a draft-only antenna can be enabled against that draft.
- It still fails clearly when paired with an incompatible configuration.
- The current published configuration remains the default GUI validation target.
- Existing browser simulation drafts remain untouched.

Suggested commit message:

```text
feat(profiles): validate eligibility against selected configurations
```

### Cleanup gate — Remove unused camera inputs

Status: **complete (2026-09-09)**

Implemented:

- Removed `CameraConfig` and camera fields from Coverage and Network Coverage
  request schemas.
- Removed camera values from manual frontend payloads, defaults, simulation
  profile templates, required-field validation, profile editing, and examples.
- Kept the interactive Three.js scene camera because it is frontend view state,
  not a simulation input.
- Existing stored profile templates containing `camera` are intentionally not
  migrated; they can be recreated under the corrected contract.

Verification:

- Focused request/profile/planner/coverage suite: 79 passed.
- Frontend production build passed; the existing large-chunk warning remains.
- Full backend suite: 272 passed and the same three unrelated schema-drift
  failures remain in `test_rsrp_service.py` (two) and `test_scene_service.py`
  (one).

Suggested commit message:

```text
refactor(simulation): remove unused camera inputs
```

### Correction gate — Move objectives from profiles to study pairs

Status: **complete (2026-09-10)**

Implemented:

- Removed objective editing, readiness checks, defaults, and summaries from the
  Simulation Profiles UI.
- Profile create/update and service validation now reject `objectives`; request
  construction no longer includes them.
- Added one shared `objectives` list to each policy-v2 profile pair. Network
  Coverage requires one or two unique coverage objectives; other simulation
  types currently accept none.
- Planned and skipped entries retain their pair objectives without embedding
  thresholds in either profile snapshot. Both scenario results will be evaluated
  against this one target during pair-aware comparison.
- Preserved policy-v1 durable-study compatibility while keeping legacy stored
  objective fields out of v2 profile snapshots and diffs.

Verification:

- Focused profile/planner/profile-diff suite: 61 passed.
- Existing Impact Study/comparison/optimization/report/notification compatibility
  suite: 41 passed.
- Frontend production build passed; the existing large-chunk warning remains.
- Full backend suite: 277 passed and the same three unrelated schema-drift
  failures remain in `test_rsrp_service.py` (two) and `test_scene_service.py`
  (one); those tests still submit the forbidden antenna `position` field.

Suggested commit message:

```text
refactor(impact): move objectives to impact pairs
```

### Slice 3 — Durable v2 study jobs and migration

Status: **next**

Goal: persist and execute explicit profile pairs idempotently.

Recommended persistence change:

- Add nullable `impact_profile_pair_id` to `simulation_jobs` in Alembic revision
  `0007`.
- Backfill existing Impact Study jobs with their legacy `simulation_profile_id`.
- Replace `uq_simulation_jobs_impact_profile_role` with uniqueness on
  `(impact_study_id, impact_profile_pair_id, scenario_role)`.
- Keep `simulation_profile_id`; each child job stores the actual profile used by
  that scenario.
- Require a pair ID for new impact-study jobs while continuing to read legacy
  studies whose plan contains one `profile_id`.
- Include pair ID and the correct side's profile ID/template in input signatures.

Work:

- Update study creation to pass explicit pairs into planner v2.
- Save the complete immutable v2 execution plan, including each pair's shared
  objectives.
- Create baseline jobs with baseline profile IDs and candidate jobs with candidate
  profile IDs.
- Group and serialize jobs with `impact_profile_pair_id`.
- Preserve row locking and idempotent start behavior.
- Keep legacy studies readable and reportable.
- Add migration, offline SQL, clean-database upgrade, and targeted study tests.

Acceptance criteria:

- One baseline and one candidate job exist per planned pair.
- Repeating start creates no duplicates.
- The same baseline profile may participate in multiple different pairs.
- Each child request and profile ID matches its scenario side.
- Old studies with no pair ID still reconcile successfully.

Suggested commit message:

```text
refactor(impact): persist paired scenario execution
```

### Slice 4 — Pair-aware comparison, decisions, optimization, and reports

Goal: make every downstream consumer understand different profiles.

Work:

- Group child jobs by `impact_profile_pair_id`, with legacy fallback.
- Separate scalar-KPI comparability from spatial-grid comparability.
- Add profile methodology and sampling warnings.
- Return both profile identities, profile diff, and both scenarios' outcomes
  against the shared pair objectives.
- Update final decision logic to use the candidate's outcomes against the shared
  pair objectives.
- Key conditional Network Coverage optimization by pair ID and use the candidate
  request/profile with the pair objectives.
- Add a pair-keyed suggested-configuration endpoint. Keep the profile-keyed route
  as a documented legacy route until old studies no longer need it.
- Update all 12 report sections to display Scenario A and Scenario B inputs,
  configuration changes, profile changes, warnings, and shared objectives with
  each scenario's outcome.
- Keep terminal notifications one per parent study.
- Update comparison, optimization, report, notification, and API tests.

Acceptance criteria:

- Different solver grids still compare aggregate KPIs and explain unavailable
  spatial deltas.
- Different propagation models show warnings rather than losing all KPI deltas.
- Candidate optimization uses only candidate-side settings while measuring
  success against the shared pair objectives.
- Reports never imply the profile was held constant when it was not.
- Partial failures and missing jobs remain explicit.

Suggested commit message:

```text
feat(impact): compare and report complete scenarios
```

### Slice 5 — Impact Preview GUI

Goal: provide the first end-to-end scenario planning interface without submitting
jobs until the engineer confirms.

Use the existing quiet operational visual language and the frontend-design skill.

Workflow:

1. Select baseline configuration.
2. Select candidate configuration; prevent the same version and show the exact
   configuration diff.
3. Display simulation types affected by configuration and profile changes.
4. Add one or more profile-pair rows.
5. Set the shared objectives for each Network Coverage pair.
6. Preselect compatible profiles where possible; allow same or different choices.
7. Show profile differences and compatibility warnings per pair.
8. Call dry-run preview and show planned, skipped, affected antennas/area, and
   estimated job count.
9. Creating a study is a separate explicit action.

Add frontend API functions for preview and study creation. Keep unsaved selector
state scene-scoped and separate from all manual simulation localStorage keys.

Acceptance criteria:

- No preview action queues simulations.
- Incompatible choices are prevented or explained before submission.
- Both configuration and profile changes are visible.
- Zero-job previews explain why nothing will run.
- Keyboard, mobile, loading, empty, and failure states are usable.
- `npm run build` passes.

Suggested commit message:

```text
feat(frontend): add scenario impact preview workflow
```

### Slice 6 — Impact Studies GUI

Goal: start, monitor, cancel, review, and download reports for durable studies.

Work:

- Add an Impact Studies route and scene-scoped list.
- Show plan summary before start and require explicit confirmation.
- Show parent and child progress grouped by profile pair.
- Link child jobs to the existing Simulation Queue without duplicating controls.
- Confirm cancellation and preserve completed child results.
- Present KPI deltas, warnings, spatial availability, objectives, decision status,
  optimization suggestions, and report download.
- Never auto-publish an optimized configuration.

Suggested commit message:

```text
feat(frontend): add impact study execution and review
```

### Slice 7 — Notification GUI

Goal: expose the already-built completion notifications.

Work:

- Add unread badge, notification panel/list, mark-read behavior, and navigation to
  the related study.
- Stay silent for child jobs and cancelled studies.
- Preserve authentication and user scoping.

Suggested commit message:

```text
feat(frontend): add impact study notifications
```

## Nationwide expansion after the corrected local workflow

Do not begin these milestones until Slices 1–7 work for one existing scene.

### Slice 8 — Vietnam map as the impact workspace

- Make the offline Vietnam map the primary nationwide planning surface.
- Add configuration-aware antenna layers, clustering, filters, selection, and
  baseline/candidate visual states.
- Keep scene creation and current simulation routes available.

### Slice 9 — Nationwide antenna inventory and viewport queries

- Move beyond static scene metadata for operational-scale antenna inventory.
- Add paginated/viewport APIs backed by PostgreSQL/PostGIS spatial indexes.
- Define bulk import validation, duplicate handling, and audit provenance.
- Never load the full nationwide inventory into the browser at once.

### Slice 10 — Affected-area planning

- Convert changed antennas and propagation assumptions into buffered affected
  geometry.
- Intersect geometry with versioned simulation tiles/scenes.
- Preview selected tiles, gaps, estimated compute, and reasons.
- Keep the policy versioned and deterministic.

### Slice 11 — Versioned local Sionna scene catalog

- Catalog scene/tile geometry, source version, generated assets, bounds, and
  readiness.
- Detect missing/stale tiles before study start.
- Add controlled generation and validation rather than silently substituting a
  different scene.

### Slice 12 — Multi-tile execution

- Expand each profile pair into baseline/candidate jobs per affected tile.
- Preserve pair, tile, configuration, and profile identities in signatures.
- Keep retries, leases, cancellation, priority, and partial-success behavior.
- Aggregate parent progress without hiding failed tiles.

### Slice 13 — Spatial aggregation and overlays

- Normalize tile results into nationwide overlay products.
- Handle borders, overlap, resolution differences, and missing tiles explicitly.
- Provide map layers for baseline, candidate, delta, lost coverage, gained
  coverage, and uncertainty/unavailable regions.

### Slice 14 — Durable object storage and access control

- Move large study artifacts behind authenticated object storage or signed access.
- Keep PostgreSQL summaries small and auditable.
- Define retention, cleanup, ownership, and recovery policies.

### Slice 15 — Measured-data shadow pilot

- Compare simulated changes with a controlled set of measured network data.
- Calibrate thresholds and uncertainty without feeding measurements silently into
  historical results.
- Keep the product labeled as simulation-based decision support.

## Cross-cutting constraints

- Do not commit for the user. Leave changes uncommitted and provide only a
  suggested commit message.
- Every user-facing delete action requires confirmation.
- Do not migrate, delete, or overwrite browser drafts silently.
- Preserve manual simulation APIs and pages.
- Keep configurations immutable and never auto-publish drafts or optimization
  suggestions.
- Preview endpoints must remain side-effect free.
- Use PostgreSQL/PostGIS for durable and spatial state; keep heavy grids and
  rendered artifacts outside PostgreSQL.
- All new database changes require Alembic migrations and upgrade verification.
- Keep APIs authenticated and enforce existing draft/profile visibility.
- Store exact configuration hashes, profile snapshots, policy versions, requests,
  and input signatures for reproducibility.
- Prefer explicit unavailable/skip/warning states over silent omission.
- Update `AGENTS.md` whenever routes, services, persistence, or workflows change.
- Run focused backend tests, then the full backend suite when practical.
- Run `npm run build` for frontend changes.
- Full Sionna runs are hardware-dependent and are not ordinary unit-test gates.

## Definition of the corrected foundation

The architecture correction is complete only when all of the following are true:

- A preview and study accept explicit baseline/candidate profile pairs.
- The same profile or two different compatible profiles can be selected.
- Each child job uses the correct scenario-side profile.
- Jobs and comparisons are grouped by pair ID rather than a shared profile ID.
- Profile and configuration differences are both visible and snapshotted.
- Aggregate KPIs survive reasonable profile-method differences with warnings.
- Spatial comparison can be unavailable without invalidating aggregate KPIs.
- Shared pair objectives are evaluated and labeled for both scenarios.
- Optimization uses the candidate scenario only.
- Legacy studies remain readable.
- The Profiles GUI no longer implies one profile is automatically shared by both
  scenarios.
- The Impact Preview GUI can review the plan without submitting work.

After this definition is met, continue with the Impact Studies GUI and then the
nationwide spatial-execution milestones.
