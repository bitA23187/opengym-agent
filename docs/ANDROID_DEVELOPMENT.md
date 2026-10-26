# Lightweight Android development

The Android app uses the shared React frontend and Capacitor 7. Android Studio,
an emulator, NDK and CMake are not needed for this project's command-line build.

## This Mac

Prepared on 2026-10-26 for Apple silicon:

| Component | Version |
| --- | --- |
| Java | Temurin JDK 21.0.13 |
| Gradle wrapper | 8.11.1, binary distribution |
| Android SDK Platform | API 35 |
| Android SDK Build Tools | 34.0.0, the default for AGP 8.7 |
| Android Platform Tools | 37.0.1 |
| Android command-line tools | 22.0 |

SDK location: `~/Library/Android/sdk`.
JDK location: `~/Library/Java/JavaVirtualMachines/temurin-21.jdk`.
The ignored `frontend/android/local.properties` points to the local SDK.

Start a fresh terminal with:

```sh
source "$HOME/.config/opengym/android-env.sh"
java -version
adb version
```

The environment file is local to this Mac; no shell startup files were changed.
Installation archives and logs are in `~/Library/Caches/opengym-android-setup`.
JDK, Gradle and command-line archives were checked with their published SHA-256
values. SDK package archives were checked against Google's repository checksums.
No emulator system image or additional phone OS was downloaded.

## Build

From the repository root:

```sh
source "$HOME/.config/opengym/android-env.sh"
cd frontend
VITE_MOBILE=1 npm run build
node ../scripts/catalogue/stage-media.mjs dist
npx --no-install cap sync android
cd android
./gradlew --no-daemon assembleDebug
```

The debug APK is `frontend/android/app/build/outputs/apk/debug/app-debug.apk`.
Its application ID ends in `.test`, so it can coexist with the release app.
Building does not install it on a phone. A release update needs the appropriate
signing key; the debug key does not replace a release signature.

If Gradle needs network access through this Mac's existing local proxy, set this
for the build command:

```sh
export GRADLE_OPTS="${GRADLE_OPTS:-} -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7890 -Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7890"
```

After dependencies have been cached, `./gradlew --offline assembleDebug` avoids
network requests. New dependencies or build variants can require more downloads.

An Android 17 phone can test this app built with SDK 35. Adopting Android 17 APIs
and target behaviors is a separate SDK/toolchain upgrade.

## Home and sleep-detail health sync

- Native iOS: HealthKit panel.
- iPhone browser: Shortcuts panel.
- Android native app and other browsers: no Apple Health panel or pending-status request.

Android's existing Health Connect integration in Settings writes workouts and
weight. Reading sleep, heart rate and HRV is separate future work.
