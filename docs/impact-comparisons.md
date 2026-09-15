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
- Network Coverage averages plus nearest-rank P10, P50, and P90 values for RSRP,
  SINR, and throughput when the grid contains those measurements;
- `improved`, `unchanged`, or `degraded` for each KPI;
- `passed`, `failed`, or `not_configured` for each objective;
- paired-grid counts for newly covered, lost coverage, improved SINR, and
degraded SINR cells when full grid results are available.

Network Coverage KPI calculations are shared with optimization. RF threshold
area helpers count every scene cell in the denominator; missing RSRP or SINR
fails the threshold, while missing throughput is treated as zero. RF percentiles
also include every scene cell, with missing RSRP or SINR ordered below finite
values. A percentile whose nearest-rank position is missing is unavailable.

Profiles are marked `pending`, `missing`, `failed`, `unavailable`, or
`incompatible` instead of being omitted when they cannot be compared. Grid
results must have matching dimensions and cell coordinates. SINR and throughput
results must use the same propagation model, and RSRP results must use compatible
user counts and random seeds when those values are present.

The same comparison is also returned in the normal Impact Study `summary` after
all child jobs reach a terminal state. A partial child failure preserves all
successful results and explains why the affected profile was not compared.

