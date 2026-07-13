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
swift "$ROOT/scripts/generate-dmg-background.swift" "$ROOT/build/dmg-background.png"

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

VERSION="$(node -p "require('./package.json').version")"
VERSIONED_DMG="$ROOT/dist/Beacon-${VERSION}-${EB_ARCH}.dmg"
VERSIONED_ZIP="$ROOT/dist/Beacon-${VERSION}-${EB_ARCH}-mac.zip"
STABLE_DMG="$ROOT/dist/Beacon-${EB_ARCH}.dmg"
STABLE_ZIP="$ROOT/dist/Beacon-${EB_ARCH}-mac.zip"

echo "→ Stable download names (for GitHub latest + Lemon Squeezy link)"
if [[ -f "$VERSIONED_DMG" ]]; then
  cp -f "$VERSIONED_DMG" "$STABLE_DMG"
  echo "   $STABLE_DMG"
fi
if [[ -f "$VERSIONED_ZIP" ]]; then
  cp -f "$VERSIONED_ZIP" "$STABLE_ZIP"
  echo "   $STABLE_ZIP"
fi

echo
echo "Done. Share one of these:"
ls -lh "$ROOT/dist"/Beacon-"${VERSION}"*."$EB_ARCH"* 2>/dev/null \
  || ls -lh "$ROOT/dist"/Beacon-"${VERSION}"*.dmg "$ROOT/dist"/Beacon-"${VERSION}"*.zip 2>/dev/null \
  || ls -lh "$ROOT/dist"/Beacon*.dmg "$ROOT/dist"/Beacon*.zip 2>/dev/null \
  || ls -lh "$ROOT/dist"
echo
if [[ -f "$STABLE_DMG" ]]; then
  echo "Stable latest URL (attach to every GitHub release):"
  echo "  https://github.com/danwalll/Beacon/releases/latest/download/Beacon-${EB_ARCH}.dmg"
  echo
  echo "Lemon Squeezy → Product → Links → add that URL as an external download."
  echo
fi
echo "Recipient steps:"
echo "  1. Open the DMG (double-click the download)"
echo "  2. Double-click Install Beacon (not the Beacon icon)"
echo "  3. If Mac asks, click Open / Allow"
echo "  4. First launch auto-connects detected apps — restart them when prompted"
