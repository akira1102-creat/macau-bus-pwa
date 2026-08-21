# 澳門巴士 PWA Task 4 UI Implementation Plan

> **For agentic workers:** Task 4 is implemented inline in the current worktree. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the mobile-first React shell, home/search/nearby/favorite/recent flow, route detail/realtime workflow, settings theme controls, and a lazy Leaflet map using only the local catalog and Task 1–3 interfaces.

**Architecture:** Keep `App` as a small shell that owns catalog loading, route state, theme, and tab navigation. Home, route detail, settings, polling, and map are separate feature components. The route screen receives catalog/repository/API/preferences through explicit props so component tests can use sanitized fixtures and production defaults remain real-data-only.

**Tech Stack:** React 18, TypeScript, Vite, Lucide React, Leaflet, Vitest, Testing Library, jsdom.

**Spec:** `docs/superpowers/specs/2026-08-21-macau-bus-pwa-design.md`; visual truth: `docs/design/home-concept.png`, `docs/design/route-concept.png`.

## Global Constraints

- Runtime UI is Traditional Chinese; no fake route or station data when `public/data/catalog.json` is unavailable.
- Realtime polling is only for the selected route/direction while the route screen is visible; interval is 12 seconds and hidden documents pause.
- Every displayed bus position is station-coordinate based and explicitly labeled as estimated / station-displayed; never call it GPS.
- Map code is lazy-loaded and uses OpenStreetMap attribution; browser location remains local-only.
- App content does not recreate phone status bars or home indicators.
- Light/dark/system preferences use the existing versioned local preference adapter.
- Task 5 owns service-worker registration and cache lifecycle; Task 4 must not add a service worker.

### Task 1: Dependencies and test harness

**Files:** `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`, `src/test/setup.ts`

- [ ] Add React, Vite React plugin, Lucide, Leaflet, and Testing Library/jsdom dependencies.
- [ ] Configure JSX, React plugin, jsdom, setup file, and `.tsx` test inclusion.
- [ ] Run the existing suite to prove the harness still passes.

### Task 2: RED component contracts

**Files:** `src/features/home/HomePage.test.tsx`, `src/features/routes/RoutePage.test.tsx`, `src/features/settings/SettingsPage.test.tsx`

- [ ] Write tests for search results, local nearby permission, favorite/recent writes, direction switching, loading/error/stale states, debug gating, and explicit estimated-position wording.
- [ ] Run the focused files before production components exist; record the expected missing-module failures.

### Task 3: App shell and home flow

**Files:** `index.html`, `src/main.tsx`, `src/app/App.tsx`, `src/app/router.tsx`, `src/i18n/messages.ts`, `src/components/*`, `src/features/home/*`, `src/styles/*`

- [ ] Implement real catalog loading with a clear local sync instruction when the catalog is absent/invalid.
- [ ] Implement five-tab navigation, route/station search, nearby location request/radius results, favorites/recent and theme application.
- [ ] Keep controls keyboard/focus accessible and use Lucide outline icons with 44px touch targets.
- [ ] Run focused home/settings tests and make them green.

### Task 4: Route, polling, and lazy map

**Files:** `src/features/routes/*`, `src/features/map/*`

- [ ] Implement route identity/operator/direction tabs, ordered stops, realtime tab, loading/error/stale age and debug-only normalized panel.
- [ ] Poll only the selected route/direction while visible; abort/cleanup on route change, unmount, and hidden state.
- [ ] Lazy-load Leaflet map with OSM attribution, station dots/polyline, station-coordinate bus markers, and optional local user marker.
- [ ] Use `estimateEtaMinutes` with an explicit observation station code for each bus and render an unavailable message when data is insufficient.
- [ ] Run route tests and the full type/lint suite.

### Task 5: Browser smoke, visual review, report, and commit

**Files:** `.superpowers/sdd/2026-08-21-macau-bus-pwa/task-4-report.md` plus Task 4 source files only

- [ ] Start the Vite app with a synchronized local catalog and capture desktop/mobile render evidence; use the in-app Browser first, Playwright only if unavailable.
- [ ] Inspect both concept images and the latest implementation screenshot; record copy/layout/type/palette/icon/responsive comparison points and intentional deviations.
- [ ] Inspect the scoped diff, run tests/typecheck/lint/build, write RED/GREEN/browser evidence, and commit with `完成手機介面與路線地圖流程`.
