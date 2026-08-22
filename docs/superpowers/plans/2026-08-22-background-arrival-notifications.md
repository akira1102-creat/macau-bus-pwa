# Background Arrival Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add remaining-stop arrivals and anonymous one-shot Web Push reminders that work after the installed PWA closes.

**Architecture:** Keep the GitHub Pages React PWA and add Netlify-native batch arrivals, Blob-backed push subscriptions/alerts, and a minute scheduler. Share deterministic stop-index math across the browser and functions, keep GPS local, and authorize anonymous alert CRUD with a hashed capability token.

**Tech Stack:** React 18, TypeScript, Vite PWA/Workbox, Vitest, Playwright, Netlify Functions, Netlify Blobs, Web Push/VAPID, Zod.

**Spec:** `docs/superpowers/specs/2026-08-22-background-arrival-notifications-design.md`

## Global Constraints

- Route detail defaults to stops; tab order is stops then realtime buses.
- Settings default is 3 and accepts only integer lead counts from 1 through 10.
- Reminders are one-shot, expire after 4 hours, and are limited to 5 active reminders per anonymous subscription.
- Nearby requests contain at most 5 stop IDs and never GPS coordinates.
- Store capability tokens only as SHA-256 hashes and never log tokens, push endpoints, keys, GPS, or full request bodies.
- Preserve version-1 favorites, recents, theme, localStorage, and IndexedDB through migration/update.
- Release package/app/service-worker together as 0.3.0.

---

### Task 1: Shared arrival math, preference migration, and direction routing

**Files:**
- Create: `shared/arrival-distance.ts`
- Create: `shared/arrival-distance.test.ts`
- Modify: `src/infra/local-preferences.ts`
- Modify: `src/infra/local-preferences.test.ts`
- Modify: `src/app/router.tsx`
- Modify: `src/app/router.test.tsx`

**Interfaces:**
- Produces: `remainingStopsToTarget(stopIds, currentStationCode, targetStopIndex): number | null`.
- Produces: version-2 `Preferences.notificationLeadStops: number`, `LocalPreferences.getNotificationLeadStops()`, and `setNotificationLeadStops(value)`.
- Produces: `AppRoute.directionId?: DirectionId` and direction-aware parse/navigation URLs.

- [ ] **Step 1: Write failing arrival-distance tests** for exact matches, zero remaining, repeated stop IDs using the last match at/before target, invalid target index, missing current station, and a bus observed only after the target.
- [ ] **Step 2: Run `npx vitest run shared/arrival-distance.test.ts`** and verify failures occur because `remainingStopsToTarget` is missing.
- [ ] **Step 3: Implement the pure function** with trimmed exact IDs and no catalog/network dependencies.
- [ ] **Step 4: Write failing migration/routing tests** asserting version-1 JSON becomes version 2 with lead count 3, invalid lead counts normalize to 3, values 1 and 10 persist, and `?tab=routes&route=1&direction=1` round-trips.
- [ ] **Step 5: Run `npx vitest run src/infra/local-preferences.test.ts src/app/router.test.tsx`** and verify the new assertions fail for the intended missing fields.
- [ ] **Step 6: Implement version-2 migration and direction routing** without changing the storage key or clearing old values.
- [ ] **Step 7: Run all Task 1 tests** and verify they pass.

### Task 2: Nearby-arrivals batch API

**Files:**
- Create: `netlify/functions/arrivals.ts`
- Create: `tests/netlify/arrivals.test.ts`
- Modify: `netlify/functions/_shared/catalog.ts`
- Modify: `netlify/functions/_shared/http.ts`

**Interfaces:**
- Consumes: `remainingStopsToTarget` from Task 1.
- Produces: `POST /api/bus/arrivals` accepting `{ stopIds: string[] }` and returning `{ updatedAt, arrivals: Array<{ stopId; route; direction; plate; remainingStops }> }`.

- [ ] **Step 1: Write failing function tests** for OPTIONS/POST, exact production CORS, no-store, malformed JSON, deduplication, the five-stop maximum, unknown stops, catalog unavailable, grouped route-direction DSAT calls, remaining-stop output, sorting, and absence of raw upstream data.
- [ ] **Step 2: Run `npx vitest run tests/netlify/arrivals.test.ts`** and verify failure because the function does not exist.
- [ ] **Step 3: Extend shared HTTP helpers** so this endpoint allows only POST/OPTIONS without widening existing GET endpoints.
- [ ] **Step 4: Implement catalog-backed route-direction expansion and grouped parallel fetches** with allowlisted route IDs and the existing DSAT runtime/cache.
- [ ] **Step 5: Validate the response with a local Zod schema** and return safe 400/413/503/502 bodies as appropriate.
- [ ] **Step 6: Run Task 2 tests** and verify all pass.

### Task 3: Blob-backed Web Push backend and minute checker

**Files:**
- Create: `netlify/functions/_shared/push-contract.ts`
- Create: `netlify/functions/_shared/push-store.ts`
- Create: `netlify/functions/push-public-key.ts`
- Create: `netlify/functions/push-subscriptions.ts`
- Create: `netlify/functions/push-alerts.ts`
- Create: `netlify/functions/check-arrival-alerts.ts`
- Create: `tests/netlify/push-api.test.ts`
- Create: `tests/netlify/check-arrival-alerts.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `remainingStopsToTarget` from Task 1 and the existing DSAT runtime/catalog.
- Produces: the five push endpoints from the spec plus `runArrivalAlertCheck(dependencies)` for deterministic scheduled-function tests.
- Produces: client JSON shapes `PushIdentity`, `ArrivalAlertInput`, and `ArrivalAlertSummary` exported from `push-contract.ts`.

- [ ] **Step 1: Add `@netlify/blobs`, `web-push`, and `@types/web-push`** and write failing API tests with in-memory store and push doubles.
- [ ] **Step 2: Verify API tests fail** for missing handlers, token hashing, active limit, validation, CORS, methods, expiry, list, create, and delete.
- [ ] **Step 3: Implement store injection and public-key/subscription/alert handlers** using cryptographic random IDs/tokens and SHA-256 token hashes.
- [ ] **Step 4: Write failing checker tests** for grouped fetches, nearest qualifying bus, no early trigger, successful one-shot deletion, transient retention, expiry cleanup, and 404/410 subscription cleanup.
- [ ] **Step 5: Implement `runArrivalAlertCheck` and the scheduled default export** with `config.schedule = '* * * * *'` and a 4-hour expiry policy.
- [ ] **Step 6: Run Task 3 tests** and verify all pass without logging sensitive values.

### Task 4: Route-stop reminder UX, Settings, and service-worker push

**Files:**
- Create: `src/infra/push-client.ts`
- Create: `src/infra/push-client.test.ts`
- Create: `src/features/routes/ArrivalAlertSheet.tsx`
- Create: `src/features/routes/ArrivalAlertSheet.test.tsx`
- Modify: `src/features/routes/RoutePage.tsx`
- Modify: `src/features/routes/RoutePage.test.tsx`
- Modify: `src/features/settings/SettingsPage.tsx`
- Modify: `src/features/settings/SettingsPage.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/sw.ts`
- Modify: `src/pwa/cache-policy.test.ts`
- Modify: `src/styles/app.css`

**Interfaces:**
- Consumes: Task 1 preferences/direction routing and Task 3 push JSON contracts.
- Produces: `PushClient` with `support()`, `listAlerts()`, `createAlert(input)`, and `deleteAlert(id)` methods.
- Produces: `RoutePage.initialDirectionId?: DirectionId` and reminder sheet interactions.

- [ ] **Step 1: Write failing push-client tests** for unsupported state, permission denial, service-worker subscription, separate `macau-bus-pwa:push:v1` identity storage, bearer auth, list/create/delete, and safe network errors.
- [ ] **Step 2: Implement the minimal push client** and verify its focused tests pass.
- [ ] **Step 3: Write failing component tests** asserting stops default/left order, complete plate badges replace `有觀測`, stop buttons open the sheet, default lead count is used, active reminders cancel, and Settings persists 1-10 values and shows permission state.
- [ ] **Step 4: Implement route/settings UI and App wiring** while keeping debug data masking and existing theme behavior.
- [ ] **Step 5: Write failing worker tests** for `push` payload notification display and `notificationclick` focus/open behavior.
- [ ] **Step 6: Implement worker push/click handlers** without touching application storage or existing update logic.
- [ ] **Step 7: Run all Task 4 tests** and verify accessibility roles/names and error states.

### Task 5: Nearby-stop arrival rows and direction-aware navigation

**Files:**
- Create: `src/infra/arrivals-client.ts`
- Create: `src/infra/arrivals-client.test.ts`
- Create: `src/features/home/NearbyArrivals.tsx`
- Create: `src/features/home/NearbyArrivals.test.tsx`
- Modify: `src/features/home/HomePage.tsx`
- Modify: `src/features/home/HomePage.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/app.css`

**Interfaces:**
- Consumes: Task 2 arrivals response and Task 1 direction-aware navigation.
- Produces: `ArrivalsClient.getForStops(stopIds, signal?)` and `HomePage.onOpenRoute(routeId, directionId?)`.

- [ ] **Step 1: Write failing client tests** for deduplicated max-five stop IDs, POST body, schema validation, abort, and safe errors.
- [ ] **Step 2: Implement arrivals client** using the configured Netlify API base and verify focused tests pass.
- [ ] **Step 3: Write failing Home tests** asserting GPS coordinates never enter request bodies, stop IDs are sent only after successful location, arrivals show route/direction/full plate/remaining count, at-stop copy, click opens matching direction, and API failure preserves the nearby stop list.
- [ ] **Step 4: Implement nearby arrivals UI** with one batch request per nearby-stop change and cancellation on rerender/unmount.
- [ ] **Step 5: Add narrow-screen styles** and run Home tests at component level.

### Task 6: Integration, release, deployment, and live verification

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/pwa/release.ts`
- Modify: `tests/e2e/app.spec.ts`
- Modify: `tests/e2e/pwa.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: release 0.3.0 on Netlify and GitHub Pages.

- [ ] **Step 1: Integrate concurrent edits** resolving `App.tsx`/CSS conflicts without reverting any worker changes.
- [ ] **Step 2: Add E2E coverage** for default stops/order, plate badges, reminder setup with a fake PushManager, Settings lead count persistence, nearby arrival deep link, service-worker update, and offline preference preservation.
- [ ] **Step 3: Bump package and `APP_RELEASE` to 0.3.0** and update worker/release assertions and README deployment/privacy notes.
- [ ] **Step 4: Run `npm run verify`** and require typecheck, lint, all Vitest files, and production build to pass.
- [ ] **Step 5: Run a fresh `PLAYWRIGHT_BASE_URL=http://127.0.0.1:<free-port> npm run test:e2e`** for mobile 390 and desktop and require zero failures.
- [ ] **Step 6: Run `npx netlify build`, `npm audit --omit=dev`, and `git diff --check`** and inspect the final scoped diff.
- [ ] **Step 7: Generate scoped VAPID keys and set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, and public `CATALOG_URL` on the linked Netlify site** without printing or committing the private key.
- [ ] **Step 8: Commit one coherent Cantonese release commit, push main, deploy Netlify production, and wait for the Pages workflow**.
- [ ] **Step 9: Verify live** API CORS/auth/limits, catalog, worker 0.3.0, desktop/mobile UI, one controlled subscription/test push/one-shot removal where browser support permits, clean console, and clean git status.

