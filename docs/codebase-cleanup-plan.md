# Codebase Cleanup Plan

Scope: reduce the size and complexity of the codebase without changing product behavior
or breaking the running app. The plan is structured into five phases, ordered from
lowest risk (pure deletions) to highest risk (behavior-preserving refactors).

This document assumes the canonical workflow described at the top is the reference.
Anything that does not serve that workflow is a cleanup candidate.

## Canonical workflow (reference architecture)

```
USER
 1. Login ─────► JWT in localStorage
 2. /scenes ───► pick or /choose-scene (MapLibre, draw area,
                 optional XLSX antennas, preview, load)
 3. /network / /coverage / /rsrp / /sinr / /throughput
    ─► build request (1–10 antennas, scene solver)
 4. POST /api/v1/<sim>
    ┌────────────── DB configured? ──────────────┐
    │ yes                                         │ no
    ▼                                             ▼
   simulation_jobs row        run inline under engine.lock
   (status=queued)                  (sionna.rt.Scene)
            │
            │ claim (FOR UPDATE SKIP LOCKED)
            ▼
   simulation-worker (Docker) or in-process thread
    ├─ heartbeat (20s), lease (90s), timeout (1h)
    ├─ call coverage_service / rsrp_service / ...
    └─ write static/simulation-job-results/<id>.json
            │
            ▼
   /queue: user reviews, clicks "Save to history"
            │
            ▼
   POST /simulation-jobs/{id}/save
    └─► store_simulation_result
         ├─► simulation_runs row + per-antenna snapshots
         └─► static/simulation-results/<run_id>.json
            │
            ▼
   /history (scoped to active scene, can compare)
```

Automation side (separate from manual sims):

```
/configurations    ─► immutable antenna versions (draft|published|superseded)
                      SHA-256 hash, partial unique index per scene
/profiles          ─► saved solver/radio/sampling/role settings
                      eligible only against a readable same-scene config
/impact-studies    ─► durable paired baseline/candidate child jobs
                      reconcile ─► comparison ─► report ─► notification
/network/optimization ─► deterministic global+local search (Halton, beam)
                         Apply → mutates /network draft only
```

## Current state (what was measured)

Largest files in the codebase (lines of code, top offenders):

| File | Lines | Why it is a cleanup target |
| --- | --- | --- |
| `frontend/src/components/ApiPages.jsx` | 2,269 | Coverage + RSRP + SINR + Throughput pages crammed together; almost certainly duplicated antenna, solver, and result panels |
| `frontend/src/App.jsx` | ~2,100+ | Single-file state machine owning auth, scene gating, four draft types, queue, history, comparison, modals |
| `frontend/src/components/Scene3DPreview.jsx` | 1,529 | Three.js scene + camera + antenna visualization + result overlay in one file |
| `frontend/src/components/SceneChooserModal.jsx` | 1,096 | MapLibre + region manager + drawing + XLSX import in one file |
| `frontend/src/components/SimulationProfilesPage.jsx` | 870 | Eligibility + editor + role pickers likely overlap |
| `backend/services/optimization_service.py` | 913 | Beam search + Halton sampling + ranking + objective extraction |
| `backend/services/simulation_job_store.py` | 731 | Claim, reconcile, cancel, heartbeat all in one module |
| `backend/services/impact_study_service.py` | 706 | Lifecycle + comparison trigger + suggestion creation + cancel |
| `backend/services/simulation_store.py` | 701 | Inline result persistence + artifact management |
| `backend/services/impact_planner.py` | 633 | v1 and v2 planners + diff application |
| `backend/services/impact_comparison_service.py` | 521 | Metric specs + KPI normalization + spatial deltas |
| `backend/services/impact_report_service.py` | 500 | HTML rendering + atomic write |

Likely duplication to verify before refactoring:

- Antenna-card UI for type 1 and type 2 across Network, RSRP, SINR, and Throughput
  (probably four near-identical copies).
- Per-scene localStorage draft read/write helpers — same pattern, four separate
  keys under `frontend/src/constants/storage.js`.
- Solver and radio form components — probably duplicated four times inside
  `ApiPages.jsx`.
- Antenna-role assignment UI (`transmitter`, `receiver`, `interferer`) duplicated
  between SINR and Throughput.
- Backend request-validation pipeline (`align_request_solver_to_scene`,
  `validate_request_positions_inside_solver`, `with_runtime_antenna_positions`)
  is called from five endpoints — verify whether it is already factored.
- The run/queue dispatcher logic in `backend/api/sinr.py:queue_or_run` — verify
  whether it is reused by all simulation endpoints or copy-pasted.

Confirmed dead-in-practice code (safe to remove after final verification):

- `POST /optimizations/network-coverage/evaluate` in `backend/api/sinr.py:484`
- `POST /optimizations/network-coverage/candidates/preview` in `backend/api/sinr.py:499`
- `POST /optimizations/network-coverage/candidate-request/preview` in
  `backend/api/sinr.py:513`

The frontend no longer exposes these stages; AGENTS.md already records that fact.

Do not touch yet (still in active use, even if legacy):

- `impact_planner.preview_configuration_impact_legacy` is still called by
  `impact_study_service.create_impact_study` at `impact_study_service.py:56`. The
  handoff doc `docs/scenario-comparison-v2-handoff.md` describes the future v2
  migration; until durable paired persistence lands, v1 is the production path.
- The `simulation-store` versus `simulation-job-store` split — both are needed
  (queue results are temporary until the user saves them, history is durable).

## Phase 0 — Pre-flight

No code changes. Just establish the safety net before any cleanup begins.

1. Confirm the full test suite is green: `python -m pytest test -q`.
2. Confirm the frontend builds: `cd frontend && npm run build`.
3. Confirm the Docker stack boots end-to-end (postgres, migrate, backend, worker,
   frontend). This is the safety net for any cleanup PR.
4. Open a tracking issue list. Each cleanup task gets a checkbox and a "what to
   verify" line.

Stop here until Phase 0 is green.

## Phase 1 — Pure deletions (lowest risk, biggest LOC win)

Goal: remove code that nothing actually calls anymore.

1. Remove the three unused optimization preview endpoints from
   `backend/api/sinr.py` (lines ~483–530). Verify before deleting:

   ```powershell
   rg "evaluateNetworkCoverageOptimization|previewNetworkCoverageOptimization" frontend
   rg "/optimizations/network-coverage/(evaluate|candidates|candidate-request)/preview" .
   ```

2. Search for every `@router.<method>("...")` decorator in `backend/api/` and
   cross-check each is referenced by `frontend/src/api.js`. Remove any that are
   not.
3. Search `backend/` and `frontend/src/` for `TODO`, `FIXME`, `XXX`, and
   `# deprecated` markers. Triage each.
4. Run pytest, frontend build, and a smoke test against a live simulation flow.
   Stop here and ship before continuing.

Expected win: a few hundred lines removed with zero behavior change if the
verification in step 1 comes back clean.

## Phase 2 — Static analysis and lint tightening (no behavior change)

1. Backend: add `ruff` (or `flake8 + isort + black`) via `pyproject.toml`. Fix
   everything it flags, except long-line warnings inside HTML strings in
   `impact_report_service.py`.
2. Frontend: turn on stricter ESLint rules incrementally (`no-unused-vars`,
   `react-hooks/exhaustive-deps`). Fix only what is auto-fixable or trivially
   wrong. Do not address architectural warnings yet.
3. Backend: run `mypy backend` on the service layer only. Address type holes
   that block test reliability. Ignore Pydantic/JSON serialization noise.
4. Ship as a series of small commits. No refactors in this phase.

Expected win: code consistency and future-regression safety, no behavior change.

## Phase 3 — Extract shared frontend primitives (medium risk)

Goal: break up `ApiPages.jsx` and `App.jsx` without changing behavior.

1. Identify duplication by reading `ApiPages.jsx` and listing the components it
   exports (`CoverageApiPage`, `RsrpSimulationPage`, `SinrApiPage`,
   `ThroughputApiPage`). For each, find the antenna panel, the solver panel, and
   the result panel.
2. Extract duplicated pieces into new files under
   `frontend/src/components/<sim>/`:
   - `AntennaPanel.jsx` — shared by Network, RSRP, SINR, Throughput.
   - `SolverForm.jsx` — solver + radio + sampling.
   - `RoleAssignPanel.jsx` — three-role picker for SINR and Throughput.
   - `ResultView.jsx` — coverage/RSRP/SINR/Throughput result renderer, one
     component with a mode prop.
3. Split `App.jsx` by introducing hooks:
   - `useAuth()`, `useWorkScene()`, `useSceneDraft(<storageKey>)`,
     `useSimulationRunner()`, `useHistory()`, `useQueue()`.
   - Pages that currently live inline in `App.jsx` (`NetworkCoveragePage`,
     `QueueRoutePage`, `HistoryRoutePage`) move into their own files under
     `frontend/src/components/`.
4. Split `Scene3DPreview.jsx` by extracting: `<AntennaMarkers/>`,
   `<ResultOverlay/>`, `<CameraRig/>`.
5. Split `SceneChooserModal.jsx` by extracting: `<BuildingRegionManager/>`,
   `<AreaDrawer/>`, `<AntennaImportPanel/>`, `<ScenePreviewCard/>`.

Each extraction is a small commit. Manually smoke the affected page before
shipping.

Expected win: `ApiPages.jsx` from 2,269 lines to probably under 400 (just
dispatch). `App.jsx` halves in size. No new abstractions invented — only
relocated code.

## Phase 4 — Extract shared backend helpers (medium risk)

Goal: deduplicate backend service code without inventing new abstractions.

1. Read each of the five simulation services (`coverage`, `rsrp`, `sinr`,
   `throughput`, plus `optimization`'s `execute_simulation` shim) and find the
   request → result pattern. Look for a shared `_summarize_kpis(result)` or
   similar helper hiding in plain sight.
2. Move the request-validation pipeline (`align_request_solver_to_scene`,
   `validate_request_positions_inside_solver`, `with_runtime_antenna_positions`)
   into a single helper in `backend/services/request_pipeline.py` if it is not
   already factored.
3. `simulation_store` and `simulation_job_store` likely share artifact-URL and
   PNG-handling logic — factor into `backend/services/artifact_store.py`.
4. Split `optimization_service.py`: `halton.py`, `beam_selection.py`,
   `objective_evaluation.py`, `optimization_service.py` (orchestrator).
5. Split `impact_study_service.py` into lifecycle (start/cancel), reconciliation,
   and suggestion creation.

Each split is a small commit. Run tests and smoke one impact study end-to-end.

Expected win: each service file under ~400 lines; clearer ownership boundaries.

## Phase 5 — Behavior-preserving refactors (highest risk, do last)

Only after Phases 1 through 4 have landed and stabilized for at least one
release.

1. v1 to v2 impact-planner migration. Write a one-page plan describing the
   contract for v2 to support durable creation. Migrate
   `impact_study_service.create_impact_study` to call `preview_configuration_impact`.
   Keep `preview_configuration_impact_legacy` for one release behind a feature
   flag, then remove it.
2. Add the frontend notification badge and list. The backend is ready; the UI is
   the pending piece per AGENTS.md.
3. Tighten Pydantic request models. Many probably still accept
   `dict[str, Any]` where a typed model would catch bugs at the boundary.
4. Optional: replace the `App.jsx` route-switch with `react-router` if nested
   routes and lazy-loaded pages become desirable. Scope this carefully — it is a
   big-bang change.

## Suggested execution order

| Week | Phase | Done when |
| --- | --- | --- |
| 1 | Phase 1 + Phase 2 | Dead endpoints removed, lint green, tests pass |
| 2–3 | Phase 3 (frontend) | `ApiPages.jsx` split, `App.jsx` split into hooks + page files |
| 3–4 | Phase 4 (backend) | Each service file is roughly ≤ 400 lines, helpers extracted |
| Later | Phase 5 | After one stable release on the new shape |

## What to avoid during cleanup

- Renaming public API endpoints or DB columns during cleanup. New Alembic
  migrations are cheap to add, but data migrations are not.
- Touching `backend/services/optimization_service.py` and
  `backend/services/simulation_worker.py` at the same time. They are the
  highest-coupling pair in the codebase.
- Splitting `App.jsx` and `ApiPages.jsx` in the same commit. Keep refactors
  independently revertable.
- Writing new abstractions (interfaces, base classes) before seeing two or
  three duplications. Wait for the pattern, then name it.
- Removing `impact_planner.preview_configuration_impact_legacy` before the v2
  durable path is live. See `docs/scenario-comparison-v2-handoff.md`.

## Verification checklist (run after every phase)

```powershell
python -m pytest test -q
cd frontend && npm run build
docker compose --env-file .env.docker up --build -d
```

Plus, per page or endpoint touched:

- Log in.
- Load or create a scene.
- Run one of each simulation type you touched.
- Save the result to history.
- For automation changes: create one configuration, one profile, start one
  impact study, view its report.

If any of the above regresses, revert before continuing to the next phase.
