# 自動跑道起飛診斷候選

這是開發用候選頁工具，不會改寫正式 `handoff/bundle/app.js.html` 或模擬核心。必須明確帶 `?tfAutoTakeoff=1` 才建立診斷面板、啟動自動出擊及收集資料。

```powershell
node handoff/tools/patch_auto_takeoff_runner.mjs --input D:/TankForge-validation/r7-fuel-hud-perf-combined.html --output D:/TankForge-validation/auto-takeoff-candidate.html
```

命令輸出的是應用尾段，需由打包流程與已驗證完整線上頁面的 immutable prefix 拼接成可載入的完整候選頁。輸出必須是 D: 上不存在的新路徑；工具拒絕覆寫、原地修改及正式 bundle 路徑。

- `?tfAutoTakeoff=1`：依序 P-51D、Me 262、F-15，涵蓋螺旋槳、早期噴射、現代噴射。
- `?tfAutoTakeoff=1&tfAutoTakeoffTypes=mig15,su27skm`：指定實際目錄內的機型。
- `?tfAutoTakeoff=1&tfAutoTakeoffTypes=all`：依序跑實際可玩目錄的全部 fighter 型號。

出擊用原有 `flyType` → `startBattle` → `enterAircraft`；靶場原有 15 輛地面目標及防空流程保留。每架從正常跑道出生，以 Shift 加油門、原滑鼠瞄準輸入拉起，經原 `advanceAircraftInput` 和 120 Hz WASM 步進。達到 AGL 15 m 後再保留 15 模擬秒的真實防空觀察。過程不改寫位置、速度、姿態、遙測、生命、彈藥或無敵狀態。起飛失敗、防空擊毀、超時及防空未啟用都會保留 FAIL。

失焦、頁面隱藏、暫停及輸入框取得焦點時停止提交控制；背景沒有 RAF 回呼的時段也不計入可見計時或 profiler 窗口。停止按鈕只清除此 runner 持有的按鍵。完成後依原 UI 流程回車庫並恢復原本地圖選項。

面板的「下載起飛診斷 JSON」輸出各機型的實際狀態、彈丸／子彈／表面 actor 峰值和原 profiler 的 CPU phase、projectile、replay、surface query 報告。預設最多 600 份 profiler 報告，全部機型模式最多 4800 份；每機結果最多保存 180 份。所有數值都來自實際執行，沒有預測 FPS。

```powershell
node --test handoff/tests/auto-takeoff-runner.test.mjs
```

測試包括原始 C215 WASM、實際機型參數／surface 配置和原 Aircraft 輸入／步進的平地跑道起飛。此 CPU fixture 沒有渲染、戰鬥生命週期或真實 AA，不能冒稱瀏覽器效能驗證；完整瀏覽器結果以候選頁實際下載的 JSON 為準。
