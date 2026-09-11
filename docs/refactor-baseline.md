# Refactor Phase 0 Baseline

Recorded: 2026-09-11  
Result: complete

This record captures the validation state before behavior-preserving refactor
implementation begins.

## Backend tests

Reproducible command:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/test-backend.ps1
```

Result:

```text
281 passed, 2 warnings in 2.37s
```

The command builds the `test` target in `Dockerfile.backend` and runs pytest in a
test-only image. The default `application` target remains the production image
and does not contain pytest or httpx.

Warnings recorded for a separate dependency/tooling task:

- FastAPI/Starlette reports that using `httpx` with `starlette.testclient` is
  deprecated in favor of `httpx2`.
- Starlette reports that the AnyIO `BlockingPortal` alias is deprecated.

The test target also exposed an environment-dependent existing test. The lazy
Sionna engine test now supplies its own active scene rather than depending on a
runtime scene registry; its product assertion remains unchanged.

## API contract

The normalized FastAPI OpenAPI document contains:

- 46 paths
- 53 operations
- SHA-256 `a2ed3a1f2524129da668553520cdab2d8621f1fe832aff9f7b84f4b63289a6b6`

`test/test_refactor_contracts.py` checks the digest, counts, and authentication
boundary. It also validates all canonical request fixtures against the current
Pydantic schemas.

## Frontend dependency and build baseline

Commands:

```powershell
cd frontend
npm ci
npm run build
```

Result:

- `npm ci`: succeeded; 46 packages installed.
- npm audit summary: 2 high-severity findings. No automatic fix was run because
  dependency changes are outside Phase 0.
- Vite version: 8.0.16.
- Modules transformed: 60.
- Build completed in approximately 1.50 seconds.

Bundle output:

| Output | Size | Gzip |
| --- | ---: | ---: |
| `dist/index.html` | 0.40 kB | 0.27 kB |
| MapLibre worker | 477.66 kB | Not reported |
| Main CSS | 188.10 kB | 32.83 kB |
| Main JavaScript | 2,153.27 kB | 571.36 kB |

Vite reports that the main chunk exceeds 500 kB. Route-level code splitting and
bundle optimization remain a separate performance task.

## Docker baseline

The existing default Compose database is stamped at revision
`0012_session_coverage_job`, which does not exist in this checkout. The default
stack correctly refused to migrate backward. No existing database or volume was
reset, stamped, or deleted.

The branch was validated in temporary Compose project `sionna-phase0` with clean,
isolated PostgreSQL and Elasticsearch volumes and alternate host ports.

Results:

- Database migration exited 0 at `0006_notifications (head)`.
- Observability setup exited 0.
- PostgreSQL healthy.
- Elasticsearch healthy.
- Backend healthy; `GET /health` returned `{"status":"ok"}`.
- Frontend healthy; `/` returned HTTP 200.
- Simulation worker running.
- Registration succeeded against the temporary database.
- Token verification succeeded.
- Authenticated scene listing succeeded and returned zero scenes, as expected for
  a clean baseline.

The temporary project and its volumes were removed after validation.

## Phase 0 artifacts

- `docs/refactor-contract.md`
- `docs/frontend-route-matrix.md`
- `docs/scene-draft-compatibility.md`
- `docs/refactor-smoke-checklist.md`
- `test/fixtures/refactor/simulation_requests.json`
- `test/fixtures/refactor/frontend_contract.json`
- `test/fixtures/refactor/local_storage_contract.json`
- `test/test_refactor_contracts.py`
- `scripts/test-backend.ps1`

## Known baseline limits

- Full GPU/Sionna simulations were not run; they remain outside the normal unit
  suite and depend on suitable hardware/runtime data.
- The complete manual smoke checklist was created but not executed against a
  populated scene because the isolated baseline database intentionally began
  empty.
- The default local database belongs to a newer migration lineage than this
  checkout. Future default-stack validation requires the matching branch or a
  deliberately selected compatible database; it must not downgrade the existing
  database.
