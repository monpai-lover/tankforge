# 靶場車輛重置：恢復所選彈藥

2026-10-11。TankForge，運行時修復源碼：30126d2；最終鍵盤測試：843ec72。

## 玩家可見的改動

離線靶場重置車輛時，現在會重建所選載具並恢復保存的攜彈量。BMPT34 的左右
TT250 發射軌各自補回一發；主炮、機關炮、機槍和 Oplot 的新生命狀態同步恢復。
少帶彈藥或某種彈藥選 0 發時，仍沿用該設定。武器裝填、發射管、外露火箭模型、
導彈世界和 APS 狀態一起初始化，固定靶車的生命保持原樣。

BMPT34 活著時按 **R 發射火箭**；按 **Backspace 重置靶場車輛並補彈**。
没有火箭的車，R 仍可重置。**Tab 回車庫，再按 Enter 出擊**也會重新補齊携彈。
聯機重置仍由伺服器重生處理；其他戰場的復位不提供這次新增的免費補彈。

## 問題與驗證範圍

真實 main resetVehicle/resetPose 與 loadout/launcher CPU 重現：兩軌打空後，
舊重置流程仍留 count=0、ready=0、loaded=-1。修復復用既有 select 和
missileBattleStart 初始化，沒有另造補彈函式。開始時直接把此流程稱為「R 重置」
不夠準確；獨立規格審查發現 BMPT 的 R 路由仍是火箭發射，已修正文檔及測試。
保留鍵位，新增實際 keydown/KEYMAP、Backspace、R、Tab 和 Enter 路徑測試。

Tab 回車庫／重新出擊的實際 CPU 測試在修復前已能補彈，使用者未明確的重新進
靶場路径尚未重現。這次修復的是確定存在的車輛重置漏補，不能說所有入口均曾故障。

測試使用實際 main 函式、loadout、loading、機槍、幾何與 VehicleSim；渲染、傳輸、
損傷及地圖呈現是標明的邊界接收器。它們沒有替代瀏覽器畫面驗收。瀏覽器驗收
此前被自動批准審查拒絕，原因未保留；本次沒有用其他通道繞過，也未宣稱實景通過。

## 交付檢查

- 真實生命週期測試 8 項，以及相關玩法／靶車／導彈測試，共 **33 PASS**。
- 最終完整 Node 回歸 **566 PASS / 0 FAIL / 0 SKIP**。
- Rust／協議／配置／原始車輛與資源未變；實際伺服器 handler 收據逐源核對相同。
  保留已驗證的 native **366 PASS / 4 既有 ignored**，不宣稱本次重新跑過全部 native。
- 既有 448 項資源保護、全部基準資料、B2 舊實驗 13+2 項凍結保護及四份舊命名
  遊戲頁均核對通過。原始 GLB、packed assets 及主工作區的原始 CRLF 參考資料保留。
- 既有構建器重新編譯當前源碼的 WASM，沒有 fallback；新頁完整腳本與獨立再次
  打包的源碼完全相同，九組內嵌資料與真實 loadData 相同，內嵌核心與 asset/target 相同。

本次新頁：`client/web/dist/tankforge-range-ammo-reset-20261011.html`。
新頁 35,054,945 bytes，SHA-256：
`d5f1603fcb7ca0d630855cc466c158b19e35f8bf2125334a1084aea4341ef8de`。
WASM 1,643,249 bytes，SHA-256：
`173c6c970f1d51ddcd86e819a1b4bc80b31af4f277a41466045cd7e68de08fd7`。
源碼／頁面／測試證據保留於工作樹 `target/range-ammo-source-build-receipt.json`，
以及同目錄的 `range-ammo-full-node.tap`、`range-ammo-focused.tap`、
`range-ammo-build.log`、`range-ammo-verification.log`。生成頁與日誌不提交。

## 獨立審查

fresh SPEC 在 843ec72 通過。fresh QUALITY 同樣 APPROVE、沒有可操作的問題，
獨立重跑 33 項相關測試通過，並逐一核對 812 項輸入、三份頁面、完整回歸與
既有 native／handler 收據。審查另外執行真實 launchFromGun：10 次 BMPT34
打空／Backspace 重置循環，共 20 次有效發射；空軌均拒絕再次發射，每次重置
均恢復左右各一發。80 個舊玩家 mesh 各釋放一次，scene 僅保留一個玩家 root。
全部審查均為唯讀，修復與文件由同一 root writer 完成。

據點補給的 5 秒補滿方案在
[補給設計](superpowers/specs/2026-10-11-ammunition-resupply-design.md)，待使用者批准。
真實履帶轉向設計亦仍保留待批准；這次没有把兩項新玩法列為已完成。
