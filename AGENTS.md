# Sionna Simulation Agent Guide

This is a FastAPI/Sionna RT/SQLAlchemy and React/Vite radio-planning app. Read
the nearest nested `AGENTS.md` before changing `backend/` or `frontend/`.

## Context Budget

- Use the minimum context needed: start with `rg`, then open only directly
  relevant files and documentation sections. Do not inventory the whole repo.
- Do not reread unchanged files or repeat tool output. Prefer targeted line ranges.
- For ordinary work, use the fewest useful tool calls and concise progress/final
  messages. Stop investigating once evidence is sufficient to implement or answer.
- Read feature docs only when the task touches that feature. The focused feature
  document is authoritative; `docs/system-behavior.md` is orientation, not a
  detailed contract.
- Do not copy feature detail across documents. Update `README.md` only for user
  or operator instructions and compatibility docs only when their stated
  boundary changes. Recorded baselines remain historical snapshots.
- Run targeted checks first; broaden validation only when change risk warrants it.

## Invariants

- API routes live under `/api/v1`; keep router, schema, service, and ORM concerns
  separate. Preserve authentication/authorization for owned and shared resources.
- PostgreSQL/PostGIS is optional locally. DB mode uses the durable queue; no-DB
  mode must start without migration validation and run supported work inline.
- Docker runs Alembic before the API and worker; the API does not create tables.
- Queue results remain temporary until saved to History. Queue, History, reports,
  and scenes own separate artifacts and cleanup rules.
- The app is scene-first. Preserve scene gating and scene-scoped state contracts.
- Configuration versions and submitted job/History request snapshots are immutable.
- Scene dimensions define solver bounds. `MAX_GRID_CELLS` may enlarge cell size;
  never restore an area cap or silently scale imported antennas.
- Azimuth is compass-based (0° north, clockwise); convert only at the simulation
  boundary.
- Every user-facing delete requires confirmation and must clean up only owned data
  and artifacts. Removing a queue item must not delete saved History.
- Preserve retained API, route, localStorage, and artifact contracts unless the
  task explicitly changes them; update focused tests and contract docs when changed.
- Never commit secrets, generated `static/` content, DB volumes, offline-map
  archives, or local runtime artifacts. Never revert unrelated user changes.

## Task Router

- Documentation ownership and update triggers: see the table below.
- Setup, Docker, migrations, commands, endpoints: `README.md`
- Current behavior: `docs/system-behavior.md`
- Refactor/artifact compatibility: `docs/refactor-contract.md`
- Routes and localStorage: `docs/frontend-route-matrix.md`,
  `docs/scene-draft-compatibility.md`
- Queue reliability: `docs/simulation-job-reliability.md`

### Documentation ownership

| Document | Update when |
| --- | --- |
| `docs/system-behavior.md` | A major user-visible flow or runtime boundary changes |
| `docs/refactor-contract.md` | A public API, artifact, error, or logging guarantee changes |
| `docs/frontend-route-matrix.md` | Routing or navigation behavior changes |
| `docs/scene-draft-compatibility.md` | A persisted browser key, shape, or cleanup rule changes |
| `docs/simulation-job-reliability.md` | Queue execution or reliability behavior changes |
| `README.md` | Setup, deployment, operator workflow, or headline API entry points change |
| `docs/database-baseline.md`, `docs/refactor-baseline.md` | Historical evidence only; do not update for normal features |

Update the authoritative document only. Prefer links over copied lists, tables,
defaults, and algorithms.
- Feature contracts: the matching file in `docs/`.

High-value entry points are `backend/main.py`, `backend/models.py`,
`backend/api/`, `backend/schemas/`, `backend/services/`, `backend/simulations/`,
`frontend/src/App.jsx`, `frontend/src/api/`, and
`frontend/src/hooks/useSceneAntennaDraft.js`.

Full Sionna runs are hardware-dependent and are not required for ordinary unit
validation. Use existing utilities and constants instead of ad hoc duplicates.
