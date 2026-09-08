# Agent Project Brief

This file is the first stop for future AI agents working in this repository. Use it
to avoid rereading the entire project before every prompt. Keep it current when
you make meaningful architectural, API, UI, persistence, or workflow changes.

## Project Snapshot

- Product: Sionna Simulation Planner, a radio-network planning app.
- Backend: FastAPI in `backend/`, NVIDIA Sionna RT simulation services, SQLAlchemy
  ORM, optional PostgreSQL/PostGIS persistence, optional Elasticsearch logging.
- Frontend: React/Vite in `frontend/`, Leaflet/Three.js visual previews, plain CSS
  in `frontend/styles.css`.
- Tests: backend pytest suite in `test/`.
- Deployment: Docker Compose is the supported full-stack path. It starts frontend,
  backend, PostgreSQL/PostGIS, Elasticsearch, Kibana, and observability setup.
- Static/runtime data: generated scenes, previews, images, and large result JSON
  are stored under `static/` locally or the `application-static` Docker volume.
  These artifacts are intentionally not committed.

## What Has Already Been Built

- Authentication is implemented with register, login, token verification, and
  frontend session persistence.
- Main API routes are mounted under `/api/v1` from `backend/api/sinr.py` and
  `backend/api/auth.py`.
- Simulation types supported:
  - `network_coverage`
  - `coverage_map`
  - `rsrp_simulation`
  - `sinr`
  - `throughput_comparison`
- Simulation requests validate transmitter, receiver, interferer, and antenna
  positions against the active scene solver bounds.
- When a database is configured, simulations are queued as jobs and processed by
  `backend/services/simulation_worker.py`; without a database they run inline.
  Completed queued simulations remain in the Simulation Queue until a user
  explicitly saves the result to history.
- Simulation history is stored through `backend/services/simulation_store.py`.
  Heavy grid/user results are summarized in PostgreSQL and written as JSON files
  under `static/simulation-results/`.
- Simulation queue results are stored through
  `backend/services/simulation_job_store.py`. Heavy queued results are written as
  temporary JSON files under `static/simulation-job-results/` and are not history
  until the user saves them. Simulation Queue supports selecting individual
  deletable entries, selecting all non-running entries, and deleting the selected
  entries after confirmation. Running entries cannot be selected; saved History
  results remain when their queue entries are removed. Network Coverage result
  antenna snapshots show request longitude/latitude to four decimal places and
  label tilt/power as the current value plus its allowed range; internal scene
  positions remain available for Sionna and 3D rendering.
- History UI supports viewing details, preview loading state, deleting one or
  many saved runs, and comparing compatible successful runs. The history list is
  scoped to the currently selected work scene.
- Scene management supports listing, previewing, activating, and deleting
  imported scenes. There is no built-in default scene.
- Scene choosing now lives at `/choose-scene` as a full-page offline Vietnam map
  with a major-city dropdown, scene-name entry, area drawing, preview, and
  keep/load actions.
- The frontend flow is scene-first: after login and from `/`, users land on
  `/scenes`, choose an imported scene there, or use Create new scene to open
  `/choose-scene`. Activating or creating a scene moves users into Network
  Coverage with that scene as the shared simulation context. If no scenes exist,
  the selector shows "No scene found."
- Simulation/history routes are gated until the user explicitly chooses or
  creates a work scene in the current session. The top navbar does not expose
  Scenes as a normal tab; users return there from the username dropdown's Change
  scene action, and direct simulation URLs redirect back to `/scenes` when no
  work scene is selected.
- The Change scene action asks for confirmation, then clears the frontend work
  scene state before returning to `/scenes`.
- Imported scenes can be deleted from the scene selector even if the persisted
  registry still marks them active from an older session; deletion clears the
  backend active scene. Legacy Munich/default scene entries are removed when the
  scene registry is loaded.
- Imported scene previews are limited by count and size, expire while still in
  preview status, and are cleaned up if not kept.
- Imported scene bounds allow up to 5 km² and up to 5000 m width/height.
- The Choose scene modal uses a Docker-served offline MapLibre/PMTiles map from
  `frontend/public/data/` with `vietnam.pmtiles`, `building-regions.json`, and
  regional `vn-buildings-*.pmtiles` archives. At zoom 13.5+, visible 1-degree
  building regions are loaded as 3D fill-extrusion layers and unloaded when they
  leave the viewport. Large PMTiles assets are ignored by git but checked during
  the frontend Docker build.
- OpenStreetMap scene building exists in `backend/services/osm_scene_builder.py`
  and uses Overpass endpoints/timeouts from `backend/constants/scenes.py`.
- Observability is wired through `backend/services/event_logger.py`,
  `backend/middleware/request_logging.py`, `backend/observability_setup.py`, and
  Docker Elasticsearch/Kibana services.
- Dockerization and README setup instructions are already in place.
- Raw SQL has been converted to SQLAlchemy ORM models in `backend/models.py`.
- Immutable network configuration versions are stored in PostgreSQL through
  `backend/services/network_configuration_service.py`. Authenticated APIs can
  create/read drafts, publish them, list versions, and resolve a scene's active
  published configuration. Publishing supersedes the prior version; identical
  normalized content is rejected. Existing browser localStorage drafts remain
  unchanged until a later frontend migration. Published versions are shared for
  the project's shared scenes, while drafts are private to their creator.
- Saved simulation profiles are stored in PostgreSQL through
  `backend/services/simulation_profile_service.py`. Profiles keep explicit solver,
  radio, camera, objective, and role settings separate from antenna configuration
  versions. Enabling validates a profile against the scene's active published
  configuration and an existing Pydantic request model. Network Coverage and RSRP
  receive enabled configuration antennas; Coverage Map, SINR, and Throughput
  resolve saved antenna role IDs. Invalid role profiles return an explicit skip
  reason. Existing manual simulation requests and frontend localStorage remain
  unchanged.
- `backend/services/configuration_diff_service.py` compares two network
  configuration snapshots deterministically. It reports antenna additions,
  removals, and before/after changes for enabled status, geographic position,
  height, tilt ranges, power ranges, and azimuth. Ordering and equivalent numeric
  representations do not create false differences. The authenticated
  `POST /api/v1/network-configurations/compare` endpoint enforces existing
  configuration visibility and same-scene comparison.
- Impact policy `impact-policy-v1` is implemented in
  `backend/services/impact_planner.py`. The authenticated
  `POST /api/v1/configuration-impact/preview` endpoint performs a dry run only:
  it combines a same-scene baseline/candidate pair with enabled simulation
  profiles, returns paired validated requests, explicit skip reasons, and an
  estimated job count, but never queues work. Role profiles run only for affected
  antennas. Analytical SINR/Throughput profiles are skipped for tilt, azimuth,
  position, and height-only changes that their current formulas do not use.
  Automatic optimization remains disabled in policy v1.
- Durable impact studies are stored through
  `backend/services/impact_study_service.py`. Authenticated APIs create and list
  studies, inspect one study, start it, and cancel it. Starting creates exactly
  one baseline and one candidate child job per planned profile in the existing
  simulation queue; row locking plus a database uniqueness constraint make start
  idempotent. Child jobs carry their study, profile, scenario role, and a stable
  input signature. Worker completion reconciles the parent summary and preserves
  successful results when sibling jobs fail. Queued jobs can be cancelled;
  already-running jobs finish while the study remains cancelled. The workflow is
  backend-only for now and does not change manual simulation or frontend flows.
- Alembic 1.19.2 is configured through `alembic.ini` and
  `backend/migrations/`, using the existing database URL resolver and
  `Base.metadata`. Revision `0001_initial_schema` reproduces the six existing
  application tables and creates PostGIS when needed; it deliberately excludes
  PostGIS-owned tables from autogeneration. The baseline was verified on an
  isolated clean database. The legacy-schema adoption command validates types,
  defaults, constraints, and application-owned tables before stamping; the
  existing Docker database is stamped at `0001_initial_schema`. FastAPI
  checks that a configured database is at the current Alembic head and fails
  startup with migration guidance when it is not. It no longer creates tables.
  Docker Compose runs the one-shot `database-migrate` service before starting
  the backend. No-database mode skips the revision check.
- RSRP work includes no-coverage rows for served/measured output and a legend UI
  update.
- Antenna import work has started with a frontend download button that creates
  `antenna-template.xlsx` from the current antenna schema. The Choose Scene page
  can import that workbook, validate antenna rows, and immediately render valid
  antennas on the map before or after a scene area is selected. Imported
  antennas are allowed to sit outside the selected scene area. When a chosen
  scene is kept and loaded, only imported antennas inside that selected area are
  saved as `fixed_antennas` on the scene registry metadata and carried into
  Network Coverage, preserving their map positions in the new scene coordinate
  system. Fixed antennas are not stored as database antenna rows, but they do
  persist with the static scene metadata and reload when the scene is selected.
  The frontend also keeps a localStorage backup keyed by scene ID so fixed
  antennas can be restored if a stale backend ignores the scene metadata field.
  Network Coverage now treats those imported antennas as type 1 fixed antennas:
  their base real-world data is immutable, but tilt, power, and azimuth can be
  overridden for the current simulation draft. Users can add type 2
  simulation-only antennas from a form with the same fields as the XLSX template;
  type 2 base data is set from that add form, can be deleted per antenna, and is
  stored separately from per-simulation antenna settings in scene-scoped
  localStorage so accidental reloads preserve the draft. Resetting
  antennas or changing the work scene clears that Network Coverage draft. Scene
  import does not cap the number of type 1 antennas, but Network Coverage still
  enforces a maximum of 10 active checked antennas per simulation request.
  Network Coverage antenna cards include an enabled checkbox; unchecked antennas
  remain in the sidebar draft but are hidden from the 3D scene and excluded from
  the simulation payload. Antenna-card longitude/latitude values are displayed
  with four decimal places across the shared antenna-management pages.
- Coverage API uses exactly one transmitter. If the selected scene has no fixed
  antennas, users enter one type 2 transmitter with antenna ID, longitude,
  latitude, and height. If fixed antennas exist, users can choose one fixed
  antenna or choose the type 2 transmitter option; one fixed antenna is selected
  automatically only as the default. If multiple fixed antennas exist, users must
  choose a fixed antenna or type 2 transmitter before running. The backend still
  receives the converted scene `transmitter_position`; fixed antenna real-world
  coordinates remain read-only in the UI. Coverage API exposes azimuth as a
  simulation field: fixed antennas initialize it from base data, custom
  transmitters default to 0 degrees, and the backend applies it to transmitter
  orientation.
- SINR API uses exactly three role antennas: one transmitter, one receiver, and
  one interferer. The page builds candidates from fixed type 1 scene antennas and
  SINR-only type 2 antennas. Users can add SINR-only type 2 candidates even when
  three or more fixed antennas already exist. The run button stays disabled until
  exactly one transmitter, one receiver, and one interferer are assigned to three
  different antennas. SINR does not cap candidate antenna count because only the
  three selected role antennas are sent to the backend. SINR type 2 antennas,
  per-antenna simulation settings, and role selections are persisted in separate
  scene-scoped localStorage keys and cleared when resetting SINR antennas or
  changing the work scene. The SINR page uses a workspace layout with the 3D
  scene/result on the left, candidate antenna management on the right, and
  role/solver setup below the 3D scene.
- Throughput API uses the same three-role antenna workflow as SINR, but stores
  Throughput-only type 2 antennas, per-antenna simulation settings, and role
  selections in separate scene-scoped localStorage keys. Base tilt and target
  tilt are constrained to the selected transmitter antenna's configured tilt
  min/max range. Throughput does not cap candidate antenna count because only the
  selected transmitter, receiver, and interferer are sent to the backend. The
  Throughput page uses the same workspace layout pattern as SINR, with candidate
  antenna management on the right and role/tilt/solver setup below the 3D
  scene/result on the left.
- SINR and Throughput now let users select Sionna, UMa, Ericsson, or Friis as
  independent propagation models. Sionna keeps the existing scene-based
  ray-tracing flow. UMa, Ericsson, and Friis bypass 3D scene loading and use the
  selected transmitter, receiver, and interferer with carrier frequency,
  bandwidth, and receiver noise figure. Those three formulas do not use antenna
  tilt, so Throughput base and target tilt results are intentionally unchanged.
- RSRP Simulation uses all configured transmit antennas for the run, with the
  same type 1/type 2 split as Network Coverage. Fixed type 1 antenna base data
  remains immutable, users can add/delete type 2 antennas from the XLSX-shaped
  form, simulation tilt/power/azimuth settings are editable per antenna, and the
  RSRP draft is stored in its own scene-scoped localStorage keys. RSRP antenna
  cards include an enabled checkbox; unchecked antennas remain in the sidebar
  draft but are hidden from the 3D scene and excluded from the simulation payload.
  RSRP enforces the backend limit of 10 active checked antennas per simulation
  request. The RSRP page keeps antenna management on the right and places
  user/solver setup below the 3D scene/result on the left.
- Network Coverage optimization now has a deterministic global-plus-local search at
  `/network/optimization`: set up to two coverage/overlap targets, choose tilt
  step, power step, azimuth step, and maximum simulations (1–5000, including
  baseline), and start a run.
  `POST /api/v1/optimizations/network-coverage/run` snapshots the active scene
  and current Network Coverage request. It creates one
  `network_coverage_optimization` job when a database is configured, or runs
  inline without a database. The worker simulates a fresh baseline. If the full
  discrete space fits within the budget, it searches every combination. For a
  larger space, it reserves about 40% of the budget for deterministic Halton
  space-filling configurations plus full-range anchors; every global candidate
  can change multiple fields across multiple antennas. It then selects up to 12
  good configurations with explicit distance-based diversity and locally refines
  that beam with nearby legal values. Candidate generation interleaves beam
  parents and parameter dimensions to prevent one antenna or field from consuming
  the remaining budget. The run stops at the
  first setup satisfying all targets, when it uses the full simulation budget,
  or when no unseen beam candidates remain. Solver settings stay fixed. Failed
  candidates are reported and skipped; baseline failure aborts the run. Ranking prioritizes passing all
  targets, then summed target shortfall normalized by metric range (100 for
  percentages, 10 for overlap count), then fewer failed targets. KPI ranking
  uses unrounded cell-derived values so small coverage differences are not lost;
  exact ties preserve the earlier setup, including the baseline.
  The result includes the winning coverage grid, baseline/best KPI summaries,
  tested setup summaries with full candidate settings, original/winning requests,
  stop reason, budget, search-space size, global/local trial counts, beam width,
  and completed round count under `optimization`. The Tested setups table is
  minimized by default and can be expanded from the result summary.
  Progress is stored in job result metadata between simulations. The page
  remembers the latest job per scene and resumes polling after navigation or
  reload. Apply suggested settings changes only the Network Coverage draft and
  rejects a draft changed since submission. Saving a completed optimization
  stores the winning request/result as normal `network_coverage` history.
  Targets remain under `sionna_network_optimization_objectives`; latest job IDs
  and draft signatures use its `:run:<scene-id>` suffix. The older evaluate,
  candidates, and candidate-request preview endpoints remain available, but
  the UI no longer exposes their separate stages or frontend calculation
  fallbacks. Core search logic lives in `backend/services/optimization_service.py`.

## Important Files

- `README.md`: canonical run, Docker, environment, testing, and troubleshooting
  guide.
- `backend/main.py`: app startup, middleware, static mount, routers, worker/logger
  lifecycle.
- `backend/api/sinr.py`: simulation, history, job, and scene endpoints.
- `backend/api/auth.py`: authentication endpoints.
- `backend/database.py`: database URL resolution, SQLAlchemy engine/session, and
  startup Alembic revision validation.
- `backend/models.py`: PostgreSQL/PostGIS ORM schema.
- `alembic.ini` and `backend/migrations/`: database migration configuration and
  future revision history.
- `backend/schemas/requests.py`: Pydantic request models and validation.
- `backend/services/coverage_service.py`: coverage map and network coverage.
- `backend/services/rsrp_service.py`: RSRP calculations.
- `backend/services/sinr_service.py`: SINR calculations.
- `backend/services/throughput_service.py`: throughput comparison calculations.
- `backend/services/simulation_job_store.py`: queue/job persistence.
- `backend/services/simulation_worker.py`: background job polling and execution.
- `backend/services/simulation_store.py`: result/history persistence and artifact
  cleanup.
- `backend/services/network_configuration_service.py`: immutable antenna snapshot
  normalization, hashing, version creation, access control, and publishing.
- `backend/services/configuration_diff_service.py`: deterministic field-level
  comparison of network configuration versions.
- `backend/services/impact_planner.py`: policy-versioned dry-run mapping from
  configuration changes to planned and skipped simulation profiles.
- `backend/services/impact_study_service.py`: durable impact-study lifecycle,
  linked child-job creation, status reconciliation, and partial-failure summary.
- `backend/services/simulation_profile_service.py`: saved automation-profile CRUD,
  enable-time validation, antenna-role resolution, and request construction.
- `backend/services/scene_service.py`: scene registry, preview lifecycle, activate
  and delete behavior.
- `backend/services/osm_scene_builder.py`: OSM/Overpass to Sionna scene generation.
- `frontend/src/App.jsx`: top-level routes, auth state, scene state, simulation
  orchestration, history/comparison orchestration.
- `frontend/src/api.js`: API wrapper, auth headers, simulation queue, history,
  scene, and artifact fetch calls.
- `frontend/src/constants/`: frontend route, map, radio, scene, storage, API
  constants.
- `frontend/src/components/`: feature UI components.
- `frontend/src/utils/`: map drawing, scene sizing, history filtering, formatting.

## Current UI Routes

- `/network`: main network coverage planner.
- `/network/optimization`: Network Coverage tilt optimization, progress, comparison, and apply.
- `/queue`: submitted simulation jobs, status tracking, result review, save to
  history, and discard actions.
- `/coverage`: coverage map API tool.
- `/rsrp`: RSRP simulation tool.
- `/sinr`: SINR tool.
- `/throughput`: throughput comparison tool.
- `/history`: saved simulation runs, detail, delete, compare.
- `/scenes`: scene list and management.
- `/choose-scene`: full-screen offline Vietnam map for drawing and importing a
  Sionna scene area.

## Runtime Behavior To Preserve

- Docker runs Alembic migrations before the backend. Backend startup verifies a
  configured database is at the current migration head, then starts the
  Elasticsearch logger and simulation worker. No-database mode skips migration
  validation and remains available for manual inline simulations.
- Frontend redirects `/` and unknown paths to `/scenes`.
- Frontend stores auth token/user in localStorage using constants from
  `frontend/src/constants`.
- Simulation API calls may return queued job IDs; `frontend/src/api.js` polls
  no longer waits for completion. Users open `/queue` to see job status, inspect
  completed results, and save only selected results into history.
- Scene dimensions drive solver bounds on the frontend.
- Imported fixed antennas are no longer scaled to fit scene dimensions. A scene
  with saved `fixed_antennas` uses those antennas as-is; a scene without fixed
  antennas starts with an empty antenna list instead of the old A1-A10 defaults.
- `MAX_GRID_CELLS` protects the backend by enlarging cell size for large scenes.
- Delete operations must remove database rows and generated artifact files where
  applicable.
- Every user-facing delete action must ask for confirmation before deleting.
- Do not commit `.env`, `.env.docker`, generated `static/` content, database
  volumes, or local runtime artifacts.

## Known Caveats

- README notes that the map picker records real-world bounds. The previous stated
  limitation was that it created a runnable scene from Sionna's bundled
  `simple_street_canyon`; newer code now has an OSM builder, so verify the actual
  current behavior before changing docs or scene import logic.
- Full Sionna simulations are hardware-dependent and are not part of the normal
  unit test expectation.
- Database-backed simulations require PostgreSQL/PostGIS. Without database config,
  some history/job behavior is disabled and simulations run inline.
- Scene registry metadata lives in `static/scenes/scenes.json`; PostgreSQL `scenes`
  rows are kept as minimal references for simulation history.
- As of 2026-08-24, the worktree had an unrelated whitespace-only local change in
  `backend/services/osm_scene_builder.py`. Do not revert user changes without an
  explicit request.

## Recent Commit Trail

Recent commits before this briefing included:

- Dockerized the app.
- Added README guidance for Docker distribution and operations.
- Converted raw SQL to SQLAlchemy ORM models.
- Added automatic Elasticsearch/Kibana log configuration.
- Added preview scene cleanup when previews are not kept.
- Increased Overpass timeout and moved it into constants.
- Updated RSRP legend UI.
- Added no-coverage rows for served/measured RSRP output.

## How To Work Here

- Start by reading this file, then read only the files relevant to the user prompt.
- Prefer existing service boundaries and constants over new ad hoc logic.
- Backend changes usually need targeted pytest coverage in `test/`.
- Frontend changes should preserve the existing quiet operational UI style and run
  `npm run build` from `frontend/` when practical.
- Useful checks:
  - `python -m pytest test -q`
  - `cd frontend && npm run build`
  - `docker compose --env-file .env.docker up --build -d`
- If you add new routes, services, persistent fields, scene behavior, or major UI
  flows, update this file in the same change.
