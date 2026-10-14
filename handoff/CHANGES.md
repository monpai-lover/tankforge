# 本輪修正與新功能（cloud/replay-aircraft-fixes）

所有程式修改都在 `bundle/app.js.html`（esbuild 打包檔，依 `// client/web/src/...` 模組標記編輯）與 `bundle/head.html`（CSS）。`client/web/src` 沒有改動。重建單檔版：

```sh
./build.sh                 # 產生 tankforge-full-online.html（約 280 MB，不進 git）
```

飛行核心原始碼與重建方式在 `flight/`（見第 7 項）。瀏覽器驗證工具與截圖在 `tests/`（見文末）。

---

## 1. 擊中回放透明（看得到戰車後面的天空／雲）

**根因**：回放畫布是 `alpha:true, premultipliedAlpha:false` 的覆蓋畫布。`Renderer2.view()` 先畫不透明天空（alpha=1），之後半透明裝甲、內部零件、線框、彈道都用 `blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)`，這個混合也作用在 alpha 通道（結果 alpha = srcA² + dstA·(1−srcA) < 1）；POST 著色器再把場景 alpha 寫到畫布，所以每個鬼影像素都變成半透明，後面的遊戲畫面透出來。

**修正**：天空畫完後 `colorMask(true,true,true,false)`，之後所有繪製不再改 alpha，alpha 通道只代表「這裡是回放視窗」（視窗內 1、外面 0）；混合改為 `blendFuncSeparate(SRC_ALPHA, ONE_MINUS_SRC_ALPHA, ONE, ONE_MINUS_SRC_ALPHA)`。主畫面渲染器是 `alpha:false`，它的 `replayDraw` 路徑目前沒有被使用，沒有同樣問題。

**驗證**：讀回回放畫布像素。修正前 28,113–39,429 個不透明像素之外有 2,921–4,047 個半透明像素（最低 α = 45/255）；修正後 0 個半透明像素，α 全部 255。截圖 `tests/screenshots/1-replay-before.jpg` / `1-replay-after.jpg`。

## 2. 等效厚度查詢（防護分析游標）沒有作用

**根因一**：`armorPreviewFromReport()` 用 `report.geometry_contacts` 判斷入射路徑是否經過「未審核」表面；但這個陣列包含全部破片（spall）射線的接觸點（一發 44 道），破片打到的 `audit_pending` 內表面投影到射線上，就把結果判成 `unsupported_entry_path`，游標只顯示「防護未知」。改用彈體本身的 `primary_geometry_contacts`。

**根因二**：射線先碰到履帶、負重輪、誘導輪、外掛件時，`pick()` 直接回報未知。現在若前面只有外部零件（module／decoration），改查後方第一塊裝甲，游標附註「外部零件後方」。

**根因三**：44 輛車中有 20 輛（T-10M、BMP-T34、獵豹防空車、追獵者各型、BMP-K64……）沒有表面目錄，游標退回「未標記的渲染三角形」查詢，永遠只回答「防護未知」。現在這些車改用戰鬥模型的裝甲板（armor.json；與防護分析試射相同的舊式射擊）計算，顯示游標下那一塊板的等效厚度（例：獵豹側面 35 mm、54° → 54 mm、可擊穿；BMP-K64 側面 80 mm、54° → 123 mm）。

**驗證**：在車庫用格點掃描游標（T-72A／虎式／三號，各 54 點）：「未知」由 9／17／18 降到 4／10／9（剩下的是只打到履帶、後面沒有裝甲的射線）。三號側面 30 mm、51° → 等效 44 mm、可擊穿。截圖 `2-effective-thickness-cursor.jpg`。另外第 4 項修正後，原本因為內表面被判為未審核而顯示未知的情況也一併消失。

## 3. 彈藥殉爆後遊戲卡死

找到兩個會造成「卡死」的原因：

**(a) 回放永遠不結束**：被擊毀的殘骸會持續燃燒約 60 秒，每 0.25 秒推進一次燃燒，產生新的機制紀錄並重送「擊殺事件」證據和狀態提交。每次重送都把 `ReplaySession.endFilm` 推到至少目前影片時間，`tick()` 永遠到不了結尾；結束後下一次重送又重新開始同一段回放。玩家自己被殉爆時這是**全螢幕受害者回放**，而且線上模式重新部署要等回放結束——畫面看起來完全凍結。重現：殉爆 35 秒後回放仍在播、總長持續增加。
修正：重送的事件與狀態提交最多只能把影片延長到最後一筆真實證據後 6 秒，而且在死亡之後（+1 秒）一律不能延長；影片硬上限 40 秒；HitCam 記住已播過的事件，沒有新死亡的重送不再重播。受害者回放可按**空白鍵／Esc 跳過**（畫面右下有提示）。修正後受害者回放約 7.5 秒結束、敵方殘骸回放約 6 秒結束，殘骸照常燃燒。

**(b) 例外中斷動畫迴圈**：`frame()` 在 `update()` 回傳後才重新排 `requestAnimationFrame`，任何一次例外（例如戰鬥核心拒絕一發射擊：測試中重現過 `barrel health differs from last core-issued state`）就讓整個遊戲永久停住。現在 `update()` 例外會記錄並以提示顯示、迴圈繼續；擊中與殘骸推進的核心呼叫改為逐發／逐車失敗。

**附帶效能**：`LocalSurfaceCombat.validateShape()` 每次姿態更新都逐頂點比對所有已註冊網格（測試機每個遊戲步約 11 ms）。改為同一份頂點陣列只深度比對一次（每 240 次再全量檢查），`surface.pose` 耗時降到約 1/4。

截圖 `3-detonation-victim-replay-before.jpg`（修正前卡在全螢幕回放）。

## 4. 應該擊穿卻顯示未擊穿（hitbox）

**根因**：表面目錄（surfaceCatalog）把尚未審核的三角形（車體／砲塔殼網格的內側面、砲架、懸吊座……三號戰車有 355 個表面、3,372 個三角形）宣告為 `resistancePolicy: "unsupported"`，原生核心遇到第一個這種表面就讓彈體停止（事件 `unsupported_surface_resistance`）。所以彈體已經打穿裝甲（例：417 mm 尾翼穩定脫殼彈打 30 mm 砲塔側面，剩 386 mm），接著碰到同一面牆的內側面就被判「未擊穿」。不是厚度、角度、單位或砲塔姿態錯誤。

**修正**（`localSurfaceCombat.js`）：註冊前把目錄正規化——unsupported 表面改宣告為非裝甲附件（沒有登記厚度；它所屬的裝甲牆由裝甲層計算一次，不重複計算），並依產生器相同方式重算宣告內容雜湊、manifest／catalog 雜湊。幾何、payload、登記裝甲都不變。符合 `docs/hitbox-conventions.md` 第 4、5 條。

**取捨**：砲管斷裂的碰撞變體（barrel-fracture variants）由核心內建的「受信任登錄表」驗證，並指名原版目錄為父目錄，無法和修正後的目錄一起註冊，所以不註冊；斷砲管改由第 6 項的畫面效果呈現（碰撞上砲管仍是完整長度）。

**可重複測試**（`tests/plates_apfsds.js`、`tests/plates_apc.js`）：靶場實戰路徑，對 M8／三號／虎式 armor.json 每塊裝甲沿法線（0°）射擊：
- 3BM22（420 mm）：37/37 擊穿（修正前 22 塊回報 stopped）。
- 5 cm Pzgr.39（約 85 mm）：虎式正面 100 mm、側面 80 mm、防盾仍擋下；三號上斜甲 74° 跳彈；30 mm 側面與虎式 80 mm 後部（需 83／有 84 mm）擊穿。

## 5. 彈道回放：開源方案調查

搜尋 GitHub／網路上「War Thunder 式擊中攝影機／彈道 X 光回放」：只找到回放檔解析（wrpl，AGPL）、遊戲資料解包（War-Thunder-Datamine、wt-tools）、Tacview 匯出、停更的 Unity 專案與閉源的 WoT 裝甲檢視模組，沒有比你提供的 `hit_replay_webgl_wasm_v3` 更合適、可直接採用的 WebGL 專案。因此保留 vendored 的 V3，並修好它的透明（第 1 項）、不結束（第 3 項）與斷砲管顯示（第 6 項）。

## 6. 砲管與履帶損壞沒有畫面效果

**砲管**：新增 `gfx/damageVisuals.js`。戰鬥能力結果回報砲管損毀（`caps.weapons["gun:t:g"].can_fire=false`、原因 gun_barrel）時，砲管在外露長度約一半處斷裂：鋸齒斷口、燒焦變黑、下垂。原本的砲管節點保留網格與碰撞註冊，只是隱藏；替代網格是隱藏的鏡像（每台車首幀建立），所以擊中姿態與回放快照都包含它。玩家、AI／靶車、遠端玩家都適用。**回放**：從第一筆回報砲管損毀的紀錄接觸時刻起，回放裡的砲管才換成斷裂版本（擊中前完整）。

**履帶**：離線時原有的 TrackChain 會把斷掉那側的履帶切開、掉在地上，那側停止轉動（已驗證：右側斷，右履帶速度 0，車輛原地轉）。沒有模擬履帶鏈的情況（線上遠端車輛沒有權威框架、或沒有可信的履帶片拓撲）原本畫面毫無變化，現在改畫成「履帶脫離負重輪、鋪在車體後方地面、不再捲動」。

截圖 `6-*.jpg`。

## 7. 飛機與飛行操控（AEROLAB）

**飛行核心**（`flight/`）：直接使用你的 AEROLAB 02 C 核心，只加「外部世界」模式：`set_world(1)` 後地面高度與可降落表面由 TankForge 提供（匯入 `world.ground` / `world.landable`），`spawn()` 可在任意位置以停放或飛行狀態出現；起落架在任意航向的地面滑跑（側滑抑制、尾輪轉向）。動力學完全沒改：在原本世界中，重建的 wasm 與你提供的 `flight_core.wasm` 跑 20 秒相同輸入的結果**逐位元相同**（差值 0）。用 clang 或 zig（`pip install ziglang`）執行 `flight/build.sh` 重建，wasm 以 base64 內嵌在打包檔。

**遊戲內**（`game/aircraft.js` + main.js）：
- 車庫「試飛飛機（F8）」按鈕，或出擊後按 **F8**：靶場時停在道路起點（道路 2.7 km 當跑道），地圖上出現在戰車旁。戰車原地停放。
- 操控與 AEROLAB 相同：滑鼠＝世界瞄準方向（教官飛控追蹤金圈），W/S 俯仰、A/D 滾轉、Q/E 方向舵、Shift/Ctrl 或滾輪油門、C 自由觀察、I 教官、L 平飛保持、G 起落架、F 襟翼、B 煞車／減速板、V 追蹤／座艙視角。畫面下方顯示空速、高度、爬升率、航向、油門、迎角、G 值。
- 地面上低速時按 F8 回到戰車（飛機停在原地，40 m 內再按 F8 可登機）；空中要 2 秒內按兩次 F8 才棄機。
- 地形、水面、坡度來自 TankForge 世界；地面網格跟著飛機移動。

**驗證**：起飛滑跑約 500 m、201 km/h 離地、30 秒爬升到 110 m；滑鼠瞄準右轉；從 55 m 高度進場降落在道路上，滑跑煞車到停止且未墜毀；F8 回到戰車並可駕駛，F8 再次登機。截圖 `7-*.jpg`。

**未包含**：飛機武器、飛機受損與和建築／樹木／戰車的碰撞、線上同步、飛機音效。

---

## 尚未完成／已知限制

- 第 4 項只作用在本機權威（離線）戰鬥。線上對戰由伺服器判定，伺服器端目錄仍是原規則。
- 斷砲管目前只有畫面效果，碰撞上砲管仍完整（原因見第 4 項取捨）。要恢復斷裂碰撞，需要用同樣規則重新產生目錄與變體，並更新核心內建的受信任登錄表（需要這個 wasm 的 Rust 原始碼，本 repo 與 TankForge.zip 中都沒有）。
- **全資料驗證**：完整的 280 MB 單檔頁面在這台 3 GB 記憶體的機器上載入時 Chromium 直接記憶體不足當掉（`Page crashed`），無法整頁測試。改為把完整資料切成 6 批（每批含原始、未裁減的車輛資料與表面目錄），用 `tests/catalogs_all.js` 驗證**全部 24 輛有表面目錄的車**：修正後目錄全部被原生核心接受，3BM22 沿裝甲法線射擊時沒有任何一發被「未審核表面」攔下（結果存於 `tests/catalogs_all.result.txt`；少數 miss／external／ricochet 是 armor.json 板中心不在網格上或圓弧砲塔跳彈）。其餘 20 輛沒有表面目錄的車走裝甲板路徑（第 2 項根因三）。請在記憶體足夠的電腦上用 `./build.sh` 產生的完整檔再實玩確認一次。其餘功能測試使用裁剪資料（T-72A、三號、虎式、M8、Prototype A 及其表面目錄）。
- `client/web/test` 的 node 測試：1049 通過、23 失敗。這些測試針對 `client/web/src`（本輪未修改），失敗為既有狀況（replay-v3、replay-network、aps_pose 等）。

## 驗證工具（`tests/`）

需要 Python Playwright（Chromium + SwiftShader WebGL2）與 gcc：

```sh
cd handoff/tests
./run.sh trim                  # 從 bundle/data.line 裁出測試資料 out/data.dev.line
./run.sh page                  # 產生 out/dev.html（加入除錯掛鉤 window.__tfx）
./run.sh plates_apfsds.js      # 任一測試腳本；結果印在終端，截圖存 out/
```

測試腳本：`replay_alpha.js`（回放透明）、`armor_cursor_probe.js` / `armor_cursor_grid.js`（等效厚度）、`detonation_offensive.js` / `detonation_victim.js` / `victim_skip.js`（殉爆）、`plates_apfsds.js` / `plates_apc.js`（擊穿判定）、`damage_barrel_track.js` / `replay_barrel.js` / `track_fallback.js`（損壞畫面）、`aircraft_takeoff.js` / `aircraft_landing.js`（飛機）、`catalogs_all.js`（批次驗證所有表面目錄：`./run.sh trim 車輛清單` 後 `./run.sh page` 再執行）、`full_data.js`（完整頁面的總檢查，需要約 4 GB 以上可用記憶體；`PAGE=full.html`，頁面用 `sh devpage.sh ../bundle/data.line out/full.html` 產生）。
