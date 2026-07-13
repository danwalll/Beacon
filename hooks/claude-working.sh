#!/usr/bin/env bash
# Claude Code: user submitted a prompt → working
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"
if command -v node >/dev/null 2>&1; then
  node "$DIR/notify-from-hook.js" working claude
else
  cat >/dev/null || true
  "$DIR/notify.sh" working claude
fi
exit 0
