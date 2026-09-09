# Impact studies

An impact study turns the configuration-impact preview into a durable,
database-backed workflow. It stores the baseline/candidate pair, policy version,
difference, execution plan, progress, and final child-job summary.

## API workflow

All endpoints require authentication.

1. `POST /api/v1/impact-studies` with `baseline_configuration_id` and
   `candidate_configuration_id` creates a study in `planned` state. It runs the
   existing planner but submits no jobs yet.
2. `POST /api/v1/impact-studies/{id}/start` creates one baseline and one candidate
   child job for every planned profile. Calling start again returns the existing
   jobs and does not duplicate them.
3. `GET /api/v1/impact-studies/{id}` returns the saved plan, summary, and linked
   child jobs. `GET /api/v1/impact-studies/{id}/comparison` returns the live
   normalized baseline/candidate comparison. `GET /api/v1/impact-studies` lists
   the current user's studies and accepts optional `scene_id`, `status`, and
   `limit` filters.
4. `POST /api/v1/impact-studies/{id}/cancel` cancels queued child jobs and marks
   running children for cooperative cancellation at the next safe checkpoint.
   The parent remains cancelled.
5. When the saved policy is `if_objectives_fail`, a failed candidate Network
   Coverage objective conditionally creates one linked optimization job. See
   [`impact-optimization.md`](impact-optimization.md).
6. `GET /api/v1/impact-studies/{id}/report` generates or downloads the stable
   HTML report after the study reaches a terminal state. See
   [`impact-reports.md`](impact-reports.md).

The child jobs also remain visible through the normal `/api/v1/simulation-jobs`
queue endpoints. Each carries `impact_study_id`, `simulation_profile_id`,
`scenario_role`, and a deterministic `input_signature`.

## Status and results

Studies move through `planned`, `queued`, `running`, `aggregating`, and
`completed`. If one or more children fail, the terminal state is
`completed_with_failures`; successful child results are retained and listed in
the summary. `cancelled` and `failed` are also terminal states.

The worker updates the parent after child completion. Reading or listing studies
also reconciles their state, so progress remains correct across API restarts.
After all children finish, `summary.comparison` stores normalized KPI deltas,
objective outcomes, and compatible spatial grid changes. See
[`impact-comparisons.md`](impact-comparisons.md). Policy v1 does not reuse an
earlier baseline job. HTML reports are generated idempotently on first download
and persist in application artifact storage.
