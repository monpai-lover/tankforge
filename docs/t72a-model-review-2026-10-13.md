# T-72A obr.1979 模型翻新 — 主會話整合交付

> **追加版提示（細節＋Real Hitbox）**：下文是上一輪外觀候選的歷史交接。當前新增65個細節零件，模型21,168唯一三角形，並提供未接入native傷害的精確表面碰撞元件；最新接口與限制以 `t72a-real-hitbox-interface-2026-10-13.md` 和 `t72a-real-hitbox-results-2026-10-13.json` 為準。`t72a-model-geometry-2026-10-13.json` 已更新為追加版幾何。舊測試數量與16,588面統計僅作前版紀錄。

**狀態：模型候選版，尚不是可直接發布的戰鬥幾何版本。** 模型、測試與實際遊戲渲染已交付；裝甲命中面同步、1979 年份裝備確證和完整回放驗收仍需主會話處理。

## 1. 基準與工作區

- 使用者公開基準：`84033dd10d019bef0b7be344d6eedb77b9f87b38`。
- 既有隔離遠端分支 `model/t72a-obr1979-refine-20261013` 停在 `bc2588519e96194f73fb0578b95cdf03caf03568`，僅新增模型 review 工作流，沒有上一輪未提交的幾何。
- 從該提交的 GitHub Actions artifact 恢復完整源碼；恢復後 Git tree 為 `3705ac91c949c38494299af129ad773cc2bbcbd3`，與遠端一致。下載 ZIP SHA-256：`3318695851037b6638a087407ce74a0ef51a950ce18e746eb04ade576712d3eb`。
- 本地快照提交 `356137d82f3cc8ec36e16fd4b3cf963f7931682e` 的 **tree 與遠端相同，commit ID 不同**。本地隔離工作樹分支：`model/t72a-obr1979-continuation-20261013`。
- 本輪核對最新 main 為 `c6486a293194f385678df704fe9b3ded1d56932c`，比使用者基準多兩個音效整合提交。已查其 changed-file 清單，與本交付修改路徑無交集；但未將新的 main 執行檔混入這次前後比較，因此仍需整合後重跑。
- 沒有存取或修改使用者 Windows 共用工作區，沒有推送本輪模型提交、部署或覆蓋舊測試 HTML。交付的是隔離副本的提交與可攜式 patch。

## 2. 外形與製作範圍

`tools/t72a_visual.mjs` 為獨立、可重現的作者工具，CLI **只寫 su_t72a/visual.json**。既有 `tools/build_t72a.mjs` 已接回同一 helper，以免日後生成覆蓋新外形；本輪未執行會重寫遊戲參數的整車生成流程。

| 部位 | 實際改動 | 保留／限制 |
|---|---|---|
| 鑄造炮塔 | 8 層 × 48 點的原創截面、雙頰與炮口凹部；分開外殼／內壁法線、硬邊開口及頂面；真的炮口開窗與環形承座 | 頂部、後部和頰部仍為按照片調整的工程曲面，不是原廠曲面數據 |
| 炮盾接合 | 中空俯仰防塵罩、依開口邊界製作的薄壁固定帆布裙、後坐套 | 不以大盒子封口；帆布是兩段搭接而非布料模擬，極端斜角仍需視覺複核 |
| 車體 | 修正首上／首下形線、封閉下車體、翼子板連接、上部側箱、分片橡膠裙與前擋泥板 | 首上 68°、首下 60°是模型使用的對垂直角度；命中平面尚未同步，見第 6 節 |
| 主炮 | 抽煙器兩端漸縮、前後熱護套與少量固定環、真正的 125 mm 內孔；炮尾附近延長隱藏的管段以保持後坐套接 | 原炮耳、槍口基準、310 mm 後坐及全部武器性能不變 |
| 機槍 | PKT 可見端按既有同軸槍口坐標安裝；新增 opt-in `nsvt_t72a` 第一方外觀及實測 damage_geometry variant | 不重命名 `coax_pkt`、`aa_nsvt`；不替換其他車的預設 NSVT |
| 附件 | 艙口座、關閉艙蓋、鉸鏈、把手、TPD-K1 外部頭／玻璃、IR 支架與燈框、天線根部、油桶支架／箍帶 | 僅關閉艙蓋狀態；沒有新增開蓋控制契約。位置、細部尺寸未獲原廠圖確認 |
| 行走装置 | 保持既有六輪／側、三托輪、後驅動、前誘導與完整輪組節點 | 未改輪站、齒數、履帶節距、懸掛或傳動算法；不能把這次測試當成斷履帶、履帶張緊或地形極限驗收 |
| 材質 | 保留現有塗裝、鋼、橡膠、履帶、光學玻璃及帆布材質槽；調整 T-72A palette、只對專用炮塔平滑法線 | 沒有新共用材質政策、外來貼圖、第三方模型或未授權美術 |

整車渲染幾何從 **8,804** 增為 **16,588 三角形**；100 個 visual 作者零件，加上動態機槍節點。這是幾何數量，不是效能承諾；尚未量測大量戰車同屏的 frame time。

## 3. 來源、尺寸與年代邊界

來源均只作事實與外觀參考。沒有把來源照片、掃描圖或第三方模型打包進倉庫。

### A. 勝利博物館：T-72 條目

https://victorymuseum.ru/external-navigation/ploshchadka-2-4/38109/

用於核對焊接車體、相對垂直的 68°／60°前板角度、拉長的鑄造炮塔、熱護套、PKT／NSVT 位置類型、每側六負重輪及三托輪、前誘導／後驅動。**這是家族綜述，混有不同年代配置**，不是 1979 生產批次物料表；未套用文內裝甲厚度、後期穩定器或反應裝甲。

該頁描述 902A 為炮右 5、炮左 7 管，而原模型是對稱 6+6。這不能證明所有 1979 出廠車有或沒有煙幕發射器。本候選版暫時移除未證實的排法，**「無煙幕管」是待主會話确认的選型，不是已證實的 1979 歷史定論**。

### B. 原始技術手冊：蘇聯國防部，T-72A，第一冊，1986

https://voennizdat.com/teh/brone/tehbrone206.pdf

已讀取手冊文字、版本與資料截止說明：PDF 第 4 頁明示依 **1983-06-01** 設計文件編寫。可作 A 型部件／機構背景，不能倒推 1979 全套外觀。PDF 圖頁截圖服務失敗，**本輪沒有完成原廠尺寸圖的視覺核對，也沒有把未看過的圖宣稱為建模依據**。

### C. 實車照片：Vitaly V. Kuzmin，Park Patriot 2015

本輪看過的直接照片：
https://photos.smugmug.com/Military/Park-Patriot-New-photos-part1/i-Nx9wWN9/0/93965117/XL/ParkPatriot2015part13-026-XL.jpg

用於比較炮塔頰部連續曲面、炮根帆布罩、右側紅外燈與車體大形。這是博物館留存車，照片不保證其附件仍為 1979 年出廠狀態；没有像素追描、貼圖投射或複製頂點。

### D. 沿用上一版的尺寸基準

`docs/t72a-autoloader-research-2026-10-12.json` 已記錄上一版資料與估算邊界，包含 Weaponsystems T-72A 尺寸頁：
https://weaponsystems.net/system/1408-T-72A

本輪保留原車體長度 **6.86 m**、裙板包絡約 **3.6 m**、炮前端相對車尾 **9.53 m** 的建模尺度，不把二手資料升格為本次實測。名義座圈直徑 **2.16 m**、上下車體分界、炮塔截面、NSVT 零件尺寸與附件坐標仍是工程估算。不能稱此版為精確測繪或 1979 全配置一比一復原。

## 4. 動畫、身份與損傷契約

車型、乘員、武器、引擎、装甲与内部模组六個 JSON 的 SHA-256 均與基準相同；逐項雜湊見幾何 JSON 的 `protectedData`。

- 炮塔軸 `[0,1.5,0.18]`，炮耳 `[0,1.86,1.15]`，炮口相對炮耳 `4.95 m`，靜止炮口 Z=`6.10 m`。
- 主炮俯角 −6°、仰角 +13°、後坐 0.31 m；3 名乘員、22 組 AZ、`az_drive`／`az_ram`／`az_carousel` 及彈藥配比皆原樣。
- `coax_pkt` 的 `position_m` 就是既有槍口，未多加一截錯誤射程偏移。PKT 的內部 generic damage anatomy 仍是舊版簡化盒，並非完整實物結構。
- `aa_nsvt` 的槍口向量仍為 `[0,0.06,1.17]`，post 與可旋轉 gun 保持兄弟節點。新 variant 的槍身、炮管 ROI 由實際 renderer 重新量測，NSVT 其餘數據不變。
- stock 工坊匯出測試驗證了 smoothing metadata、variant、ID 與 AZ 的保留；不是已逐一完成所有異車體移植組合的畫面驗收。
- 不改 main、audio、replay 或行走算法。X 光使用原有內構與角色；未執行完整命中／擊殺回放序列。

## 5. 實際驗證

### CPU / Node

| 驗證 | 結果 |
|---|---|
| 原基準全套 Node | 824 項：816 pass / 8 fail |
| 修改後全套 Node | 832 項：824 pass / 8 fail，失敗名稱與基準完全相同 |
| 新增 T72 模型測試 | 8 / 8 pass；既有斷言未移除或放寬 |
| 離散姿態 | 24 個全周方向 × 3 俯仰 × 2 後坐＝144；座圈／炮盾接觸失敗 0，主炮零件對固定車體表面交叉 0 |
| 真實 renderer／零件資料對應 | 最大位置誤差約 2.10e−7 m |
| 拓樸 | 受測作者零件和動態 MG material walls：0 退化三角形、0 開邊、0 非流形邊；管孔由環形壁保留，不是封蓋 |
| 瞄具／炮孔 | TPD-K1 6 條前視射線無自身遮挡；主炮／NSVT 內孔射線通過 |
| 非目標影響 | 28 個程序車型逐一比對 vertex-buffer 與節點資料，僅 su_t72a 有變；12 種預設 MG buffers 全相同。16 個 imported 車型未作完整 buffer 比對 |
| Schema / MG 測量 | 新 visual 通過 JSON Schema；全部 12 MG + mg34_remote / nsvt_t72a 實測資料比對通過 |

8 個基準失敗來自未生成的原生驗證檔：兩個網路測試入口、T72 native C2 receipt，以及 5 個依賴 `target/weapon-control-gameplay-network.json` 的測試。它們**沒有被跳過、刪除或偽造驗證檔來變綠**，因此不能聲稱全套測試通過。完整原始 TAP 與 `test-summary.json` 隨交付包提供。

接觸工具使用既有 **12 mm** 容差；承座另有明確 **5 mm** 模型搭接。離散姿態及 triangle-crossing 測試不是連續碰撞證明，也不能排除完全包覆、不產生表面交叉的情況。

### 真正遊戲 WebGL2

用 Chromium + ANGLE SwiftShader + Xvfb 執行實際 `boot.js`、`main.js`、遊戲 WebGL2 renderer。隔離的 about:blank 頁面透過 Blob import-map 載入本地原始模組；未用另外的 Three.js 或離線假渲染替代。瀏覽器版本、原始碼雜湊、狀態與錯誤陣列在 `*-browser-receipt.json`。

已捕捉同相機的前斜、側、後斜、炮塔特寫、正面、+13°、−6°／全後坐、內構、戰場、行進、單獨控制機槍等畫面。原來的炮盾上緣大黑缺口是看過近距離渲染後才發現並補做固定帆布裙，不把先前「零件相接」誤當作沒有視覺缺口。

实际戰場以 `fwd` 輸入驅動並觀察輪組轉動。NSVT 單控發射 7 發、底座相對炮塔不動，發射點與最後一幀模型槍口誤差小於 **0.02 mm**（含更新順序數值差異）。這不是網路端命中事件一致性驗收。

外觀比較畫面隱藏 UI，但炮鏡另需恢復 UI 才能驗證瞄準窗；最終炮鏡圖及實測狀態隨包附上。現有艙蓋只能驗證關閉狀態，斷履帶／車體受損／全回放控制器未實測。

## 6. 必須由主會話接手的接口：裝甲面同步

**發布阻擋項。** 舊戰鬥 owner 使用 `armor.json` 平面及 `modules.json` 盒，並不直接採用新 visual 三角形。重塑首上／首下而保留舊命中平面會造成畫面與戰鬥不一致。為不越界修改傷害計算，本 patch 不改 armor；以下候選幾何已機器可讀地寫進 `docs/t72a-model-geometry-2026-10-13.json / visualToDamage.proposedArmorGeometry`。

| ID | 候選中心 `[x,y,z]` m | 候選法線 `[x,y,z]` | half_u / half_v m |
|---|---|---|---|
| hull_glacis | `[0,1.16,2.5884705]` | `[0,0.92718385,0.37460659]` | `1.14 / 0.90761881` |
| hull_lower | `[0,0.61,3.0662695]` | `[0,-0.86602540,0.5]` | `1.14 / 0.41999985` |

保留各面 `id / zone / material / thickness_mm`。但即使厚度不變，法線／位置變動仍會改命中與斜角，所以應由戰鬥 owner 明確核准並重跑命中／彈道／回放測試。

炮塔仍使用舊有平面裝甲近似；需要主會話決定是否增加分面碰撞表示，不能把新平滑 visual 當成已具有精確曲面裝甲。槍管模組盒、PKT 內部盒也是既有近似，包絡與 visual part-role 對照見幾何清單。

## 7. 重新產生與整合

在新的模型 review 工作樹執行，**不要直接套進仍有其他會話修改的共享目錄**：

```sh
# 由主會話選定最新整合基準建立新工作樹之後：
git apply --check /path/to/tankforge-t72a-model.patch
# 核對 patch 白名單，再使用 git am 保存交付提交。
git am /path/to/tankforge-t72a-model.patch

node tools/t72a_visual.mjs
node tools/t72a_geometry_audit.mjs --out=target/t72a-review-new/geometry.json
node client/web/tools/measure-mg-damage.mjs
cd client/web
node --test test/t72a-model-refinement.test.mjs
node --test test/*.test.mjs
```

完整浏览器复现工具：

```sh
# 需要既有 Node、Python Playwright、Chromium；無桌面 Linux 需先備妥 Xvfb。
python tools/t72a_browser_review.py --root . --out target/t72a-browser-review-new --label after --display :98
```

輸出目錄必須尚不存在；準備工具讀本地 sources/assets，只在新目錄建立 review 頁與截圖，不修改 production HTML。Windows 有桌面時略去 `--display`，用 `--chromium` 指向實際瀏覽器執行檔。這個跨平台參數路徑未在使用者 Windows 電腦驗證。

整合顺序：先审模型与年份选型 → 核准首上／首下 hit-plane 接口 → 重跑 native receipt / pose / 回放与工坊移植 → 才能决定是否进入下一个整合测试版本。本交付不授权自动上线。
