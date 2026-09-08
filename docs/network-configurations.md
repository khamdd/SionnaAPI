# Versioned network configurations

Network configurations are immutable database snapshots of the antenna settings
that affect simulations. They are separate from the existing browser drafts, so
the current simulation pages continue to work unchanged.

## Lifecycle

1. `POST /api/v1/network-configurations` creates a draft. Send the full antenna
   snapshot, or send a parent configuration ID without `antennas` to clone it.
2. If a scene already has a published version, it becomes the default parent of a
   new draft.
3. `POST /api/v1/network-configurations/{id}/publish` publishes a draft and marks
   the previous published version as `superseded`.
4. Old versions remain readable. Published and superseded rows are never edited.
5. A draft identical to the current published snapshot is rejected with HTTP 409
   and `error_code: configuration_unchanged`.

The server sorts antennas by ID and canonicalizes numeric values before computing
a SHA-256 content hash. One database constraint allows at most one published
configuration per scene.

## Access and runtime rules

- All endpoints require authentication.
- Scenes are currently shared project resources, so published and superseded
  versions are readable by authenticated users.
- Drafts are visible only to their creator, and only that creator can publish.
- These APIs return HTTP 503 when no database is configured. Existing localStorage
  drafts and inline simulations remain available in no-database mode.

## Endpoints

- `POST /api/v1/network-configurations`
- `POST /api/v1/network-configurations/compare`
- `GET /api/v1/network-configurations?scene_id=...&status=draft`
- `GET /api/v1/network-configurations/{id}`
- `POST /api/v1/network-configurations/{id}/publish`
- `GET /api/v1/scenes/{scene_id}/active-configuration`
