'use strict';
/* Wandrer Poster — turn wandrer.earth KMZ exports into 50x70cm print-ready posters.
 * Everything runs client-side; the file never leaves the browser. */

// ---------- print constants ----------
const DPI = 300;
const POSTER_W_PX = Math.round((50 / 2.54) * DPI);   // 5906
const POSTER_H_PX = Math.round((70 / 2.54) * DPI);   // 8268
const PX_PER_MM = DPI / 25.4;

// ---------- state ----------
const state = {
  lines: [],        // {bucket, pts: Float64Array [x,y,...] projected metres, bbox}
  polys: [],
  styles: {},       // kml style id -> {color:'#rrggbb', alpha, width}
  bbox: null,       // {minX,minY,maxX,maxY} projected — lines only, used for fitting
  fullBbox: null,   // everything incl. boundaries — used when boundaries shown
  stats: null,
  baseView: null,   // fitted view {x,y,w,h}
  view: null,
  fileName: null,
  osmRoads: null,   // [{cls, pts: Float64Array, bbox}] fetched from Overpass
  osmLoading: false,
  osmError: null,
};

const els = {};
['dropzone','fileInput','fileInfo','statsCard','statsBody','theme','customColors',
 'titleText','subtitleText','showStats','showBoundary','showOsm','osmStatus','cBg','cTraveled','cUntraveledPaved','cUntraveledUnpaved',
 'lineWidth','zoomPad','mapFrac','downloadBtn','previewLink','recenterBtn','posterWrap',
 'poster','emptyState','toolbar','zoomLabel'].forEach(id => els[id] = document.getElementById(id));

// ---------- themes ----------
const THEMES = {
  light: { bg:'#ffffff', text:'#232323', sub:'#777777', traveled:'#47ad5f', untraveled:'#c01c28', unpaved:'#ffaa00', osmRoad:'#e2e4e8' },
  dark:  { bg:'#10131a', text:'#f2f2f2', sub:'#98a0ad', traveled:'#5fc483', untraveled:'#e04747', unpaved:'#ffb340', osmRoad:'#252b38' },
  paper: { bg:'#f5eedd', text:'#3d3428', sub:'#8a7c64', traveled:'#3e7d54', untraveled:'#bf4b36', unpaved:'#c9922d', osmRoad:'#dfd5c2' },
};
function currentTheme() {
  const t = els.theme.value;
  if (t !== 'custom') return THEMES[t];
  return {
    bg: els.cBg.value,
    traveled: els.cTraveled.value,
    untraveled: els.cUntraveledPaved.value,
    unpaved: els.cUntraveledUnpaved.value,
    text: contrastColor(els.cBg.value),
    sub: contrastColor(els.cBg.value) === '#ffffff' ? '#9aa0aa' : '#777777',
    osmRoad: contrastColor(els.cBg.value) === '#ffffff' ? '#e2e4e8' : '#252b38',
  };
}
function contrastColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.2126*((n>>16)&255) + 0.7152*((n>>8)&255) + 0.0722*(n&255);
  return lum > 140 ? '#1c1c1c' : '#ffffff';
}

// ---------- projection (Web Mercator, metres) ----------
const R = 6378137;
function proj(lon, lat) {
  return [R * lon * Math.PI/180,
          R * Math.log(Math.tan(Math.PI/4 + (lat*Math.PI/180)/2))];
}
function haversineKm(lon1, lat1, lon2, lat2) {
  const dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}
function invProj(x, y) {
  return [x / R * 180/Math.PI,
          (2*Math.atan(Math.exp(y/R)) - Math.PI/2) * 180/Math.PI];
}

// ---------- OSM basemap via Overpass API ----------
const OSM_ENDPOINTS = [
  '/api/osm',  // same-origin Vercel proxy (no CORS)
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const OSM_WEIGHTS = {
  motorway:2.8, trunk:2.2, primary:1.8, secondary:1.4, tertiary:1.1,
  unclassified:0.85, residential:0.75, living_street:0.6, service:0.45,
  track:0.4, cycleway:0.55, footway:0.35, path:0.3, bridleway:0.35,
};
const OSM_HIGHWAY_RE = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track|cycleway|footway|path|bridleway)$/;

async function fetchOsmRoads() {
  const bb = state.bbox;
  if (!bb || state.osmLoading) return;
  state.osmLoading = true; state.osmError = null;
  els.osmStatus.textContent = 'Fetching road network from OpenStreetMap…';
  const t0 = Date.now();
  const [wLon,sLat] = invProj(bb.minX, bb.minY);
  const [eLon,nLat] = invProj(bb.maxX, bb.maxY);
  const pad = Math.max(nLat-sLat, eLon-wLon) * 0.2;
  const bbox = `${(sLat-pad).toFixed(5)},${(wLon-pad).toFixed(5)},${(nLat+pad).toFixed(5)},${(eLon+pad).toFixed(5)}`;
  const query = `[out:json][timeout:30];(way["highway"~"^(${OSM_HIGHWAY_RE.source.replace(/^\^|\$$/g,'')})$"](${bbox}););out geom;`;

  let data = null;
  for (let i = 0; i < OSM_ENDPOINTS.length; i++) {
    const ep = OSM_ENDPOINTS[i];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000); // hard cap per attempt
    try {
      if (i > 0) els.osmStatus.textContent = `Overpass is slow — trying backup source (${i+1}/${OSM_ENDPOINTS.length})…`;
      const r = await fetch(ep, {
        method:'POST',
        body:`data=${encodeURIComponent(query)}`,
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      data = await r.json();
      break;
    } catch(e) {
      console.warn('OSM source failed:', ep, e.message || e);
    } finally {
      clearTimeout(timer);
    }
  }

  state.osmLoading = false;
  if (!data || !data.elements) {
    state.osmError = 'unavailable';
    els.osmStatus.innerHTML =
      '<span style="color:#e05252">⚠ Road network unavailable</span> · ' +
      '<a href="#" id="osmRetry" style="color:var(--accent2)">Retry</a>';
    const retry = document.getElementById('osmRetry');
    if (retry) retry.addEventListener('click', ev => { ev.preventDefault(); fetchOsmRoads(); });
    scheduleRender(); return;
  }
  const roads = [];
  for (const el of data.elements) {
    if (el.type !== 'way' || !el.geometry) continue;
    const cls = el.tags?.highway || 'residential';
    const flat = [];
    for (const pt of el.geometry) {
      const [x,y] = proj(pt.lon, pt.lat);
      flat.push(x,y);
    }
    if (flat.length >= 4) {
      let mnx=Infinity,mny=Infinity,mxx=-Infinity,mxy=-Infinity;
      for(let i=0;i<flat.length;i+=2){
        if(flat[i]<mnx)mnx=flat[i]; if(flat[i]>mxx)mxx=flat[i];
        if(flat[i+1]<mny)mny=flat[i+1]; if(flat[i+1]>mxy)mxy=flat[i+1];
      }
      roads.push({ cls, pts:new Float64Array(flat), bbox:[mnx,mny,mxx,mxy] });
    }
  }
  state.osmRoads = roads;
  if (els.osmStatus) els.osmStatus.textContent = `${roads.length.toLocaleString()} roads loaded from OSM in ${((Date.now()-t0)/1000).toFixed(1)}s`;
  scheduleRender();
}

// ---------- KML parsing ----------
function bucketOf(styleId) {
  const s = (styleId || '').toLowerCase();
  if (s.includes('boundary')) return 'boundary';
  if (s.includes('untraveled') && s.includes('unpaved')) return 'unpaved';
  if (s.includes('untraveled')) return 'untraveled';
  if (s.includes('traveled')) return 'traveled';
  // Wandrer exports some achievement-boundary polygons with no style tag at all;
  // any placemark that carries polygon geometry and no known style is a boundary.
  return arguments.length > 1 && arguments[1] === 'poly' ? 'boundary' : null;
}

function parseKml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid KML inside file');

  // style catalogue
  const styles = {};
  for (const st of doc.getElementsByTagName('Style')) {
    const id = st.getAttribute('id');
    const ls = st.getElementsByTagName('LineStyle')[0];
    if (!ls) continue;
    const colEl = ls.getElementsByTagName('color')[0];
    const wEl = ls.getElementsByTagName('width')[0];
    let color = null, alpha = 1;
    if (colEl) {
      const c = colEl.textContent.trim();
      if (/^[0-9a-fA-F]{8}$/.test(c)) {
        alpha = parseInt(c.slice(0,2),16)/255;
        color = '#' + c.slice(6,8) + c.slice(4,6) + c.slice(2,4); // aabbggrr -> rrggbb
      } else if (/^[0-9a-fA-F]{6}$/.test(c)) color = '#' + c;
    }
    styles[id] = { color, alpha, width: wEl ? parseFloat(wEl.textContent) : 4 };
  }

  const lines = [], polys = [];
  const bb = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const bbl = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }; // lines only, used for fitting
  const dist = { traveled: 0, untraveled: 0, unpaved: 0, boundary: 0 };
  let nPoints = 0, nSegs = 0;

  function addGeom(coordsEl, bucket, out) {
    const raw = coordsEl.textContent.trim().split(/\s+/);
    const flat = [];
    let prev = null;
    for (const tuple of raw) {
      const p = tuple.split(',');
      if (p.length < 2) continue;
      const lon = parseFloat(p[0]), lat = parseFloat(p[1]);
      if (!isFinite(lon) || !isFinite(lat)) continue;
      const [x, y] = proj(lon, lat);
      flat.push(x, y);
      nPoints++;
      if (prev && out === lines) {
        dist[bucket] += haversineKm(prev[0], prev[1], lon, lat);
        nSegs++;
      }
      prev = [lon, lat];
      if (out === lines) {
        if (x < bbl.minX) bbl.minX = x;
        if (y < bbl.minY) bbl.minY = y;
        if (x > bbl.maxX) bbl.maxX = x;
        if (y > bbl.maxY) bbl.maxY = y;
      }
      if (x < bb.minX) bb.minX = x;
      if (y < bb.minY) bb.minY = y;
      if (x > bb.maxX) bb.maxX = x;
      if (y > bb.maxY) bb.maxY = y;
    }
    return flat;
  }

  for (const pm of doc.getElementsByTagName('Placemark')) {
    let styleId = null;
    const se = pm.getElementsByTagName('styleUrl')[0];
    if (se) styleId = se.textContent.trim().replace(/^#/, '');
    const isPoly = !!pm.getElementsByTagName('Polygon')[0];
    const bucket = bucketOf(styleId, isPoly ? 'poly' : 'line');
    if (!bucket) continue;

    for (const ls of pm.getElementsByTagName('LineString')) {
      const co = ls.getElementsByTagName('coordinates')[0];
      if (!co) continue;
      const flat = addGeom(co, bucket, lines);
      if (flat.length >= 4) {
        let mnx=Infinity,mny=Infinity,mxx=-Infinity,mxy=-Infinity;
        for (let i=0;i<flat.length;i+=2){
          if(flat[i]<mnx)mnx=flat[i]; if(flat[i]>mxx)mxx=flat[i];
          if(flat[i+1]<mny)mny=flat[i+1]; if(flat[i+1]>mxy)mxy=flat[i+1];
        }
        lines.push({ bucket, pts:new Float64Array(flat), bbox:[mnx,mny,mxx,mxy] });
      }
    }
    for (const pg of pm.getElementsByTagName('Polygon')) {
      for (const ring of pg.getElementsByTagName('LinearRing')) {
        const co = ring.getElementsByTagName('coordinates')[0];
        if (!co) continue;
        const flat = addGeom(co, bucket, polys);
        if (flat.length >= 4) polys.push({ bucket, pts:new Float64Array(flat) });
      }
    }
  }

  if (!lines.length && !polys.length) throw new Error('No line/polygon geometry found in this KML');
  if (!lines.length && polys.length && bbl.minX === Infinity) Object.assign(bbl, bb); // fit fallback
  bb.minX -= 1; bb.minY -= 1; bb.maxX += 1; bb.maxY += 1; // guard zero-size

  const total = dist.traveled + dist.untraveled + dist.unpaved;
  return { lines, polys, styles, bbox: bbl.minX !== Infinity ? bbl : bb, fullBbox: bb,
    stats: {
      traveled: dist.traveled, untraveledPaved: dist.untraveled,
      untraveledUnpaved: dist.unpaved, total,
      pct: total > 0 ? 100 * dist.traveled / total : 0,
      nPoints, nSegs,
    } };
}

// ---------- file loading ----------
async function loadFile(file) {
  els.fileInfo.innerHTML = 'Reading…';
  try {
    let kmlText;
    if (/\.kmz$/i.test(file.name)) {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const name = Object.keys(zip.files).find(n => /\.kml$/i.test(n));
      if (!name) throw new Error('No .kml found inside the KMZ');
      kmlText = await zip.file(name).async('string');
    } else {
      kmlText = await file.text();
    }
    const parsed = parseKml(kmlText);
    Object.assign(state, parsed, { fileName: file.name });
    state.view = null;
    fitView();
    els.emptyState.hidden = true;
    els.posterWrap.hidden = false;
    els.toolbar.hidden = false;
    els.statsCard.hidden = false;
    els.downloadBtn.disabled = false;
    els.recenterBtn.disabled = false;

    const s = state.stats;
    const fmt = km => km >= 100 ? km.toFixed(0) : km.toFixed(1);
    els.fileInfo.innerHTML = `<b>${escapeHtml(file.name)}</b><br>${state.lines.length.toLocaleString()} track segments loaded`;
    els.statsBody.innerHTML = `
      <div>Road network <b>${fmt(s.total)} km</b></div>
      <div>Ridden <b>${fmt(s.traveled)} km</b></div>
      <div>Remaining · paved <b>${fmt(s.untraveledPaved)} km</b></div>
      <div>Remaining · unpaved <b>${fmt(s.untraveledUnpaved)} km</b></div>
      <div>Completed <b>${s.pct.toFixed(1)}%</b></div>`;
    scheduleRender();
    fetchOsmRoads(); // async — renders basemap when done
  } catch (err) {
    console.error(err);
    els.fileInfo.innerHTML = `<span style="color:#e05252">⚠ ${escapeHtml(err.message)}</span>`;
  }
}
function escapeHtml(s){return s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

// ---------- view fitting ----------
function mapFraction() { return els.mapFrac.value / 100; }

function fitTo(bb) {
  if (!bb) return;
  const pad = els.zoomPad.value / 100;
  const cw = bb.maxX - bb.minX, ch = bb.maxY - bb.minY;
  const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
  const m = pad * Math.max(cw, ch);
  let w = cw + 2*m, h = ch + 2*m;
  // match poster/map-area aspect
  const A = POSTER_W_PX / (POSTER_H_PX * mapFraction());
  if (w/h < A) w = h * A; else h = w / A;
  state.baseView = { x: cx - w/2, y: cy - h/2, w, h };
  state.view = { ...state.baseView };
}
function fitView() { fitTo(state.bbox); }

// ---------- rendering ----------
const BUCKET_ORDER = ['untraveled', 'unpaved', 'boundary', 'traveled'];

function render(ctx, W, H) {
  if (!state.lines.length && !state.polys.length) return;
  const th = currentTheme();
  const v = state.view;
  const mapH = H * mapFraction();
  const showBoundary = els.showBoundary.checked;

  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, H);

  const sx = W / v.w;
  const sy = mapH / v.h;
  const tx = px => (px - v.x) * sx;
  const ty = py => mapH - (py - v.y) * sy;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // road width: slider is millimetres on paper -> fraction of poster height
  const lwFrac = (parseFloat(els.lineWidth.value) * PX_PER_MM) / POSTER_H_PX;
  const lw = Math.max(lwFrac * H, 0.6);
  const lwBoundary = Math.max(lw * 0.6, 0.5);

  // visible bounds for culling
  const vx0 = v.x, vx1 = v.x + v.w, vy0 = v.y, vy1 = v.y + v.h;

  // OSM basemap — full road network with cartographic weight hierarchy
  if (state.osmRoads && els.showOsm && els.showOsm.checked) {
    const roadColor = th.osmRoad || '#d8d8d8';
    const casingColor = th.bg;
    const baseW = Math.max(lw * 0.45, 0.5);
    // group by rounded weight for batched strokes
    const groups = new Map();
    for (const road of state.osmRoads) {
      const [a,b,c,d] = road.bbox;
      if (c < vx0 || a > vx1 || d < vy0 || b > vy1) continue;
      const w = (OSM_WEIGHTS[road.cls] || 1.0) * baseW;
      const key = Math.round(w * 10);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(road);
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // casing pass — white halos separate overlapping streets
    ctx.strokeStyle = casingColor; ctx.globalAlpha = 1;
    for (const [kw, roads] of groups) {
      ctx.lineWidth = kw / 10 * 1.3 + 0.5;
      ctx.beginPath();
      for (const road of roads) {
        const p = road.pts;
        ctx.moveTo(tx(p[0]), ty(p[1]));
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(tx(p[i]), ty(p[i]));
      }
      ctx.stroke();
    }
    // fill pass — the road colour
    ctx.strokeStyle = roadColor; ctx.globalAlpha = 1;
    for (const [kw, roads] of groups) {
      ctx.lineWidth = kw / 10;
      ctx.beginPath();
      for (const road of roads) {
        const p = road.pts;
        ctx.moveTo(tx(p[0]), ty(p[1]));
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(tx(p[i]), ty(p[i]));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  for (const bucket of BUCKET_ORDER) {
    const themed = th[bucket];
    let stroke = themed || null;
    let width = lw;

    if (bucket === 'boundary') {
      if (!showBoundary) continue;
      const st = state.styles['achievementBoundary'];
      stroke = (st && st.color) || (themed || '#888888');
      width = lwBoundary;
    }
    if (!stroke) continue;

    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.beginPath();

    for (const ln of state.lines) {
      if (ln.bucket !== bucket) continue;
      const [a,b,c,d] = ln.bbox;
      if (c < vx0 || a > vx1 || d < vy0 || b > vy1) continue;
      const p = ln.pts;
      ctx.moveTo(tx(p[0]), ty(p[1]));
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(tx(p[i]), ty(p[i]));
    }
    for (const pg of state.polys) {
      if (pg.bucket !== bucket) continue;
      const p = pg.pts;
      ctx.moveTo(tx(p[0]), ty(p[1]));
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(tx(p[i]), ty(p[i]));
      ctx.closePath();
    }
    ctx.stroke();
  }

  drawTextBlock(ctx, W, H, mapH, th);
}

function drawTextBlock(ctx, W, H, mapH, th) {
  const title = els.titleText.value.trim();
  const subtitle = els.subtitleText.value.trim();
  const wantStats = els.showStats.checked && state.stats;
  const statsLine = wantStats
    ? `${state.stats.traveled.toFixed(state.stats.traveled >= 100 ? 0 : 1)} km ridden · ${state.stats.pct.toFixed(1)}% complete`
    : '';

  const f = mapH / H;
  const items = [];
  if (title) items.push({ t: title.toUpperCase(), size: 0.028, color: th.text, weight: 600, track: 0.18 });
  if (subtitle) items.push({ t: subtitle, size: 0.012, color: th.sub, weight: 400, track: 0.06 });
  if (statsLine) items.push({ t: statsLine, size: 0.009, color: th.sub, weight: 400, track: 0.04 });

  if (!items.length) return;

  const FONT = '"Helvetica Neue", Helvetica, Arial, -apple-system, "Segoe UI", Roboto, sans-serif';

  // helper: draw text with manual letter-spacing
  function drawTracked(text, x, y, font, color, spacing, align) {
    ctx.font = font;
    ctx.fillStyle = color;
    if (align === 'center') {
      // measure total width including spacing
      let total = 0;
      for (const ch of text) total += ctx.measureText(ch).width + spacing;
      x -= total / 2;
    }
    for (const ch of text) {
      ctx.fillText(ch, x, y);
      x += ctx.measureText(ch).width + spacing;
    }
  }

  if (f < 0.999) {
    // dedicated band below the map — centered
    const gap = 0.012 * H;
    let total = 0;
    for (const it of items) total += it.size * H * 1.3 + gap;
    total -= gap;
    let y = mapH + (H - mapH - total) / 2;
    for (const it of items) {
      const fs = it.size * H;
      const font = `${it.weight} ${fs}px ${FONT}`;
      const spacing = it.track * fs;
      drawTracked(it.t, W / 2, y + fs * 0.85, font, it.color, spacing, 'center');
      y += fs * 1.3 + gap;
    }
  } else {
    // overlay bottom-center on the map
    let y = H - 0.035 * H;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      const fs = it.size * H;
      const font = `${it.weight} ${fs}px ${FONT}`;
      const spacing = it.track * fs;
      ctx.globalAlpha = 0.92;
      drawTracked(it.t, W / 2, y, font, it.color, spacing, 'center');
      y -= fs * 1.5;
    }
    ctx.globalAlpha = 1;
  }
}

// ---------- preview / full-res ----------
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderPreview(); });
}

function renderPreview() {
  const cv = els.poster;
  const PH = 1600, PW = Math.round(PH * POSTER_W_PX / POSTER_H_PX);
  if (cv.width !== PW) { cv.width = PW; cv.height = PH; }
  const ctx = cv.getContext('2d');
  render(ctx, PW, PH);
  els.zoomLabel.textContent =
    `Preview ${PW}×${PH} · print output ${POSTER_W_PX}×${POSTER_H_PX}px @ ${DPI} DPI`;
}

async function renderAndExport() {
  const btn = els.downloadBtn;
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = 'Rendering full-res…';

  await new Promise(r => setTimeout(r, 30)); // let UI paint

  try {
    const cv = document.createElement('canvas');
    cv.width = POSTER_W_PX; cv.height = POSTER_H_PX;
    const ctx = cv.getContext('2d');
    render(ctx, POSTER_W_PX, POSTER_H_PX);

    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    const withDpi = await injectPngDpi(blob, DPI);

    const url = URL.createObjectURL(withDpi);
    const stamp = new Date().toISOString().slice(0,10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wandrer-poster-${stamp}-50x70cm-300dpi.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    els.previewLink.href = url;
    els.previewLink.hidden = false;
  } catch (err) {
    console.error(err);
    alert('Rendering failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

// Inject a pHYs chunk so the PNG carries real DPI (printers read true cm size)
async function injectPngDpi(blob, dpi) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const sig = String.fromCharCode(...buf.slice(12, 16));
  if (sig !== 'IHDR') throw new Error('Unexpected PNG layout');

  const ppu = Math.round(dpi / 0.0254);           // pixels per metre
  const payload = new Uint8Array(9);
  const dv = new DataView(payload.buffer);
  dv.setUint32(0, ppu); dv.setUint32(4, ppu); payload[8] = 1; // unit = metre

  const chunkType = new Uint8Array([0x70,0x48,0x59,0x73]);    // pHYs
  const crcInput = new Uint8Array(chunkType.length + payload.length);
  crcInput.set(chunkType); crcInput.set(payload, chunkType.length);
  const crc = crc32(crcInput);

  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, payload.length);

  const insertAt = 33; // 8 sig + 4 len + 4 type + 13 data + 4 crc
  const out = new Uint8Array(buf.length + 21);
  out.set(buf.subarray(0, insertAt), 0);
  out.set(len, insertAt);
  out.set(chunkType, insertAt + 4);
  out.set(payload, insertAt + 8);
  const crcBytes = new Uint8Array(4);
  new DataView(crcBytes.buffer).setUint32(0, crc);
  out.set(crcBytes, insertAt + 12);
  out.set(buf.subarray(insertAt), insertAt + 21);
  return new Blob([out], { type: 'image/png' });
}

let CRC_TABLE = null;
function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ---------- interaction: pan & wheel zoom on preview ----------
function setupPanZoom() {
  const cv = els.poster;
  let dragging = false, lastX = 0, lastY = 0;

  cv.addEventListener('pointerdown', e => {
    if (!state.view) return;
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    cv.setPointerCapture(e.pointerId);
    cv.style.cursor = 'grabbing';
  });
  cv.addEventListener('pointermove', e => {
    if (!dragging || !state.view) return;
    const rect = cv.getBoundingClientRect();
    const dx = (e.clientX - lastX) * state.view.w / rect.width;
    const dy = (e.clientY - lastY) * state.view.h / rect.height;
    lastX = e.clientX; lastY = e.clientY;
    state.view.x -= dx; state.view.y += dy;
    clampView();
    scheduleRender();
  });
  const stop = () => { dragging = false; cv.style.cursor = 'grab'; };
  cv.addEventListener('pointerup', stop);
  cv.addEventListener('pointercancel', stop);

  cv.addEventListener('wheel', e => {
    if (!state.view) return;
    e.preventDefault();
    const rect = cv.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    const px = state.view.x + fx * state.view.w;
    const py = state.view.y + (1 - fy) * state.view.h;
    const k = Math.pow(1.0015, e.deltaY);
    const bw = state.baseView.w, bh = state.baseView.h;
    const nw = Math.min(Math.max(state.view.w * k, bw * 0.02), bw * 4);
    const nh = nw * state.view.h / state.view.w;
    state.view = { x: px - fx * nw, y: py - (1 - fy) * nh, w: nw, h: nh };
    clampView();
    scheduleRender();
  }, { passive: false });
  cv.style.cursor = 'grab';
  cv.style.touchAction = 'none';
}

function clampView() {
  const v = state.view, b = state.baseView;
  if (!v || !b) return;
  const slackX = b.w * 0.6, slackY = b.h * 0.6;
  v.x = Math.min(Math.max(v.x, b.x - slackX), b.x + b.w - v.w + slackX);
  v.y = Math.min(Math.max(v.y, b.y - slackY), b.y + b.h - v.h + slackY);
}

// ---------- wiring ----------
els.dropzone.addEventListener('click', () => els.fileInput.click());
els.dropzone.addEventListener('dragover', e => { e.preventDefault(); els.dropzone.classList.add('dragover'); });
els.dropzone.addEventListener('dragleave', () => els.dropzone.classList.remove('dragover'));
els.dropzone.addEventListener('drop', e => {
  e.preventDefault();
  els.dropzone.classList.remove('dragover');
  if (e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
});
els.fileInput.addEventListener('change', () => {
  if (els.fileInput.files.length) loadFile(els.fileInput.files[0]);
});

els.theme.addEventListener('change', () => {
  els.customColors.hidden = els.theme.value !== 'custom';
  scheduleRender();
});
for (const id of ['cBg','cTraveled','cUntraveledPaved','cUntraveledUnpaved'])
  els[id].addEventListener('input', scheduleRender);
els.showBoundary.addEventListener('change', () => {
  fitTo(els.showBoundary.checked ? (state.fullBbox || state.bbox) : state.bbox);
  scheduleRender();
});
if (els.showOsm) els.showOsm.addEventListener('change', scheduleRender);
for (const id of ['titleText','subtitleText','showStats'])
  els[id].addEventListener('input', scheduleRender);

let refitTimer = null;
els.zoomPad.addEventListener('input', () => {
  clearTimeout(refitTimer);
  refitTimer = setTimeout(() => { fitView(); scheduleRender(); }, 80);
});
els.mapFrac.addEventListener('input', () => {
  clearTimeout(refitTimer);
  refitTimer = setTimeout(() => { fitView(); scheduleRender(); }, 80);
});
els.lineWidth.addEventListener('input', scheduleRender);
els.downloadBtn.addEventListener('click', renderAndExport);
els.recenterBtn.addEventListener('click', () => { fitView(); scheduleRender(); });

setupPanZoom();
