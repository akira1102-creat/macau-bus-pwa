# Parking Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Every production behavior follows TDD: write the test, run it red for the intended missing behavior, then implement the minimum green change.

**Goal:** Add a clean-room, all-free parking mode to the existing Macau bus PWA without regressing bus behavior or PWA data/update guarantees.

**Architecture:** Introduce a DSAT parking adapter and stable JSON endpoint, then add a mode-aware React shell and parking feature modules. Extend the existing anonymous Web Push identity with separate one-shot low-space alerts. Keep GPS local and preserve the current Workbox/update architecture.

**Tech Stack:** React 18, TypeScript, Vite PWA/Workbox, Leaflet/OpenStreetMap, Fastify, Netlify Functions/Blobs, Web Push, Zod, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-22-parking-mode-design.md`

## Global Constraints

- Clean-room implementation: no APK code/assets/credentials/private backend or Firebase/AdMob/payment integration.
- Preserve all current bus routes, local fields, push identity, offline launch, and safe update behavior.
- First-run mode choice, remembered last mode, and top quick switch; visible name remains 「澳門實時巴士」.
- Parking threshold defaults to 10, accepts integer 1-100, alerts expire after 12 hours, and max 10 active parking alerts.
- GPS never leaves the browser. Tokens, endpoints, keys, coordinates, user agents, and full bodies are never logged.
- Unknown/paused parking values are null/`—` and never trigger alerts.
- Release package/app/service worker together as 0.4.0.

---

### Task 1: Official parking adapter and stable API

**Ownership:** `shared/parking-contract.ts`, `server/parking/**`, `server/routes/parking*`, `netlify/functions/parking.ts`, `tests/netlify/parking.test.ts`, and their focused tests only.

**Interfaces:**
- Produces the exact `ParkingFacility` contract from the spec and Zod schemas shared by server/client.
- Produces `parseParkingRealtimeHtml(html)` and `ParkingClient.fetchSnapshot(signal?)` with injected fetch/clock/cache dependencies.
- Produces `GET /api/parking` on Fastify and Netlify with `{ updatedAt, stale, facilities }`.

- [ ] Write sanitized fixture-driven parser tests for five space types, numeric official ID, entity/whitespace normalization, null/paused values, reordered markup, malformed rows, and Macau-bounds coordinate validation.
- [ ] Run focused tests and record RED caused by missing parking adapter symbols.
- [ ] Implement the pure parser and bounded DSAT fetch client with timeout and short successful-response cache.
- [ ] Write Fastify/Netlify endpoint tests for GET/OPTIONS, exact CORS, no-store, schema, stale fallback, safe 502, and no raw HTML/error leakage.
- [ ] Run focused endpoint tests and record RED caused by missing routes/handler.
- [ ] Implement route/handler using shared runtime patterns without modifying bus endpoint behavior.
- [ ] Run all Task 1 tests and commit one coherent Cantonese commit.

### Task 2: Mode preferences, routing, shell, and parking UI

**Ownership:** `src/infra/local-preferences*`, `src/app/router*`, `src/app/App*`, `src/components/AppShell.tsx`, `src/features/parking/**`, `src/i18n/messages.ts`, `src/styles/app.css`, and focused frontend tests. Do not modify push backend files.

**Interfaces:**
- Consumes Task 1 parking schemas/API.
- Produces preference fields `activeMode`, `parkingFavorites`, and `parkingAlertThreshold` while preserving existing fields/storage key.
- Produces parking routes for nearby, map, search, favorites, and detail, plus mode-aware navigation.
- Produces `ParkingApiClient.getSnapshot(signal?)`, polling, local nearby sorting, search, favorites, external navigation, and alert-entry UI callback.

- [ ] Write migration tests proving older stored values preserve all bus fields and gain null mode, empty parking favorites, and threshold 10; test bounds/deduplication.
- [ ] Write router/AppShell tests for first-run choice, remembered mode, quick switch, both exact navigation sets, parking detail deep links, and bus route compatibility.
- [ ] Run tests and record RED for the missing mode/preferences/routes.
- [ ] Implement preference migration, mode-aware router, first-run sheet, and shell navigation.
- [ ] Write API client and component tests for abort/schema errors, polling visibility, complete-list fallback without GPS, local-only distance, search/sort, null values, freshness, favorites, map selection, detail, and navigation URL fallback.
- [ ] Run tests and record RED for missing parking feature modules.
- [ ] Implement parking pages/components using the existing open-list visual system, Leaflet/OSM, accessible controls, safe responsive layout, and no new raster assets.
- [ ] Add shared Settings controls for threshold 1-100 and source/privacy copy without changing current bus settings behavior.
- [ ] Run all Task 2 tests and commit one coherent Cantonese commit.

### Task 3: One-shot parking Web Push

**Ownership:** `netlify/functions/_shared/push-contract.ts`, shared push helpers/store additions, `netlify/functions/push-parking-alerts.ts`, `netlify/functions/check-parking-alerts.ts`, `src/infra/push-client*`, parking alert UI tests/components, `src/sw.ts` only if a generic deep-link handler adjustment is needed, and focused push tests. Do not redesign shell/parking list CSS.

**Interfaces:**
- Extends the existing push identity/capability token; no second browser subscription.
- Produces list/create/delete under `/api/push/parking-alerts` and `runParkingAlertCheck(dependencies)`.
- Parking alert input is parking ID/name and integer threshold 1-100; server owns 12-hour expiry and 10-active limit.

- [ ] Write failing API tests for methods/CORS/no-store, capability hashes, validation, one-per-facility replacement, 10-active limit, expiry, list/create/delete, and safe errors.
- [ ] Implement separate Blob storage and endpoints by reusing shared auth/rate-limit/runtime patterns.
- [ ] Write failing checker tests for one parking fetch per run, below/equal threshold, above threshold, null/paused/missing values, successful one-shot delete, transient retention, expiry cleanup, and 404/410 cleanup.
- [ ] Implement the minute checker and deep-link notification payload.
- [ ] Write failing frontend tests for unsupported/denied permission, create/list/delete, default threshold, active/cancel state, and retained bus-alert compatibility.
- [ ] Implement the parking alert client/UI wiring and reuse service-worker focus/open behavior.
- [ ] Run all Task 3 tests and commit one coherent Cantonese commit.

### Task 4: Integration, PWA release, visual QA, and delivery

**Ownership:** integration tests, E2E, release/version/config/docs/QA artifacts, and only necessary cross-task fixes.

**Interfaces:**
- Consumes Tasks 1-3.
- Produces release 0.4.0 and a deployable GitHub Pages + Netlify Functions build.

- [x] Add/extend E2E coverage for first-run choice, remembered mode after reload, both navigation sets, parking list/search/favorite/detail/map/navigation, one-shot alert with fake PushManager, bus regression, offline reload, and update/local-data preservation.
- [x] Run new E2E tests RED before integration fixes, then implement only the necessary glue.
- [x] Bump `package.json`, lockfile, app release, worker cache/release assertions, and README/source/privacy notes to 0.4.0.
- [x] Run `npm run verify`; require typecheck, lint, all Vitest tests, and production build to pass.
- [x] Run a fresh mobile 390px and desktop Playwright suite with no reused server; require zero failures and no console/page errors.
- [x] Run `npx netlify build`, `npm audit --omit=dev`, and `git diff --check`; inspect the complete scoped diff and clean status boundaries.
- [x] Verify rendered light/dark mobile/desktop surfaces, compare against the existing accepted design references, inspect screenshots with `view_image`, and record at least five fidelity points in `docs/qa/fidelity-ledger.md`.
- [ ] Request final whole-branch review, fix all Critical/Important findings in one reviewed wave, and re-run affected/full verification.
- [ ] Commit one coherent Cantonese release commit and push the configured branch. If the push triggers deployment, verify the live GitHub Pages worker/app 0.4.0 and Netlify parking endpoint; do not claim physical closed-app delivery without device evidence.
