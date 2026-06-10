# Sionna Simulation Planner

This project is a local radio-network planning demo built on top of NVIDIA Sionna RT.

It has two parts:

- `backend/`: a FastAPI server that loads the Sionna Munich scene, runs GPU-backed radio simulations, and returns coverage/SINR/throughput data.
- `frontend/`: a static browser UI for editing antenna tilt and transmit power, running a simulation, and inspecting grid-cell metrics on a top-down map.

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
      sinr_service.py
      throughput_service.py
    simulations/
      sionna_engine.py
      antenna_factory.py
      radio_calculator.py
  frontend/
    index.html
    styles.css
    app.js
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

## Connect Postgres

The backend can store simulation history in Postgres. It uses the tables you created in pgAdmin:

- `simulation_runs`
- `simulation_run_antennas`
- `simulation_artifacts`

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

## Start the Frontend

After the backend is running, open this file in a browser:

```text
\SionnaSimulation\frontend\index.html
```

The frontend calls:

```text
http://127.0.0.1:8000/api/v1/network-coverage
```

No frontend build step is required.

## Main App Flow

1. The frontend displays 10 antennas on a top-down Munich planning map.
2. Each antenna has:
   - coordinate `(x, y, z)`
   - tilt range and current tilt
   - azimuth direction
   - transmit-power range and current power
3. Users can edit only:
   - current tilt
   - current transmit power
4. Clicking `Run simulation` sends all antenna settings to the backend.
5. The backend runs Sionna RT, renders a top-down coverage image, and returns grid metrics.
6. The frontend overlays a heatmap and shows hover details per cell:
   - serving antenna
   - SINR in dB
   - signal power in dBm
   - estimated throughput in Mbps

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
frontend/app.js
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
- The frontend is intentionally static HTML/CSS/JS so it is easy to inspect and modify without a build system.
