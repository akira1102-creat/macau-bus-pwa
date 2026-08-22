# Background Arrival Notifications Design

## Goal

Extend the existing Macau bus PWA with route-stop arrival counts and anonymous, one-shot Web Push reminders that can arrive while the installed PWA is closed or the device is locked.

## Confirmed product decisions

- Route detail opens on the stops tab.
- Tab order is stops on the left and realtime buses on the right.
- A stop row shows the full plate of every bus currently observed at that stop instead of the generic `有觀測` label.
- Tapping a stop can create a one-shot reminder. The default trigger is three stops before arrival and is configurable from one to ten stops in Settings.
- The first bus that reaches the configured threshold triggers the reminder. A successful push completes and deletes the reminder.
- A reminder expires after four hours and each anonymous device may keep at most five active reminders.
- The nearby-stops surface may send at most five nearby stop IDs to Netlify. It must never send GPS coordinates.
- Nearby results show route, direction, full plate, and remaining stops. Selecting a result opens the matching route and direction.

## Platform approach

Use the existing GitHub Pages frontend and Netlify API. Add standards-based Web Push, Netlify Blobs for anonymous subscriptions and reminders, and a Netlify Scheduled Function running once per minute. Do not introduce Firebase, OneSignal, accounts, or a user database.

iOS and iPadOS require 16.4 or later and an app installed to the Home Screen before Web Push is available. Android and desktop browsers use their normal Push API support. Delivery cadence is best effort and can lag by roughly one to two minutes because the checker runs once per minute and upstream observations can move between stops.

## UX

### Route detail

The route-data tabs render in this order: `站點`, `實時巴士`. `站點` is selected initially. Direction selection remains above both tabs.

Every stop is a keyboard-accessible button. Its trailing area shows zero or more plate badges for buses whose observation station matches that stop. Tapping the row opens an accessible reminder sheet containing route, direction, stop name, the current default lead-stop count, and a primary `設定一次性提醒` action. An active reminder shows its threshold and can be cancelled.

Notification permission is requested only from that explicit action. Permission denial leaves the reminder uncreated and shows recovery copy. If Push API support is unavailable, the sheet explains the platform requirement instead of creating a local-only promise.

### Settings

Add a `到站提醒` section above the local-data note. A numeric stepper/radio group accepts integers from one to ten and defaults to three. The section also reports notification permission/support and lists active one-shot reminders with cancel controls.

Keep the existing preference storage key. Migrate stored version-1 preferences to version 2 without losing favorites, recent routes, or theme. Version 2 adds `notificationLeadStops`.

### Nearby stops

After local geolocation finds up to five nearby stops, send only their IDs to the batch arrivals endpoint. Render each stop with distance plus arrival rows containing route, direction, plate, and `仲有 N 站`. Results at the stop show `已到站`. Selecting an arrival opens route detail with the returned direction selected.

If live arrivals fail, the nearby stop list and route links remain usable and show a scoped realtime-unavailable message.

## Arrival calculation

Create a shared pure function:

```ts
remainingStopsToTarget(
  stopIds: readonly string[],
  currentStationCode: string,
  targetStopIndex: number,
): number | null
```

It validates the target index, finds the last matching current-station occurrence at or before the target index, and returns `targetStopIndex - currentIndex`. This makes repeated stop IDs on circular routes deterministic. A negative/unmatched/past observation returns `null`; zero means the bus is at the target.

The batch endpoint resolves each submitted stop ID to every exact route-direction occurrence in the catalog, fetches each unique route-direction once, and returns only buses with a non-null remaining-stop count. Results are sorted by remaining stops, route ID, direction, then plate.

## Frontend push identity

Store push capability data separately from preferences under `macau-bus-pwa:push:v1`:

```ts
interface PushIdentity {
  subscriptionId: string;
  alertToken: string;
}
```

The browser subscribes through `serviceWorkerRegistration.pushManager` using the public VAPID key. The Netlify subscription endpoint returns a random subscription ID and a random capability token. Only a SHA-256 hash of the token is stored server-side. The bearer token authorizes list, create, and delete operations for that subscription; it is never logged.

## API and storage

Add these exact public endpoints, all restricted to the production GitHub Pages origin with explicit method handling, no-store responses, schema validation, request-size limits, and rate limits:

- `GET /api/push/public-key`
- `POST /api/push/subscriptions`
- `GET /api/push/alerts`
- `POST /api/push/alerts`
- `DELETE /api/push/alerts/:alertId`
- `POST /api/bus/arrivals`

Use Netlify Blobs site-wide stores named `push-subscriptions` and `arrival-alerts`.

Stored subscriptions contain only the random ID, PushSubscription endpoint/keys, token hash, and timestamps. Stored alerts contain random ID, subscription ID, route ID, direction, target stop ID and target index, threshold (1-10), created/expiry timestamps. No GPS coordinates, IP addresses, account identifiers, or browsing history are stored.

The arrivals request accepts `{ stopIds: string[] }`, trims/deduplicates IDs, and rejects more than five. Its response contains stop ID, route, direction, plate, and non-negative remaining stops. It never returns upstream raw payloads.

## Scheduled delivery

The scheduled function runs at `* * * * *` UTC for production deploys. It deletes expired alerts, groups the remainder by route and direction, fetches each observation once, and selects the approaching bus with the smallest non-negative remaining count. When that count is at or below the alert threshold, it sends a payload with route, direction, stop, plate, remaining stops, and a GitHub Pages deep link.

The service worker handles `push` by showing a notification and handles `notificationclick` by focusing an existing app client or opening the deep link. A reminder is deleted only after the push provider accepts the notification. HTTP 404/410 push responses remove the dead subscription and its alerts. Transient upstream/push failures retain the reminder until the next run or expiry.

## Secrets and deployment

Generate one VAPID keypair for the linked `macau-bus-api-akr` Netlify site. Store `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` only in Netlify environment variables. Use the public app URL as `VAPID_SUBJECT`. Set `CATALOG_URL` to the public GitHub Pages catalog so server-side arrival calculations can load the same pinned route ordering. Never commit or print the private key.

## Testing and release

- Unit-test repeated-stop arrival math, invalid/past observations, preference migration, and limits.
- Function-test CORS, methods, auth capability hashes, request limits, CRUD, expiry, grouped fetching, one-shot deletion, dead subscriptions, and safe errors using in-memory stores and push fakes.
- Component-test default tab/order, plate badges, reminder sheet, Settings value/active reminders, nearby arrival rows, direction navigation, and degraded realtime states.
- Service-worker test push and notification-click handlers without clearing localStorage/IndexedDB.
- Run the full unit/integration suite, production build, fresh mobile/desktop Playwright suite, Netlify build, and diff checks.
- Bump package/app/service-worker release together from 0.2.4 to 0.3.0.
- Deploy Netlify first, then GitHub Pages. Verify exact live API behavior, versioned worker, desktop/mobile rendering, preference preservation, subscription creation, one test push, one-shot completion, and no console errors. Physical iOS closed-app delivery remains a disclosed device-only verification unless a device is available.

