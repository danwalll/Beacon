#!/usr/bin/env bash
# Build Beacon and publish a GitHub release with versioned + stable download names.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) EB_ARCH=arm64 ;;
  x86_64) EB_ARCH=x64 ;;
  *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
esac

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"

bash "$ROOT/scripts/release.sh"

ASSETS=(
  "$ROOT/dist/Beacon-${VERSION}-${EB_ARCH}.dmg"
  "$ROOT/dist/Beacon-${VERSION}-${EB_ARCH}-mac.zip"
  "$ROOT/dist/Beacon-${EB_ARCH}.dmg"
  "$ROOT/dist/Beacon-${EB_ARCH}-mac.zip"
)

for f in "${ASSETS[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "Missing asset: $f" >&2
    exit 1
  fi
done

NOTES_FILE="$(mktemp)"
cat >"$NOTES_FILE" <<EOF
## Install

1. Download \`Beacon-${EB_ARCH}.dmg\` (always latest) or \`Beacon-${VERSION}-${EB_ARCH}.dmg\`
2. Open DMG → run **Install Beacon**
3. First open: right click → Open if macOS asks
4. Restart connected AI apps once when prompted

## Always-latest download

\`https://github.com/danwalll/Beacon/releases/latest/download/Beacon-${EB_ARCH}.dmg\`
EOF

if gh release view "$TAG" >/dev/null 2>&1; then
  echo "→ Release $TAG exists — uploading stable + versioned assets"
  gh release upload "$TAG" "${ASSETS[@]}" --clobber
else
  echo "→ Creating release $TAG"
  gh release create "$TAG" "${ASSETS[@]}" \
    --title "Beacon ${VERSION}" \
    --notes-file "$NOTES_FILE"
fi

rm -f "$NOTES_FILE"

echo
echo "Published: https://github.com/danwalll/Beacon/releases/tag/${TAG}"
echo "Latest:      https://github.com/danwalll/Beacon/releases/latest"
echo "Stable DMG:  https://github.com/danwalll/Beacon/releases/latest/download/Beacon-${EB_ARCH}.dmg"
