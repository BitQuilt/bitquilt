#!/usr/bin/env bash
# Notarizes dist/Quilt.app, built and signed with a Developer ID by apps/mac/build.sh (QUILT_SIGN_IDENTITY set), staples
# the ticket, then packs it as a disk image with a link to Applications beside it (the usual drag), signs and notarizes
# the image as a file of its own and staples that too, so a downloaded copy opens with no right-click. Needs the notary
# credentials stored once in the keychain under a profile name:
#   xcrun notarytool store-credentials quilt --key <AuthKey.p8> --key-id <KEY_ID> --issuer <ISSUER_ID>
# (an App Store Connect API key with the Developer role), or with --apple-id, --team-id and an app-specific password.
#   QUILT_NOTARY_PROFILE=quilt bash scripts/notarize.sh      -> dist/Quilt.app stapled, dist/Quilt.dmg for the release
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

if xcrun stapler validate "$app" >/dev/null 2>&1; then
  echo "$app carries a ticket already; the app is not submitted again"
else
  rm -f "$zip"
  ditto -c -k --keepParent "$app" "$zip"
  echo "Submitting $zip under the keychain profile $profile"
  xcrun notarytool submit "$zip" --keychain-profile "$profile" --wait
  xcrun stapler staple "$app"
  rm -f "$zip"
fi
spctl --assess --type execute -vv "$app"

# The disk image: the stapled app and a link to Applications, signed with the same identity, notarized as a file of its own, stapled.
dmg="$root/dist/Quilt.dmg"
stage="$root/dist/dmg-stage"
identity="$(codesign -dvv "$app" 2>&1 | sed -n 's/^Authority=\(Developer ID Application: .*\)$/\1/p' | head -1)"
rm -rf "$stage" "$dmg"
mkdir -p "$stage"
cp -R "$app" "$stage/Quilt.app"
ln -s /Applications "$stage/Applications"
hdiutil create -volname Quilt -srcfolder "$stage" -ov -format UDZO -quiet "$dmg"
rm -rf "$stage"
codesign --force --timestamp --sign "$identity" "$dmg"
echo "Submitting $dmg under the keychain profile $profile"
xcrun notarytool submit "$dmg" --keychain-profile "$profile" --wait
xcrun stapler staple "$dmg"
spctl --assess --type open --context context:primary-signature -vv "$dmg"
echo "Notarized and stapled: $app and $dmg; the image is the file to attach to the release"
