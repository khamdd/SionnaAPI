# Sionna Simulation Planner

This project is a local radio-network planning demo built with:

- **FastAPI** backend
- **React/Vite** frontend
- **NVIDIA Sionna RT** for radio-map simulation
- Optional **PostgreSQL/PostGIS** storage for users and simulation history
- Optional **Elasticsearch/Kibana** logging

The app lets a user log in, choose or preview a scene, edit antenna tilt and transmit power, run Sionna RT simulations, inspect coverage/SINR/throughput results, and compare saved simulation history.

## Current Repository Layout

```text
SionnaSimulation/
  backend/
    main.py                         FastAPI app setup
    api/
      auth.py                       Login/register endpoints
      sinr.py                       Simulation, history, and scene endpoints
    core/
      config.py                     Elasticsearch environment settings
    middleware/
      request_logging.py            Request logging middleware
    schemas/
      auth.py                       Auth request validation
      requests.py                   Simulation and scene request validation
    services/
      auth_service.py               User creation/login logic
      coverage_service.py           Coverage-map and network-coverage logic
      event_logger.py               Optional Elasticsearch event logging
      scene_service.py              Scene registry, preview, activate, delete
      simulation_store.py           Optional PostgreSQL history storage
      sinr_service.py               SINR endpoint logic
      throughput_service.py         Throughput comparison logic
    simulations/
      antenna_factory.py            Add/update/remove Sionna transmitters
      radio_calculator.py           Grid indexing, dB/dBm, throughput math
      sionna_engine.py              Lazy-loaded shared Sionna scene
    requirements.txt
  frontend/
    package.json
    index.html
    styles.css
    src/
      App.jsx                       Main app state, routes, workflow glue
      api.js                        Frontend API client
      constants.js                  Default solver and antenna settings
      components/                   UI components
      utils/                        Formatting, history, and map helpers
  test/                             Pytest tests for backend logic
  docker-compose.elasticsearch.yml  Optional local Elasticsearch/Kibana
  README.md
```

Generated runtime files are intentionally ignored by Git:

- `.env`
- `static/`
- frontend `node_modules/`
- frontend build output such as `dist/`

There is currently no committed `.env.example` file.

## Requirements

The backend expects a Windows machine with an NVIDIA GPU and a Sionna-compatible driver/environment.

The environment used for this project is:

- Python `3.11`
- Conda environment named `sionna-rt-py311`
- `sionna-rt==2.0.1`
- FastAPI/Uvicorn
- Pytest
- Node.js/npm for the React frontend

Python dependencies are listed in:

```text
backend/requirements.txt
```

Frontend dependencies are listed in:

```text
frontend/package.json
```

## Environment Variables

Create a local `.env` file in the project root when you need database storage or Elasticsearch logging.

Minimum database example:

```text
DATABASE_URL=postgresql+psycopg://postgres:your_password@localhost:5432/sionna_simulation
AUTH_SECRET_KEY=replace-this-with-a-long-random-secret
```

Optional Elasticsearch example:

```text
ELASTICSEARCH_ENABLED=true
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_INDEX=sionna-logs-dev
```

The frontend can be pointed at a different backend by creating `frontend/.env`:

```text
VITE_API_BASE_URL=http://127.0.0.1:8000
```

If `DATABASE_URL` is not set, the backend still starts, but login/register and history storage will not work.

`AUTH_SECRET_KEY` signs login tokens. Use a long random value before deploying the app. If you leave the default development secret, anyone with the source code can forge tokens.

If `ELASTICSEARCH_ENABLED` is not true, logging silently stays disabled.

## Start the Backend

Open PowerShell:

```powershell
cd D:\Workspace\Viettel\Miniproject\SionnaSimulation
conda activate sionna-rt-py311
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

FastAPI docs:

```text
http://127.0.0.1:8000/docs
```

The backend serves generated images and scene previews from:

```text
http://127.0.0.1:8000/static/...
```

## Start the Frontend

Open another PowerShell window:

```powershell
cd D:\Workspace\Viettel\Miniproject\SionnaSimulation\frontend
npm install
npm run dev
```

Vite normally starts at:

```text
http://127.0.0.1:5173
```

## Optional Database

The backend uses PostgreSQL/PostGIS through SQLAlchemy when `DATABASE_URL` is configured.

Database access is implemented with the SQLAlchemy ORM models in `backend/models.py`. Service code builds model queries and does not contain handwritten SQL strings.

Database-backed features:

- Login/register through `app_users`
- Saved simulation history through `simulation_runs`
- Network antenna snapshots through `simulation_run_antennas`
- Generated image metadata through `simulation_artifacts`
- Optional scene references through `scenes` if that table exists

### Scene storage model

The local scene registry is the source of truth for scene metadata. Full scene information is stored in:

```text
static/scenes/scenes.json
```

Scene XML, PLY meshes, and preview SVG files are stored under:

```text
static/scenes/{scene_id}/
```

PostgreSQL `scenes` rows are intentionally minimal. The application writes `id` and `name` so `simulation_runs.scene_id` can keep a stable foreign-key reference. When a local scene is removed, its PostgreSQL row is retained for old simulation history and its `status` changes from `ready` to `deleted`. Columns such as `bounds_geom`, `bounds_json`, `metrics_json`, `scene_path`, and `preview_url` are not used by the current local-registry design and remain `NULL`.

The code does not contain a migration tool. The storage layer assumes these tables already exist and adds `simulation_runs.scene_id` automatically if missing.

Simulation grid cells are not stored in their own table. Full grid details stay in the JSON response and in the stored `response_json`.

## Optional Elasticsearch Logging

The app can log request, auth, scene, and simulation events to Elasticsearch.

Start the local logging stack:

```powershell
cd D:\Workspace\Viettel\Miniproject\SionnaSimulation
docker compose -f docker-compose.elasticsearch.yml up -d
```

Open Kibana:

```text
http://127.0.0.1:5601
```

Stop it:

```powershell
docker compose -f docker-compose.elasticsearch.yml down
```

## Docker deployment

The complete application can run as five containers:

- `frontend`: production React files served by Nginx
- `backend`: FastAPI, Sionna RT, and the background simulation worker
- `postgres`: PostgreSQL with PostGIS
- `elasticsearch`: persistent application logs
- `kibana`: log viewer

The backend Docker image installs its Python packages directly in
`Dockerfile.backend`; Docker does not use `backend/requirements.txt`.

For local testing, the Compose defaults work immediately:

```powershell
docker compose up --build -d
```

Open:

```text
Application:   http://127.0.0.1:8080
FastAPI:       http://127.0.0.1:8000
Kibana:        http://127.0.0.1:5601
PostgreSQL:    127.0.0.1:5433
Elasticsearch: http://127.0.0.1:9200
```

For a shared or production deployment, copy `.env.docker.example` to a secure
environment file, change both passwords/secrets, and pass it to Compose:

```powershell
Copy-Item .env.docker.example .env.docker
docker compose --env-file .env.docker up --build -d
```

The backend creates missing tables from `backend/models.py` when it starts.
A fresh PostgreSQL volume therefore starts with an empty application database
and the required schema; no SQL initialization file is used.

Persistent named volumes:

- `postgres-data`: users, jobs, scene references, and simulation history
- `elasticsearch-data`: logs
- `application-static`: imported scenes and generated simulation artifacts

Check the stack:

```powershell
docker compose ps
docker compose logs -f backend
```

Stop containers while preserving data:

```powershell
docker compose down
```

Delete containers and all Docker-managed application data:

```powershell
docker compose down -v
```

Use `down -v` only when a complete data reset is intentional.

Stop it and delete local log data:

```powershell
docker compose -f docker-compose.elasticsearch.yml down -v
```

The compose file binds Elasticsearch and Kibana to `127.0.0.1`, so they are local-only by default.

## Main User Flow

1. The user logs in or registers.
2. The frontend loads the active scene.
3. The default route is `/network`.
4. The user edits antenna tilt or transmit power.
5. Clicking **Run simulation** sends `POST /api/v1/network-coverage`.
6. The backend locks the shared Sionna engine, loads the active scene if needed, adds transmitters, runs a radio map, renders a coverage image, builds grid-cell metrics, and removes temporary transmitters.
7. The frontend displays the coverage image or 3D scene preview, overlays grid colors, and shows cell details.
8. If the database is configured, the simulation is stored and can be viewed from History.

## Important API Endpoints

Auth:

```text
POST /api/v1/auth/register
POST /api/v1/auth/login
```

Simulation:

```text
POST /api/v1/network-coverage
POST /api/v1/coverage-map
POST /api/v1/sinr
POST /api/v1/throughput-comparison
```

History:

```text
GET    /api/v1/simulation-runs
GET    /api/v1/simulation-runs/{run_id}
GET    /api/v1/simulation-runs/{run_id}/result
DELETE /api/v1/simulation-runs/{run_id}
```

Scenes:

```text
GET    /api/v1/scenes
GET    /api/v1/scenes/active
POST   /api/v1/scenes/preview
POST   /api/v1/scenes/{scene_id}/activate
DELETE /api/v1/scenes/{scene_id}
```

## Where To Change Common Things

Default antennas and solver settings:

```text
frontend/src/constants.js
```

Frontend API base URL and request functions:

```text
frontend/src/api.js
```

Main frontend routes and app state:

```text
frontend/src/App.jsx
```

Coverage map UI:

```text
frontend/src/components/MapPanel.jsx
frontend/src/components/Scene3DPreview.jsx
frontend/src/utils/map.js
```

Request validation:

```text
backend/schemas/requests.py
backend/schemas/auth.py
```

Simulation endpoint routing:

```text
backend/api/sinr.py
backend/api/auth.py
```

Sionna scene loading:

```text
backend/simulations/sionna_engine.py
```

Radio math and grid indexing:

```text
backend/simulations/radio_calculator.py
```

Network coverage behavior:

```text
backend/services/coverage_service.py
```

History persistence:

```text
backend/services/simulation_store.py
```

Scene preview/activate/delete:

```text
backend/services/scene_service.py
```

## How Network Coverage Works

The main endpoint is:

```text
POST /api/v1/network-coverage
```

The flow is:

```text
frontend/src/App.jsx
  -> buildNetworkCoveragePayload()
  -> frontend/src/api.js runNetworkCoverage()
  -> backend/api/sinr.py network_coverage()
  -> backend/services/coverage_service.py calculate_network_coverage_service()
  -> backend/simulations/sionna_engine.py shared scene
  -> Sionna RadioMapSolver
  -> grid JSON + PNG URL
  -> frontend/src/utils/map.js drawHeatmap()
```

The backend returns:

- `status`
- `coverage_map_image_url`
- `grid.rows`
- `grid.cols`
- `grid.cells`
- `solver`
- `transmitter_pattern`
- `antennas`

Each grid cell can include:

- row/column
- world `x` and `y`
- serving antenna
- SINR in dB
- signal power in dBm
- neighbor antennas
- estimated throughput in Mbps

## Scene Management

The default scene is Munich.

Imported scenes are stored under:

```text
static/scenes/
```

The scene registry is stored at runtime in:

```text
static/scenes/scenes.json
```

Current limitation: the map picker validates and stores the selected real-world bounds, then creates a runnable scene from Sionna's bundled `simple_street_canyon` demo scene. It does not yet convert OpenStreetMap building geometry into a true Sionna RT scene.

## Run Tests

Backend unit tests:

```powershell
cd D:\Workspace\Viettel\Miniproject\SionnaSimulation
conda activate sionna-rt-py311
python -m pytest test -q
```

Frontend production build:

```powershell
cd D:\Workspace\Viettel\Miniproject\SionnaSimulation\frontend
npm run build
```

The tests focus on request validation, API error handling, logging behavior, history behavior, generated image cleanup, Sionna engine lifecycle, grid indexing, neighbor selection, dB/dBm conversion, and throughput math.

The tests do not run full GPU Sionna simulations because those are slower and hardware-dependent.

## Troubleshooting

### Backend cannot import Sionna

Activate the correct conda environment:

```powershell
conda activate sionna-rt-py311
```

### Frontend cannot reach backend

Check that the backend is running:

```text
http://127.0.0.1:8000/docs
```

Then check the frontend API base URL in:

```text
frontend/src/constants.js
```

or override it with:

```text
frontend/.env
```

### Login or history does not work

Check whether `DATABASE_URL` is set in the root `.env`.

Without a database:

- registration returns a database-not-configured error
- login returns a database-not-configured error
- history returns an empty/non-configured response

### Port 8000 is already in use

Find the process:

```powershell
Get-NetTCPConnection -LocalPort 8000
```

Stop it:

```powershell
Stop-Process -Id <PID>
```

### Generated images are missing

Generated coverage images are written to:

```text
static/
```

That directory is runtime-only and ignored by Git. A fresh clone will not include previous generated images.

## Development Notes

- The backend intentionally serializes simulations with `engine.lock` because Sionna scenes are mutated during each request.
- Temporary transmitters are removed in `finally` blocks after simulations.
- Request bodies are validated by Pydantic before service code runs.
- Frontend route changes use `window.history.pushState`; this is a small custom router, not React Router.
- `static/` is runtime output, not source code.
- `.env` is local configuration and should not be committed.
