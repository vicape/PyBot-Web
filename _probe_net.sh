#!/usr/bin/env bash
set -euo pipefail
echo "script_ok"
curl -fsSL "https://pybot-web.vercel.app/" -o /tmp/pybot_index.html
echo "curl_index_ok"
grep -oE 'https?://[^"'\'' ]+\.js' /tmp/pybot_index.html | head -20 > /tmp/pybot_js_urls.txt
while read -r url; do
  curl -fsSL "$url" -o /tmp/pybot_asset.js || continue
  if grep -qoE 'https://[a-z0-9-]+\.supabase\.co' /tmp/pybot_asset.js; then
    grep -oE 'https://[a-z0-9-]+\.supabase\.co' /tmp/pybot_asset.js | head -1
    exit 0
  fi
done < /tmp/pybot_js_urls.txt
echo "supabase_host:not_found"
exit 1
