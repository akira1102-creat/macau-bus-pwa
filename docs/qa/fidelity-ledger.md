# 視覺保真度記錄

> 這份文件只記錄可重複的自動化驗證與待由主代理完成的實際 render 比較；未完成的概念圖／implementation `view_image` 比較不在此宣稱為已完成。

## 自動驗證

| 視口 | 驗證 | 狀態 |
| --- | --- | --- |
| 390×844 | Playwright mobile project | 待主代理執行最終 render QA |
| 1280×900 | Playwright desktop project | 待主代理執行最終 render QA |
| manifest | standalone、root scope、192/512/maskable PNG | 由 `tests/e2e/pwa.spec.ts` 驗證 |
| update lifecycle | startup、pageshow、visible、guarded controllerchange | 由 `src/pwa/update-lifecycle.test.ts` 驗證 |
| cache policy | `/api` 與 OSM tile network-only | 由 `src/pwa/cache-policy.test.ts` 驗證 |

## 主代理最後比較（尚未宣稱）

- 對照來源：`docs/design/home-concept.png`、`docs/design/route-concept.png`。
- 實作截圖：由主代理在 390×844 及桌面 viewport 實際 render 後填寫。
- 必須比較 copy、layout、type、palette、icons、responsive 六項，並記錄 intentional deviations 及 material mismatch 修正。
