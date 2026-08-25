Place the offline PMTiles assets used by the scene chooser in this directory:

- `vietnam.pmtiles`
- `hanoi-buildings.pmtiles`

The Docker frontend build checks for both files before running `npm run build`.
The files are large local assets and are intentionally ignored by git.
