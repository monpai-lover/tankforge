# 休閒／歷史玩法與 Oplot23 六管改裝：2026-10-11 聯合交付

這是本輪最新的合併結果：休閒／歷史玩法加上獨立的 `su_t10m_oplot23` 假想改裝。
玩法交付 `6853c5c`、Oplot Task1（含兩項 QUALITY 修復）`c361d0c` 均已通過各自的
SPEC → QUALITY；本頁與文件已按接受源碼 `c361d0c320081f815f99f9bdea6ca21c84848695`
完成匹配建置及離線驗證。聯合交付與協定文案修訂 `ff96373` 已通過最後一輪獨立
SPEC → QUALITY；Root 已精準整合至 main 並推送[公開倉庫](https://github.com/monpai-lover/tankforge)。
預設遊戲頁也已同步，整合後 33 項交付測試通過。瀏覽器實景驗收仍未完成，沒有發佈生產服務。

本輪獨立頁面為 [tankforge-modes-oplot23-20261011.html](../client/web/dist/tankforge-modes-oplot23-20261011.html)。
兩份交付檔完全相同：

- `C:/Users/24908/.codex/scratch/tankforge-gameplay-modes/client/web/dist/tankforge-modes-oplot23-20261011.html`
- `C:/Users/24908/Documents/ChatGPT/tankforge/client/web/dist/tankforge-modes-oplot23-20261011.html`

先前的[純玩法交付](gameplay-modes-2026-10-11.md)和[Oplot 資料研究](oplot23-research-2026-10-11.md)
保留原快照與限制；以下說明現在合併頁面的實際功能。

## 如何選車與操作

車庫先選 T-10M／Oplot 的家族卡片，在規格區的「改裝」→「武裝」選
「23 mm 六管 Oplot23（假想改裝）」。這是 `Mods` 的原廠變體選擇；旁邊的
「14.5 mm 六管 Oplot-MO」保留原車。無需先進「改裝工坊（自訂戰車）」重造武器。
新車名為 `T-10M (Oplot23 · hypothetical custom)`，工坊導入／匯出也保留新型的
原始武器與來源共享外殼。聯機選車使用新 ID；伺服器必須具備本輪新增車檔與彈藥。

進入戰鬥時從主炮按一次 **G** 即切至 Oplot；G 繼續循環瞄準武器。選中 Oplot 後，
**1** 選 API、**2** 選 HEI，**左鍵**單獨開火。**U** 切換自動 APS，**Y** 循環
APS 射速，Y 並不是武器選擇鍵。手動選中 Oplot 暫停其自動攔截，切回其他武器後
恢復 U 保存的開關偏好。原底盤的駕駛、主炮、瞄具、護板、修復與棄車控制沿用。

## 玩法、倍率與標記

單人在車庫上方點「玩法：休閒」／「玩法：歷史」，再按「開始戰鬥」。首次預設休閒；
偏好以 `tankforge.gameplay.v1` 保存。儲存不可用時只保留本次選擇。建立聯機房間時
從「玩法」選單選擇，房間列表及房內顯示相同玩法；房間由伺服器鎖定。預覽、部署、
開戰、重連與重生遵守房間規則，離開後恢復單人偏好，戰鬥中不能切換規則。

JS 與 Rust 讀取同一份 `config/gameplay-modes.json`，數值版本為 `1`。
歷史玩法沿用原始參數；它不代表本輪已完成全車歷史資料審計。

| 參數 | 休閒 | 歷史 |
|---|---:|---:|
| 前進／倒車速度工作範圍 | ×1.15 | ×1 |
| 相同引擎轉速下的傳動牽引輸出 | ×1.25 | ×1 |
| 履帶轉向速率／輪式轉向執行器響應 | ×1.25 | ×1 |
| 炮塔／獨立機槍／APS 水平迴轉 | ×1.30 | ×1 |
| 火炮／獨立機槍／APS 俯仰 | ×1.20 | ×1 |
| 射擊循環、裝填、發射槽可用速率 | ×1.20 | ×1 |
| 敵方輔助標記 | 顯示 | 隱藏 |

休閒最終傳動比除以 `1.15`，扭矩曲線與有效功率乘 `1.25 × 1.15 = 1.4375`。
因此同 RPM 下的牽引力是 `1.25` 倍、速度工作範圍是 `1.15` 倍，而功率遵循力乘
速度。地形、檔位、阻力、牽引極限及損傷仍會影響真實加速度和車速。原始資料、
工坊存檔及匯出保留原值，反覆切換不累乘；每條裝填／連射／槽位路徑只套倍率一次。

Oplot23 的原始手動射速與 APS 設定為 8000 rpm，休閒有效射速為 9600 rpm；
原始 6000–8000 rpm APS 可調範圍同樣派生有效值。30 s 彈帶補給在休閒為 25 s。
模式不改彈丸質量、初速、穿深、傷害、裝甲、底盤質量／慣量、幾何、機械角度限制、
雷達週期或彈道時間。固定物理步頻、F／J 三秒操作、實際測距與修復時間不乘性能倍率。
乘員／模組損傷、過熱、空彈、獨立武器故障及共通修復門檻仍然生效。

歷史玩法隱藏敵車／敵方殘骸的輔助名牌、距離、小地圖點與畫面邊緣方向提示；
靶場可受擊車輛的辅助名牌也隱藏。只有有效房間身份且同隊的遠端玩家算友軍。
自車、有效友軍、ABC 目標、固定靶板、準星／分劃、實際測距讀數、`Hit` 與既有
命中／彈道回放保留，場景中的目標仍可見；切換時清除舊標記快取。這是顯示規則，
本輪沒有新增網路視線／無線電探測或敵軍座標隔離。

## 新炮組、來源與估計值

新型採用 GSh-6-23 參考的六管 **23×115 mm** 炮組。這是項目假想安裝，沒有證據
可宣稱曾歷史實裝在本車；原 14.5 mm 車檔、武器及來源模型保留原字節。

| 項目 | 本輪實際資料 | 可信度與處理 |
|---|---|---|
| 炮組質量／炮管長／基礎射速 | 76 kg／1 m／8000 rpm | 公開 GSh-6-23 二手參考；8000 為本項目選定的安裝設定 |
| API `api_23_bza` | 23 mm、0.174 kg、715 m/s；98.5 mm 長 | Arsenal 普通 API 索引／副本支持質量與初速；長度是參考尺寸估計 |
| API 穿深／阻力 | B-32 推得鋼制 De Marre 係數重算；CD 0.30 | 項目估計，並非完整實測曲線或複製 14.5 mm 曲線 |
| HEI `hei_23_ofz` | 0.174 kg、715 m/s；102.5 mm 長；0.0178 kg A-IX-2 | 普通 HEI 索引／公開副本；完整彈丸質量採假設，長度是參考尺寸估計 |
| HEI 接觸爆炸／阻力 | 既有 HE 路徑，CD 0.42；既有 `14 × √裝藥kg` 估計曲線 | 藥種保留元資料；完整能量、引信與爆炸校準仍屬 P3 |
| 安裝攜彈／彈帶／補給／啟轉 | 500 發（API 300、HEI 200）／500／30 s／0.35 s | 項目安裝估計 |
| 車輛總質量 | 沿用原車 52,200 kg | 尚未針對新增炮組、彈藥及安裝件重新稱重校準 |
| APS | 原始 8000 rpm、可調 6000–8000；原控制、雷達及射界 | 新彈丸描述為 23 mm、0.174 kg、715 m/s；平台參數沿用 |

API 法向估計穿深為 0 m／24.7 mm、100 m／23.2 mm、500 m／18.1 mm、1000 m／13.2 mm。
來源「200 m、10 mm 板、相對射線 60°」是單一条件，不能當完整法向穿深表。
不混用 23×152 mm、全彈質量、API-TM 190 g／690 m/s 或 HEI-M 186 g／700 m/s。
ROMARM 的 HEI 174 g 明示不含引信，不能拿它驗證目前完整彈丸假設。

公開參考包括 [Weaponsystems GSh-6-23](https://weaponsystems.net/system/566-23mm%2BGryazev-Shipunov%2BGSh-6-23)、
[Arsenal API 表索引](https://arsenal-defense.com/wp-content/uploads/spec-sheets/API_23x115_AIR.pdf)、
[HEI 表公開副本](https://www.scribd.com/doc/299583319/23x115-Mm-Rounds-HEI-With-High)及
[ROMARM 23×115 資料表](https://romarm.ro/wp-content/uploads/2021/04/42_Datasheet-23x115mm-ROUNDS.pdf)。
原廠 PDF 曾返回驗證頁、超時或無關重定向；本輪沒有聲稱取得並目視檢查它們。
檢索方式與來源限制完整保留在[研究紀錄](oplot23-research-2026-10-11.md)。

## 模型、射擊與獨立損傷

新型共享來源炮座／外殼的 `turret`、`gun` 資源，排除舊 `barrel`；不改寫原 packed
buffers。新建六根開口圓管：內徑 23 mm、外徑 45 mm、管心環半徑 55 mm，每管
32 段、長 1 m，管間不重疊。炮耳軸維持 `[0.502, 2.715, 0.557]`，平均炮口前移
1 m。手動瞄準、閃光、發射及 APS 使用相同平均轴線，不宣稱逐管真實發射原點。
原旋轉、俯仰、後坐節點保留；目前旋轉視覺是可讀的既有動畫，非高 RPM 精確採樣。

實際 API／HEI 經原射擊、彈道、命中與既有回放路徑，消耗各自彈藥。自動 APS
使用 API 的口徑／質量／速度描述和平台既有共享總彈藥規則；未實作逐彈種 HEI
引信／爆炸攔截。主炮损毀不阻止健康 Oplot 開火；自己的炮組、乘員與共通修復
門檻繼續限制手動和自動，在原版／新型及兩種玩法均有實際檢查。

Task1 新增的連射車體後坐限於 `fireGun` 的 autocannon 分支：沿名義 `mz.dir`
反向施加質量×初速×1.3 的衝量，作用於實際車身變換後的物理炮耳軸；1.3 是項目
沿用的燃氣／遊戲慣例，不是新資料的實測後坐係數。單發主炮的舊衝量區塊完整保留。
QUALITY 發現的斜身父節點軸線問題與生成測試改寫正式檔案問題均已修復：
驗證改用兩個獨立暫存 output root，正式十個新檔的 bytes、mtime、ctime 不變。
`tools/oplot23-variant.py` 預設只寫上述新檔；不要以預設正式輸出當驗證步驟。

## 聯機與預設服務頁

客戶端 `hello` 與伺服器 `welcome` 只驗證**數值版本 1**，不攜帶玩法模式；重連的
`hello` 可另帶 `resume` token。客戶端 `create` 請求，以及伺服器 `room`、`start`、
`respawned` 封包，攜帶 `casual`／`historical` 模式與版本；客戶端 `start` 請求
無需再傳模式／版本。Resume 不是獨立訊息，而是帶 token 的 Hello 流程，成功後
返回 Welcome，以及適用的 Room／Start。

伺服器在建立房間／恢復房間座位等需相容規則的流程中，遇到版本缺漏、字串 `"1"`、
0／2 等不相容內容時提示
「玩法規則版本不相容，請更新遊戲與伺服器」（`UPDATE_NEEDED`）；版本合法但
Create 模式缺漏／未知時，伺服器提示「未知或缺少玩法規則，請更新遊戲」。瀏覽器
收到非法的房間規則封包時統一使用前述版本更新提示，不靜默改為休閒。重連 socket
重新驗證能力，有效同房重連保留武器實例與已耗彈藥，過期座位及已取消地圖載入
不能恢復舊戰鬥。房間本地偏好不可改規則；既有粗粒度吞吐／跳躍檢查随合法倍率
調整，本輪沒有完成全車運動或逐武器裝填的完整伺服器反作弊權威。

`tg-server` 預設服務共享工作區的 `client/web/dist/tankforge-range.html`。Root 在最後
兩審通過並精準整合 main 後，已把驗收合併頁的相同 bytes 同步到預設 range，並以
`--expect-new-default` 檢查通過。先前沒有新 Hello 版本的舊頁精確保存在
`tankforge-range-pre-modes-20261011.html`；純玩法頁與 sight-dot 頁也保留原始 bytes。
需要明確指定本輪頁面時，可使用既有
`--page client/web/dist/tankforge-modes-oplot23-20261011.html`；新 ID 同時需要當前 server data。

## 驗證、重建及來源保護

Root 的完整 Node suite 在 `c361d0c` 為 **558 PASS／0 FAIL／0 SKIP**；完整 native
workspace 在 `3d73ac3` 為 **366 PASS／0 FAIL／4 既有 ignored**。本輪獨立讀取並
核對完整 logs 的摘要及 hash，確認 Rust／配置／資料／manifest 自該 native 源碼
不變，且 Node／工具輸入仍是接受的 `c361d0c`；未重複跑沒有新變更的完整套件。
ignored 為 `tg-design::tests::print_sample_summary` 和 `tg-missile` 的
`debug_trace_rocket`、`debug_trace_single_tow`、`debug_two_sides`。

本輪先重產實際 Rust handlers receipt：**1 PASS**，十個 raw source/config/manifest
標籤與當前來源逐項相同。release `tg-design-wasm` 和 web build 均 exit 0，沒有
committed-core fallback、target directory 或 stack 改動。建置後新跑 Oplot **9**、
mandatory bridge **14**、實際 WASM kinetic **10**，共 **33 PASS／0 FAIL／0 SKIP**。
缺少、過期或省略來源標籤的独立 receipt 副本均按原斷言 exit 1；正式來源未修改。

離線逐頁檢查唯一 `tf-data`／`designCore`、bundle JS 語法、真正 bundle 中的凍結規則、
嚴格版本拒絕及新 `Mods` 家族。序列化資料逐項等於當前 `loadData()`。再將交付頁內
資料交給實際 Mods、loadout、import decoder、`buildTank` CPU 幾何和頁內 WASM APS
註冊檢查；未開瀏覽器／HTTP／CDP／Playwright，也未把假 renderer 當實景渲染驗收。
先前自動審批對瀏覽器操作的拒絕仍是獨立視覺驗收限制。

| 檔案／保護範圍 | bytes／數量 | SHA-256 |
|---|---:|---|
| 合併頁兩份／scratch 與主工作區預設 range | 35,055,861 | `365b79764d17821a8f99ee297af9905204414299c3132ad1104936ff4474e3ad` |
| release target／asset／每頁 designCore | 1,643,249 | `173c6c970f1d51ddcd86e819a1b4bc80b31af4f277a41466045cd7e68de08fd7` |
| 舊 range 快照／保留舊頁備份 | 34,840,387 | `95130c2a34dbb8bb8bfcf1c01662f2769f951b517e592ef8db312ab6bedc8ea1` |
| 舊玩法獨立頁 | 35,021,548 | `2bc7cc6cca74655ee12e8f34d103a94a4123cc5b2f16f7094c09f6d2f9f23c80` |
| 舊 sight-dot 頁 | 35,004,089 | `db2520bb1d249e7b2c79daca3f8fdbac362be6f069a1548b5162152b49eaa950` |
| 原始 tracked data／assets 清單聚合 | 448 檔 | `e117187c12d8dd16de6ed89d38590ee4d2b415c8b0667a94929d8635da9d8f4c` |
| 玩法 registry | 1 檔 | `fe506e2994589a49afa9372dd1807d3362d70bbb5bc04bfec2654b90905aba66` |

448 檔保護以 `c5350a4` 為基線，排除刻意核建的 WASM；包括原車 vehicle、engine、
weapons、armor、projectiles、imported／packed 資源。與基線差異只有本輪十個新增
JSON，沒有原檔改寫。現有 legacy raw GLB 沒有出現在 checkout，故不宣稱對不存在
檔案完成 hash。外部凍結 B2 清單亦核對 **13/13 + 2/2**；沒有複製、修改或提交
該未完成分支，也未改測試容差。生成 HTML 與 target logs 不加入 Git。

重建與 mandatory bridge 應依 README 設定绝對 receipt 路徑，先執行：

```powershell
$env:TG_GAMEPLAY_NETWORK_RECEIPT = Join-Path (Get-Location).Path 'target/gameplay-network.json'
cargo test -p tg-server browser_protocol_receipt_from_actual_handlers --lib
if ($LASTEXITCODE -ne 0) { throw '實際處理器 receipt 失敗' }
cargo build -p tg-design-wasm --release --target wasm32-unknown-unknown
if ($LASTEXITCODE -ne 0) { throw 'release WASM 失敗' }
node client/web/build.mjs
if ($LASTEXITCODE -ne 0) { throw 'web build 失敗' }
node --test client/web/test/oplot23-variant.test.mjs client/web/test/gameplay-network.test.mjs client/web/test/kinetic-impact.test.mjs
if ($LASTEXITCODE -ne 0) { throw '建置後驗證失敗' }
```

Windows 使用 `RUSTUP_HOME=C:/Users/24908/.codex/scratch/tankforge-rust/rustup`、
`CARGO_HOME=.../cargo` 及 `.../cargo/bin` PATH；esbuild 指向
`C:/Users/24908/Documents/ChatGPT/tankforge/client/web/node_modules/@esbuild/win32-x64/esbuild.exe`。
完整原始檔／來源／build／logs hash、驗證步驟及邊界見
[Task1 接受紀錄](superpowers/notes/2026-10-11-oplot23-task1-receipt.md)和
[Task2 交付紀錄](superpowers/notes/2026-10-11-oplot23-task2-receipt.md)及
[Root 最終接受與整合紀錄](superpowers/notes/2026-10-11-oplot23-final-acceptance.md)。

## 仍未完成

B2 下方履帶實體接觸／載荷與牽引、物理斷履帶與輪胎、精確 hitboxes、P2–P5
（含彈體形變、完整彈種效果／引信／能量校準）、炮管視覺工作及 V3 多次命中死亡
回放仍未完成。本輪新增彈药與既有命中回放不替代這些分期驗收，也不宣稱所有
先前問題或全車歷史真實性已完成。
