# Offline Vietnam Map + 3D Buildings — Codex Migration Brief

## Objective

Migrate the working offline Vietnam map implementation from the test Vite/React project into the main application.

The working test project currently provides:

- Fully offline Vietnam basemap using `vietnam.pmtiles`
- MapLibre GL JS rendering
- PMTiles support through the `pmtiles` package
- OSM building footprints extracted from `vietnam-260823.osm.pbf`
- Building data divided into regional `1° × 1°` PMTiles archives
- Dynamic loading/unloading of regional building PMTiles based on the current viewport
- 3D building extrusion
- Building height logic:
  - use OSM `height` when available
  - otherwise use `building:levels × 3m`
  - otherwise use `9m` as a temporary fallback
- No internet connection required at runtime

The test project is a **reference implementation for behavior**.  
The main project's existing architecture should remain the source of truth for component organization.

---

# 1. High-Level Runtime Architecture

```text
                     React application
                            │
                            ▼
                       MapLibre GL
                            │
            ┌───────────────┴────────────────┐
            │                                │
            ▼                                ▼
    vietnam.pmtiles                building-regions.json
      base map                              │
                                             ▼
                                    determine visible cells
                                             │
                                             ▼
                                  regional building PMTiles
                                             │
                                             ▼
                                       3D buildings
```

At runtime, the browser should only need:

```text
React
MapLibre GL
PMTiles JS

public/map-data/
├── vietnam.pmtiles
├── building-regions.json
└── vn-buildings-*.pmtiles
```

The browser must **not** need:

```text
Docker
Tilemaker
Osmium
vietnam-260823.osm.pbf
vietnam-buildings.osm.pbf
```

Those are preprocessing/development tools only.

---

# 2. Required NPM Dependencies

The main frontend needs:

```bash
npm install maplibre-gl pmtiles
```

Responsibilities:

- `maplibre-gl`
  - renders vector map data
  - provides pan/zoom/pitch/bearing
  - renders 3D `fill-extrusion` building layers

- `pmtiles`
  - allows MapLibre to read `.pmtiles` archives through the custom `pmtiles://` protocol

Do not introduce online tile providers such as:

```text
Mapbox
MapTiler
Google Maps
OpenStreetMap public tile servers
Protomaps hosted styles
```

The final application must work fully offline.

---

# 3. Runtime Data Files

Copy the working map data from the test project into an appropriate public/static directory in the main frontend.

Recommended structure:

```text
public/
└── map-data/
    ├── vietnam.pmtiles
    ├── building-regions.json
    ├── vn-buildings-104-105-9-10.pmtiles
    ├── vn-buildings-105-106-9-10.pmtiles
    ├── vn-buildings-105-106-10-11.pmtiles
    ├── vn-buildings-106-107-10-11.pmtiles
    ├── ...
    └── vn-buildings-106-107-21-22.pmtiles
```

The exact directory can change if the main project already has a convention for static assets.

The important requirement is that the browser can request the files locally.

For example:

```text
/map-data/vietnam.pmtiles
/map-data/building-regions.json
/map-data/vn-buildings-105-106-20-21.pmtiles
```

---

# 4. `vietnam.pmtiles`

## Purpose

`vietnam.pmtiles` is the offline **base map**.

It contains vector-tile data for map features such as:

```text
land
ocean
water_polygons
streets
buildings
etc.
```

For this project, use it primarily for the base cartographic layers:

```text
background
land
ocean
water
roads
```

The OSM-derived regional building PMTiles should be used for the actual 3D building overlay.

## MapLibre Source

Register it as:

```js
vietnam: {
  type: "vector",
  url: `pmtiles://${window.location.origin}/map-data/vietnam.pmtiles`,
}
```

Example road layer:

```js
{
  id: "roads",
  type: "line",
  source: "vietnam",
  "source-layer": "streets",
  paint: {
    "line-color": "#ffffff",
    "line-width": [
      "interpolate",
      ["linear"],
      ["zoom"],
      8, 0.5,
      12, 1.5,
      16, 4,
    ],
  },
}
```

---

# 5. Regional Building PMTiles

Files follow this naming convention:

```text
vn-buildings-WEST-EAST-SOUTH-NORTH.pmtiles
```

Example:

```text
vn-buildings-105-106-20-21.pmtiles
```

means:

```text
longitude: 105 → 106
latitude:   20 → 21
```

Each PMTiles archive contains an internal vector layer named:

```text
buildings
```

MapLibre therefore accesses it with:

```js
"source-layer": "buildings"
```

Possible feature properties include:

```text
building
height
levels
```

Example:

```json
{
  "building": "apartments",
  "height": 18,
  "levels": 6
}
```

Some OSM buildings only contain:

```json
{
  "building": "yes"
}
```

Therefore the frontend needs fallback height logic.

---

# 6. `building-regions.json`

## Purpose

This manifest tells the frontend:

- which regional PMTiles files actually exist
- which geographic bounds each file represents

Example:

```json
[
  {
    "id": "105-106-20-21",
    "file": "vn-buildings-105-106-20-21.pmtiles",
    "west": 105,
    "east": 106,
    "south": 20,
    "north": 21
  },
  {
    "id": "105-106-21-22",
    "file": "vn-buildings-105-106-21-22.pmtiles",
    "west": 105,
    "east": 106,
    "south": 21,
    "north": 22
  }
]
```

Load it with:

```js
const response = await fetch("/map-data/building-regions.json");
const buildingRegions = await response.json();
```

Do **not** hardcode all regional PMTiles files into the React component.

---

# 7. Why Dynamic Region Loading Is Required

There may be dozens of building PMTiles files.

Do not permanently register every archive in MapLibre.

Instead:

```text
User moves map
      ↓
MapLibre reports viewport bounds
      ↓
compare viewport with building-regions.json
      ↓
find intersecting 1×1 regions
      ↓
load only those PMTiles sources/layers
      ↓
remove regions that are no longer visible
```

This keeps the frontend scalable and avoids unnecessary source/layer management.

---

# 8. PMTiles Protocol Registration

MapLibre does not understand `pmtiles://` by default.

Register the PMTiles protocol once when the map component initializes.

```js
import { Protocol } from "pmtiles";

const protocol = new Protocol();

addProtocol("pmtiles", protocol.tile);
```

After that, MapLibre sources can use:

```text
pmtiles://http://localhost:5173/map-data/vietnam.pmtiles
```

or the equivalent local origin at runtime.

---

# 9. MapLibre + Vite Worker Setup

The working test project uses current MapLibre with Vite.

Use:

```js
import {
  Map,
  NavigationControl,
  addProtocol,
  removeProtocol,
  setWorkerUrl,
} from "maplibre-gl";

import "maplibre-gl/dist/maplibre-gl.css";

import workerUrl from
  "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
```

Before creating the map:

```js
setWorkerUrl(workerUrl);
```

Do not use the old default import:

```js
import maplibregl from "maplibre-gl";
```

The working implementation uses named imports.

If the main project does not use Vite, inspect its bundler and adapt the MapLibre worker setup appropriately.

---

# 10. Recommended Component Structure

Do not blindly copy the test project's whole `App.jsx`.

Integrate the map into the main project's existing architecture.

A possible structure is:

```text
src/
└── components/
    └── OfflineVietnamMap/
        ├── OfflineVietnamMap.jsx
        ├── OfflineVietnamMap.css
        ├── buildingRegionManager.js
        └── mapStyle.js
```

Suggested responsibilities:

## `OfflineVietnamMap.jsx`

- MapLibre lifecycle
- PMTiles protocol registration
- MapLibre worker setup
- map creation/destruction
- user interaction/event handling
- integration with main project's scene-selection UI

## `mapStyle.js`

- base map source
- background
- land
- ocean
- water
- roads
- shared colors/style configuration

## `buildingRegionManager.js`

- load `building-regions.json`
- determine which regions intersect the viewport
- add regional PMTiles source
- add 3D building layer
- remove regional layer/source
- maintain set of active regions

This separation is optional if the main project already has a better convention.

---

# 11. Base Map Initialization

Equivalent behavior to the test project:

```js
const map = new Map({
  container: mapContainer.current,

  center: [105.8342, 21.0278],

  zoom: 15,

  pitch: 55,

  bearing: -15,

  style: {
    version: 8,

    sources: {
      vietnam: {
        type: "vector",
        url:
          `pmtiles://${window.location.origin}/map-data/vietnam.pmtiles`,
      },
    },

    layers: [
      // background
      // land
      // ocean
      // water
      // roads
    ],
  },
});
```

`pitch` is important for clearly seeing the building extrusion.

---

# 12. Adding a Regional Building Source

For each visible region:

```js
const sourceId =
  `building-source-${region.id}`;

map.addSource(sourceId, {
  type: "vector",

  url:
    `pmtiles://${window.location.origin}/map-data/${region.file}`,
});
```

Use a unique source ID per region.

---

# 13. 3D Building Layer

Each regional source should get one `fill-extrusion` layer.

```js
map.addLayer({
  id: `building-layer-${region.id}`,

  type: "fill-extrusion",

  source: sourceId,

  "source-layer": "buildings",

  minzoom: 14,

  paint: {
    "fill-extrusion-color": "#d18b62",

    "fill-extrusion-height": [
      "case",

      ["has", "height"],
      ["get", "height"],

      ["has", "levels"],
      ["*", ["get", "levels"], 3],

      9,
    ],

    "fill-extrusion-base": 0,

    "fill-extrusion-opacity": 0.9,
  },
});
```

---

# 14. Building Height Policy

Preserve this exact behavior initially:

```text
OSM height exists?
       │
      YES
       ↓
use height
       │
      NO
       ↓
OSM levels exists?
       │
      YES
       ↓
levels × 3m
       │
      NO
       ↓
use 9m fallback
```

Equivalent MapLibre expression:

```js
[
  "case",

  ["has", "height"],
  ["get", "height"],

  ["has", "levels"],
  ["*", ["get", "levels"], 3],

  9,
]
```

The `9m` fallback is for visualization only.

The architecture should allow this fallback to be replaced later by a more accurate building-height estimation pipeline.

---

# 15. Dynamic Viewport Intersection

Maintain the currently loaded region IDs:

```js
const activeRegions = new Set();
```

Get current map bounds:

```js
const bounds = map.getBounds();
```

A region intersects the current viewport when:

```js
region.east > bounds.getWest() &&
region.west < bounds.getEast() &&
region.north > bounds.getSouth() &&
region.south < bounds.getNorth()
```

For every update:

1. find required/intersecting regions
2. add missing regions
3. remove regions that are active but no longer required

---

# 16. Do Not Load Buildings at Low Zoom

Use behavior equivalent to:

```js
if (map.getZoom() < 13.5) {
  // remove active building regions
  return;
}
```

Reason:

```text
Zoom 6
whole Vietnam
→ no individual building rendering needed

Zoom 10
province/city scale
→ still unnecessary

Zoom 14+
neighborhood scale
→ load building PMTiles

Zoom 16+
3D buildings clearly visible
```

---

# 17. Map Events

After loading the building manifest:

```js
updateBuildingRegions();
```

Then listen for:

```js
map.on("moveend", updateBuildingRegions);
map.on("zoomend", updateBuildingRegions);
```

This makes building loading respond to the user's viewport rather than requiring manually selected cities.

---

# 18. Removing a Region Correctly

MapLibre requires layers to be removed before their source.

Correct order:

```js
if (map.getLayer(layerId)) {
  map.removeLayer(layerId);
}

if (map.getSource(sourceId)) {
  map.removeSource(sourceId);
}
```

Do not reverse this order.

---

# 19. React Cleanup

When the map component unmounts:

```js
return () => {
  map.remove();

  try {
    removeProtocol("pmtiles");
  } catch {
    // ignore cleanup issue
  }
};
```

This is important when the map is part of routed screens in the main project.

---

# 20. Preprocessing Files — Not Runtime Files

These files/tools were used to create the final regional PMTiles and are not required by the application runtime.

```text
data-source/
├── vietnam-260823.osm.pbf
└── vietnam-buildings.osm.pbf

tile-build/
├── config-buildings.json
└── process-buildings.lua

working/

Docker
Tilemaker
Osmium
```

Keep them only if the project needs to rebuild/update map data later.

---

# 21. Purpose of `vietnam-260823.osm.pbf`

Original raw OpenStreetMap Vietnam extract.

Contains:

```text
roads
buildings
rivers
railways
boundaries
POIs
etc.
```

This file is not loaded by MapLibre.

It is developer-side source data only.

---

# 22. Purpose of `vietnam-buildings.osm.pbf`

Generated building-focused OSM PBF.

Created from the full Vietnam PBF by filtering for:

```text
building
building:part
```

Purpose:

```text
Full Vietnam OSM PBF
        ↓
Osmium tags-filter
        ↓
building-only PBF
```

This dramatically reduces the amount of irrelevant data that later preprocessing must handle.

---

# 23. Purpose of `tile-build/config-buildings.json`

Tilemaker configuration.

It defines the output vector layer:

```json
"layers": {
  "buildings": {
    "minzoom": 14,
    "maxzoom": 14
  }
}
```

This is why the frontend later uses:

```js
"source-layer": "buildings"
```

Keep the config if future map regeneration is expected.

---

# 24. Purpose of `tile-build/process-buildings.lua`

Tilemaker processing script.

Responsibilities:

- detect OSM features tagged as:
  - `building`
  - `building:part`
- output their geometry into the vector layer:
  - `buildings`
- preserve useful properties such as:
  - `building`
  - `height`
  - `building:levels` as `levels`

The frontend consumes those properties for 3D rendering.

---

# 25. Purpose of `scripts/generate-building-manifest.mjs`

This utility scans:

```text
public/map-data/vn-buildings-*.pmtiles
```

and creates:

```text
building-regions.json
```

It should include only valid regional archives.

It should skip:

```text
empty PMTiles
invalid PMTiles
archives with invalid geographic bounds
```

This script is preprocessing/developer tooling, not browser runtime code.

---

# 26. Purpose of `scripts/fix-pmtiles-bounds.mjs`

This was a repair utility.

The first generation process created some PMTiles archives whose headers reported:

```text
bounds = 0,0,0,0
```

even though the filenames encoded the correct region.

Example:

```text
vn-buildings-105-106-20-21.pmtiles
```

means the correct bounds are:

```text
west  = 105
east  = 106
south = 20
north = 21
```

The repair script updated the PMTiles header accordingly.

This utility should normally not be required in future map builds if preprocessing correctly provides geographic bounds.

---

# 27. Correct Future Preprocessing Pipeline

Do not repeatedly feed the complete Vietnam PBF directly into Tilemaker for every `1° × 1°` region.

That caused disk-space problems.

The working preprocessing pipeline is:

```text
vietnam-260823.osm.pbf
           ↓
     Osmium tags-filter
           ↓
vietnam-buildings.osm.pbf
           ↓
    temporary 2° strip
           ↓
      1° × 1° PBF
           ↓
       Tilemaker
       NO --store
           ↓
regional building PMTiles
           ↓
delete temporary cell PBF
           ↓
next cell
```

This avoids Tilemaker creating many huge:

```text
mmap_0.dat
mmap_1.dat
mmap_2.dat
...
```

files.

Do not reintroduce Tilemaker `--store` unless there is a specific reason.

---

# 28. Geographic Bounds During Preprocessing

When creating future small Osmium extracts, use:

```text
--set-bounds
```

Example:

```bash
osmium extract \
  -b 105,20,106,21 \
  -s smart \
  --set-bounds \
  input.osm.pbf \
  -o output.osm.pbf
```

Also provide Tilemaker with the explicit regional bbox if useful:

```text
--bbox 105,20,106,21
```

This avoids producing PMTiles archives with invalid:

```text
0,0,0,0
```

bounds.

---

# 29. Offline Requirement

After migration, disconnect the machine from the internet and verify the map still works.

There must be no runtime calls to:

```text
openstreetmap.org
mapbox.com
maptiler.com
google.com
protomaps.com
unpkg.com
jsdelivr.net
other external tile/style/font/sprite hosts
```

Expected map-data requests should come only from local assets, for example:

```text
/map-data/vietnam.pmtiles
/map-data/building-regions.json
/map-data/vn-buildings-105-106-20-21.pmtiles
```

The map style should also be local/in-code and must not reference a hosted style JSON.

---

# 30. Migration Tasks for Codex

Perform the migration in this order.

## Step 1 — Inspect Main Project First

Before changing code:

- inspect the main project's frontend architecture
- identify its bundler
- identify its routing
- identify current map/scene selection components
- identify where scene selection state is stored
- identify existing styling/component conventions

Do not replace the main project architecture with the test project's architecture.

---

## Step 2 — Add/Re-use Dependencies

Ensure:

```text
maplibre-gl
pmtiles
```

are available.

Avoid unnecessary dependencies.

---

## Step 3 — Move Runtime Map Assets

Move/copy:

```text
vietnam.pmtiles
building-regions.json
vn-buildings-*.pmtiles
```

into the main frontend's proper public/static data directory.

Do not move raw OSM PBF files into public assets.

---

## Step 4 — Create/Re-use a Map Component

Create an offline Vietnam map component or integrate into the existing map/scene-selection component.

The component must support:

```text
pan
zoom
pitch
bearing
offline base map
3D building overlay
```

---

## Step 5 — Register PMTiles

Register one PMTiles protocol during map initialization.

Avoid duplicate registration during rerenders/remounts.

---

## Step 6 — Configure MapLibre Worker

If using Vite, reproduce the working worker setup:

```js
import workerUrl from
  "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(workerUrl);
```

If using another bundler, adapt appropriately.

---

## Step 7 — Reproduce Base Map Style

Use `vietnam.pmtiles` for:

```text
background
land
ocean
water
roads
```

Do not depend on an online MapLibre/Mapbox style.

---

## Step 8 — Load Building Manifest

Load:

```text
building-regions.json
```

once after the map is initialized.

---

## Step 9 — Implement Dynamic Regional Loading

On `moveend` and `zoomend`:

- calculate current viewport bounds
- find intersecting manifest regions
- add newly required building PMTiles
- remove regions no longer required

---

## Step 10 — Reproduce 3D Height Behavior

Use:

```text
height
→ otherwise levels × 3
→ otherwise 9
```

Do not change this behavior during initial migration.

Feature parity comes before improvements.

---

## Step 11 — Preserve Zoom Optimization

Below approximately zoom `13.5`:

- do not load regional building PMTiles
- remove active regional building sources/layers

---

## Step 12 — Correct Cleanup

When removing a region:

1. remove MapLibre layer
2. remove MapLibre source

When unmounting map component:

- destroy MapLibre map
- clean PMTiles protocol registration safely

---

## Step 13 — Integrate With Existing Scene Selection

The offline map should become part of the main project's existing map/scene-selection workflow.

Do not build an unrelated standalone map screen unless that matches the current architecture.

Later functionality may include:

```text
user selects geographic area
        ↓
determine selected buildings
        ↓
generate/extract Sionna RT scene
```

But first reproduce the currently working map behavior.

---

# 31. Acceptance Criteria

The migration is complete when all of the following are true:

```text
✓ Main application starts normally

✓ Vietnam basemap renders fully offline

✓ No external map/tile/style request is required

✓ User can pan the map

✓ User can zoom the map

✓ User can rotate/pitch the map

✓ At approximately zoom 14+, regional buildings appear

✓ Buildings render as 3D fill extrusions

✓ Hanoi behaves the same as the working test project

✓ Moving elsewhere in Vietnam loads the correct regional PMTiles

✓ Regions leaving the viewport are unloaded

✓ OSM height is used when present

✓ levels × 3 is used if height is missing

✓ 9m is used if both height and levels are missing

✓ Zooming out unloads building regions

✓ No `Bounds of PMTiles archive 0,0,0,0 are not valid` error occurs

✓ No Docker/Osmium/Tilemaker is required at runtime

✓ Existing main-project scene/simulation architecture remains intact
```

---

# 32. Important Instruction to Codex

**Do not blindly copy the test project's `App.jsx`.**

Before implementation, inspect the main project and determine where this functionality belongs.

Use the test project as the reference for:

```text
behavior
data format
PMTiles setup
MapLibre setup
dynamic building loading
3D height rendering
offline requirements
```

Use the **main project** as the reference for:

```text
component organization
routing
state management
styling
scene-selection integration
project conventions
```

First achieve feature parity with the working test project.  
Only refactor or add new features after the migrated map is confirmed to work.
