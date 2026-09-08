# Impact comparisons

Completed Impact Studies compare each successful baseline/candidate child-job
pair using normalized KPIs. The result is stored under `summary.comparison` on
the existing `impact_studies` row; complete grid data remains in the child-job
result artifacts and is not duplicated in PostgreSQL.

## API

`GET /api/v1/impact-studies/{id}/comparison` requires authentication and returns:

- the parent study ID and current status;
- one comparison entry per planned simulation profile;
- baseline value, candidate value, absolute delta, and a percentage delta where
  a relative change is meaningful;
- `improved`, `unchanged`, or `degraded` for each KPI;
- `passed`, `failed`, or `not_configured` for each objective;
- paired-grid counts for newly covered, lost coverage, improved SINR, and
  degraded SINR cells when full grid results are available.

Profiles are marked `pending`, `missing`, `failed`, `unavailable`, or
`incompatible` instead of being omitted when they cannot be compared. Grid
results must have matching dimensions and cell coordinates. SINR and throughput
results must use the same propagation model, and RSRP results must use compatible
user counts and random seeds when those values are present.

The same comparison is also returned in the normal Impact Study `summary` after
all child jobs reach a terminal state. A partial child failure preserves all
successful results and explains why the affected profile was not compared.

