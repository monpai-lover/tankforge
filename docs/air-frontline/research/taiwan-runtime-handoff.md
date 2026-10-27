# Taiwan runtime geography handoff — 2026-10-25

`data/frontline/taiwan.json` retains the selected **117.8–122.35°E,
21.65–26.5°N** theatre: all Taiwan main island, retained mainland coast,
Penghu, Kinmen, Matsu and other in-bounds geography. It does not silently
expand to distant Dongsha/Taiping. Existing older study documents remain
historical design evidence; this new asset is the concrete export.

The same world contains a fictional central-west main-island initial battle
with **three real connected road backbones, 15 objectives, six company
sources and 60 tank slots**. Roads total about 40.76 km. Whole-world coverage
does not distribute the existing human-player budget across the whole island.
Air/ground teams, already held fronts, ownership, clearings, services and use
of airport references are fictional. Room-era eligibility and shared vehicle
pools remain the mode's authority; geography does not impose nationality pools.

## Actual source coverage

- All 23 publicly listed intersecting Copernicus GLO30 tiles were actually
  read through their COG overviews and retained as 300×300 observation grids.
  These are not hashes of complete original TIFF files. The final strategic
  base is 640×733 at approximately 737 m/cell, with no missing sampled land
  cells under the separate strategic land mask. This is a coarse flight/map
  base, not native30m terrain everywhere.
- Three narrow source patches cover all registered ground corridors. They
  come from actual native1arcsecond GLO30 windows, reprojected to a 30 m metric
  grid. Two additional actual native source patches cover RCMQ/RCKU references.
  DSM includes buildings and vegetation; it is not a bare-earth road survey.
- Primary OSM source caches retain shared node IDs and adjacent source-way
  edges, tags, query bounds, queries, timestamps and fingerprints. The three
  backbones each follow one through-path. Intermediate objectives are placed
  on that path rather than connecting independent nearest snaps or spurs.
- The retained official NLSC county archive is the verified
  `COUNTY_MOI_1090820.shp` source (2020-08-20), not a 2026 survey. Its mainland-
  island envelope is 120.026905567–122.007494458°E,
  21.895599675–25.300305479°N and is entirely inside the selected theatre.
- An independent Natural Earth **1:10,000,000 cartographic-scale** land mask
  defines strategic ocean geometry. This does **not** mean 10 m resolution.
  It does not certify small-islet shorelines, harbours, water depth or ramps.

## Physical authoring and shared sampler

World coordinates are metric AEQD about **120.075°E, 24.075°N**:
`x=easting`, `z=-northing`, north is negative z. The axis-aligned projected
envelope is slightly larger than the geographic rectangle because its edges
curve in projection; this is padding, not stretched geography. Scale error and
round-trip checks are reported in the generated proof.

The sampler contract is identical to the Korean runtime:
`base → native patches → roadbeds → pads → runways`.
`taiwan_runtime_common.py:sample` is normative for this export. The proof
also executes the existing Korean canonical sampler on these actual heights.

Roadbeds use the same segment/spatial-cell format and weighted blending.
Registered road cores are 16 m wide, with 24 m terrain shoulders. Six
96×130 m company clearings and 120 m blends are explicit game construction.
Road profiles and plateau constraints are solved together so imposing an old
DSM hill height cannot recreate an artificial steep ramp after grading. The
initial failed grade evidence is preserved in the two pre-fix proof JSONs.
Each production road explicitly lists the exact `roadbedSegments` returned by
its source-vertex builder. The initial native registry correctly rejected the
missing index field; the metadata-only correction and equality of every other
JSON value are retained in `taiwan-runtime-roadbed-registration-proof.json`.

Thirty authored physical deck/culvert groups support mapped or conservatively
buffered water intersections; seventeen have nearby actual OSM bridge tags.
The remainder are explicitly new game structures, not invented OSM evidence.
Water levels are local authored DSM proxies, not hydrological surveys. A wet
10×4 m vehicle-footprint sample must lie within a registered deck's 8 m core
and have canonical height at least 2 m above the matching water level. A
boolean bridge flag alone does not make a crossing usable.

Only registered road cores and enabled pad cores inside the retained hydro
coverage are admitted for tanks. Shoulders and unregistered off-road terrain
remain closed. There is no cross-lane implicit graph link, cross-strait tank
edge or tank movement across the ocean.

## Airports, travel and remaining scope

Twenty existing selected airport references are projected throughout the
whole theatre. RCMQ/RCKU are the two enabled fictional team-use references;
their runway geometry follows retained community endpoints and explicit game
grading. The source inventory and native DSM do not establish real current
operations, historical availability, obstacle clearance or eligibility of every
jet/load. Farther-rear airborne starts remain 15 km behind the chosen fields;
map distances are not shortened to match a round timer.

Maritime transport, bathymetry, loading ramps, surviving-cargo continuity and
coast-avoiding ship navigation remain **unimplemented**. An illustrative future
20 kn game transport travels 37.04 km/h: a 200 km sea route takes about 324
minutes before loading/unloading. Initial fictional bridgeheads/nearshore
standby reinforcements must be explicit scenario state, not instantaneous
completed crossings. No navigable route is inferred from airport spans or
Copernicus ocean zero values.

`taiwan-runtime-geography-proof.json` verifies actual source/topology/height,
grading, dry pads, wet deck support and scalar sampler parity. Its
`nativeExecutionStatus` stays pending. The 27 cases in
`taiwan-runtime-native-cases.json` are follow-up inputs for actual native tank
integration, not a claim those tests ran. Native whole-route traversal,
aircraft takeoff/landing, live map selection, whole-world streaming/floating
origin, rendering/network performance and the complete combined mode remain
separate integration work. No browser, GPU, Cargo or deployment was used here.

## Reproduce

Use Python 3.10+ with the four pinned dependencies in
`taiwan-runtime-build-requirements.txt`. From the repository root:

```sh
python3 docs/air-frontline/research/taiwan_runtime_fetch_sources.py
python3 docs/air-frontline/research/taiwan_runtime_backbone.py
python3 docs/air-frontline/research/export_runtime_taiwan.py
python3 docs/air-frontline/research/taiwan_runtime_proof.py
```

The fetcher retains caches and refuses a mismatched cached query; subsequent
export/proof steps make no network requests. The source manifest fingerprints
each retained observation cache and includes attribution. The original full
county archive can be fetched from its official URL if its earlier `/tmp`
copy is unavailable.

Primary sources: [Copernicus COG maintainer](https://copernicus-dem-30m.s3.amazonaws.com/readme.html),
[NLSC official dataset](https://data.gov.tw/dataset/7442),
[Natural Earth land maintainer](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-land/),
[OurAirports maintainer](https://ourairports.com/data/),
[OSM waterway semantics](https://wiki.openstreetmap.org/wiki/Key:waterway).
