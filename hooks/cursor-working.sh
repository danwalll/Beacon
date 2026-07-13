#!/usr/bin/env bash
# Cursor: prompt submitted → working
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"
# Keep stdin available for the notifier
if command -v node >/dev/null 2>&1; then
  node "$DIR/notify-from-hook.js" working cursor
else
  cat >/dev/null || true
  "$DIR/notify.sh" working cursor
  echo '{}'
fi
exit 0
