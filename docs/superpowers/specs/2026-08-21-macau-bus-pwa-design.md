# 澳門巴士 PWA MVP 設計規格

## 目標

建立一個私人技術驗證用、可安裝、手機優先的繁體中文 PWA。使用者可以搜尋澳門巴士路線與站點、查看方向及站序、取得 DSAT 即時巴士觀測、在地圖按目前站點顯示推算位置、查看簡單 ETA、附近站點、收藏與最近查看。

第一版只把 DSAT 回傳的 `staCode` 對應到站點座標；任何巴士 marker 都標示為「推算位置」，不得稱為 GPS。站間平滑移動不屬於 MVP。

## 已選方案

採用單一 TypeScript repository、單一 Node production process：

- React、TypeScript、Vite；
- Fastify proxy；
- Leaflet、OpenStreetMap、`react-leaflet`；
- `vite-plugin-pwa` 的 `injectManifest` 模式；
- Zod 驗證外部資料；
- Vitest、Testing Library、Playwright；
- npm 與鎖定的 `package-lock.json`。

Production 由 Fastify 同時提供 Vite `dist/` 與 `/api`，避免 CORS 和前後端版本錯配。MVP 不加入資料庫、登入、SSR、Redux、WebSocket、Redis、marker clustering 或 Capacitor wrapper。

## 資料來源與發佈邊界

靜態資料透過 `scripts/sync-static-data.ts` 從 `ChiHin-Lio/macau-bus-data` 指定來源版本下載，正規化為前端只需的 catalog。下載檔及生成 catalog 保持在本機並列入 `.gitignore`；repository 只提交 schema、下載器、測試 fixture 及來源歸屬說明，避免在未確認授權前重新發佈整套資料。同步 script 會記錄來源 URL、來源 commit/ref、同步時間及 SHA-256。

資料存取由 `TransitCatalog` 介面抽象，React component 不直接依賴上游 JSON layout。將來可用官方 DSAT static data adapter 取代而不改 UI。

## DSAT 即時資料

Backend 只接受 catalog 已知的 route，direction 只接受 `0` 或 `1`：

`GET /api/bus/realtime/:route/:direction`

2026-08-21 實測顯示現行官方網站以 `POST https://bis.dsat.gov.mo:37812/macauweb/routestation/bus` 查詢，並按網站 JavaScript 產生 token；原 prompt 中的普通 GET 只視為歷史線索。Client 會跟隨當前網站 protocol、帶官方頁面 Referer，以表單欄位傳 route/direction/token。成功 body 雖為 JSON，Content-Type 實測可能是 `text/html; charset=UTF-8`，因此按 UTF-8 text 讀取再 JSON parse，並要求 application `header === "000"`；HTTP 200 但其他 header code 仍算失敗。每次請求設 4 秒 timeout，限制 response size，以 Zod tolerant parser 驗證最外層結構；未知欄位保留於 development debug raw payload，但 production normalized response 不猜測其含義。

Normalized response：

```ts
interface RealtimeRouteResponse {
  route: string
  direction: 0 | 1
  updatedAt: string
  ageSeconds: number
  stale: boolean
  source: 'DSAT observation'
  buses: Array<{
    plate: string
    stationCode: string
    speedKph: number | null
    status: string | null
    passengerFlow: string | null
    busType: string | null
    facilities: string | null
  }>
}
```

Cache key 為 `${route}|${direction}`。成功資料 fresh TTL 為 12 秒；相同 key 的同時 refresh 由同一 Promise coalesce。timeout 或上游錯誤時回傳上一份成功資料並設 `stale: true`；若從未成功取得資料，回傳結構化 `502` 或 `504`，不自動密集 retry。API 加上本機記憶體 rate limit，response 使用 `Cache-Control: no-store`。

Frontend 只輪詢目前可見頁面中選中的 route/direction，每 12 秒一次；document hidden 時暫停，visible 時立即更新。

## ETA

`segment_times.json` 只提供站與下一站的統計時間。ETA 以目前 observation 的 `staCode` 作 0 分鐘 anchor，沿選定方向站序把每段 `median/p50` 秒數累加；沒有 median 才用 average。缺段、負值、找不到目前站、目標不在後方站序時顯示「ETA 暫未提供」。顯示取整至分鐘並使用「約」字，不製造秒級精確度。

## PWA 與離線更新

- manifest 使用 `standalone`、正確 root `start_url`/`scope`、192/512 及 maskable icon；
- navigation network-first，離線 fallback 到 cached app shell；
- hashed JS/CSS、icon、normalized catalog cache-first；
- `/api` 和 OSM tiles network-only，不預先快取公共 OSM tiles；
- service worker cache 名含 release id，每次 cached frontend/catalog 變更同步 bump；
- install `skipWaiting`、activate 刪除舊 cache 並 `clientsClaim`；
- client 以 `updateViaCache: 'none'` 註冊，startup、`pageshow`、重返 visible 時檢查更新；
- 只在新 worker `controllerchange` 後 guarded reload 一次，不清除 localStorage。

離線仍可看 catalog、收藏及最近查看；即時資料與未載入的地圖 tile 顯示明確 unavailable 狀態。

## 前端資訊架構

底部 navigation 固定為：附近、路線、地圖、收藏、設定。

首頁：全域路線／站點搜尋、使用者主動點擊才要求定位的附近站點、收藏路線、最近查看。路線詳情：route identity、operator、方向切換、服務資訊、Leaflet map、實時巴士／站點 tabs、loading/error/stale 狀態、ETA。Map 可顯示 route 站點、按站點座標的巴士 marker、獲授權後的使用者位置。

收藏與最近查看儲存在 versioned localStorage；讀取時 validation，最近項目最多 10 個。位置只在瀏覽器本機計算 Haversine 距離，不傳 server，不記錄。

Development debug panel 顯示 route、direction、遮罩後 plate、staCode、speed、status、last observation 與 raw response；production build 不註冊 raw debug route，UI 亦不包含 debug panel。

## 視覺規格

視覺來源：`docs/design/home-concept.png` 與 `docs/design/route-concept.png`。

- true white `#FFFFFF` 背景、深墨色正文、cool gray divider；
- 主色為澳門玉綠，amber 只用於即時／推算狀態；
- open list layout，避免 nested cards、漸層與重 shadow；
- 觸控目標最少 44px，focus-visible 清晰，文字與控制具足夠對比；
- 390×844 為主要手機視口，桌面使用置中 phone-width content column，map 可適度放寬；
- Light/Dark mode 跟隨設定並可手動選擇；
- 使用 Lucide outline icons，保持一致 stroke。

所有可互動文字、表單、tabs、地圖與列表都以 code-native React 元件實作，概念圖不會出現在 runtime UI。

## 錯誤處理

- 初次：`正在取得即時巴士資料…`；
- 無 cache：`暫時無法取得即時巴士資料`，route page 其他資料仍可用；
- stale：`目前顯示 N 秒前的資料`；
- geolocation denied/unavailable：說明原因並保留 300m/500m/1km 選項；
- catalog 未同步：啟動畫面提供清楚的本機同步指令，不用假資料冒充真資料；
- 任一 route API failure 不得令整個 app crash。

## 驗收與測試

Unit tests 覆蓋 cache TTL/coalescing/stale fallback、DSAT parser、ETA 累加／缺資料、catalog 查詢、Haversine、localStorage validation。Integration tests 用 Fastify `inject()` 驗證 endpoint 與 dev-only debug；React tests 覆蓋搜尋、方向切換、loading/error/stale、收藏／最近、定位權限。Playwright 在 390×844 及桌面驗證核心流程、console health、offline shell 與 service-worker update-like path。

完成門檻：lint、TypeScript、unit/integration、production build、Playwright smoke 全部成功；Browser/IAB 或 Playwright 實際 render 後，用 `view_image` 同兩張概念圖比較至少 copy、layout、type、palette、icons、responsive 六項，記錄 fidelity ledger。

## 已知限制

- DSAT 是非保證穩定的外部 observation API；
- 巴士 marker 是站點座標推算，不是連續 GPS；
- ETA 是歷史分段時間累加，不包含即時路況；
- 記憶體 cache 不跨 process；若日後水平擴展才引入 shared cache；
- OSM 公共 tiles 適合低流量 prototype，正式公開前須重新評估 tile provider 與使用政策；
- iOS Home Screen 更新及實體手機定位需另作真機驗證，桌面模擬不能代替。

## 2026-08-21 實測資料備註

`macau-bus-data` 的五個目標檔實測 schema：`bus-stops.json` 是 597 個站點，欄位包括 `id/name/nameCn/coordinates/routeIds/nameEn/namePor`；`operators.json` 是 route 到 operator；`route-metadata.json` 含 `version/routes` 與多語方向、schedule；`route-stops.json` 是 route 到有序 stop-code；`segment_times.json` 以 `route_direction → time bucket → from→to → {avg_sec,p50,p90,samples}` 組織。Repository 公開但沒有 LICENSE；catalog 只在本機同步與建置。

四個受控 probe（1、26A；direction 0、1）均回 HTTP 200 及 application header `000`。`data.routeInfo[]` 每站含 `staCode` 與可能為空的 `busInfo[]`；bus 欄位 `busType/busCode/busPlate/status/isFacilities/passengerFlow/speed` 均應先按 string/empty-string tolerant 方式解析。動態 response 沒有 GPS；只用 `staCode` 合併 ordered static stop catalog。
