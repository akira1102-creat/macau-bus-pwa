# 私隱及資料邊界

本 PWA 不需要帳戶、登入、廣告、付款或訂閱。巴士及泊車資料由 server-side adapter 讀取 DSAT 公開資料並轉成穩定 JSON；本專案沒有使用供應 APK 的私有 API、Firebase 設定或廣告識別資料。

- 定位只用於本機距離／排序計算，不會送到 API，也不會由背景提醒保存。
- 巴士收藏、泊車收藏、模式、主題及提醒門檻留在瀏覽器 localStorage。
- 關閉 PWA 後的背景提醒需要 Web Push；server 只保存匿名訂閱所需的訂閱 ID、token hash 及提醒資料，不保存 GPS、完整 endpoint log、user-agent 或原始上游回應。
- DSAT 數據可能延遲、暫停或變更；未知值顯示 `—`，不會當成零，也不會觸發低空位提醒。

部署 Web Push 前，Netlify 必須設定 VAPID keys、Blobs 與每分鐘 scheduled function。瀏覽器自動化測試只驗證 fake PushManager 和 API 契約；實體 iOS／Android 關閉 PWA 後的通知 delivery 仍需獨立驗證。
