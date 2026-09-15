# Current System Behavior

This document records high-value feature and runtime context that is too specific
for the root `AGENTS.md`. Source code and focused contract documents remain the
authority; verify them before making behavior changes.

## Scenes and Navigation

- There is no built-in default scene. Users authenticate, land on `/scenes`, and
  explicitly select an imported scene or create one at `/choose-scene`.
- Simulation, History, configuration, profile, optimization, and antenna routes
  are gated by the selected work scene where applicable. Change scene confirms,
  clears frontend work-scene state, and returns to `/scenes`.
- The scene chooser uses an offline Vietnam MapLibre/PMTiles map. With a database,
  province and ward search uses the authenticated Vietnam admin API and persisted
  PostGIS boundaries. Without a database, manual area drawing remains available.
- Kept ward scenes retain validated GeoJSON boundary metadata for shared 3D
  previews. Manual drawing or choosing a new area clears the ward overlay and any
  untouched auto-generated scene name.
- Imported scene bounds allow up to 5000 m in width and height. Solver workload is
  protected by `MAX_GRID_CELLS`, which increases cell size for large scenes.
- Scene registry metadata is stored in `static/scenes/scenes.json`; database scene
  rows are minimal references for persisted results. Preview scenes expire and
  are cleaned up when not kept.
- Offline building data lives under `frontend/public/data/`. Regional PMTiles are
  loaded at high zoom and are intentionally excluded from Git.

## Simulations, Queue, and History

- Supported simulation types are `network_coverage`, `coverage_map`,
  `rsrp_simulation`, `sinr`, and `throughput_comparison`.
- With PostgreSQL/PostGIS configured, simulations become durable jobs processed by
  `backend/services/simulation_worker.py`. Without it, supported calls run inline.
- Completed queue results remain temporary until the user explicitly saves them
  to History. Removing a queue entry must not remove an already-saved History run.
- Heavy queue and History payloads are stored as JSON artifacts under distinct
  `static/` directories while database rows retain summaries and references.
- History is scoped to the current work scene and supports detail, compatible
  comparisons, and confirmed single or bulk deletion.
- Simulation positions are validated against active scene solver bounds. Coverage
  uses one inventory antenna; Network Coverage and RSRP accept up to ten enabled
  antennas; SINR and Throughput require distinct transmitter, receiver, and
  interferer roles.
- SINR and Throughput support Sionna, UMa, Ericsson, and Friis. Analytical models
  bypass 3D scene loading and do not use tilt; Sionna uses ray tracing.
- Queue retry, lease, heartbeat, cancellation, and failure rules are documented in
  `simulation-job-reliability.md`.

## Antennas and Network Configuration

- `/antennas` is the global PostgreSQL-backed inventory with globally unique IDs,
  search, add/edit, archive/restore, and XLSX preview/import.
- Simulation pages choose active in-scene inventory antennas. Identity, geographic
  position, and height stay linked to inventory; enabled state, radio controls,
  azimuth, and roles are scene-scoped request overrides.
- Scenes with saved fixed antennas use them unchanged. Scenes without them begin
  with an empty antenna list; do not restore old defaults or scale antennas to fit.
- Network configuration versions persist ordered inventory references and resolve
  current inventory values. Archived or out-of-scene references make a version
  unavailable. Queue and History keep immutable submitted snapshots.
- Configuration and profile lifecycle rules are documented in
  `network-configurations.md`, `configuration-differences.md`, and
  `simulation-profiles.md`.

## Network Coverage Optimization

- `/network/optimization` runs a deterministic global-plus-local search through
  `POST /api/v1/optimizations/network-coverage/run`.
- A run snapshots the active scene and Network Coverage request, simulates a fresh
  baseline, holds solver settings fixed, and searches legal tilt, power, and
  azimuth values within a user budget of 1 to 5000 simulations.
- Small discrete spaces are exhaustive. Larger spaces use deterministic
  space-filling candidates, diverse beam selection, and local refinement.
- Ranking first favors satisfying all objectives, then normalized total shortfall,
  then fewer failed objectives. It uses unrounded KPI values and preserves the
  earlier setup on exact ties.
- Network Coverage and Impact comparison share coverage, overlap, and RF KPI
  extraction. RF summaries include averages and nearest-rank P10/P50/P90 values
  for RSRP, SINR, and throughput; reusable threshold-area calculations support
  future RF objectives without changing the current optimization objective API.
- Progress is persisted between simulations. The frontend remembers the latest
  job per scene, resumes polling, rejects applying results to a changed draft, and
  saves the winning request/result as normal Network Coverage History.
- Core behavior and result shape live in
  `backend/services/optimization_service.py` and its targeted tests.

## Automation and Impact Studies

- Immutable network configurations, saved simulation profiles, dry-run impact
  planning, durable studies, comparisons, optional optimization, HTML reports,
  and notifications are separate but connected workflows.
- Decision objectives belong to a study profile pair, not to reusable profiles.
  Durable scenario-pair migration remains tracked in
  `scenario-comparison-v2-handoff.md`.
- Use the focused documentation: `network-configurations.md`,
  `simulation-profiles.md`, `impact-planning.md`, `impact-studies.md`,
  `impact-comparisons.md`, `impact-optimization.md`, `impact-reports.md`, and
  `notifications.md`.

## Observability and Persistence

- Elasticsearch/Kibana logging is optional and wired through the event logger,
  request-logging middleware, and observability setup module. Health checks are
  excluded from request logging.
- Docker uses a dedicated worker and shared static artifact storage. Host
  development defaults to an in-process worker.
- Database startup validates the Alembic head. Docker's one-shot migration service
  applies revisions before the API and worker; no-database mode skips this check.
- See `database-baseline.md` before changing migration adoption or PostGIS schema
  handling.
