# Backend Agent Guide

Applies under `backend/` in addition to the root guide.

- Keep `api/` thin, contracts in `schemas/`, domain/persistence logic in
  `services/`, ORM in `models.py`, and Sionna conversions in `simulations/`.
- Use existing DB URL/session patterns. Schema changes need an Alembic revision;
  preserve PostGIS exclusions and legacy adoption safeguards.
- Durable jobs must preserve leases, heartbeats, retries, cancellation, priority,
  and idempotent finalization. Read `../docs/simulation-job-reliability.md` only
  for queue/worker changes.
- Preserve separate ownership for queue, History, scene, and Impact artifacts.
- PostgreSQL/PostGIS is required before the backend starts; validate the database
  connection and current migration head during startup.

Find code with `rg` before opening files. Common entry points: `main.py`, `api/`,
`schemas/requests.py`, `services/simulation_worker.py`,
`services/simulation_job_store.py`, `services/simulation_store.py`,
`services/scene_service.py`, `services/osm_scene_builder.py`, and
`services/optimization_service.py`.

Validate narrowly first: `python -m pytest test/<relevant_test>.py -q`. Use
`python -m pytest test -q` or `ruff check backend test` only when scope warrants
it. Full Sionna validation is required only for explicitly runtime-dependent work.
