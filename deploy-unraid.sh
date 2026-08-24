#!/bin/bash
# Deploy wandrer-poster to joegandy.co.uk/map-generator
# Run this on your Unraid host as root.

set -e

SITE_ROOT="/mnt/user/appdata/nginx/www/joegandy.co.uk/public"
SWAG_NGINX="/mnt/user/appdata/swag/nginx"
DEST="$SITE_ROOT/map-generator"
REPO="/tmp/wandrer-poster-deploy"

echo "==> Cloning repo..."
rm -rf "$REPO"
git clone --depth 1 https://github.com/JoeGandy/wandrer-poster.git "$REPO"

echo "==> Copying static files to $DEST ..."
mkdir -p "$DEST/vendor"
cp "$REPO/index.html" "$DEST/"
cp "$REPO/app.js" "$DEST/"
cp "$REPO/vendor/jszip.min.js" "$DEST/vendor/"

echo "==> Files deployed:"
ls -lh "$DEST/"

# Find the SWAG site config for joegandy.co.uk
CONF=""
for f in "$SWAG_NGINX"/site-confs/*.conf; do
  if grep -q "server_name.*joegandy" "$f" 2>/dev/null; then
    CONF="$f"
    break
  fi
done

if [ -z "$CONF" ]; then
  echo ""
  echo "!! Could not auto-detect SWAG nginx config for joegandy.co.uk."
  echo "!! Add this location block inside your server {} block in the SWAG config:"
  echo ""
  cat <<'NGINX'
    # Wandrer Poster — static files + Overpass API proxy
    location /map-generator/ {
        alias /config/nginx/www/joegandy.co.uk/public/map-generator/;
        index index.html;
        try_files $uri $uri/ /map-generator/index.html;

        # Proxy Overpass API requests to avoid CORS
        location /map-generator/api/osm {
            proxy_pass https://overpass-api.de/api/interpreter;
            proxy_set_header Content-Type application/x-www-form-urlencoded;
            proxy_set_header User-Agent WandrerPoster/1.0;
            proxy_read_timeout 60s;

            # Rewrite the request body: client sends data=..., Overpass expects data=...
            # (the client already sends url-encoded form data, so pass through as-is)
        }
    }
NGINX
  echo ""
  echo "Then reload nginx: docker exec swag nginx -s reload"
else
  echo "==> Found SWAG config: $CONF"

  # Check if the location block already exists
  if grep -q "map-generator" "$CONF"; then
    echo "==> /map-generator location already exists in config, skipping."
  else
    echo "==> Adding /map-generator location block..."

    # Find the last closing brace of the server block and insert before it
    # Use a temp file to inject the block
    BLOCK=$(cat <<'NGINX'

    # Wandrer Poster — static files + Overpass API proxy
    location /map-generator/ {
        alias /config/nginx/www/joegandy.co.uk/public/map-generator/;
        index index.html;
        try_files $uri $uri/ /map-generator/index.html;
    }

    location /map-generator/api/osm {
        proxy_pass https://overpass-api.de/api/interpreter;
        proxy_set_header Content-Type application/x-www-form-urlencoded;
        proxy_set_header User-Agent WandrerPoster/1.0;
        proxy_read_timeout 60s;
    }
NGINX
    )

    # Insert before the last } in the file (end of server block)
    # Find line number of last }
    LAST_BRACE=$(grep -n "^}" "$CONF" | tail -1 | cut -d: -f1)
    if [ -n "$LAST_BRACE" ]; then
      # Insert the block before the last }
      head -n $((LAST_BRACE - 1)) "$CONF" > /tmp/swag_conf_tmp
      echo "$BLOCK" >> /tmp/swag_conf_tmp
      tail -n +$LAST_BRACE "$CONF" >> /tmp/swag_conf_tmp
      cp /tmp/swag_conf_tmp "$CONF"
      rm /tmp/swag_conf_tmp
      echo "==> Config updated."
    else
      echo "!! Could not find closing brace in $CONF"
      echo "!! Please add the location blocks manually."
    fi
  fi

  echo "==> Testing nginx config..."
  if docker exec swag nginx -t 2>&1; then
    echo "==> Reloading nginx..."
    docker exec swag nginx -s reload
    echo "==> Done! https://joegandy.co.uk/map-generator should be live."
  else
    echo "!! nginx config test failed. Please check $CONF manually."
  fi
fi

# Cleanup
rm -rf "$REPO"
echo "==> Cleaned up temp files."
