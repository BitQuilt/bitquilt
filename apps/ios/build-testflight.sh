#!/usr/bin/env bash
# Quilt for the iPhone, archived and exported for App Store Connect, and with --upload sent to TestFlight.
#
#   ./build-testflight.sh [build-number]            archive and export
#   ./build-testflight.sh [build-number] --upload   and upload
#
# Signing is automatic. With ASC_KEY_ID and ASC_ISSUER_ID in the environment, an App Store Connect API key whose file is
# ~/.appstoreconnect/private_keys/AuthKey_<id>.p8, the archive and the export sign through that key, which registers the
# bundle id and makes the profile where there is none; without them they sign through the account signed in to Xcode.
# The upload always reads the key. The app's record in App Store Connect is made there by hand, once, for the bundle
# id org.bitquilt.quilt.
set -euo pipefail
cd "$(dirname "$0")"

BUILD="$(date +%Y%m%d%H%M)"
UPLOAD=""
for arg in "$@"; do
  if [ "$arg" = "--upload" ]; then UPLOAD=1; else BUILD="$arg"; fi
done

AUTH=()
if [ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ]; then
  AUTH=(-authenticationKeyPath "$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8"
    -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi

xcodegen generate >/dev/null
rm -rf .build/Quilt.xcarchive .build/export
xcodebuild archive -project Quilt.xcodeproj -scheme Quilt -configuration Release \
  -destination 'generic/platform=iOS' -archivePath .build/Quilt.xcarchive -derivedDataPath .build/DerivedData \
  -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} CURRENT_PROJECT_VERSION="$BUILD" 2>&1 | grep -E "error:|ARCHIVE (SUCCEEDED|FAILED)" || true
[ -d .build/Quilt.xcarchive ] || { echo "no archive"; exit 1; }

cat > .build/ExportOptions.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>8PB5R5CS37</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST
xcodebuild -exportArchive -archivePath .build/Quilt.xcarchive -exportPath .build/export \
  -exportOptionsPlist .build/ExportOptions.plist -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} 2>&1 | grep -E "error:|EXPORT (SUCCEEDED|FAILED)" || true
IPA="$(ls .build/export/*.ipa 2>/dev/null | head -1)"
[ -n "$IPA" ] || { echo "no .ipa in .build/export"; exit 1; }
echo "ipa: $IPA ($(du -h "$IPA" | cut -f1)), build $BUILD"

if [ -n "$UPLOAD" ]; then
  : "${ASC_KEY_ID:?the App Store Connect key's id}" "${ASC_ISSUER_ID:?the App Store Connect issuer's id}"
  xcrun altool --upload-app -f "$IPA" -t ios --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" 2>&1 | tee .build/upload.log | tail -5
  # altool can leave with 0 on an upload it refused, so only its own line counts.
  grep -q "No errors uploading" .build/upload.log || { echo "the upload failed: .build/upload.log"; exit 1; }
fi
