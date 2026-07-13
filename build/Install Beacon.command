#!/bin/bash
# Installs Beacon to Applications and clears the macOS download block.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$DIR/Beacon.app"
DEST="/Applications/Beacon.app"

if [[ ! -d "$SRC" ]]; then
  osascript -e 'display alert "Beacon.app not found" message "Open the Beacon download (DMG) first, then run Install Beacon again." as warning'
  exit 1
fi

echo "Installing Beacon to Applications…"
rm -rf "$DEST"
ditto "$SRC" "$DEST"
xattr -cr "$DEST" 2>/dev/null || true
codesign --force --deep --sign - "$DEST" 2>/dev/null || true

echo "Opening Beacon…"
open "$DEST"
