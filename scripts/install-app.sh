#!/usr/bin/env bash
# Build Beacon.app and install to /Applications so Spotlight / Raycast can open it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) EB_ARCH=arm64 ;;
  x86_64) EB_ARCH=x64 ;;
  *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
esac

echo "→ Building Beacon.app ($EB_ARCH)"
npx electron-builder --mac dir --"$EB_ARCH"

APP="$ROOT/dist/mac-${EB_ARCH}/Beacon.app"
if [[ ! -d "$APP" ]]; then
  APP="$ROOT/dist/mac/Beacon.app"
fi
if [[ ! -d "$APP" ]]; then
  echo "Build failed — Beacon.app not found in dist/" >&2
  exit 1
fi

echo "→ Ad-hoc signing"
codesign --force --deep --sign - "$APP" 2>/dev/null || true

DEST="/Applications/Beacon.app"
echo "→ Installing to $DEST"
# Quit running copies first
osascript -e 'tell application "Beacon" to quit' 2>/dev/null || true
pkill -f 'Beacon.app/Contents/MacOS/Beacon' 2>/dev/null || true
sleep 0.5
rm -rf "$DEST"
cp -R "$APP" "$DEST"
xattr -cr "$DEST" 2>/dev/null || true

echo "→ Opening Beacon"
open "$DEST"

echo
echo "Done. Next time: Spotlight (⌘Space) or Raycast → type “Beacon” → Enter."
echo "First open if macOS blocks it: Right-click Beacon in Applications → Open."
