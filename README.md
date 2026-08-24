# Wandrer Poster

Turn a [wandrer.earth](https://wandrer.earth/) KMZ export into a framed
**50 × 70 cm poster** — the kind that fits a standard frame.

Everything runs client-side in your browser. Your ride data never leaves your
machine (the OSM road network is fetched separately for the basemap).

## Use it

1. Export your progress from wandrer.earth (**Progress → Download KMZ**)
2. Drop the `.kmz` onto the app
3. Pick your area from the dropdown (Wandrer exports can span multiple zones)
4. Optionally enter the official numbers from wandrer.earth — any two of
   **Total network km**, **% complete**, and **Km explored**; the third is
   derived automatically so the figures always reconcile
5. Tweak theme / title / road weight / zoom until it looks right
6. **Download PNG** → send the file to any print shop

The exported PNG is 5906 × 8268 px @ 300 DPI with proper pHYs DPI metadata,
so printers read it as exactly 50 × 70 cm with no scaling needed.

## Features

- Drag & drop KMZ/KML parsing (JSZip, vendored)
- True 300 DPI canvas rendering at exact physical dimensions
- **OSM basemap** — full street network fetched from OpenStreetMap via a
  same-origin proxy (no CORS), with cartographic road weight hierarchy and
  casing halos
- **Per-area stats** — segments assigned to Wandrer boundary polygons;
  traveled km de-duplicated on a 5 m grid to approximate Wandrer's
  "unique kilometres"
- **Reconciled overrides** — enter any two of (total km, %, km explored) and
  the third is derived, so the poster always matches wandrer.earth exactly
- Themes: light / dark / vintage paper / fully custom colours
- Optional title, subtitle and stats band ("46.08 km explored · 89.52% complete")
- Road weight in real millimetres on paper
- Zoom/crop control plus pan & wheel-zoom on the preview
- Gallery-style framed layout with white margins and clean typography
- Optional achievement-area boundary overlay

## Dev

The app is a single static HTML page with a vendored JSZip. No build step.

For local development with the OSM proxy (mirrors the Vercel serverless
function):

```sh
python3 dev_server.py 8080
# open http://localhost:8080
```

The proxy forwards Overpass API requests to avoid CORS issues in the browser.
Without it, the "Show road network" toggle will fail with a CORS error.

## Architecture

```
index.html          — UI shell, sidebar controls, canvas
app.js              — all application logic (parse, project, render, interact)
vendor/jszip.min.js — vendored JSZip for KMZ extraction
api/osm.js          — Vercel serverless function: Overpass API proxy
dev_server.py       — local dev server with matching proxy
vercel.json         — Vercel function config (60s maxDuration)
```

**Rendering pipeline:**
1. KMZ → JSZip → KML text → DOMParser
2. KML coordinates → Web Mercator metres (`proj`)
3. Segments bucketed by KML style (`Traveled`, `Untraveled`, `UntraveledUnpaved`)
4. Boundary polygons parsed; segments assigned to containing polygon by midpoint
5. Traveled km de-duplicated per area on a 5 m grid
6. OSM roads fetched via `/api/osm` proxy, grouped by highway class
7. Canvas render: background fill → OSM basemap (casing + fill passes) →
   ridden roads → border frame → typography block
8. Export: offscreen canvas at 5906×8268 → PNG → pHYs chunk injection → download

## Why the numbers might differ from wandrer.earth

The KMZ contains generalised *drawing* polylines, not Wandrer's internal road
graph. Our de-duplication uses a spatial grid; Wandrer's uses exact graph
edges. Both sides of the fraction (unique km and total network) can drift
1–3% — that's why the override fields exist. Enter the official figures and
the poster prints them exactly.
