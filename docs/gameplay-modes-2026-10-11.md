# 休閒／歷史玩法：2026-10-11 交付紀錄

TankForge 已接入單人與聯機房間的兩種玩法。Tasks1–3 的獨立 SPEC 與 QUALITY
複核已接受；本輪交付源碼凍結於 `0cbcc35c5935fe265cc5437e85dda064b700a760`，
僅補建與該源碼匹配的 WASM、獨立頁面和文件。最終整體 SPEC → QUALITY
複核及精準整合仍待 Root 執行，尚未推送或發布。

## 如何選擇

- 單人：在車庫點上方「玩法：休閒」／「玩法：歷史」按鈕切換，再按「開始戰鬥」。
  首次使用為休閒；選擇以 `tankforge.gameplay.v1` 保存，下次開啟沿用。
  車庫規格區分原始與目前玩法的有效性能，部署／戰鬥也顯示玩法說明。
- 聯機：建立房間時用「玩法」選單選擇休閒或歷史。房間列表及房內顯示相同標籤；
  加入後以伺服器的房間規則預覽、部署、開戰、重連和重生。
- 進入戰鬥後規則鎖定；房間中也不能用本地車庫按鈕改房間規則。退出房間後恢復
  原本保存的單人偏好，房間規則不覆寫它。儲存空間不可用時偏好只保留本次使用。

## 實際倍率與有效輸出

兩端共用 `config/gameplay-modes.json`，規則版本為整數 `1`，ID 僅有
`casual` 和 `historical`。歷史玩法是原始參數的恒等變換。

| 項目 | 休閒 | 歷史 |
|---|---:|---:|
| 前進／倒車速度範圍 | ×1.15 | ×1 |
| 相同引擎轉速下的傳動牽引输出 | ×1.25 | ×1 |
| 履帶可用轉向速率、輪式轉向執行器响应 | ×1.25 | ×1 |
| 炮塔／獨立機槍／APS 水平轉動速率 | ×1.30 | ×1 |
| 火炮／獨立機槍／APS 俯仰速率 | ×1.20 | ×1 |
| 射擊循環、裝填和發射槽可用速率 | ×1.20 | ×1 |
| 敵軍輔助標記 | 顯示 | 隱藏 |

休閒傳動由原始參數派生：最終傳動比除以 `1.15`，扭矩曲線及有效功率乘
`1.25 × 1.15 = 1.4375`。因此在相同引擎轉速，傳動牽引输出為 `1.25` 倍，
速度工作範圍為 `1.15` 倍；有效功率遵循力乘速度。這是玩法用的有效傳動變換，
原始馬力和車輛資料仍原樣保存。阻力、牽引上限、地形、檔位和損傷仍會影響
實際加速度與速度，不能把此倍率當作每一時刻的車速或加速度保證。

手動／佈局裝填的最終週期、彈帶補給、導彈槽補給及發射間隔各自除以 `1.20`；
連射武器的循環射速乘 `1.20`。同一計時路徑只套用一次。雙管導彈的原始
`0.25 s` 間隔在休閒為 `0.208333… s`，獨立槽位與真實耗彈繼續生效。
原版 Oplot 的手動／自動動作使用同一玩法，並保留既有共享門檻。

模式不改質量、慣量、輪／履帶幾何、輪胎牽引或機械角度限制，也不改炮彈質量、
初速、穿深、装甲、傷害、導彈過載、雷達週期或彈道時間。既有乘員／模組損傷、
過熱、空彈、獨立武器故障及修復門檻繼續作用；F／J 三秒操作、測距時序、修復時間、
戰鬥時鐘和固定物理步頻不乘性能倍率。工坊存檔／匯出保留原始數值，反覆切換不累乘。

## 歷史玩法的標記範圍

隱藏敵方車輛及敵方殘骸的輔助名牌／距離標記、敵軍小地圖點與敵軍畫面邊緣方向提示；
靶場的可受擊車輛目標也不再顯示輔助名稱／距離牌。只有具有有效房間隊伍身份且
同隊的遠端玩家算友軍；相同車型、未知隊伍或敵隊不能因此取得友軍標記。
切換玩法／戰鬥時會清除舊標記快取，避免殘留一張敵軍小地圖。

自車、有效友軍、ABC 目標、固定靶板、準星／分劃、實際測距讀數、命中 `Hit`
提示與既有彈道／命中回放保留；場景中的車輛和受擊目標仍可見。
大廳與戰績名單的玩家暱稱也保留。此處是輔助顯示規則，沒有新增伺服器視線／
無線電探測或隱藏敵軍座標的網路隔離機制。

## 客戶端與伺服器相容

客戶端 Hello 及 Create、伺服器 welcome／room／start／resume／respawn 規則封包
均須使用數值版本 `1`；模式字串须為 `casual` 或 `historical`。缺漏、未知模式、
字串 `"1"`、版本 `0`／`2` 等不相容內容會拒絕，顯示
「玩法規則版本不相容，請更新遊戲與伺服器」。新版客戶端遇到不支援的伺服器會
停用新規則房間的建立／開始流程，不默認成休閒。重新接入的 socket 也須重新
驗證能力，不能沿用旧座位的能力標籤。

每個房間的玩法固定，由伺服器保存並發送。客戶端 state 不能改它；即使兩名
玩家的本地偏好不同，也遵守同一房間規則。伺服器導彈／火箭及 APS 世界使用
該房間的有效時序。既有主炮／機槍發射額度、訊息桶、有限序列／證明快取及
有限輸出佇列隨合法吞吐調整；既有全域跳躍速度檢查隨速度倍率調整。
這些仍是粗粒度防濫用檢查，本輪沒有完成全車運動權威或逐武器裝填權威反作弊。

## 測試與重建

先依 README 從儲存庫根目錄，以绝對路徑設定 `TG_GAMEPLAY_NETWORK_RECEIPT`，
執行 `cargo test -p tg-server browser_protocol_receipt_from_actual_handlers --lib`，
再到 `client/web` 執行 `npm test`。Node bridge 強制檢查十項原始來源／配置內容；
receipt 缺少或過期會失敗，不是可跳過的測試。負向探針已驗證兩者各以 exit `1`
拒絕，來源與原始 receipt 沒有為該探針修改。

- 相同凍結源碼的 Root 完整 Node suite：`549 PASS / 0 FAIL / 0 SKIP`。
- 相同凍結源碼的 Root 完整 native workspace：`364 PASS / 0 FAIL / 4` 既有 ignored。
  ignored 是 `tg-design::tests::print_sample_summary` 和 `tg-missile` 的
  `debug_trace_rocket`、`debug_trace_single_tow`、`debug_two_sides`；不是新增玩法路徑。
- 本輪重新生成實際伺服器處理器 receipt：`1 PASS`。建置後重新跑六組玩法／
  bridge／實際 runtime／HUD 測試及新 WASM 的 kinetic-impact：`72 PASS / 0 FAIL / 0 SKIP`。
- 實際 release `tg-design-wasm` 和 `node client/web/build.mjs` 均 exit `0`，
  web 建置沒有使用 committed-core fallback。沒有設定 `CARGO_TARGET_DIR` 或更改 stack。
- 本輪只做 Node／native／靜態離線驗證，未執行瀏覽器、HTTP、CDP 或 Playwright。
  先前自動審批的瀏覽器限制仍然遵守；這些證據不構成瀏覽器實景驗收。

此 Windows 驗收使用 `C:/Users/24908/.codex/scratch/tankforge-rust/rustup`、
`.../cargo`，且 `.../cargo/bin` 在 PATH；esbuild 使用
`C:/Users/24908/Documents/ChatGPT/tankforge/client/web/node_modules/@esbuild/win32-x64/esbuild.exe`。
重建時先成功執行：

```powershell
cargo build -p tg-design-wasm --release --target wasm32-unknown-unknown
if ($LASTEXITCODE -ne 0) { throw 'release WASM 建置失敗' }
node client/web/build.mjs
if ($LASTEXITCODE -ne 0) { throw '網頁建置失敗' }
```

此一般建置工具在缺 Rust 時仍支持既有 fallback；本輪驗收另外檢查它沒有發生，
並將 target／asset／頁面內核逐位元組比較，不能只以網頁建置 exit `0` 當作內核匹配。

## 獨立頁面與來源保護

交付頁面名稱為 `tankforge-gameplay-modes-20261011.html`，兩份完全相同：

- `C:/Users/24908/.codex/scratch/tankforge-gameplay-modes/client/web/dist/tankforge-gameplay-modes-20261011.html`
- `C:/Users/24908/Documents/ChatGPT/tankforge/client/web/dist/tankforge-gameplay-modes-20261011.html`

頁面 `35,021,548` bytes，SHA-256 為
`2bc7cc6cca74655ee12e8f34d103a94a4123cc5b2f16f7094c09f6d2f9f23c80`。
release target、提交的 asset 及各輸出的唯一 `tf-data.designCore` 均為
`1,643,249` bytes、SHA-256
`173c6c970f1d51ddcd86e819a1b4bc80b31af4f277a41466045cd7e68de08fd7`。
離線逐頁檢查只有一個 `tf-data`、一個 `designCore`，JS bundle 語法可解析，
包含車庫／房間兩種玩法控制、嚴格版本與原始 registry 值；所有嵌入資料的
序列化內容與當前 `loadData()` 輸出完全相同。

原工作區靶場 `tankforge-range.html` 未覆寫，SHA-256 保持
`95130c2a34dbb8bb8bfcf1c01662f2769f951b517e592ef8db312ab6bedc8ea1`。
先前 `tankforge-sight-dot-preview-20261011.html` 未覆寫，SHA-256 保持
`db2520bb1d249e7b2c79daca3f8fdbac362be6f069a1548b5162152b49eaa950`。
生成 HTML 不加入 Git；只精準提交匹配的 WASM 與文件。

相對 `c5350a4`，448 個 tracked `data/` 和 `client/web/assets/` 檔案
（排除本輪刻意重建的 WASM）的 diff 為空，包含原始車輛／引擎／武器／裝甲／炮彈
及 imported／packed 模型。按排序路徑到 SHA-256 的 JSON 清單計算之摘要為
`e117187c12d8dd16de6ed89d38590ee4d2b415c8b0667a94929d8635da9d8f4c`。
registry 的來源 hash 為
`fe506e2994589a49afa9372dd1807d3362d70bbb5bc04bfec2654b90905aba66`；
JS 與 native `tg-gameplay` 消費同一份配置，原始內容也受 receipt 檢查。
完整來源／建置／驗收 hash 見 [Task4 receipt](superpowers/notes/2026-10-11-gameplay-task4-receipt.md)。

另獨立重核 B2 外部凍結清單 `13/13 + 2/2` hash 一致；没有複製、修改、
提交其內容或改動容差。旁邊的參考專案 `tank` 不屬本輪修改範圍。

## 修復歷程與仍待完成的工作

Task2 曾修正舊測試抽出的 main 片段未提供新增依賴的 harness；保留原斷言，
沒有放寬 production 行為。Task3 在独立複核後修正過期重連座位留下舊
`battleProfile`，及退出房間後舊線上地图載入回呼仍可啟動战鬥的問題。
`0cbcc35` 已通过新的 SPEC（39）與 QUALITY（29）檢查；有效的同房重連仍保留
武器實例與已消耗彈藥，不藉重連補滿。

以下需求仍未完成，不能由此玩法功能宣稱驗收：B2 下方履帶實體接觸／載荷與
牽引，物理斷履帶／輪胎，精確 hitboxes，P2–P5，炮管視覺工作，以及 V3 多次
命中死亡回放。既有 `Hit`／回放继续保留不代表新 V3 已完成。

使用者已選六管布局的 Oplot 23 mm 改裝仍只有已批准的計畫，尚未實作；
本輪倍率不是 23 mm 新武器或新車型，也沒有完成全車歷史資料的逐車審計。
