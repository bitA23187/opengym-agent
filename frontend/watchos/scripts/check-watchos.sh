#!/bin/bash
set -euo pipefail
WATCH_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$WATCH_ROOT"
mkdir -p .build
MODE="${1:---all}"
if [[ "$MODE" != "--all" && "$MODE" != "--test" && "$MODE" != "--simulator" && "$MODE" != "--device" ]]; then
  echo 'Usage: bash scripts/check-watchos.sh [--all|--test|--simulator|--device]' >&2
  exit 2
fi
if [[ "$MODE" == "--all" || "$MODE" == "--test" ]]; then
  xcrun swiftc -swift-version 5 ../ios/App/App/HealthSyncModels.swift Core/*.swift Tests/WatchSyncTests.swift -o .build/WatchSyncTests
  .build/WatchSyncTests
  xcrun swiftc -swift-version 5 ../ios/App/App/HealthSyncModels.swift Core/*.swift Tests/WatchPairingTests.swift -o .build/WatchPairingTests
  .build/WatchPairingTests
  xcrun swiftc -swift-version 5 ../ios/App/App/HealthSyncModels.swift ../ios/Tests/HealthSyncModelsTests.swift -o .build/SharedProtocolTests
  .build/SharedProtocolTests
fi
if [[ "$MODE" == "--all" || "$MODE" == "--simulator" ]]; then
  xcodebuild -project OpenGymWatch.xcodeproj -scheme OpenGymWatch -configuration Release \
    -sdk watchsimulator -destination 'generic/platform=watchOS Simulator' \
    -derivedDataPath .build/simulator CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- build > .build/simulator-build.log 2>&1 || { tail -n 100 .build/simulator-build.log; exit 1; }
  echo 'PASS: watchOS Simulator Release build (ad hoc signed for Keychain)'
  codesign --verify .build/simulator/Build/Products/Release-watchsimulator/OpenGymWatch.app
  SIMULATED_ENTITLEMENTS='.build/simulator/Build/Intermediates.noindex/OpenGymWatch.build/Release-watchsimulator/OpenGymWatch.build/OpenGymWatch.app-Simulated.xcent'
  [[ -n "$(/usr/libexec/PlistBuddy -c 'Print :application-identifier' "$SIMULATED_ENTITLEMENTS")" ]]
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :com.apple.developer.healthkit' "$SIMULATED_ENTITLEMENTS")" == 'true' ]]
  echo 'PASS: simulator signature and simulated Keychain/HealthKit entitlements'
fi
if [[ "$MODE" == "--all" || "$MODE" == "--device" ]]; then
  xcodebuild -project OpenGymWatch.xcodeproj -scheme OpenGymWatch -configuration Release \
    -sdk watchos -destination 'generic/platform=watchOS' \
    -derivedDataPath .build/device CODE_SIGNING_ALLOWED=NO build > .build/device-build.log 2>&1 || { tail -n 100 .build/device-build.log; exit 1; }
  echo 'PASS: watchOS device Release build (unsigned)'
  WATCH_APP='.build/device/Build/Products/Release-watchos/OpenGymWatch.app'
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :MinimumOSVersion' "$WATCH_APP/Info.plist")" == '26.0' ]]
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :WKWatchOnly' "$WATCH_APP/Info.plist")" == 'true' ]]
  [[ "$(/usr/libexec/PlistBuddy -c 'Print :WKApplication' "$WATCH_APP/Info.plist")" == 'true' ]]
  echo 'PASS: standalone app metadata and watchOS 26.0 minimum'
fi
