# Wandrer Poster — Project Summary

## What it is

A client-side web app that turns a [wandrer.earth](https://wandrer.earth/) KMZ export into a framed **50 × 70 cm poster** at 300 DPI (5906 × 8268 px). Drop your KMZ, tweak the style, download a print-ready PNG with embedded pHYs DPI metadata.

**Live:** https://joegandy.github.io/wandrer-poster/
**Repo:** https://github.com/JoeGandy/wandrer-poster
**LAN dev server:** `python3 dev_server.py 8140` (serves static files + `/api/osm` proxy)

---

## Architecture

```
index.html          — UI shell, sidebar controls, canvas preview
app.js              — all application logic (~900 lines, no framework)
vendor/jszip.min.js — vendored JSZip for KMZ extraction
api/osm.js          — Vercel serverless function: Overpass API proxy (CORS fix)
dev_server.py       — local dev server with matching proxy
vercel.json         — Vercel function config (60s maxDuration)
```

No build step. No dependencies beyond vendored JSZip. Static HTML + vanilla JS.

---

## Rendering Pipeline

1. **KMZ → JSZip → KML text → DOMParser** — client-side extraction
2. **KML coordinates → Web Mercator metres** via `proj(lon, lat)`
3. **Segments bucketed** by KML style: `Traveled` (green), `Untraveled` (red), `UntraveledUnpaved` (red)
4. **Boundary polygons** parsed; segments assigned to containing polygon by midpoint (ray-casting)
5. **Traveled km de-duplicated** per area on a 5 m grid (approximates Wandrer's "unique kilometres")
6. **OSM roads fetched** via `/api/osm` proxy, grouped by highway class with weight hierarchy (motorway thick → footway thin)
7. **Canvas render** (gallery-style framed layout):
   - Background fill (white/cream/dark)
   - OSM basemap: casing pass (bg-colour halos) + fill pass (road colour)
   - Ridden roads: casing pass (bg-colour halos) + fill pass (green/red)
   - Crisp border frame around the map viewport
   - Typography block in the bottom margin (title, subtitle, stats)
8. **Export:** offscreen canvas at 5906×8268 → PNG → pHYs chunk injection → download

---

## Key Features

- **Drag & drop** KMZ/KML parsing (JSZip, vendored)
- **True 300 DPI** canvas rendering at exact physical dimensions with pHYs metadata
- **OSM basemap** — full street network from OpenStreetMap with cartographic road weight hierarchy and casing halos
- **Per-area stats** — segments assigned to Wandrer boundary polygons; traveled km de-duplicated on a 5 m grid
- **Reconciled overrides** — enter any two of (total km, %, km explored) and the third is derived (`km = % × total`)
- **Themes:** light / dark / vintage paper / fully custom colours
- **Gallery-style framed layout** with white margins and clean tracked-caps typography
- **Zoom/crop** control plus pan & wheel-zoom on the preview canvas
- **Optional** achievement-area boundary overlay, ride stats band, title/subtitle

---

## CORS / Proxy Setup

The OSM road network is fetched from the Overpass API. Direct browser fetches to Overpass can hit CORS errors (especially under load or from certain mirrors). The app handles this with a same-origin proxy:

- **Vercel:** `api/osm.js` serverless function forwards to Overpass with proper headers
- **Local dev:** `dev_server.py` includes a matching `/api/osm` proxy
- **GitHub Pages:** no proxy available — falls back to direct Overpass endpoints (works in most browsers but may occasionally fail)

The proxy has 25-second timeouts per endpoint with fallback to multiple Overpass mirrors.

---

## Why Numbers Differ from wandrer.earth

The KMZ contains generalised *drawing* polylines, not Wandrer's internal road graph. Our de-duplication uses a spatial grid; Wandrer's uses exact graph edges. Both sides of the fraction (unique km and total network) can drift 1–3%. That's why the override fields exist — enter the official figures and the poster prints them exactly.

Wandrer boundary polygons are also nested (a large polygon can contain the rides of smaller ones), so the "All areas" aggregate computes directly from segments with one global de-dup rather than summing per-area rows.

---

## Key Technical Decisions

| Decision | Why |
|---|---|
| Vanilla JS, no framework | Single-purpose tool, no build step, easy to host anywhere |
| Canvas 2D API | Full control over line rendering, casing passes, clipping; no SVG performance issues at 5906×8268 |
| Two-pass casing+fill | Prevents junction blobs where green/red roads cross — casing (bg colour, wider) drawn first, then colour fill |
| Web Mercator projection | Matches Wandrer's own map display; adequate accuracy at town scale |
| 5 m grid de-dup | Approximates Wandrer's "unique km" without access to their road graph |
| pHYs chunk injection | Canvas.toBlob doesn't set DPI metadata; manual PNG chunk insertion ensures printers read true 300 DPI |
| Vercel serverless proxy | Same-origin fetch avoids CORS; 24h cache on responses; fallback to direct Overpass |

---

## File Structure

```
wandrer-poster/
├── index.html          — UI shell with sidebar controls and canvas
├── app.js              — all application logic (parse, project, render, interact)
├── vendor/
│   └── jszip.min.js    — vendored JSZip for KMZ extraction
├── api/
│   └── osm.js          — Vercel serverless function: Overpass API proxy
├── dev_server.py       — local dev server with /api/osm proxy
├── vercel.json         — Vercel function config (60s maxDuration)
├── README.md           — user-facing docs
├── LICENSE             — MIT
└── .gitignore
```

---

## Hosting Options

| Host | Proxy | Notes |
|---|---|---|
| GitHub Pages | No (direct Overpass fallback) | Free, works for most users |
| Vercel | Yes (`api/osm.js`) | Free tier, best experience |
| Local LAN | Yes (`dev_server.py`) | `python3 dev_server.py 8140` |
| Self-hosted nginx | Manual location block | Proxy `/api/osm` to `https://overpass-api.de/api/interpreter` |

---

## Lessons Learned

1. **Always visually inspect renders** — coordinate bugs (e.g. `ty(p[i])` instead of `ty(p[i+1])`) produce output that's technically "valid" but looks completely wrong. Don't trust syntax checks alone.
2. **CORS is a real blocker for client-side apps** — even APIs that "usually" send CORS headers can fail intermittently. A same-origin proxy is essential for reliability.
3. **KMZ exports ≠ road graphs** — Wandrer's drawing polylines are generalised and can overlap across nested boundary polygons. De-duplication and per-area assignment are needed for accurate stats.
4. **Two-pass rendering prevents junction artifacts** — drawing all casings first, then all fills, prevents round caps from painting blobs where different-coloured roads cross.
5. **pHYs chunk injection** — Canvas.toBlob doesn't embed DPI metadata. Manual PNG chunk insertion is needed for print shops to read the correct physical size.
