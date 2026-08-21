# 視覺保真度記錄

最終比較已完成；完整證據及 iteration history 見專案根目錄 `design-qa.md`。

## 自動驗證

| 視口 | 驗證 | 狀態 |
| --- | --- | --- |
| 390×844 | Playwright mobile project + Browser/IAB 核心流程 + `view_image` comparison | 通過 |
| 1280×900 | Playwright desktop project + native render inspection | 通過 |
| manifest | standalone、root scope、192/512/maskable PNG | 由 `tests/e2e/pwa.spec.ts` 驗證 |
| update lifecycle | startup、pageshow、visible、guarded controllerchange | 由 `src/pwa/update-lifecycle.test.ts` 驗證 |
| cache policy | `/api` 與 OSM tile network-only | 由 `src/pwa/cache-policy.test.ts` 驗證 |

## 最終比較

- 對照來源：`docs/design/home-concept.png`、`docs/design/route-concept.png`。
- 手機 render：390×844；桌面 render：1280×900。
- Copy：繁體中文介面一致；空收藏／最近查看及未主動定位是乾淨本機狀態，不以假資料填充。
- Layout：手機主要區域及固定五項導覽無重疊；桌面保持置中 phone-width column。
- Type：深墨色 CJK sans hierarchy 清晰，長端點名穩定換行。
- Palette：true white、jade、cool gray、amber 狀態色與概念一致。
- Icons：Lucide outline stroke 統一，active jade state 清晰，觸控目標至少 44px。
- Responsive：390×844 及 1280×900 通過；top/bottom safe-area regression tests 通過。
- Intentional deviations：真實 OSM map 取代概念的簡化地圖；乾淨首頁不虛構 nearby/favorite/recent；route header 同時顯示真實端點與 `路線 26A` badge。
- Material mismatch fix：第一次比較發現 route number 缺失，commit `656f79c` 補回後重新 build、capture、combined compare，沒有剩餘 P0/P1/P2。
