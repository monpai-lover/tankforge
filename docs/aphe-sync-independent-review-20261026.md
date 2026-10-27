# 核心與聯機同步工具獨立複核

已唯讀檢查 `handoff/tools/sync_design_core.mjs` 及組合後的 `handoff/tools/sync_frontline_client.py`，並獨立執行三個同步工具的 `--check`，均成功。未寫入 app、WASM 或 catalog。

`sync_design_core.mjs` 先實際建立 WASM module／instance，拒絕 host imports，驗證八項必要輸出及四個 revision 函式皆為1，才產生替換區塊。它在真實 boot 的 JSON 解析後覆蓋 `designCore`，並在原本存在 `surfaceCore` 時覆蓋相同核心。區塊替換具唯一 marker 檢查；`--check` 比對結果，沒有寫入。實際核對核心 SHA-256：`d5ca844a7a5d2c19980a6452cbf93ec23ca0022a51b1e466feaa8e2df543ee59`，3,198,801 bytes。

Python 同步工具保留 global／initialise 的既有作用域，先從 source 重建區塊，再在記憶體中呼叫 `patchAirframeLimits` 組合已安裝的窄 hook。子程序錯誤會在寫入前中止；`--check` 比對組合後文字，避免把正確 limit 延伸誤報為髒資料或同步時刪除它。

未發現阻礙目前接入的問題。需區分證據層級：WASM export／revision 驗證只能確認介面，不能單獨證明幾何及傷害行為完全保留。receipt 中的 legacy triangle geometry 保留旗標依賴 ROOT 另外執行的真實 legacy 路徑及 exact-surface WASM 測試；不能拿同步工具的 metadata 代替那些行為測試。
