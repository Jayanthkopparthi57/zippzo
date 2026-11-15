# Native mobile build requirements and commands

## Why builds were not run in this workspace

- No Android SDK / JDK / `adb` / `gradle` on PATH.
- No Xcode / `xcodebuild` (macOS required; this workspace is Windows).
- Expo CLI is available via `npx expo`.

## Android (when SDK is available)

Prerequisites:
- JDK 17+ (set `JAVA_HOME`)
- Android SDK with platform-tools, build-tools, and an emulator or device
- `ANDROID_HOME` / `ANDROID_SDK_ROOT` set

Commands:
```bash
cd mobile
npm install
npx expo prebuild --platform android
npx expo run:android          # debug build + install on connected device/emulator
# or
cd android && ./gradlew assembleRelease
```

APK output: `mobile/android/app/build/outputs/apk/`.

## iOS (requires macOS)

Prerequisites:
- macOS with Xcode 15+
- CocoaPods
- Apple Developer account + signing profile

Commands:
```bash
cd mobile
npm install
npx expo prebuild --platform ios
npx expo run:ios              # debug build on simulator
# release: open ios/*.xcworkspace in Xcode and archive
```

## Acceptance run checklist (device/emulator)

1. Launch app; sign in with a staff account (email/password).
2. Enter the one-time code (delivered via configured provider; dev echo only in DEBUG+OTP_DEV_ECHO).
3. If multi-site, choose one of the server-authorized facilities.
4. Open My Work; verify only tasks for the selected facility appear.
5. Open a task; scan a bin barcode with the camera; commit units.
6. Verify the server returns confirmation before the task shows complete.
7. Disable network; perform an action; verify it is queued as "Pending sync", not "confirmed".
8. Re-enable network; retry pending sync; verify the queue drains and the server state matches.
9. Switch facility (multi-site) and verify the queue/tasks change.
10. Sign out; verify the session is revoked server-side.
