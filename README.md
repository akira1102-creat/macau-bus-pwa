# 澳門巴士 PWA

This repository does not commit the generated Macau transit catalog. The upstream JSON files stay ignored by Git; local development and the GitHub Pages workflow generate a pinned, provenance-recorded catalog at build time. The DSAT data-open catalogue lists static bus route data as unconditionally open; review the pinned source and provenance before changing or redistributing the build pipeline.

## 公開部署

- PWA：<https://akira1102-creat.github.io/macau-bus-pwa/>
- 即時 API：<https://macau-bus-api-akr.netlify.app/api/health>

GitHub Pages 只提供靜態 PWA。瀏覽器會把即時路線請求送到 Netlify Function；Function 只接受 `https://akira1102-creat.github.io` 的跨域請求、驗證路線及方向，並只回傳正規化後的 DSAT observation。

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

如果 `public/data/catalog.json` 尚未同步或暫時被重新命名，server 仍會啟動並提供 static shell；`/api/health` 會回傳 `catalogReady: false`，需要路線 catalog 的 API 會回傳 503、`no-store` 及 `npm run data:sync` action。可用 `CATALOG_PATH` 指向另一個 catalog 路徑作本機 smoke test。

PWA release id 為 `macau-bus-pwa-v0.3.0`，並同步出現在 app release、service-worker cache names 及 production worker。Service worker 使用 navigation NetworkFirst、hashed shell／catalog CacheFirst，catalog cache 會包含 build-time catalog revision，`/api`（包括 project path 下的 API）及 OpenStreetMap tiles NetworkOnly；更新會在啟動、pageshow 及重返 visible 時檢查，保留 localStorage／IndexedDB。v0.3.0 加入附近站巴士尚餘站數、站點車牌，以及安裝後可用的一次性背景到站通知；瀏覽器只會向 API 傳送最多五個附近站 ID，不會傳送 GPS。

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
