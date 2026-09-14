Place the offline PMTiles assets used by the scene chooser in this directory:

- `vietnam.pmtiles`
- `building-regions.json`
- `vn-buildings-*.pmtiles`

Province and ward reference data is no longer served from this directory.
The scene chooser loads provinces, ward search results, and ward boundaries
from the database-backed `/api/v1/vietnam/*` endpoints. The `vietnam-provinces.csv`,
`vietnam-wards.csv`, and per-province `vn-wards-*.geojson` archives in this
directory are seed sources for `scripts/seed_vietnam_admin.py` and are tracked
in git.

The Docker frontend build checks for the base map, the building manifest,
the Vietnam ward seed CSV, and at least one regional building PMTiles archive
before running `npm run build`.
The PMTiles files are large local assets and are intentionally ignored by git.
