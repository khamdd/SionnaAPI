# Sionna Simulation Planner

A radio-network planning application built with FastAPI, React, NVIDIA Sionna RT,
PostgreSQL/PostGIS, and Elasticsearch/Kibana.

The application lets users manage scenes and antennas, run coverage, RSRP, SINR,
and throughput simulations, and compare saved results.

## Run with Docker (recommended)

Docker Compose starts the complete application:

- `frontend`: React application served by Nginx
- `backend`: FastAPI and the Sionna simulation worker
- `postgres`: users, jobs, scenes, and simulation history
- `elasticsearch`: application event logs
- `kibana`: log search and visualization

### 1. Requirements

Install:

- [Git](https://git-scm.com/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

Start Docker Desktop before running the commands below.

### 2. Clone and configure

```powershell
git clone <repository-url>
cd SionnaSimulation
Copy-Item .env.docker.example .env.docker
```

Open `.env.docker` and replace the placeholder database password and authentication
secret with long, random values. Do not commit or share this file.

### 3. Build and start

```powershell
docker compose --env-file .env.docker up --build -d
```

The first build downloads the base images and Python/Node dependencies, so it takes
longer than later starts.

Check that every service is running:

```powershell
docker compose ps
```

Open:

| Service | Address |
| --- | --- |
| Application | http://127.0.0.1:8080 |
| FastAPI documentation | http://127.0.0.1:8000/docs |
| Kibana | http://127.0.0.1:5601 |
| Elasticsearch | http://127.0.0.1:9200 |
| PostgreSQL | `127.0.0.1:5433` by default |

Register the first application user from the login page. The database schema is
created automatically when the backend starts.

### 4. Everyday Docker commands

Start an existing installation:

```powershell
docker compose --env-file .env.docker up -d
```

Rebuild after changing source code or dependencies:

```powershell
docker compose --env-file .env.docker up --build -d
```

View status and backend logs:

```powershell
docker compose ps
docker compose logs -f backend
```

Stop the application while preserving data:

```powershell
docker compose down
```

Delete the containers **and all stored application data**:

```powershell
docker compose down -v
```

Use `down -v` only when a complete reset is intentional.

## Docker configuration and secrets

The Docker images do not contain `.env` or `.env.docker`. These files are excluded
from the build context by `.dockerignore`.

When this command runs:

```powershell
docker compose --env-file .env.docker up -d
```

Docker Compose reads `.env.docker` on the host, substitutes values referenced in
`docker-compose.yml`, and injects those values into the running containers as
environment variables. The backend reads them with `os.getenv()`.

Important distinctions:

- `.env.docker` configures the Compose deployment and is loaded only when passed
  with `--env-file`.
- `.env` is automatically used by Docker Compose when no `--env-file` is supplied,
  and is also used when the backend runs directly on the host.
- Environment files are not automatically copied into containers.
- Only values declared or referenced by `docker-compose.yml` are passed to a
  container.
- Docker administrators can inspect container environment variables. Use a secret
  manager or Docker secrets when deploying to a higher-security environment.

Never commit real passwords, tokens, or authentication secrets. Each installation
should create its own `.env.docker` from `.env.docker.example`.

## Giving the application to another user

The simplest supported approach is to give the user access to this repository.
They can then follow the Docker instructions at the top of this README and create
their own `.env.docker` file.

The current `docker-compose.yml` builds the backend and frontend images from source.
It does not download prebuilt application images from a registry. To distribute
prebuilt images instead, publish the backend and frontend images to Docker Hub or
another container registry, then replace their Compose `build:` entries with
versioned `image:` entries.

Do not send your personal `.env.docker`. Send only `.env.docker.example` and have
the receiving user generate their own secrets.

## Persistent data

Docker Compose uses named volumes:

| Volume | Contents |
| --- | --- |
| `postgres-data` | Users, jobs, scene references, and simulation history |
| `elasticsearch-data` | Application logs |
| `application-static` | Imported scenes and generated simulation files |

`docker compose down` preserves these volumes. `docker compose down -v` deletes
them.

## Kibana logs

Open http://127.0.0.1:5601 and create a data view for:

```text
sionna-logs-*
```

Use `@timestamp` as the time field. Useful Kibana Query Language filters include:

```text
simulation_type: *
event: "simulation_queued"
event: "simulation_failed"
```

Most generic HTTP request events do not contain `simulation_type`; that field is
added to simulation-specific events.

## Local development without the full Docker stack

Docker is the supported first-run path. For backend development on the host, use
Python 3.11 with the dependencies in `backend/requirements.txt`, and configure a
root `.env` when database or Elasticsearch access is needed.

Example `.env` for host development:

```dotenv
DATABASE_URL=postgresql+psycopg://postgres:replace-me@localhost:5432/sionna_simulation
AUTH_SECRET_KEY=replace-with-a-long-random-secret
ELASTICSEARCH_ENABLED=true
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_INDEX=sionna-logs-dev
```

Start the backend:

```powershell
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Start the frontend in another terminal:

```powershell
cd frontend
npm install
npm run dev
```

The Vite development server normally opens at http://127.0.0.1:5173. To use a
different backend, set `VITE_API_BASE_URL` in `frontend/.env`.

## Tests

Run backend tests from the repository root:

```powershell
python -m pytest test -q
```

Verify the frontend production build:

```powershell
cd frontend
npm install
npm run build
```

Full Sionna simulations are hardware-dependent and are not part of the normal unit
test suite.

## Main API endpoints

The complete interactive API documentation is available at
http://127.0.0.1:8000/docs while the backend is running.

```text
POST   /api/v1/auth/register
POST   /api/v1/auth/login

POST   /api/v1/network-coverage
POST   /api/v1/coverage-map
POST   /api/v1/rsrp-simulation
POST   /api/v1/sinr
POST   /api/v1/throughput-comparison

GET    /api/v1/simulation-jobs/{job_id}
GET    /api/v1/simulation-runs
GET    /api/v1/simulation-runs/{run_id}
GET    /api/v1/simulation-runs/{run_id}/result
DELETE /api/v1/simulation-runs/{run_id}

GET    /api/v1/scenes
GET    /api/v1/scenes/active
POST   /api/v1/scenes/preview
POST   /api/v1/scenes/{scene_id}/activate
DELETE /api/v1/scenes/{scene_id}
```

## Project structure

```text
backend/                    FastAPI API, services, storage, and simulations
frontend/                   React/Vite user interface
test/                       Backend unit tests
docker/                     Nginx configuration
docker-compose.yml          Complete application stack
Dockerfile.backend          Backend image
Dockerfile.frontend         Frontend production image
.env.docker.example         Safe Docker configuration template
```

Runtime scene files and generated simulation output are stored under `static/` on
the host or in the `application-static` Docker volume. They are intentionally not
committed to Git.

## Troubleshooting

### A container is unhealthy or repeatedly restarting

```powershell
docker compose ps
docker compose logs --tail 200 backend
docker compose logs --tail 200 postgres
```

Confirm that `.env.docker` exists and that you used `--env-file .env.docker`.

### A port is already in use

Change `POSTGRES_HOST_PORT` in `.env.docker` for PostgreSQL. For ports 8000, 8080,
9200, or 5601, stop the conflicting program or change the corresponding host-side
port in `docker-compose.yml`.

### Login or history does not work

Check the backend and PostgreSQL logs. In Docker, the backend receives its database
connection settings from the `POSTGRES_*` variables in `docker-compose.yml`.

### Kibana does not show simulation types

Filter with `simulation_type: *`. Generic request and health-check events do not
have a simulation type.

### Generated files disappeared

Generated files survive ordinary container restarts in the `application-static`
volume. They are permanently removed by `docker compose down -v`.

## Current scene limitation

The map picker records the selected real-world bounds but currently creates a
runnable scene from Sionna's bundled `simple_street_canyon` example. It does not
yet convert OpenStreetMap building geometry into a complete Sionna RT scene.
