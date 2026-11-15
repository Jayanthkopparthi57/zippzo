# Shopper app and Cashfree sandbox

The shopper client is an Expo / React Native variant of the existing mobile project. It has its own Android package (`com.zippzo.shopper`) and iOS bundle identifier (`com.zippzo.shopper`). The WMS / DS app keeps the `com.zippzo.operations` identifiers and its own screens.

## Local development

From `mobile/`, set the public API URL to the reachable backend (the `/api` suffix is required), then start Expo with the shopper variant:

```powershell
$env:EXPO_PUBLIC_APP_VARIANT = 'shopper'
$env:EXPO_PUBLIC_API_BASE = 'https://your-api-host.example/api'
npx expo start
```

The EAS shopper profiles target the API hostname configured for this project. Update that hostname in `mobile/eas.json` if the backend moves. This value is public and contains no provider credentials. Cashfree credentials stay in the Django server environment (`CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_ENV=sandbox`).

## Android and iOS builds

The `shopper-apk` EAS profile creates an internal Android APK; `shopper-ios` creates an iOS device build. EAS Build can compile these remotely when the developer machine lacks Android build tools or macOS/Xcode:

```powershell
cd mobile
npx eas-cli build --profile shopper-apk --platform android
npx eas-cli build --profile shopper-ios --platform ios
```

The iOS build still needs the Apple signing/team setup in the Expo account. Install and exercise the resulting binaries on real Android and iOS devices before release.

## Cashfree sandbox configuration

1. Keep the provider app ID and secret in the server `.env` or deployment secret store only. Never set them as `EXPO_PUBLIC_*` variables and never add them to source control.
2. Keep `CASHFREE_ENV=sandbox` while using test credentials. The backend creates every payment order from the server-calculated checkout total.
3. Configure Cashfree's webhook to `https://your-api-host.example/api/orders/payments/cashfree/webhook` and enable order/payment success events. The endpoint verifies Cashfree's signature and then independently fetches the order before confirming it.
4. Run `python manage.py expire_cashfree_orders` every five minutes. It checks expired sessions against Cashfree before releasing stock; if payment succeeded it confirms the order instead.
5. Confirm the order is `CONFIRMED` and `payment_status=CAPTURED` before the DS pick queue receives it. A payment SDK success callback alone does not confirm an order.

## Current boundaries

- Shopper web and React Native sign-in include email-verified registration and password recovery. Verification/reset codes are mailed, hashed at rest, time-limited, one-use, attempt-limited, and never returned in API responses. These flows fail closed if a real email provider is not configured.
- In-progress orders expose rider live location in My Orders. The shopper client polls every 15 seconds; it shows stale GPS as stale, masks the rider phone, and stops exposing rider identity/location after delivery. ETA is only calculated where the saved delivery address has coordinates. Mobile opens the latest position in the device map app.
- Cashfree refunds are not automated. Paid orders are blocked from shopper self-cancellation and need support/refund handling.
- The Cashfree sandbox credentials were shared in chat. Rotate them before use beyond sandbox testing, and keep the replacement values in server-side deployment secrets only.
- Production still needs a verified Cashfree production account, production credentials, webhook setup, deployed HTTPS API, and native-device acceptance.

## Shopper journey on web and native

The shopper web client and the React Native Android/iOS client now support:

- Delivery pincode coverage and only the chosen dark store's active, stocked listings.
- Category chips, local product search, product detail, MRP/offer price, and saved products.
- Per-account and per-store persistent native basket, quantity controls capped to the latest available stock, server-priced checkout, delivery-fee thresholds, store combo offers, and coupon validation.
- Saved address selection, default-address management, add/remove address, and editable shopper name/mobile.
- COD and Cashfree, shopper order history with line items/status history, early cancellation with inventory reservation release, reorder of currently available items, delivered-order return requests, one-time delivery code, in-app notifications, and live rider tracking.

Native in-app order and notification views refresh from the API every 20 seconds; rider location refreshes every 15 seconds while a tracking card is open. Notifications are in-app inbox records. Native push delivery still needs push-provider/device-token registration and deployment configuration.

## Isolated workflow test run

The local test settings use in-memory SQLite and LocMemCache. They are for automated tests only and must not be used to run the app:

```powershell
python manage.py test bounded.tests.test_shopper_auth bounded.tests.test_customer_tracking bounded.tests.test_full_journey bounded.tests.test_auth_defaults bounded.tests.test_cashfree_workflow --settings=zippzo_wms.test_settings
```
