# Zippzo mobile — handoff notes

## Layout
- `mobile/` — single Expo (RN 0.88 / Expo 58) codebase, three variants selected via `EXPO_PUBLIC_APP_VARIANT` (`shopper` | `rider` | `operations`).
- `mobile/src/shopper/ShopperApp.tsx` — purple/gold shopper app (~3000 lines).
- `mobile/src/rider/RiderApp.tsx` — rider app + `RiderLogin.tsx`.
- `mobile/src/screens/*` + `mobile/src/components/Ui.tsx` — WMS & DS app (shared Ui kit + screens).
- `mobile/App.tsx` — variant router.
- `mobile/app.config.js` — per-variant name/slug/package + cleartext plugin.
- `mobile/src/api.ts` — `API_BASE` from env, fallback `http://192.168.1.100:8001/api`.

## Running
- Dev server (from repo root): `DB_NAME=zippzo_staging; DB_USER=postgres; DB_PASSWORD=''; DB_HOST=localhost; DB_PORT=5432; DB_SSLMODE=disable; python manage.py runserver 0.0.0.0:8001 --noreload`
- Typecheck: `cd mobile && npx tsc --noEmit`
- JS bundle check: `cd mobile && EXPO_PUBLIC_APP_VARIANT=shopper EXPO_PUBLIC_API_BASE=http://192.168.1.100:8001/api npx expo export --platform android`

## Building APKs
- Kill antigravity java processes first (they hold `.gradle` locks).
- Delete `mobile/android`, set env vars, `npx expo prebuild --platform android --non-interactive --clean`.
- Restore `mobile/android/local.properties` from `C:\Users\jayan\AppData\Local\Temp\opencode\local.properties.bak`.
- `.\gradlew assembleRelease --no-daemon` in `mobile/android`.
- Copy `app/build/outputs/apk/release/app-release.apk` to `mobile/apks/`.
- ~13 min shopper, ~14 min rider, ~24 min operations.

## Gotchas
- Windows Firewall is currently OFF (turned off for testing). Re-enable with `netsh advfirewall set allprofiles state on` (admin). McAfee's filter driver silently drops phone→laptop traffic even with 8001 rules; permanent fix is uninstalling McAfee.
- Cleartext HTTP: `usesCleartextTraffic=true` via `expo-build-properties` plugin in app.config.js. Never hand-write MainActivity/MainApplication.
- Android SafeAreaView is a no-op: every top-level screen must add `TOP_INSET = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0` to its header padding. `Ui.tsx` exports `TOP_INSET`; shopper defines its own.
- API fallback in `api.ts` is `192.168.1.100` (laptop). Phone is `192.168.1.2`.
- Test accounts (password `Verify123!`): shopper `audit-customer@zippzo.in`, rider `audit-rider@zippzo.in`, WMS `verify-admin@zippzo.in` / `verify-ds@zippzo.in`.

## What's verified
- tsc clean; all three JS bundles compiled by Metro.
- All three APKs built (BUILD SUCCESSFUL) and installed on device R9ZY60FKZCW.
- Rider: dashboard, hero header, earnings card, icon nav render with real data; accepted a job end-to-end.
- WMS: hero dashboard, stats, tiles, login screen, Inbound step flow render with real data (both mother-hub Manager and DS-VERIFY dark store).
- Shopper: home 2-col grid, category rail, bottom nav render with real products; product detail and profile headers fixed in the latest build.

## What's NOT verified
- I cannot view screenshots in this environment, so visual quality was never actually confirmed. Please eyeball every screen in Antigravity before shipping.
- The "Unsupported type for radius property: Null" RN warning in shopper (cosmetic, not a crash).
