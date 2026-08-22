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
