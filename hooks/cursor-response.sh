#!/usr/bin/env bash
# Cursor: after agent response — cache text for debugging
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"
if command -v node >/dev/null 2>&1; then
  node "$DIR/notify-from-hook.js" response cursor
else
  cat >/dev/null || true
  echo '{}'
fi
exit 0
