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
- Simulation history is stored through `backend/services/simulation_store.py`.
  Heavy grid/user results are summarized in PostgreSQL and written as JSON files
  under `static/simulation-results/`.
- History UI supports viewing details, preview loading state, deleting one or
  many saved runs, and comparing compatible successful runs.
- Scene management supports listing, previewing, activating, deleting imported
  scenes, and keeping the default Munich scene.
- Scene choosing now lives at `/choose-scene` as a full-page offline Vietnam map
  with a major-city dropdown, scene-name entry, area drawing, preview, and
  keep/load actions.
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
- RSRP work includes no-coverage rows for served/measured output and a legend UI
  update.
- Antenna import work has started with a frontend download button that creates
  `antenna-template.xlsx` from the current antenna schema. The Choose Scene page
  can import that workbook, validate antenna rows, and immediately render valid
  antennas on the map before or after a scene area is selected. Imported
  antennas are allowed to sit outside the selected scene area. When a chosen
  scene is kept and loaded, only imported antennas inside that selected area are
  carried into Network Coverage, preserving their map positions in the new
  scene coordinate system.

## Important Files

- `README.md`: canonical run, Docker, environment, testing, and troubleshooting
  guide.
- `backend/main.py`: app startup, middleware, static mount, routers, worker/logger
  lifecycle.
- `backend/api/sinr.py`: simulation, history, job, and scene endpoints.
- `backend/api/auth.py`: authentication endpoints.
- `backend/database.py`: database URL resolution, SQLAlchemy engine/session, table
  creation.
- `backend/models.py`: PostgreSQL/PostGIS ORM schema.
- `backend/schemas/requests.py`: Pydantic request models and validation.
- `backend/services/coverage_service.py`: coverage map and network coverage.
- `backend/services/rsrp_service.py`: RSRP calculations.
- `backend/services/sinr_service.py`: SINR calculations.
- `backend/services/throughput_service.py`: throughput comparison calculations.
- `backend/services/simulation_job_store.py`: queue/job persistence.
- `backend/services/simulation_worker.py`: background job polling and execution.
- `backend/services/simulation_store.py`: result/history persistence and artifact
  cleanup.
- `backend/services/scene_service.py`: scene registry, preview lifecycle, activate
  and delete behavior.
- `backend/services/osm_scene_builder.py`: OSM/Overpass to Sionna scene generation.
- `frontend/src/App.jsx`: top-level routes, auth state, scene state, simulation
  orchestration, history/comparison orchestration.
- `frontend/src/api.js`: API wrapper, auth headers, queued job polling.
- `frontend/src/constants/`: frontend route, map, radio, scene, storage, API
  constants.
- `frontend/src/components/`: feature UI components.
- `frontend/src/utils/`: map drawing, scene sizing, history filtering, formatting.

## Current UI Routes

- `/network`: main network coverage planner.
- `/coverage`: coverage map API tool.
- `/rsrp`: RSRP simulation tool.
- `/sinr`: SINR tool.
- `/throughput`: throughput comparison tool.
- `/history`: saved simulation runs, detail, delete, compare.
- `/scenes`: scene list and management.
- `/choose-scene`: full-screen offline Vietnam map for drawing and importing a
  Sionna scene area.

## Runtime Behavior To Preserve

- Backend startup initializes database tables only when database configuration is
  present, then starts the Elasticsearch logger and simulation worker.
- Frontend redirects `/` and unknown paths to `/network`.
- Frontend stores auth token/user in localStorage using constants from
  `frontend/src/constants`.
- Simulation API calls may return queued job IDs; `frontend/src/api.js` polls
  `/api/v1/simulation-jobs/{job_id}` and then fetches the saved result.
- Scene dimensions drive solver bounds on the frontend.
- Default antennas are no longer scaled to fit scene dimensions; imported
  antennas selected from the Choose Scene page are used as-is for that active
  scene.
- `MAX_GRID_CELLS` protects the backend by enlarging cell size for large scenes.
- Delete operations must remove database rows and generated artifact files where
  applicable.
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
