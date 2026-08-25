Place the offline PMTiles assets used by the scene chooser in this directory:

- `vietnam.pmtiles`
- `building-regions.json`
- `vn-buildings-*.pmtiles`

The Docker frontend build checks for the base map, the building manifest, and at
least one regional building PMTiles archive before running `npm run build`.
The PMTiles files are large local assets and are intentionally ignored by git.
