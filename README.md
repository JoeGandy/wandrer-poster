# Wandrer Poster

Turn a [wandrer.earth](https://wandrer.earth/) KMZ export into a print-ready
**50 × 70 cm poster** — the kind that fits a standard frame.

Everything runs client-side in your browser. Your ride data never leaves your machine.

## Use it

1. Export your progress from wandrer.earth (**Progress → Download KMZ**)
2. Drop the `.kmz` onto the app
3. Tweak theme / title / road weight / crop until it looks right
4. **Download PNG** → send the file to any print shop (or use one that takes online uploads)

The exported PNG is 5906 × 8268 px @ 300 DPI with proper pHYs DPI metadata,
so printers read it as exactly 50 × 70 cm with no scaling needed.

## Features

- Drag & drop KMZ/KML parsing (JSZip, vendored)
- True 300 DPI canvas rendering at exact physical dimensions
- Themes: light / dark / vintage paper / fully custom colours
- Optional title, subtitle and stats band ("123 km explored · 87.3% complete")
- Road weight in real millimetres on paper
- Zoom/crop control plus pan & wheel-zoom on the preview
- Optional achievement-area boundary overlay (off by default — some Wandrer
  exports tag these polygons without a style)

## Dev

Any static file server works:

```sh
python3 -m http.server 8080
# open http://localhost:8080
```

No build step, no dependencies beyond the vendored `vendor/jszip.min.js`.

## How rendering works

The KML is parsed in-browser; coordinates are projected to Web Mercator metres;
roads are bucketed by their KML style (`Traveled`, `Untraveled`,
`UntraveledUnpaved`, boundary) and stroked onto an offscreen canvas sized to the
physical poster dimensions. A `pHYs` chunk is injected into the PNG afterwards
so the file carries true DPI.
