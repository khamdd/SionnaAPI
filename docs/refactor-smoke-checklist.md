# Refactor Smoke Checklist

Use this checklist after a refactor pass in addition to targeted automated tests.
Only run the sections touched by a small pass; run the complete checklist before
closing a phase.

## Preconditions

- [ ] Copy `.env.docker.example` to an untracked `.env.docker` and provide a real
      `AUTH_SECRET_KEY`.
- [ ] Run `powershell -ExecutionPolicy Bypass -File scripts/test-backend.ps1`.
- [ ] Run `npm ci` and `npm run build` from `frontend/`.
- [ ] Run `docker compose --env-file .env.docker up --build -d`.
- [ ] Confirm `docker compose ps` reports PostgreSQL, Elasticsearch, backend, and
      frontend healthy/running; confirm the worker is running and one-shot setup
      services completed successfully.
- [ ] Confirm `GET http://127.0.0.1:8000/health` returns `{"status":"ok"}`.

## Authentication and routing

- [ ] Open an unknown URL while signed out; Login is shown.
- [ ] Register or log in; the app opens `/scenes`.
- [ ] Directly open `/network` without a work scene; the app returns to `/scenes`
      with a notice.
- [ ] Select a scene; the app opens `/network` and planning/result navigation is
      available.
- [ ] Browser Back and Forward preserve normalized routes.
- [ ] Cancel Change scene; current scene and drafts remain.
- [ ] Confirm Change scene; current-scene drafts clear and `/scenes` opens.

## Scene flow

- [ ] Open Create new scene and draw a valid area.
- [ ] Import a valid antenna workbook before or after drawing; markers appear.
- [ ] Preview the scene, keep/load it, and confirm only in-bounds imported
      antennas become fixed antennas.
- [ ] Cancel an unkept preview and confirm temporary artifacts are cleaned.
- [ ] Delete a scene only after confirmation and confirm generated artifacts are
      removed.

## Simulation submission

For each simulation type touched by the refactor:

- [ ] Existing defaults and validation messages are unchanged.
- [ ] Fixed/type 2 antenna rules are unchanged.
- [ ] Disabled antennas remain in the draft but are not rendered/submitted where
      enabled toggles apply.
- [ ] The submitted request matches the golden fixture shape.
- [ ] Queued mode returns a job ID and opens the queue prompt.
- [ ] Inline mode returns the existing success/failure shape.
- [ ] SINR/Throughput analytical propagation works without waiting for 3D scene
      loading.

## Queue and History

- [ ] A queued job transitions through queued/running/terminal state.
- [ ] A running job cannot be selected for deletion.
- [ ] Cancellation remains cooperative and reports the existing state.
- [ ] A succeeded job opens its full result.
- [ ] Saving creates one History run; saving again returns the same run.
- [ ] Deleting the saved queue entry leaves History intact.
- [ ] Deleting an unsaved queue entry removes temporary artifacts.
- [ ] History remains scoped to the selected scene.
- [ ] Compatible successful runs compare; incompatible runs cannot be selected
      together.
- [ ] History deletion requires confirmation and removes owned artifacts.

## Configuration, profiles, and Impact Studies

- [ ] Create a configuration draft and inspect its exact diff.
- [ ] Publish after confirmation; the prior published version becomes superseded.
- [ ] Create a disabled profile, validate it against a readable same-scene
      configuration, and enable it.
- [ ] Preview one explicit baseline/candidate pair without creating rows/jobs.
- [ ] Create and start an Impact Study; repeat start and confirm no duplicate jobs.
- [ ] Inspect terminal comparison and report.
- [ ] Confirm at most one terminal notification exists.
- [ ] If optimization is triggered, create the suggested draft and confirm it is
      not automatically published.

## Artifact and observability checks

- [ ] Heavy queue/History JSON is stored in its existing directory.
- [ ] Authenticated artifact URLs still resolve.
- [ ] No delete operation removes a file outside `static/`.
- [ ] Request logs redact sensitive fields.
- [ ] Kibana receives simulation and business events with existing event names.

## Evidence to attach to a refactor pull request

- Automated test command and result.
- Frontend build output.
- OpenAPI contract result.
- Docker service status.
- Relevant screenshots or a short note identifying the manually exercised path.
- Any intentionally changed fixture with its separately approved migration task.
