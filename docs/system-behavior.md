# Current System Behavior

This document is a short orientation to major product flows and runtime
boundaries. It is not a second feature specification. Source code, tests, and
the focused documents listed in `README.md` remain authoritative. Small feature
changes normally should not require an edit here.

## Scenes and Navigation

- There is no built-in default scene. After authenticating, users land on
  `/network` when a persisted work scene is active, otherwise on `/scenes`,
  where they explicitly select an imported scene or create one at
  `/choose-scene`.
- Simulation, History, configuration, profile, optimization, and antenna routes
  are gated by the selected work scene where applicable. Change scene confirms,
  clears the persisted active scene via `DELETE /api/v1/scenes/active`, clears
  frontend work-scene state, and returns to `/scenes`. Signing out also clears
  the persisted active scene. Reloading the browser without changing or signing
  out keeps the active scene.
- The scene chooser uses an offline Vietnam MapLibre/PMTiles map. With a database,
  province and ward search uses the authenticated Vietnam admin API and persisted
  PostGIS boundaries. Without a database, manual area drawing remains available.
- Kept ward scenes retain validated GeoJSON boundary metadata for shared 3D
  previews. Manual drawing or choosing a new area clears the ward overlay and any
  untouched auto-generated scene name.
- Imported scene bounds allow up to 5000 m in width and height. Solver cell size
  is an integer from 2 to 50 meters and is not increased automatically for
  large scenes.
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
  antennas; SINR and Throughput require one transmitter antenna and one receiver
  point, while an interferer antenna is optional.
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
- Queue and History keep immutable submitted snapshots.

## Network Coverage Optimization

- `/network/optimization` runs a deterministic global-plus-local search through
  `POST /api/v1/optimizations/network-coverage/run`.
- A run snapshots the active scene and request, evaluates a fresh baseline, and
  searches legal antenna adjustments within a bounded simulation budget.
- Objectives, guardrails, resumable progress, ranking, result comparisons, and
  reports are part of the optimization flow. Their detailed behavior and result
  shape are owned by `backend/services/optimization_service.py` and its targeted
  tests; do not mirror algorithm details in this overview.

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
