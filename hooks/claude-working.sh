#!/usr/bin/env bash
# Claude Code hooks kept for optional use — not installed by default.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/Users/danwall/.nvm/versions/node/v22.22.3/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
node "$ROOT/hooks/notify-from-hook.js" working claude
exit 0
