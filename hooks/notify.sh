#!/usr/bin/env bash
# Notify Beacon of a status change.
# Usage: notify.sh <idle|working|done> [source] [label]
set -euo pipefail

PORT="${AGENT_BEACON_PORT:-17373}"
STATE="${1:-}"
SOURCE="${2:-}"
LABEL="${3:-}"

if [[ -z "$STATE" ]]; then
  echo "usage: notify.sh <idle|working|done> [source] [label]" >&2
  exit 1
fi

payload=$(printf '{"state":"%s"' "$STATE")
if [[ -n "$SOURCE" ]]; then
  payload+=$(printf ',"source":"%s"' "$SOURCE")
fi
if [[ -n "$LABEL" ]]; then
  # Escape quotes in label lightly
  safe_label=${LABEL//\"/\\\"}
  payload+=$(printf ',"label":"%s"' "$safe_label")
fi
payload+='}'

# Prefer curl; fall back to node if curl is missing.
if command -v curl >/dev/null 2>&1; then
  curl -sS -m 2 \
    -X POST "http://127.0.0.1:${PORT}/status" \
    -H 'Content-Type: application/json' \
    -d "$payload" >/dev/null || true
else
  node -e "
    const http=require('http');
    const data=process.argv[1];
    const req=http.request({hostname:'127.0.0.1',port:process.env.AGENT_BEACON_PORT||17373,path:'/status',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)},timeout:2000},res=>{res.resume()});
    req.on('error',()=>{});
    req.end(data);
  " "$payload" || true
fi

exit 0
