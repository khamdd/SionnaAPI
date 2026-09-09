# Impact Study reports

Terminal Impact Studies have an authenticated, downloadable HTML report:

```text
GET /api/v1/impact-studies/{id}/report
```

The first request generates `static/impact-reports/{id}.html` atomically and
stores the authenticated API URL in the study's `report_url`. Later requests
reuse the same file, so generation is idempotent. The Docker backend mounts
`static/` from persistent application storage, allowing reports to remain
available after API restarts. If the database reference exists but the file is
missing, the endpoint rebuilds it from the immutable study snapshot and child
results.

Reports are available for completed, partially failed, cancelled, and failed
studies. Active studies return HTTP 409. Every report clearly states that its
values are simulated predictions rather than live-network measurements.

## Contents

The report includes study metadata, configuration versions, exact antenna
changes, planned/executed/skipped/failed simulations, KPI deltas, side-by-side
map slots, spatial changes, objective outcomes, optimization suggestions,
warnings, runtime metadata, and a final `pass`, `review`, `fail`, or `incomplete`
decision-support status.

When a simulation did not create a rendered map image, its map slot explicitly
says the artifact is unavailable. KPI and spatial grid comparisons remain in the
report. Partial reports name missing, failed, and cancelled child jobs rather
than silently excluding them.

The final status is conservative:

- `incomplete` when results are missing or the study did not complete cleanly;
- `fail` when the candidate or completed optimization misses an objective;
- `pass` when all configured objectives pass and no local spatial regression is
  detected;
- `review` when no objective decides the result or a local regression still
  requires engineering review.

