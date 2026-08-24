// Vercel serverless function — proxies Overpass API requests to avoid CORS issues.
// Caches responses for 24 hours (same bbox = same roads).
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const PER_ENDPOINT_TIMEOUT = 28_000;

module.exports = async (req, res) => {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  let query;
  if (req.method === 'POST') {
    // body is url-encoded: data=...
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString();
    query = new URLSearchParams(body).get('data');
  } else {
    query = req.query.data;
  }
  if (!query) return res.status(400).json({ error: 'missing data param' });

  let data = null;
  let lastErr = null;
  for (const ep of ENDPOINTS) {
    try {
      const r = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'WandrerPoster/1.0' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(PER_ENDPOINT_TIMEOUT),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      data = await r.json();
      break;
    } catch (e) {
      lastErr = e;
      console.warn('Overpass fallback:', ep, e.message);
    }
  }

  if (!data) {
    return res.status(502).json({ error: 'All Overpass endpoints failed', detail: String(lastErr) });
  }

  // Cache for 24h — road geometry doesn't change fast
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=3600');
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json(data);
};
