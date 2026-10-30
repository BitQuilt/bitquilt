#!/usr/bin/env bash
# Builds Quilt.app: the Swift shell in release, then the bundle at dist/Quilt.app in the repository root with the quilt
# executable, the connector bundle (quilt.mcpb, which the app hands to Claude Desktop) and the fonts inside it, signed ad hoc for
# this machine, or with the Developer ID in QUILT_SIGN_IDENTITY and the hardened runtime for a copy others download
# (then scripts/notarize.sh). Stops with a plain message when either is missing, rather than building an app that cannot
# start a node or install its connector.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
quilt="$root/dist/bin/quilt-darwin-arm64"
app="$root/dist/Quilt.app"

if [ ! -x "$quilt" ]; then
  echo "The quilt executable is not at dist/bin/quilt-darwin-arm64. Run pnpm build:bin at the repository root first." >&2
  exit 1
fi
mcpb="$root/dist/quilt.mcpb"
if [ ! -f "$mcpb" ]; then
  echo "The connector bundle is not at dist/quilt.mcpb. Run pnpm build:mcpb at the repository root first." >&2
  exit 1
fi

swift build -c release --package-path "$here"
built="$(swift build -c release --package-path "$here" --show-bin-path)/Quilt"

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$built" "$app/Contents/MacOS/Quilt"
cp "$here/Resources/Info.plist" "$app/Contents/Info.plist"
cp "$quilt" "$app/Contents/Resources/quilt"
cp "$mcpb" "$app/Contents/Resources/quilt.mcpb"
# The site's three faces and their licences; Info.plist's ATSApplicationFontsPath loads them for the popover.
mkdir -p "$app/Contents/Resources/Fonts"
cp "$here"/Resources/Fonts/*.ttf "$here"/Resources/Fonts/*-OFL.txt "$app/Contents/Resources/Fonts/"
printf 'APPL????' > "$app/Contents/PkgInfo"
if [ -n "${QUILT_SIGN_IDENTITY:-}" ]; then
  # A Developer ID, for a copy others download: the hardened runtime notarization asks for, the nested quilt executable
  # signed first with the entitlements Node's just-in-time compiler needs, then the app, each with a timestamp. Then
  # scripts/notarize.sh submits and staples.
  codesign --force --options runtime --timestamp --entitlements "$here/Resources/quilt.entitlements" --sign "$QUILT_SIGN_IDENTITY" "$app/Contents/Resources/quilt"
  codesign --force --options runtime --timestamp --sign "$QUILT_SIGN_IDENTITY" "$app"
  codesign --verify --strict --deep "$app"
  echo "Built and signed $app with $QUILT_SIGN_IDENTITY"
else
  codesign --force --deep --sign - "$app"
  echo "Built $app (signed ad hoc, for this machine)"
fi
