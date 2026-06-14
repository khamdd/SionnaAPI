# Sionna Simulation Planner

This project is a local radio-network planning demo built on top of NVIDIA Sionna RT.

It has two parts:

- `backend/`: a FastAPI server that loads the Sionna Munich scene, runs GPU-backed radio simulations, and returns coverage/SINR/throughput data.
- `frontend/`: a React/Vite browser UI for editing antenna tilt and transmit power, running a simulation, and inspecting grid-cell metrics on a top-down map.

## Requirements

- Windows with an NVIDIA GPU supported by Sionna RT/Mitsuba/Dr.Jit.
- NVIDIA driver `596.49` or another driver verified to work with Sionna RT OptiX on this machine.
- Conda environment named `sionna-rt-py311`.

The current verified environment uses:

- Python `3.11`
- `sionna-rt 2.0.1`
- FastAPI
- Uvicorn
- Pytest
- Node.js/npm for the React frontend

## Project Structure

```text
SionnaSimulation/
  backend/
    main.py
    api/
      sinr.py
    schemas/
      requests.py
    services/
      coverage_service.py
      scene_service.py
      sinr_service.py
      throughput_service.py
    simulations/
      sionna_engine.py
      antenna_factory.py
      radio_calculator.py
  frontend/
    package.json
    index.html
    styles.css
    src/
      main.jsx
      App.jsx
      api.js
      constants.js
      components/
        ApiPages.jsx
        AntennaPanel.jsx
        ComparisonResult.jsx
        HistoryDetail.jsx
        HistoryModal.jsx
        HistoryPanel.jsx
        MapPanel.jsx
        SceneChooserModal.jsx
        ScenesPage.jsx
      utils/
        format.js
        history.js
        map.js
  test/
    test_radio_calculator.py
    test_request_schemas.py
```

## Start the Backend

Open PowerShell:

```powershell
cd project_dir
conda activate sionna-rt-py311
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

The backend API docs will be available at:

```text
http://127.0.0.1:8000/docs
```

## Connect Postgres/PostGIS

The backend can store simulation history in PostgreSQL with PostGIS enabled. The schema stores local Sionna coordinates as PostGIS geometry values:

- antenna positions use `scene_position GEOMETRY(PointZ, 0)`
- simulation centers use `center_position GEOMETRY(PointZ, 0)`
- simulation areas use `area_geom GEOMETRY(Polygon, 0)`

The app uses these project tables:

- `sites`
- `antennas`
- `simulation_runs`
- `simulation_run_antennas`
- `simulation_artifacts`

PostGIS also creates metadata tables/views such as `spatial_ref_sys`, `geometry_columns`, and `geography_columns`. Those are expected and should not be deleted.

Create a local `.env` file in the project root:

```text
DATABASE_URL=postgresql+psycopg://postgres:your_password@localhost:5432/sionna_simulation
```

Replace:

- `postgres` with your database username.
- `your_password` with your pgAdmin/Postgres password.
- `sionna_simulation` with your database name if you used a different one.

The `.env` file is ignored by Git. Use `.env.example` as the template.

If `DATABASE_URL` is not set, the app still runs but skips database storage.

When the DB is configured, every simulation request stores:

- one row in `simulation_runs`
- antenna snapshots in `simulation_run_antennas` for `/api/v1/network-coverage`
- generated coverage image metadata in `simulation_artifacts` when a PNG is returned
- active scene metadata (`scene_id`, `scene_name`) on the simulation run

The app does not use a `coverage_cells` table. Coverage grid detail stays in the API response for the active simulation, while the database stores the request, summarized response, image URL, and antenna snapshots.

If your existing `simulation_runs` table does not have `scene_id` and `scene_name`, the backend adds those two columns automatically when history is stored or read.

The frontend History tab reads from:

```text
GET /api/v1/simulation-runs
GET /api/v1/simulation-runs/{run_id}
```

## Optional Elasticsearch Logging

The backend can send operational logs to Elasticsearch. This is optional; the app runs normally when logging is disabled.

Logged events currently include:

- `http_request`: normal API request/response log.
- `http_request_failed`: unhandled API exception.
- `user_registered`: successful account registration.
- `register_failed`: failed account registration.
- `login_success`: successful login.
- `login_failed`: failed login.
- `simulation_started`: simulation request started.
- `simulation_completed`: simulation finished successfully.
- `simulation_failed`: simulation returned failure or raised an exception.

Logs include useful fields such as request path, status code, duration, username, simulation type, scene id, scene name, and error message. Passwords, tokens, database URLs, and password hashes are redacted. Request bodies and query strings are not logged.

### Run Elasticsearch locally

This is for local development only. The compose file binds Elasticsearch and Kibana to `127.0.0.1`, so they are reachable only from your own machine.

```powershell
cd project_dir
docker compose -f docker-compose.elasticsearch.yml up -d
```

Open Kibana:

```text
http://127.0.0.1:5601
```

Then enable logging in `.env`:

```text
ELASTICSEARCH_ENABLED=true
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_INDEX=sionna-logs-dev
```

Restart the backend after changing `.env`.

To stop the local logging stack:

```powershell
docker compose -f docker-compose.elasticsearch.yml down
```

To remove local log data too:

```powershell
docker compose -f docker-compose.elasticsearch.yml down -v
```

Do not expose this local Elasticsearch service to the public internet. For production, use a secured Elasticsearch service with authentication, TLS, index retention, and restricted access.

## Start the Frontend

After the backend is running, open another PowerShell window:

```powershell
cd project_dir\frontend
npm install
npm run dev
```

Open the URL printed by Vite, normally:

```text
http://127.0.0.1:5173
```

The frontend calls:

```text
http://127.0.0.1:8000/api/v1/network-coverage
```

To point the React app at another backend URL, create `frontend/.env`:

```text
VITE_API_BASE_URL=http://127.0.0.1:8000
```

## Main App Flow

1. The frontend starts with the Munich scene as the active global scene.
2. The active scene name is displayed in the navbar. Use `Choose scene` to select a small area from the map, preview it, then keep or cancel it.
3. The frontend displays 10 antennas on a top-down planning map.
4. Each antenna has:
   - coordinate `(x, y, z)`
   - tilt range and current tilt
   - azimuth direction
   - transmit-power range and current power
5. Users can edit only:
   - current tilt
   - current transmit power
6. Clicking `Run simulation` sends all antenna settings to the backend.
7. The backend runs Sionna RT with the active global scene, renders a top-down coverage image, and returns grid metrics.
8. The frontend overlays a heatmap and shows hover details per cell:
   - serving antenna
   - SINR in dB
   - signal power in dBm
   - estimated throughput in Mbps

## Scene Management

The Scenes page lists all available scenes. Users can load a scene or delete an imported scene. The active scene and the default Munich scene cannot be deleted.

Imported scenes are limited to 3. If the user tries to choose another map scene after reaching that limit, the app redirects to the Scenes page and asks them to delete one first.

History comparison only allows successful simulation runs with the same API type and the same `scene_id`. This avoids comparing Munich results against another scene.

Current limitation: the map picker validates and stores the selected real-world area, then creates a runnable Sionna demo scene from a bundled Sionna scene template. It does not yet convert OpenStreetMap building geometry into a true Sionna RT scene. That conversion needs an OSM/building importer pipeline before production use.

## API Endpoints

### `POST /api/v1/network-coverage`

Used by the frontend.

Runs a multi-antenna coverage simulation and returns:

- rendered coverage image URL
- grid metadata
- hoverable per-cell metrics
- antenna data

### `POST /api/v1/coverage-map`

Runs a single-transmitter coverage-map render.

### `POST /api/v1/sinr`

Computes SINR at a receiver position.

### `POST /api/v1/throughput-comparison`

Compares estimated throughput between a base tilt and target tilt.

### `GET /api/v1/simulation-runs`

Lists recent stored simulations for the frontend History tab.

### `GET /api/v1/simulation-runs/{run_id}`

Loads one stored simulation, including solver settings, response summary, antenna snapshots, and generated artifacts.

### Scene endpoints

```text
GET /api/v1/scenes
GET /api/v1/scenes/active
POST /api/v1/scenes/preview
POST /api/v1/scenes/{scene_id}/activate
DELETE /api/v1/scenes/{scene_id}
```

## Run Tests

```powershell
cd project_dir
conda activate sionna-rt-py311
python -m pytest test -q
```

The unit tests cover request validation, grid indexing, dB/dBm conversions, and throughput math. They do not run full GPU simulations because those are slower and hardware-dependent.

## Useful Frontend Settings

The default antennas and solver settings are in:

```text
frontend/src/constants.js
```

To change antenna positions, edit `DEFAULT_ANTENNAS`.

To make simulations faster, reduce:

```javascript
samples_per_tx
size
```

or increase:

```javascript
cell_size
```

Example faster settings:

```javascript
const DEFAULT_SOLVER = {
  max_depth: 1,
  samples_per_tx: 5000,
  cell_size: 10,
  center: [0, 0, 0],
  size: [200, 200],
};
```

## Troubleshooting

### Backend cannot import Sionna

Make sure the correct conda environment is active:

```powershell
conda activate sionna-rt-py311
```

### GPU/OptiX compile error

Check the NVIDIA driver:

```powershell
nvidia-smi
```

This machine was verified with driver `596.49`. A newer driver previously caused an OptiX PTX compile error with Sionna RT.

### Frontend shows simulation failure

Check that the backend is running:

```text
http://127.0.0.1:8000/docs
```

Then retry `Run simulation`.

### Port 8000 already in use

Find the process:

```powershell
Get-NetTCPConnection -LocalPort 8000
```

Stop it if needed:

```powershell
Stop-Process -Id <PID>
```

## Notes

- Generated coverage images are written to `static/`.
- `static/` is ignored by Git because these images are runtime artifacts.
- The frontend is a React/Vite app. Use `npm run dev` for local development and `npm run build` before static deployment.
