#!/bin/bash
# Installs Beacon to Applications and clears the macOS download block.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$DIR/Beacon.app"
DEST="/Applications/Beacon.app"

if [[ ! -d "$SRC" ]]; then
  osascript -e 'display alert "Beacon.app not found" message "Open the Beacon download (DMG) first, then double-click Install Beacon again." as warning'
  exit 1
fi

osascript -e 'display notification "Installing Beacon…" with title "Beacon"'

echo "Installing Beacon to Applications…"
rm -rf "$DEST"
ditto "$SRC" "$DEST"
xattr -cr "$DEST" 2>/dev/null || true
codesign --force --deep --sign - "$DEST" 2>/dev/null || true

echo "Opening Beacon…"
open "$DEST"

osascript -e 'display notification "You’re all set — Beacon will connect your apps on first launch." with title "Beacon installed"'
