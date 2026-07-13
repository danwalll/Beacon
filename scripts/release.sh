#!/usr/bin/env bash
# Build a shareable Beacon.app / DMG for the current Mac architecture.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) EB_ARCH=arm64 ;;
  x86_64) EB_ARCH=x64 ;;
  *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
esac

echo "→ Installing deps"
npm install --silent

chmod +x "$ROOT/build/Install Beacon.command" 2>/dev/null || true

echo "→ Generating DMG artwork"
swift "$ROOT/scripts/generate-dmg-background.swift" "$ROOT/build/dmg-background.png" "$ROOT/build/icon-1024.png"

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

echo "→ Clearing quarantine attrs + ad-hoc signing"
xattr -cr "$APP" 2>/dev/null || true
codesign --force --deep --sign - "$APP" 2>/dev/null || true

echo "→ Packaging DMG + zip"
npx electron-builder --mac dmg zip --"$EB_ARCH" --prepackaged "$APP"

echo
echo "Done. Share one of these:"
ls -lh "$ROOT/dist"/Beacon*."$EB_ARCH"* 2>/dev/null || ls -lh "$ROOT/dist"/Beacon*.dmg "$ROOT/dist"/Beacon*.zip 2>/dev/null || ls -lh "$ROOT/dist"
echo
echo "Recipient steps:"
echo "  1. Open the DMG (double-click the download)"
echo "  2. Double-click Install Beacon (not the Beacon icon)"
echo "  3. If Mac asks, click Open / Allow"
echo "  4. Set up apps → turn on Claude → restart Claude once"
