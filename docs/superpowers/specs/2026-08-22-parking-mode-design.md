# Parking Mode Clean-room Design

## Goal

Extend the existing 「澳門實時巴士」 PWA with a maintainable parking mode while preserving every current bus workflow, local preference, offline/update guarantee, and one-shot bus-arrival notification.

## Product decisions

- Keep the visible product name 「澳門實時巴士」. Parking is an additional mode, not a replacement app or a copy of the supplied APK.
- On first launch, ask the user to choose `巴士` or `泊車`; remember the last chosen mode locally and keep a persistent top-level quick switch.
- Bus mode remains behavior-compatible with the current release.
- Parking mode provides nearby car parks, searchable list, map, favorites, external navigation, and one-shot low-space alerts.
- The default parking alert threshold is 10 private-car spaces; Settings accepts integers from 1 through 100.
- No account, login, Firebase Auth, advertisement, payment, subscription, Pro tier, purchase restoration, analytics profile, or paywall is introduced. All implemented features are free.
- Favorites, mode, settings, recent items, and notification capability identity remain device-local except the minimum anonymous Web Push subscription and one-shot alert data needed for closed-app delivery.
- Prediction, voice control, cruise mode, native widgets, reservations, and payment are outside this release.

## Clean-room boundary

The supplied APK is used only to understand public-facing feature categories and technical feasibility. Do not copy or decompile proprietary Dart code, images, icons, strings, private backend endpoints, Firebase configuration, ad identifiers, signing material, or credentials. Implement the feature from this specification and public government data using the existing repository patterns.

## Information architecture and UX

### Mode selection

When no mode preference exists, render a lightweight first-run sheet with two equal actions: `搭巴士` and `搵泊車位`. The choice enters that mode and persists immediately. It must not block app installation or create an account.

The existing header gains a compact, keyboard-accessible two-option mode switch. Changing mode preserves each mode's current sub-route and scroll-independent local state. The bottom navigation changes by mode:

- Bus: `附近`, `路線`, `地圖`, `收藏`, `設定`.
- Parking: `附近`, `地圖`, `搜尋`, `收藏`, `設定`.

Settings is shared. Favorites shows content for the active mode and does not merge bus and parking identifiers.

### Parking nearby/list

Parking nearby opens by default. It requests browser location only after an explicit user action or when the current bus nearby workflow already has permission. The page continues to show the complete live list if location is denied or unavailable.

Rows use the existing open-list visual system rather than a new card grid. Each row shows car-park name, private-car free spaces as the primary number, motorcycle/electric/accessible counts where supplied, freshness, favorite state, and distance when local coordinates are available. Unknown or paused values render `—`, never zero.

Sorting options are `附近優先`, `最多車位`, and `名稱`; search matches normalized Traditional Chinese names and official location text. Selecting a row opens an inline/detail surface with all supplied counts, address/location, entrance description, last update time, favorite, alert, and navigation actions.

### Parking map and navigation

Reuse Leaflet and OpenStreetMap attribution. Display only car parks with validated Macau-bounds WGS84 coordinates. Markers show the private-car free-space count or `—`; selected marker opens the same detail action surface as the list.

`導航` opens an external HTTPS map URL using the validated coordinate. If a coordinate is unavailable, open a query URL using the official parking name and Macau location instead of inventing a coordinate.

### Parking favorites

Favorites store stable DSAT parking IDs. Removing a favorite does not remove an active alert. Missing/renamed upstream entries stay in storage but render only when their current ID returns again; the app does not silently reassign favorites by display name.

### One-shot low-space alert

From a parking detail surface, the user can create one active alert per car park. The alert triggers once when the private-car free-space value is at or below the configured threshold. The explicit action requests notification permission; unsupported or denied platforms show recovery copy and do not promise a local-only background alert.

Alerts expire after 12 hours, each anonymous device may hold at most 10 parking alerts, and a successful Web Push deletes the alert. Paused, missing, malformed, or unknown values never trigger. Transient fetch/push failures retain the alert until retry or expiry. HTTP 404/410 from the push provider removes the dead subscription and its alerts.

The notification includes car-park name, observed free spaces, configured threshold, and a deep link to parking detail. Service-worker notification click focuses an existing app client or opens the deep link. No location is stored or sent for alert checks.

## Data architecture

### Official source adapter

Use the DSAT public car-park surfaces as the source of truth:

- Dynamic vacancy: the official realtime/mobile car-park page, documented by DSAT as an unconditionally open interface updated about every 10 seconds.
- Static detail: official DSAT car-park detail/static surfaces for stable ID, name, location, entrance information, and any published coordinate.

Put all HTML/interface parsing in `server/parking/` and expose it through one pure parser plus an injectable fetch client. Store sanitized HTML fixtures with synthetic names/values in tests; do not commit a live page dump.

The parser returns a stable contract:

```ts
interface ParkingFacility {
  id: string;
  name: string;
  location: string | null;
  entrance: string | null;
  latitude: number | null;
  longitude: number | null;
  spaces: {
    car: number | null;
    motorcycle: number | null;
    electricCar: number | null;
    electricMotorcycle: number | null;
    accessible: number | null;
  };
  updatedAt: string | null;
  suspended: boolean;
}
```

Values are non-negative integers or null. IDs are exact official numeric IDs. Coordinates are accepted only when finite and inside a conservative Macau bounding box. The adapter performs bounded concurrent detail fetches, timeouts, safe user-agent identification, and short in-memory caching. It never forwards raw upstream HTML or errors.

If the current official static page does not expose coordinates machine-readably, the repository may maintain a generated, reviewable parking catalog produced from the official downloadable dataset. A build/sync script owns that artifact. It must not use the supplied APK or a private backend. A missing catalog degrades distance/map precision but must not break the live list.

### Public API

Add `GET /api/parking` to Fastify and Netlify. It returns:

```ts
{
  updatedAt: string;
  stale: boolean;
  facilities: ParkingFacility[];
}
```

Responses are `Cache-Control: no-store`, schema validated, CORS restricted to the production GitHub Pages origin plus explicit development origins, and safe on upstream failure. A recent cached successful result may be returned with `stale:true`; without one, return a structured 502. Exact `/api` routing remains NetworkOnly and existing bus endpoints remain unchanged.

### Frontend client and local data

Add a parking client that validates the contract with Zod and supports abort. Poll while parking list/map/detail is visible, pause when the document is hidden, and retain the last successful response on transient failure with a visible stale/error indicator.

Migrate the existing preferences value without changing its storage key or deleting fields. The next schema adds:

- `activeMode: 'bus' | 'parking' | null`
- `parkingFavorites: string[]`
- `parkingAlertThreshold: number` default 10, integer 1-100

The push identity storage key stays unchanged so existing subscriptions and bus alerts continue to work.

## Parking push backend

Extend the existing capability-token and Netlify Blobs design rather than introducing a second identity system. Parking alerts use a separate `parking-alerts` store and a discriminated contract with parking ID/name/threshold, creation/expiry timestamps, and subscription ID. Store only token hashes; never log tokens, endpoints, keys, GPS, full request bodies, or user-agent fingerprints.

Add CRUD endpoints under `/api/push/parking-alerts` and a minute scheduled checker. Reuse shared auth, CORS, rate-limit, expiry, dead-subscription, and push delivery helpers. Group work so the checker fetches parking data once per run, not once per alert.

## Visual system and accessibility

This is an extension inside the accepted existing design system, so no new image concept or raster asset is required. Preserve the current true-background color, typography, spacing scale, open-list container model, button geometry, focus treatment, icon family, safe-area behavior, dark theme, and responsive breakpoints. Use existing Lucide icons only where they clarify navigation/actions. Do not add ads, promotional banners, badges, fake metrics, decorative gradients, or APK-derived branding.

All mode, tab, row, favorite, sort, alert, and navigation controls require accessible names, visible focus, 44px touch targets where practical, and deterministic selected states. Mobile 390px must not horizontally overflow; desktop keeps the existing centered application width and map/list density.

## PWA, privacy, and update behavior

- Bump package, app release, and service-worker cache identity together to 0.4.0.
- Continue safe automatic activation/update and preserve localStorage/IndexedDB.
- Keep HTML/navigation no-cache behavior and exact API NetworkOnly handling.
- Offline launch may show the cached shell and last in-memory/session-visible data, but never labels stale parking data as live.
- Location stays in the browser and is used only for local distance/sorting. It is never sent to Netlify.
- README and in-app source/privacy copy state that DSAT supplies parking/bus data, OpenStreetMap supplies map tiles, values are informational, and background alert timing is best effort.

## Verification

- Pure parser/client tests cover complete, missing, paused, malformed, reordered, and unexpected upstream markup.
- API tests cover methods, CORS, no-store, schema, caching/stale fallback, upstream timeouts, and raw-data non-disclosure.
- Preference tests prove migration preserves every existing bus field and push identity.
- Component tests cover first-run choice, remembered mode, both navigation sets, search/sort, map/list degraded states, favorites, navigation, and alert threshold UX.
- Push tests cover capability auth, limits, expiry, grouped fetch, threshold crossing, one-shot deletion, non-triggering unknown values, and dead subscriptions.
- Browser QA covers desktop and 390px mobile, light/dark, first run, mode switching, local persistence, parking list/detail/map/search/favorite/navigation/alert flows, bus regression, offline reload, and update preservation.
- Run the full verification suite, fresh Playwright suite, Netlify build, audit, diff check, scoped review, commit, and push. Live deployment is verified only if the configured GitHub/Netlify pipelines deploy from the push.
