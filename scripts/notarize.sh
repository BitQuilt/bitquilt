#!/usr/bin/env bash
# Notarizes dist/Quilt.app, built and signed with a Developer ID by apps/mac/build.sh (QUILT_SIGN_IDENTITY set), and
# staples the ticket, so a downloaded copy opens with no right-click. Needs the notary credentials stored once in the
# keychain under a profile name:
#   xcrun notarytool store-credentials quilt --key <AuthKey.p8> --key-id <KEY_ID> --issuer <ISSUER_ID>
# (an App Store Connect API key with the Developer role), or with --apple-id, --team-id and an app-specific password.
#   QUILT_NOTARY_PROFILE=quilt bash scripts/notarize.sh      -> dist/Quilt.app stapled, dist/Quilt.app.zip for the release
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
app="$root/dist/Quilt.app"
zip="$root/dist/Quilt.app.zip"
profile="${QUILT_NOTARY_PROFILE:-quilt}"

if [ ! -d "$app" ]; then
  echo "dist/Quilt.app is not built. Run bash apps/mac/build.sh with QUILT_SIGN_IDENTITY set first." >&2
  exit 1
fi
if ! codesign --verify --strict --deep "$app" 2>/dev/null; then
  echo "dist/Quilt.app is not signed, or not as a whole. Build it with QUILT_SIGN_IDENTITY set." >&2
  exit 1
fi
if codesign -dv "$app" 2>&1 | grep -q "Signature=adhoc"; then
  echo "dist/Quilt.app is signed ad hoc; notarization needs a Developer ID. Build it with QUILT_SIGN_IDENTITY set." >&2
  exit 1
fi

rm -f "$zip"
ditto -c -k --keepParent "$app" "$zip"
echo "Submitting $zip under the keychain profile $profile"
xcrun notarytool submit "$zip" --keychain-profile "$profile" --wait
xcrun stapler staple "$app"
spctl --assess --type execute -vv "$app"
rm -f "$zip"
ditto -c -k --keepParent "$app" "$zip"
echo "Notarized and stapled: $app; $zip is the file to attach to the release"
