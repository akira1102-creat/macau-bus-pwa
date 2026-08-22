# Task 1 報告：官方 DSAT 泊車 adapter 同穩定 API

## status

完成。Task 1 production/test slice 已 GREEN；未改 UI、push、版本、plan 或 spec。只加入 synthetic/sanitized fixture，沒有提交 live DSAT HTML。

## files

- `shared/parking-contract.ts`：`ParkingFacility`、spaces/snapshot/response Zod schemas，同保守澳門座標 bounds。
- `server/parking/parser.ts`：純 DSAT realtime/detail HTML parser；數字 ID、五類車位、entity/whitespace、paused/null、reordered markup、detail location/entrance、座標 bounds。
- `server/parking/client.ts`：注入 fetch/clock/cache 的 `ParkingClient.fetchSnapshot(signal?)`；官方 list/detail fetch、4-way detail concurrency、bounded body、timeout、safe user-agent、5 秒成功 cache/stale fallback。
- `server/parking/http.ts`：production GitHub Pages + explicit localhost/127.0.0.1 dev CORS、GET/OPTIONS/no-store。
- `server/parking/runtime.ts`、`netlify/functions/parking.ts`：Netlify runtime/`GET /api/parking` handler，safe 502/504。
- `server/routes/parking.ts`、`server/app.ts`：Fastify `/api/parking` registration，保留 bus route 行為。
- `server/parking/*.test.ts`、`server/routes/parking.test.ts`、`tests/netlify/parking.test.ts`：focused parser/client/Fastify/Netlify tests。
- `tests/fixtures/dsat/parking-*-synthetic.html`：synthetic fixture only。
- `.superpowers/sdd/2026-08-22-parking-mode/task-1-report.md`：本報告。

## RED commands/evidence

- `npx vitest run server/parking/parser.test.ts`（初次）：collection fail，`Cannot find module '../../shared/parking-contract'`。
- `npx vitest run server/parking/client.test.ts`（初次）：collection fail，`Cannot find module './client'`。
- `npx vitest run server/routes/parking.test.ts`（route 未接入）：4 tests fail，GET/OPTIONS/拒絕 origin/上游錯誤均收到 404。
- `npx vitest run tests/netlify/parking.test.ts`（handler 未存在）：collection fail，`Cannot find module '../../netlify/functions/parking'`。
- 後續新增 abort/decimal malformed regression tests 亦先實跑 RED，再以最小改動 GREEN。

## GREEN commands/evidence

- `npx vitest run server/parking/parser.test.ts server/parking/client.test.ts server/routes/parking.test.ts tests/netlify/parking.test.ts`：`4 files passed, 18 tests passed`。
- `npm test`：`41 files passed, 283 tests passed`。
- `npm run typecheck`：exit 0。
- `npm run lint`：exit 0。
- `npm run build`：Vite production build + service worker build 完成。
- `git diff --check`：無 whitespace error。
- live read-only structure check：`https://m.dsat.gov.mo/carpark.aspx` parser 讀到 87 個官方 rows；detail page 位置/出入口可讀，現行 detail 未提供座標所以安全地保留 null。live raw HTML 沒有寫入 repo。

## commit

`新增官方泊車 adapter 同 API`

## self-review

- Contract 嚴格限制 numeric ID、non-negative integer/null spaces、offset datetime、成對且在澳門 bounds 內嘅 WGS84 座標。
- Realtime parser 遇 malformed row 會跳過；unknown/paused values 係 null，唔會當 0；duplicate ID 唔會重複輸出。
- Static detail 係 enrichment：detail timeout/404 不會令完整 live list 消失；主 realtime upstream fail 先走 cache stale fallback，無 cache 就 safe 502/504。
- API body 只經 schema parse，error 只回 `upstream-error`/`upstream-timeout`，不回 raw HTML、upstream message 或 debug payload。
- Fastify bus endpoint regression tests 同全套 Vitest 都通過；新增 `server/app.ts` 只係註冊 parking route 同注入 client。

## concerns

- DSAT 現行 detail page 沒有 machine-readable 座標；此 release 會返回 `latitude/longitude: null`，由後續 catalog/sync 工作按 spec 處理，沒有自行猜座標。
- 每次 5 秒 cache miss 會以最多 4 個 concurrent requests enrichment 官方 detail pages；已設 bounded timeout/body limit，但 live Netlify latency/上游限流仍需 Task 4 deploy/monitoring 實測。
- 本 task 未做 live deployment verification；亦未改 package/app/service-worker version，交由 Task 4。

## Fix round 1

### covering test files

- `server/parking/parser.test.ts`：paused row numeric counts、HTTP 200 non-DSAT/zero-valid rows、partial `id=123abc`。
- `server/parking/client.test.ts`：invalid-html 保留成功 cache stale、caller abort 不取消 shared pending、aggregate detail budget。
- `server/parking/runtime.test.ts`：module-level refresh coalescing/cooldown、無 cache 時 failed refresh admission。
- `tests/netlify/parking.test.ts`：cooldown 期間回傳 stale snapshot 而不重打 DSAT。
- `server/routes/parking.test.ts`：focused rerun，確認 Fastify contract 無 regression。

### RED commands/evidence

- `npx vitest run server/parking/parser.test.ts -t "forces every parsed space count"`：failed；paused row 仍回傳 `car: 7`、`motorcycle: 8`、`electricCar: 9`、`electricMotorcycle: 10`。
- `npx vitest run server/parking/parser.test.ts -t "rejects non-DSAT"`：failed；unknown/zero-valid HTML 未 throw。
- `npx vitest run server/parking/client.test.ts -t "non-DSAT 200"`：failed；invalid 200 response 未映射為 `ParkingClientError` `invalid-html`。
- `npx vitest run server/parking/client.test.ts -t "shared pending refresh"`：failed；第一 caller abort 令第二 caller shared refresh 失敗。
- `npx vitest run server/parking/client.test.ts -t "aggregate budget"`：未於預期 deadline 完成，舊實作等 detail timeout wave，command timeout。
- `npx vitest run server/parking/runtime.test.ts`：failed；`ParkingRefreshAdmission` 未存在，兩個 admission tests collection/runtime fail。
- `npx vitest run tests/netlify/parking.test.ts -t "stale snapshot during"`：failed；cooldown 內第二個 request 未回傳 `stale: true`。
- `npx vitest run server/parking/parser.test.ts -t "partial numeric query ID"`：failed；舊 regex 將 `id=123abc` 截成 `123`。

### GREEN commands/evidence

- 對應 parser RED tests 逐一重跑：`npx vitest run server/parking/parser.test.ts -t "forces every parsed space count"`、`-t "rejects non-DSAT"`、`-t "partial numeric query ID"`：各自 PASS。
- 對應 client RED tests 逐一重跑：`npx vitest run server/parking/client.test.ts -t "non-DSAT 200"`、`-t "shared pending refresh"`、`-t "aggregate budget"`：各自 PASS。
- 對應 runtime/Netlify RED tests 重跑：`npx vitest run server/parking/runtime.test.ts`、`npx vitest run tests/netlify/parking.test.ts -t "stale snapshot during"`：PASS。
- focused integration：`npx vitest run server/parking/parser.test.ts server/parking/client.test.ts server/parking/runtime.test.ts server/routes/parking.test.ts tests/netlify/parking.test.ts`：`5 files passed, 28 tests passed`。
- `npm run typecheck`：exit 0；`npm run lint`：exit 0；`git diff --check`：exit 0。
- `npm test`：`42 files passed, 292 tests passed`。
- `npm run build`：Vite production build、service worker build 完成。

### changes/self-review

- paused row 一律把五類 spaces 設為 null；HTTP 200 非 DSAT/無 valid facility 以 `invalid-html` 失敗，RealtimeCache 因而保留既有成功資料作 stale fallback，不會 fresh-empty overwrite。
- caller signal 只 race 該 caller 等待，不再傳入 shared loader；其他 caller 可完成同一次上游 refresh。
- static detail enrichment 增加可注入 aggregate budget（預設 1.5 秒，上限 30 秒），budget 到期 abort detail workers，返回已取得 realtime rows，未完成 detail 保持 null。
- runtime 新增 module-level pending coalescing/cooldown admission；有成功 snapshot 時 cooldown 內回 stale，無 cache 的 repeated failure 回 429/`Retry-After`，不依賴 GPS/identity。
- official detail ID query 必須完整為 decimal digits，不接受 partial numeric prefix。
- 本輪仍只用 synthetic/sanitized fixtures，未加入 live DSAT HTML；未修改 UI、push、版本、plan/spec；未 push。

### commit

`修正泊車 adapter 安全邊界`

### concerns

- Netlify function instance/module memory 內 admission state 只提供 per-instance protection；多 instance/global quota 仍需 deployment-level monitoring 或 platform control。
- 本輪未做 live deployment verification，且沒有 push；live DSAT behavior/latency 仍需後續部署後觀察。
