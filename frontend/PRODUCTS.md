# Frontend product boundaries

The frontend ships three products. They share API/authentication and reusable
UI code, but each product owns its navigation, permissions, and job flow.

| Product | Browser surface | Installed app | Entry module | Main users |
|---|---|---|---|---|
| **WMS & Dark Store** | `index.html` (operations web) | `operations-app.html` (Zippzo Ops) | `src/products/operations/entry.jsx` | Warehouse/store operators, supervisors |
| **Rider** | No rider web console is currently shipped | `rider.html` | `src/products/rider/entry.jsx` | Delivery partners |
| **Consumer** | `shopper.html` (consumer web) | `consumer-app.html` | `src/products/consumer/entry.jsx` | Customers |

## Ownership

- `src/products/` contains product entry points. This is where product-wide
  setup and styling are attached.
- `src/apps/` contains product shells and session/navigation behavior.
- `src/views/` contains workflow screens. Warehouse and dark-store operations
  remain one staff product and change according to facility context.
- `src/api/`, `src/context/`, `src/components/ui/`, and `src/utils/` are shared
  platform modules. Keep product-only behavior out of shared modules.
- `android/app/src/<store|rider|shopper>/` packages the matching native bundle.
  Android flavors are separate installs; `scripts/build-android.mjs` selects
  each product's HTML entry before packaging.

## Commands

- `npm run dev` — operations web at `/`
- `npm run dev:operations-app` — operations floor surface at `/operations-app.html`
- `npm run dev:rider` — rider app
- `npm run dev:shopper` — consumer web
- `npm run dev:consumer-app` — consumer app surface at `/consumer-app.html`
- `npm run build` — all browser surfaces
- `npm run android:store`, `npm run android:rider`, `npm run android:shopper` —
  individual native app builds

The operations web and floor app use the same authenticated stock/task records.
The floor app is tuned for small touch screens and in-task barcode scanning;
the web console is tuned for supervision, assignments, exceptions, and review.

## iOS operations app

The WMS & Dark Store floor app has a Capacitor iOS project. Choose an HTTPS
backend that is reachable by the iPhone and pass it at build time.

PowerShell (Windows project generation/sync):

```powershell
$env:IOS_API_BASE_URL = 'https://zippzo-wms-ha2c.onrender.com/api'
npm run ios:sync
```

macOS (simulator build):

```bash
IOS_API_BASE_URL=https://zippzo-wms-ha2c.onrender.com/api npm run ios:build
```

`ios:sync` prepares `ios/App/App.xcodeproj` on Windows. `ios:build` needs
macOS and Xcode; signing a device or TestFlight build also needs an Apple
Developer team and provisioning profile. See `IMPLEMENTATION_TODO.md` for
remaining release and device checks.
