# Frontend Agent Guide

Applies under `frontend/` in addition to the root guide.

- Preserve scene-first routing and scene gating. Read the route/storage contract
  docs only when changing routing or localStorage.
- Keep `src/api.js` as the compatibility barrel; implementations belong in
  `src/api/`, with shared HTTP behavior in `src/api/http.js`.
- Use `useSceneAntennaDraft` for scene-scoped antenna drafts. Inventory owns
  identity/location/height; simulation controls and roles are scene overrides.
- Submission may return a queued job. Queue owns polling, review, History save,
  and discard; API clients must not wait for completion.
- Keep `Scene3DPreview` camera state frontend-only and preserve on-demand Three.js
  rendering without rebuilding scenes for unrelated React state.
- Every visible delete action requires confirmation.

Find code with `rg` before opening files. Common entry points: `src/App.jsx`,
`src/components/`, `src/hooks/useSceneAntennaDraft.js`, `src/api/`,
`src/constants/`, and `src/utils/`.

Run the narrowest relevant Vitest first. Use `npm test`, `npm run lint`, and
`npm run build` as broader gates when scope warrants them. Preserve the restrained
operational visual style unless redesign is requested.
