# 視覺保真度記錄 — v0.4.0

最終比較已完成；完整證據及 iteration history 見專案根目錄 `design-qa.md`。

## 自動驗證

| 視口 | 驗證 | 狀態 |
| --- | --- | --- |
| 390×844 | Playwright mobile project + Browser/IAB 核心流程 + `view_image` comparison | 通過 |
| 1280×900 | Playwright desktop project + native render inspection | 通過 |
| 泊車模式 390×844 / 1280×900 | Playwright parking list capture + `view_image` comparison | 通過；Browser/IAB screenshot 曾 timeout，改用 Playwright fallback |
| manifest | standalone、root scope、192/512/maskable PNG | 由 `tests/e2e/pwa.spec.ts` 驗證 |
| update lifecycle | startup、pageshow、visible、guarded controllerchange | 由 `src/pwa/update-lifecycle.test.ts` 驗證 |
| cache policy | `/api` 與 OSM tile network-only | 由 `src/pwa/cache-policy.test.ts` 驗證 |

## 最終比較

- Release：`macau-bus-pwa-v0.4.0`；parking integration、unit/integration 及 fresh E2E 以最終驗證結果為準。
- 對照來源：`docs/design/home-concept.png`、`docs/design/route-concept.png`。
- 手機 render：390×844；桌面 render：1280×900。
- Copy：繁體中文介面一致；泊車頁明確標示 DSAT、OpenStreetMap 及「數值可能延遲」，未知空位使用 `—`。
- Layout：泊車頁沿用 open-list rows；手機保留完整列表及固定導覽，桌面保持置中 application width，無橫向溢出。
- Type：深墨色 CJK sans hierarchy 清晰；停車場名稱、位置、更新時間及空位數字維持同一層級節奏。
- Palette：true white、jade、cool gray、amber 狀態色與概念一致；選中模式、收藏及主要操作使用 jade。
- Icons／controls：Lucide outline stroke 統一；模式切換、收藏、導航、提醒及底部導覽控制均有 accessible name，quick switch 實際高度至少 44px。
- Responsive：390×844 及 1280×900 泊車 list／chooser 通過；safe-area、bottom navigation 及 search/sort controls 無重疊。
- Intentional deviations：真實 OSM map 取代概念的簡化地圖；乾淨首頁不虛構 nearby/favorite/recent；route header 同時顯示真實端點與 `路線 26A` badge。
- Material mismatch fix：第一次比較發現 route number 缺失，commit `656f79c` 補回；final review 再以 Lucide `BusFront` 取代文字 marker。v0.2.2 重新 build、capture、combined compare 後沒有剩餘 P0/P1/P2。
