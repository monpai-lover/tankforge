# TankForge 超壓機制調查

日期：2026-10-11。狀態：研究與實作建議，**尚未實作**。

檢查工作樹：`C:/Users/24908/.codex/scratch/tankforge-suspension-tracks-v7`，檢查時 HEAD：`85dd0e1edb405dd828e5085757fc3a569349b119`。工作樹另有未完成的懸吊／履帶改動；本調查僅新增本文件，沒有修改 runtime、車輛／武器／裝甲資料、GLB 或 B 方案文件。

## 判斷與建議

現有程式已有名為 `Overpressure` 的結果，但目前是「填藥量、距離、半徑」傷害近似，不是經驗壓力／衝量模型。最值得先修正的是**爆炸如何抵達乘員**，再談傷害量：外部爆炸、開頂暴露、經破口進入與真正艙內起爆應分開；HESH 裝甲背面剝落不應自動等於艙內填藥爆炸。

建議第一版採用「傳播路徑判定 + 明確標記為遊戲估計的負荷曲線」。保留原本武器、裝甲、車輛和美術資料；沿用 Rust 戰鬥判定、乘員／模組狀態及權威報告。先消除錯誤的全車徑向傷害，再加入可驗證的外部壓力／衝量查表。沒有艙室容積、開口與試驗資料時，勿把任意艙內倍率宣稱成真實氣壓。

## 真實現象：哪些可以確定

### 壓力、衝量與反射是不同量

超壓是相對環境氣壓的上升。峰值、持續時間、介質、距離及周圍反射／聚焦都會影響暴露；車內和牆面附近的波形可能有多次脈衝。這不能支持一個通用的「超過某壓力所有人立即死亡」規則。[DoD BIRCO：Science of Blast](https://blastinjuryresearch.health.mil/index.cfm/blast_injury_101/science_of_blast)

正相壓力衝量是壓力隨時間的積分；它不是峰值氣壓、動能或彈體動量。實作中應區分 `peak_pressure_kpa`、`positive_impulse_kpa_ms` 和 `positive_duration_ms`。工程自由場模型常以 `Z = R / W^(1/3)` 描述同類爆炸的尺度，其中 `W` 是 TNT 當量；球形空爆與半球地表爆炸有不同曲線。相同 Z 的峰壓相近，不代表不同裝藥量具有相同的脈衝時間和衝量。[UNODA IATG 01.80，§5、§6.2、§6.5](https://s3.amazonaws.com/unoda-web/wp-content/uploads/2019/05/IATG-01.80-Formulae-for-Ammunition-Management-V.2.01.pdf)

### 不要把不同傷害機制全部叫超壓

DoD 的分類將直接壓力造成的原發傷害、碎片／碎屑傷害，以及身體加速／撞擊傷害分開。燒傷、煙氣也屬其他機制。程式中的 `spall`、`jet`、`burst`、`blast` 應保留各自的來源，不宜因同一次爆炸而合併成單一超壓判斷。[DoD BIRCO：What is Blast Injury?](https://blastinjuryresearch.health.mil/index.cfm/blast_injury_101/what_is_blast_injury)

完整車體可阻擋外部氣流的直接進入，但封閉車內乘員仍可能受快速板材變形、地板位移及車體運動傷害。這需要另一個結構／加速度模型；「沒有外部空氣超壓路徑」不能在說明文字中寫成「乘員永遠安全」。[Viano，Scientific Reports，2023，車內變形與乘員傷害分析](https://www.nature.com/articles/s41598-023-29686-7)

### 開口與封閉程度

外部波可經開口進入，繞射和內部反射形成複雜負荷。開口、艙室尺寸及外部波形重要；不是穿透任一薄片便必然造成相同艙內壓力。Eytan 等人的 45 個 CFD 案例顯示 UFC 部分內壁負荷預測可偏高，但研究對象是房間，並非戰車。[Eytan 等，2024 線上發表／2025 卷期](https://journals.sagepub.com/doi/10.1177/20414196241277222)

2026 的後續論文又檢討早期試驗的儀器振鈴、資料處理及超出公式適用域問題。不能把前一篇的某個百分比直接換成所有車輛的「艙內加成」或「防護倍率」。[Eytan 等，2026，Discussion and re-evaluation](https://journals.sagepub.com/doi/10.1177/20414196251413706)

以下屬於由上述機制推導的遊戲設計，而非來源給出的戰車傷害數值：

- 開頂戰鬥室：先判定每名乘員或其艙室到開口的路徑；有開頂炮塔不代表封閉駕駛室也開放。
- 外部爆點在側牆下方：直線遮蔽可降低直接暴露，壓力仍可能繞過牆沿從上方進入；不能只用爆點高度作開關。
- 真正艙內起爆：與外部爆炸經小孔漏入不同。封閉、容積與洩壓會改變負荷；近處碎片依然獨立造成傷害。
- 艙門／觀察孔／既有破口：沒有可靠資料或狀態時，不憑美術縫隙捏造開口。維持「資料未知」而不是假裝完整流體模擬。

### 填藥量不是 TNT 當量

`explosive_mass_kg` 是填藥實際質量。換成 TNT 當量需要來源明確的等效因子；峰壓與衝量因子可能不同，且各自有適用範圍。[UNODA IATG 01.80，§7.2](https://s3.amazonaws.com/unoda-web/wp-content/uploads/2019/05/IATG-01.80-Formulae-for-Ammunition-Management-V.2.01.pdf) 近場不能無條件套用遠場等效因子。[Shin、Whittaker、Cormie，2015，研究摘要](https://journals.sagepub.com/doi/10.1260/2041-4196.6.3.567)

實作原則：從可信的炮彈定義讀入填藥與類型，保留原值；只有來源已核驗且適用時才輸出 TNT 等效量。未知類型可以保留保守的遊戲估計與 `uncalibrated` 記錄，不能無聲地把所有填藥都稱為 TNT，也不能把總彈重当填藥重。

## 彈種應如何分開

| 彈種／情境 | 第一版應保留的傷害來源 | 超壓處理建議 |
|---|---|---|
| HE 外部起爆、未破艙 | 外部爆炸、彈殼／目標碎片、外部模組受損 | 僅對有氣流／開口路徑的乘員估計暴露；不要隔著完整裝甲直接徑向扣全艙乘員血量 |
| HE 確實造成通往乘員艙的破口 | 破口碎片與部分爆炸氣體進入 | 使用 `BreachIngress`，保留實際外部爆點和破口，不把整顆裝藥搬到艙內 |
| APHE 引信啟動且彈體在艙內起爆 | 原有穿透／剝落、彈殼碎片、內部爆炸 | 使用 `InternalDetonation`；引信未啟動、未爆或已離開車內時不得套用 |
| HESH／HEP 造成背面剝落但未打通 | 裝甲應力波造成的背面碎片 | 使用 `ArmourShockSpall`；對外部起爆另評估暴露，只有真的存在氣體通道才能有 ingress |
| HEAT／HEAT-FS 穿透 | 射流及背面碎片；可能另有燃燒／次生效應 | 不因大穿深或有填藥就自動給全車超壓；外爆、穿孔進氣與真正內爆仍須分開 |
| 實心 AP／APDS／APFSDS | 彈芯、剝落、模組及乘員直接命中 | 無填藥爆炸；彈藥殉爆屬另一個由車內狀態觸發的事件 |

HEAT 的穿甲效應是高速金屬射流及機械侵蝕／衝擊，不應用「高溫氣體燒穿裝甲後充滿全車」的說明；孔口後亦有碎片。[CBO，2012，Appendix B，pp.47–50](https://www.cbo.gov/sites/default/files/112th-congress-2011-2012/workingpaper/11-06-2012-Ground_Combat_Vehicles_0.pdf)

HESH 的研究把裝甲剝落與空氣爆炸負荷分別討論；這支持在遊戲中分開二者，而不是以「發生剝落」作為整顆填藥已進艙的證據。[Deshpande 等，Defence Science Journal，2003；本次讀到 EPA HERO 提供的論文摘要](https://hero.epa.gov/reference/7685510/) 上表是模擬建議，不是歷史炮彈的傷害校準表。

## 現有程式的精確檢查

檢查基於上述 HEAD 的工作樹文件；未執行或修改戰鬥程式。

| 位置 | 現有行為 | 風險與最小修正方向 |
|---|---|---|
| `crates/combat/src/lib.rs:826–836` | `he_pen_mm = 13.1 * kg^0.673`；艙內半徑 `3.6*cbrt(kg)`；外部半徑 `1.6*cbrt(kg)+0.5` | 原創估計常數，没有來源與壓力單位。半徑可作事件搜尋上界，不能當通用生理致死界限 |
| `lib.rs:1094–1116` | `blast_inside` 依距離扣所有乘員／內部模組血量；乘員 power 使用 `150*(max(kg,0.005)/0.05)^0.25` | 不檢查艙室、內部裝甲、開頂、容積或洩壓。爆點所在隔艙可傷到另一封閉艙室；內部模組距離也不是壓力耐受資料 |
| `lib.rs:1120–1152` | 外部模組僅依距离；所有開頂車乘員用距離與爆點／乘員／全車最高板中心高度判斷 | 兩側同高度乘員都可在厚牆後受傷。駕駛可能因 `open_top=true` 被當暴露。單個無關高板中心又可屏蔽整車；炮塔轉動不會改變此高度判斷。應使用 posed 幾何及逐人路徑 |
| `lib.rs:1323–1345` | HE 與 HESH 共用第一命中板分支；rating ≥ 原始板厚且不是 skirt 就生剝落、`blast_inside(inner, kg*0.8/0.4)`、`Outcome::Overpressure` | HESH 背面剝落被誤当氣體進入。第一層附加板被突破後就停止，沒有驗證後方主裝甲。HE/HESH 也不讀材料因子；其規則是另一種簡化，不應標為已算完整 breach |
| `lib.rs:1329` | 艙內位置為 `point + dir*(thickness_m+0.03)` | 用的是沿彈道位移，却没有斜角厚度轉換；接觸爆炸的內表面定位應明確依据板法线／几何，不能把這個偏移视為真實內爆位置 |
| `lib.rs:1156–1169`、`:1425–1466` | `burst_fragments` 一律附帶 `blast_inside`；HE/HESH 命中非 external 模組或開放乘員也進入该 helper | 暴露模組／乘員命中不必然等於封閉艙內起爆。碎片產生與爆炸環境判定應拆開 |
| `lib.rs:1293–1300`、`:1407–1418`、`:1486–1501` | APHE 有引信靈敏度與延遲，超出 broadphase span 可標 overpenetration；`inside` 在進板時設真，未在出板時設假 | 原有引信是有用的基础。但車輛 broadphase 包含外部模組，不能充當氣密艙邊界；離開乘員艙、仍在 barrel／整車 bounds 內時可能被算作內爆。引信距離在啟動時由當時速度算出，後續減速也未重積分引信時間 |
| `lib.rs:699–708`、`:732–736`、`:1625` | `Overpressure` 註解意指薄甲被爆炸打通；`Burst` 只有位置、半徑、inside、kg；預設標題「超壓擊穿」 | 結果標签混合「破甲／進入／傷害」。報告缺少伝播途徑和損傷來源；即使無人受压，也可顯示超壓 |
| `crates/weapon/src/lib.rs:59–60`；`combat/lib.rs` | 炮彈有 `explosive_type`，当前 blast helpers 只使用質量 | 沒有 TNT 當量轉換。對照數據應明確原始填藥質量，而非聲稱計算真實 TNT 爆炸 |
| `lib.rs:1326`、`:1428`、`:1157` | 某些分支將零填藥 HE/HESH clamp 成 0.01／0.005 kg | 資料异常／合成測試可能無中生有爆炸。入口應拒绝非有限／負數，零填藥必須無爆炸，不靠下限创造裝藥 |

同一段傷害裡，破片 `fragment` 已利用 `to_armour` 阻擋裝甲並讓模組吸收；`blast_inside/outside` 沒有同等的路徑判定。這不表示應把所有压力都按碎片直线擋住，而是目前缺少氣体路徑這一層。

### 現有測試哪些不能當物理驗證

- `tests.rs:991` APHE 與實心彈多 seed 比較：驗證目前遊戲相對效果，可保留；它不是艙內壓力校準。
- `tests.rs:1018` 外爆重甲不傷乘員：應表述成「没有直接氣流路徑的外爆不套艙內 primary-blast」；別擴展為永不受任何爆炸傷害。
- `tests.rs:1033` 大 HE 穿薄頂、至少兩人死亡：能防回歸，但不能證明任意內外隔艙都必定有相同結果。
- `tests.rs:1286` 開頂近彈案例目前接受「有乘員受傷 **或只是履帶受傷**」。名稱声稱 crew exposure，却可在零乘員傷害時通過；新的測試需直接斷言指定暴露乘員。
- `tests.rs:1296` 翻折側板案例改的是全車 `top` 高度；應另加板材可视遮擋、局部開口與炮塔轉角，避免只通過同一高度捷徑。

### 權威計算的接點

`crates/server/src/lobby.rs:1408–1425` 的 `apply_shot` 使用 `tg_combat::shoot`，更新伺服器持有的 combat 狀態並計算死亡。這是直接命中應沿用的權威路徑。

Rust 搜尋 `splash` 本次只見 combat 定義／測試與 `crates/design-wasm/src/lib.rs:261–266` 的 adapter；未見 server 調用。`client/web/src/main.js:2126–2145` 的 `splashNear` 在本機計算近彈，略過 online 的 remote 車輛，並用 `kg < 0.1` 當入口界限。故只改善 combat helper，不能讓多人近彈自動獲得權威傷害；這需要額外的 server burst 接點與一次性事件處理。

目前 `splash` 只傳 `at/kg/yaw/seed`，没有 trusted shell type。引入當量時應使用伺服器查得的 projectile 定義／可信事件，不讓客戶端指定填藥量、當量、命中乘員或傷害。

## 第一版縮減模型

下面為建議範圍，待後續整合審閱；尚未實作。

### 選項比較

| 選項 | 優點 | 代價／限制 |
|---|---|---|
| A. 只改大半徑與傷害倍率 | 快 | 保留 HESH 假內爆、全車開頂和隔甲傷害；不建議 |
| B. 先明確判定機制／路徑，保留可配置的游戏負荷曲线 | 可以在不改歷史資產下修正主要誤判，結果可重播解釋 | 絕對傷害仍未校準；標記為估計。**建議首版** |
| C. 爆炸流體 + 可變形裝甲 + 生理模型 | 有機會對試驗作完整對照 | 超出目前資料、效能與開發範圍；也須實驗驗證，並非自動更真實 |

### B 的資料流

1. 從可信炮彈資料创建一個爆炸事件，保留實際爆點、填藥質量、類型和引信狀態。無填藥／未起爆就没有 blast event。
2. 將環境標成 `ExternalExposure`、`BreachIngress` 或 `InternalDetonation`。`ArmourShockSpall` 另外生成／記錄剝落，不假造氣體事件。
3. 對乘員逐個找路徑：直接可見、到已知開口的有限路徑，或同一可連通艙室。所有測试使用當時 `posed`／折板几何。完整板阻止直接氣流；碎片仍用既有 fragment propagation。
4. 只對得到路徑的乘員施加對應負荷估計。輸出來源／路徑與估計標記，避免將 `Layer.passed` 直接翻译為全艙殺傷。
5. 分別累計碎片、壓力及其他已實現的傷害；單一爆炸 ID 去重，健康／死亡／事件仍由既有權威 owner 更新。

開頂第一版可用既有炮塔／板材資料導出少量頂部開口 sample，檢查「爆點到開口、開口到乘員」兩段是否穿越完整板，再以路徑長度與可見開口量降低估計負荷。這是有限的繞射近似；完全直線遮蔽只可當保守的 direct component，不能声稱压力在牆後一定為零。不要把炮管／external 模組擴大的 `Target.lo/hi` 作為艙內自由容積。

對 closed 車体的 hatch／內部艙隔若没有資料，首版不凭空生成。若後续加入元數据，應由現有 vehicle.json 几何在 loader 衍生或使用 optional fields，保持旧档兼容；不要批改所有历史車辆资产來满足算法。

HE 的既有薄甲 rating 可以暂時保留為**遊戲破口候选**，但需驗證它確實跨過所有遮擋層、連接到受損艙室。不能將 `kg*0.8` 的“轉移填藥”视為已驗證物理。HESH 既有 rating 在這一階段應只作剝落能力估計，不作 gas-breach rating；真破口需獨立證據。HEAT 首版保留 jet/spall，除非可信穿孔與外爆資料支持額外 ingress，否则不添加普遍徑向艙內殺傷。

### 外部 P/I 的下一步

在路徑模型穩定後，可給外部事件接入有來源、單位與適用域的压力／衝量查表。查表須区分空中球形和地表半球形，處理零距离／超域／無效輸入；不能把自由場 KB 曲線直接套進接觸爆炸或車內。

內部／破口的負荷没有校準資料時，保留 dimensionless 的遊戲 exposure／severity，不輸出假精確 kPa。乘員血量轉換應是可配置且有版本的游戏響應曲线；不把游戏死亡概率宣傳成人体通用阈值。任何直接套用 `pressure > constant => kill all crew` 的方案均不應采纳。

## 實作接點與邊界

| 接點 | 後續工作 |
|---|---|
| `crates/combat/src/lib.rs` | 拆分 fragment burst 與 blast environment；新增纯計算路徑／暴露 helper；修 HE/HESH 路由；保留原 state/caps/finish |
| `crates/combat/src/tests.rs` | 添加以下矩阵；更新過度依赖旧半徑/高度/全車人數的測试说明和預期 |
| `crates/weapon/src/lib.rs` / trusted projectile catalog loader | 可选的爆炸參數描述／当量來源；讀取現有 `explosive_type`，不擅改 historical data |
| `crates/design-wasm/src/lib.rs` 與 `client/web/src/game/combat.js` | 兼容旧 `splash` adapter；將机制數据傳到诊斷／回放，浏覽器不拥有多人最终傷害 |
| `crates/server/src/lobby.rs` 與實際彈體／地面接觸 owner | 在權威爆炸事件上應用近彈暴露；按照目標／event ID 一次性扣血；廣播結果並沿用死亡計分 |
| `client/web/src/main.js` / hitcam consumers | 消費權威結果；改 misleading「超壓擊穿」說明，呈現破片／艙內爆炸／開口爆壓区別 |

不要改懸吊／履帶 implementation、GLB、原有車輛 weapons/armor/crew 數值，也不要將狀態與界面同時大范圍重构。

## 有意義的驗證矩陣

| 測試 | 必須驗證的觀察結果 |
|---|---|
| 封閉厚甲，外部 HE 起爆，無 breach | pressure component 不傷封閉乘員；允許獨立外部模塊／碎片效果 |
| 同爆点、open gun compartment + enclosed driver | 暴露炮手受負荷，封閉驾驶员不因全局 `open_top` 自動受相同傷害 |
| 單面盾牌遮住一名 crew、另一名露出 | 暴露分別判定；添加一個不在路徑上的高板不會保護整車 |
| 爆点低于牆沿，頂部有可達開口 | 有限間接路徑可進入；移除/封住開口後不再有這條途徑 |
| 炮塔不同 yaw、折板不同角度 | 實際遮擋改變相應路徑；crew/module indices保持穩定 |
| 前側附加薄板、後側主装甲完好 | 第一片“通過”不觸發全車內压；主甲仍阻止 ingress |
| HE 通向一個艙室的真實候选破口，另一艙室被完整板隔開 | 只傷連通艙室；完整隔板不被徑向半徑跳過 |
| HESH 产生背面 spall，但没有穿孔 | 可有碎片傷害；不得生成假 `InternalDetonation` 或徑向 cabin pressure |
| HEAT 射流穿透、没有獨立內爆證据 | jet/spall仍有效；不得僅凭穿深/填藥自動傷全車 |
| APHE fuse未啟動、延遲內爆、离艙後外爆 | 三者爆炸路由不同；外部 AABB/barrel bounds不能留住假“內爆” |
| 無填藥/zero、負數、NaN、infinite輸入 | 没有伪裝藥、NaN state或無穷半徑；可信邊界拒绝無效值 |
| 距離/填藥量與負荷響應 | 同环境內合理單调且有界；改變压力持续時間／衝量能影響傷害，而非只用一峰压 |
| 多次调用同 burst ID / direct hit + adjacent splash | 不重複傷同目標；不同事件可獨立傷害 |
| 同 seed、同几何/状態、server與WASM | 路徑、crew index、報告與状態確定；回放只消費記錄 |
| 多目標近爆/重複同車型玩家/死亡計分 | 依 entity ID 更新，不依車型 ID；傷害與死亡由server持有並只計一次 |

先做合成几何的行為測试，再用既有開頂／封閉車輛回歸。真實压力查表只以來源/獨立參考点驗證單位與適用域；不要用同一實現的輸出生成自己的“真值”。不以強制「每次至少殺几人」代替机制測试。

## 可用開源參考與許可

[fcento100/kingery-bulmash](https://github.com/fcento100/kingery-bulmash) 的 README、算法和 [LICENSE](https://github.com/fcento100/kingery-bulmash/blob/194c3c7a91ecda97bb3e8aaca55f0359d4066d5e/LICENSE) 已核驗；檢查 commit 為 `194c3c7a91ecda97bb3e8aaca55f0359d4066d5e`。

- MIT，copyright 2024 fcento100；若複制/移植實質代码須保留 copyright 與 permission notice。
- 接受 TNT equivalent NEQ，适用于半球地表爆炸；輸出压力、衝量、持续時間、到達時間等，並分各參數的 valid Z range。不是氣体穿孔／战車艙內／人體傷害庫。
- 适合作為离线對照或外部曲线實現參考，**不是本次已加入的依赖**。未複制代码、圖片、模型或算法常數。
- 不直接移植到全部爆炸：接觸、空爆、near-field/out-of-range必須另外處理；取得壓力值仍不等於得到生理殺傷阈值。

## 來源讀取狀態與不確定性

已讀：DoD BIRCO 的两個正文頁；UNODA 2015/2016 版 IATG 01.80 的相關全文章节；Viano 2023 正文；Eytan 2024/2025 與 2026 正文；CBO 2012 Appendix B；MIT repo README、實現與許可證。IATG 引用的是明確標出的旧版机制资料，不声稱這是当前庫存安全规程。

只讀到摘要：Shin 2015 原出版社摘要；Deshpande 2003 經 EPA HERO 的原文摘要。後者 DRDO 全文抓取失败，因此没有從其全文導入任何傷害常數。UFC 巨型 PDF讀到文件但未可靠提取相關頁，本文件不把其公式／氣密艙比例當獨立已驗證的數据；相關 ingress 限制引用的是已讀的 Eytan 正文。

主要未知：当前車輛資料沒有可靠的氣密艙自由容積、實際通風／開門狀態、breach aperture、板材動態變形與壓力傳遞校準；公開房間試驗不能直接給战車乘员的系數。HESH/HEAT 小孔的 gas ingress 與近场複雜度亦未在此次得到足夠可公開泛化的校準材料。

所以首版能诚實做到的是**机制與路徑更可信、傷害來源可解釋、權威性和確定性可驗證**；不能宣稱達到真實战車傷亡預測。
