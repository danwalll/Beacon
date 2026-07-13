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

echo "→ Building Beacon for $EB_ARCH"
npx electron-builder --mac dmg zip --"$EB_ARCH"

APP="$ROOT/dist/mac-${EB_ARCH}/Beacon.app"
if [[ ! -d "$APP" ]]; then
  # electron-builder sometimes uses mac/ for x64
  APP="$ROOT/dist/mac/Beacon.app"
fi

if [[ -d "$APP" ]]; then
  echo "→ Ad-hoc code signing (easier Gatekeeper Open on other Macs)"
  codesign --force --deep --sign - "$APP" 2>/dev/null || true
fi

echo
echo "Done. Share one of these:"
ls -lh "$ROOT/dist"/Beacon*."$EB_ARCH"* 2>/dev/null || ls -lh "$ROOT/dist"/Beacon*.dmg "$ROOT/dist"/Beacon*.zip 2>/dev/null || ls -lh "$ROOT/dist"
echo
echo "Recipient steps:"
echo "  1. Open the DMG (or unzip)"
echo "  2. Drag Beacon.app → Applications"
echo "  3. Right-click → Open  (first launch, unsigned)"
echo "  4. Click Set up now when prompted"
echo "  5. Restart Cursor"
