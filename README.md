# 澳門巴士 PWA

This repository keeps the static Macau transit catalog local. The upstream JSON files and generated catalog are intentionally ignored by Git; only the schema, synchronizer, provenance rules, and sanitized fixtures are committed.

## Local setup

```text
npm install
npm run data:sync
npm test
npm run typecheck
npm run lint
npm run build
```

## 開發及 production 預覽

`npm run dev` 會同時啟動 Vite（`http://127.0.0.1:5173`）及本機 Fastify API（port 3001），Vite 會把 `/api` 代理到 API process。production 先執行 `npm run build`，再以 `npm run start` 由同一個 Fastify process 提供 `dist/`、SPA fallback 及 `/api`。

PWA release id 為 `macau-bus-pwa-v0.2.0`，並同步出現在 app release、service-worker cache names 及 production worker。Service worker 使用 navigation NetworkFirst、hashed shell／catalog CacheFirst，`/api` 及 OpenStreetMap tiles NetworkOnly；更新會在啟動、pageshow 及重返 visible 時檢查，保留 localStorage／IndexedDB。

可用以下指令執行完整本機驗證及兩個 viewport 的 Playwright smoke：

```text
npm run verify
npm run test:e2e
```

`test:e2e` 會建置 production bundle，並以 Fastify 在 `http://127.0.0.1:4173` 提供測試頁面。正式公開前仍須重新評估 OSM tile provider 使用政策及以實體 iOS／Android 裝置驗證安裝更新與定位。

`data:sync` downloads exactly five files from the pinned `ChiHin-Lio/macau-bus-data` ref, normalizes them to `public/data/catalog.json`, and writes `public/data/provenance.json`. Set `MACAU_BUS_DATA_REF` to an audited commit when updating the source.

The DSAT probe is deliberately opt-in and makes one polite POST request:

```text
npm run dsat:test -- --route 1 --direction 0
```

The probe prints only protocol metadata and a sanitized summary. Do not commit upstream data, live vehicle identifiers, response bodies, or secrets.
