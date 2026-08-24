#!/usr/bin/env python3
"""Local dev server with /api/osm proxy (mirrors the Vercel serverless function)."""
import http.server, urllib.request, urllib.parse, json, sys

OVERPASS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
]

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        if self.path == '/api/osm':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode()
            query = urllib.parse.parse_qs(body).get('data', [None])[0]
            if not query:
                self.send_error(400, 'missing data param'); return
            data = None
            for ep in OVERPASS:
                try:
                    req = urllib.request.Request(ep,
                        data=f'data={urllib.parse.quote(query)}'.encode(),
                        headers={'Content-Type': 'application/x-www-form-urlencoded',
                                 'User-Agent': 'WandrerPoster/1.0'})
                    with urllib.request.urlopen(req, timeout=28) as r:
                        data = r.read()
                    break
                except Exception as e:
                    print(f'  fallback {ep.split("/")[2]}: {e}', file=sys.stderr)
            if data:
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(data)
            else:
                self.send_error(502, 'All Overpass endpoints failed')
        else:
            self.send_error(404)

    def do_GET(self):
        # serve static files
        super().do_GET()

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8137
    srv = http.server.ThreadingHTTPServer(('0.0.0.0', port), Handler)
    print(f'Serving on http://0.0.0.0:{port} (with /api/osm proxy)')
    srv.serve_forever()
