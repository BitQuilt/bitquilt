#!/usr/bin/env bash
# Builds Quilt.app: the Swift shell in release, then the bundle at dist/Quilt.app in the repository root with the quilt
# executable inside it, signed ad hoc for this machine. Stops with a plain message when the quilt executable is missing,
# rather than building an app that cannot start a node.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
quilt="$root/dist/bin/quilt-darwin-arm64"
app="$root/dist/Quilt.app"

if [ ! -x "$quilt" ]; then
  echo "The quilt executable is not at dist/bin/quilt-darwin-arm64. Run pnpm build:bin at the repository root first." >&2
  exit 1
fi

swift build -c release --package-path "$here"
built="$(swift build -c release --package-path "$here" --show-bin-path)/Quilt"

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$built" "$app/Contents/MacOS/Quilt"
cp "$here/Resources/Info.plist" "$app/Contents/Info.plist"
cp "$quilt" "$app/Contents/Resources/quilt"
printf 'APPL????' > "$app/Contents/PkgInfo"
codesign --force --deep --sign - "$app"
echo "Built $app"
