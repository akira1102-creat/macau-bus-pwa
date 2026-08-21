# 澳門巴士 PWA MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可安裝、手機優先的澳門巴士 PWA，從本機同步的靜態 catalog 與受控 DSAT proxy 顯示路線、站點、實時觀測、推算位置、附近站點及簡單 ETA。

**Architecture:** 單一 TypeScript repo；Vite/React frontend 與 Fastify backend 共用 contracts。Production 由一個 Fastify process 同時提供 `dist/` 和 `/api`；靜態資料 adapter、DSAT adapter、cache、ETA 與 UI 分離。

**Tech Stack:** Node 22, npm, React, TypeScript, Vite, Fastify, Zod, Leaflet/react-leaflet, vite-plugin-pwa, Vitest, Testing Library, Playwright, ESLint.

**Spec:** `docs/superpowers/specs/2026-08-21-macau-bus-pwa-design.md`

## Global Constraints

- Runtime UI 必須是繁體中文；只預留 English/Portuguese message keys，不實作翻譯。
- DSAT query fresh TTL 固定 12 秒、timeout 固定 4 秒；同 key request 必須 coalesce。
- route 必須由 catalog allowlist；direction 只接受 `0 | 1`。
- 巴士位置必須標示「推算位置」或「位置按站點顯示」，不得稱為 GPS。
- geolocation 不得傳出 browser；raw DSAT payload 只可在 development 使用。
- `/api` 與 OSM tiles 不可進 service-worker cache；app shell/navigation 可離線。
- static upstream data 和 generated catalog 不提交；只提交同步器、schema、fixture、provenance 規則。
- 每個 cached frontend/catalog 變更要同步 bump app release 與 service-worker cache id。
- 禁止加入 database、auth、SSR、Redux、WebSocket、Redis、marker clustering 或 Capacitor wrapper。

---

### Task 1: Repository foundation and static catalog pipeline

**Files:**
- Create: `package.json`, `package-lock.json`, `tsconfig*.json`, `vite.config.ts`, `eslint.config.js`, `.gitignore`, `.env.example`, `README.md`
- Create: `shared/transit-contract.ts`, `src/domain/transit.ts`, `src/data/catalog-repository.ts`
- Create: `scripts/sync-static-data.ts`, `scripts/test-dsat.ts`, `tests/fixtures/catalog/*.json`
- Test: `src/data/catalog-repository.test.ts`, `scripts/sync-static-data.test.ts`

**Interfaces:**
- Produces `TransitCatalog`, `RouteSummary`, `RouteDirection`, `BusStop`, `SegmentTime`, `loadCatalog(url): Promise<TransitCatalog>`.
- Produces `npm run data:sync` and a polite `npm run dsat:test -- --route 1 --direction 0` probe.

- [ ] Write failing unit tests proving route lookup, direction station order, station search, provenance validation, and rejection of malformed coordinates.
- [ ] Run targeted Vitest tests and confirm failures are caused by missing catalog implementation.
- [ ] Add minimal shared schemas, repository, sync pipeline and DSAT probe; sync only the five requested upstream files and record URL/ref/time/SHA-256.
- [ ] Run the targeted tests until green, then run lint/typecheck for files in this task.
- [ ] Initialize Git on branch `main`, commit only this task plus approved spec/design/plan with Cantonese message `建立澳門巴士 PWA 基礎與資料管線`.

### Task 2: DSAT adapter, coalescing cache and realtime API

**Files:**
- Create: `server/config.ts`, `server/app.ts`, `server/index.ts`
- Create: `server/dsat/dsat-client.ts`, `server/dsat/dsat-parser.ts`
- Create: `server/cache/realtime-cache.ts`, `server/routes/realtime.ts`, `server/routes/health.ts`, `server/routes/debug.ts`
- Test: `server/dsat/dsat-parser.test.ts`, `server/cache/realtime-cache.test.ts`, `server/routes/realtime.test.ts`

**Interfaces:**
- Consumes catalog route allowlist.
- Produces `createDsatClient({ fetch, timeoutMs })`, `parseDsatRouteResponse(raw)`, `RealtimeCache.get(key, loader)`, and `buildServer(options)`.
- Produces `GET /api/bus/realtime/:route/:direction`, `GET /api/health`, development-only `GET /api/debug/dsat/:route/:direction`.

- [ ] Write failing parser tests from sanitized real DSAT fixtures, including missing optional strings, numeric speed strings and buses nested under station observations.
- [ ] Write failing cache tests using a fake clock: 12-second fresh hit, concurrent miss coalescing, refresh after TTL, timeout/error stale fallback, and no-cache failure.
- [ ] Write failing Fastify injection tests for allowlisted route, invalid direction, normalized response, `Cache-Control: no-store`, and production debug 404.
- [ ] Implement the minimum adapter/cache/routes with AbortSignal 4-second timeout, response-size guard, Referer, rate limit, Zod validation and no automatic retries.
- [ ] Run task tests, typecheck and lint; commit `加入 DSAT 即時代理與快取`.

### Task 3: Domain helpers and local state

**Files:**
- Create: `src/domain/eta.ts`, `src/domain/nearby.ts`
- Create: `src/infra/api-client.ts`, `src/infra/geolocation.ts`, `src/infra/local-preferences.ts`
- Test: `src/domain/eta.test.ts`, `src/domain/nearby.test.ts`, `src/infra/local-preferences.test.ts`

**Interfaces:**
- Consumes normalized catalog and `RealtimeRouteResponse`.
- Produces `estimateEtaMinutes(...)`, `findNearbyStops(...)`, `getRealtimeRoute(...)`, `getCurrentPositionOnce()`, and versioned favorites/recent/theme storage helpers.

- [ ] Write failing ETA tests for median-first, average fallback, cumulative segments, missing segment, target before observation and unknown station.
- [ ] Write failing nearby tests for Haversine ordering and 300m/500m/1km thresholds without network calls.
- [ ] Write failing local preference tests for schema validation, corrupt JSON recovery, recent cap 10 and profile-preserving PWA update behavior.
- [ ] Implement minimum pure helpers and adapters; do not add UI or polling here.
- [ ] Run task tests, typecheck and lint; commit `加入 ETA 附近站點與本機偏好邏輯`.

### Task 4: Mobile UI, route workflow and Leaflet map

**Files:**
- Create: `index.html`, `src/main.tsx`, `src/app/App.tsx`, `src/app/router.tsx`, `src/styles/*.css`
- Create: `src/components/*`, `src/features/home/*`, `src/features/routes/*`, `src/features/map/*`, `src/features/settings/*`
- Create: `src/i18n/messages.ts`, `public/icons/*`
- Test: `src/features/home/HomePage.test.tsx`, `src/features/routes/RoutePage.test.tsx`, `src/features/settings/SettingsPage.test.tsx`

**Interfaces:**
- Consumes catalog repository, domain helpers, API client and local preferences.
- Produces the five-tab app shell, home search/nearby/favorites/recent flow, route detail with directions/stops/realtime/stale/error, lazy Leaflet map and theme selection.

- [ ] Write failing Testing Library tests for home search, location permission result, favorite/recent persistence, direction switch, loading, error, stale age, debug gating and the explicit estimated-position label.
- [ ] Run tests and confirm failures are caused by missing UI behavior.
- [ ] Extract CSS tokens, typography, component families, icon treatment and allowed visible copy from `docs/design/*.png`; implement Home and Route screens at 390×844 first, then responsive desktop shell.
- [ ] Lazy-load map, include OSM attribution, station dots, selected route path, bus markers at station coordinates and optional local-only user location.
- [ ] Run component tests, typecheck, lint and browser smoke; commit `完成手機介面與路線地圖流程`.

### Task 5: PWA update lifecycle, integration and release QA

**Files:**
- Create: `src/pwa/register-sw.ts`, `src/sw.ts`, `src/env.d.ts`
- Modify: `vite.config.ts`, `src/main.tsx`, `package.json`, `README.md`
- Create: `tests/e2e/app.spec.ts`, `tests/e2e/pwa.spec.ts`, `playwright.config.ts`, `docs/qa/fidelity-ledger.md`

**Interfaces:**
- Consumes the complete app and server.
- Produces installable manifest/service worker, safe update handoff, production build/server and repeatable QA commands.

- [ ] Write failing unit/integration coverage for update registration guard and network policy helpers; configure Playwright tests for 390×844 and desktop.
- [ ] Implement versioned cache, network-first navigation, cache-first hashed shell/catalog, NetworkOnly API/OSM, `skipWaiting`, `clientsClaim`, startup/pageshow/visible checks and one guarded `controllerchange` reload.
- [ ] Add root scripts: `dev`, `build`, `start`, `test`, `test:e2e`, `typecheck`, `lint`, `verify`, `data:sync`, `dsat:test`.
- [ ] Run `npm run verify`, then production start and Playwright core workflow; test an update-like rebuild and offline shell without clearing localStorage.
- [ ] Capture implementation screenshots at 390×844 and desktop; inspect both concepts and both renders using `view_image`; record at least six comparison points, copy diff and intentional deviations in fidelity ledger, fixing every material mismatch.
- [ ] Bump matching app/cache release identifier, inspect final diff, commit `完成 PWA 更新流程與整合驗證`.

## Plan self-review

- Spec coverage: architecture, static data boundary, DSAT probe/proxy/cache, route UI, map, nearby, ETA, local preferences, debug gating, PWA updates and QA all map to a task.
- Placeholder scan: implementation steps contain named interfaces, files and acceptance cases; no implementation placeholder is permitted.
- Type consistency: route/direction/cache contracts are defined in Task 1 and consumed unchanged by Tasks 2–5.
