# T-72A：外觀細節與 Real Hitbox — 接線交付

**交付狀態：可執行的模型表面碰撞元件與審閱器；正式戰鬥尚未改用此判定。**
本分支沒有修改 main.js、enemies.js、combat.js、Rust combat、伺服器、回放控制器、音效或輪履算法。不能把審閱器的「命中」當成原遊戲已经採用這個命中點，更不能把它當成已完成的網路端權威傷害。

## 1. 這次增加的內容

在前一版候選模型之上增加車燈、鏡片、真正中空的燈圈與開放護架，前後拖曳座與空心拖環，工具箱扣件、鉸鏈、油桶端圈和加注蓋，翼子板／側裙固定件，引擎蓋大形扣件、炮塔吊環、熱護套鎖扣。新增 65 個作者零件，100 → 165；唯一上傳幾何 16,588 → 21,168 三角形。沒有增加 ERA 或未確證年份的煙幕管。

這些細節為本次原創程序幾何；尺寸、數量與具體位置仍是建模估算，不是 1979 出廠配件的完整測繪。沿用 `docs/t72a-model-review-2026-10-13.md` 的來源與年代限制。原始參考照片僅作觀察，沒有將照片、貼圖或第三方模型放進遊戲／交付包。

## 2. 幾何的單一來源

`client/web/src/collision/meshHitbox.js` 在 `buildTank()` 中捕捉真正傳给 renderer 的 Float32 頂點。13-float vertex layout 中只複製 position；不重新擬合盒子、不造凸包、不補空洞，也不拿光照平滑法線冒充真實幾何面法線。

啟用條件為程序模型的 `visual.t72a_hitbox.schema_version === 1`。當前只有 T-72A 及保留該 visual 的完整工坊匯出使用它；未全局開啟，不修改其他車型共用行為。導入模型沒有在本輪啟用。

每個唯一 mesh 一棵局部 BVH，15 個幾何模板；中立姿態 273 個實例，包含 198 節獨立履帶與 44 根支撐連桿實例。加上各實例後，該姿態總計 54,372 個三角形實例。273 是渲染 mesh 實例數，不是作者零件數。

AABB / BVH **只能剔除候選，不能把命中包圍盒當作命中坦克**。最終接觸由三角面、邊或頂點決定；輪間空隙、拖環孔、炮口內孔保留。可見表面具有接觸，不等於它具有主裝甲抗性：帆布、橡膠、玻璃及附件分開標記。

## 3. 可直接使用的 JS 幾何 API

更新完原模型姿態後使用；路徑端點為世界坐標、單位公尺：

```js
// `model` 是現有 buildTank(...) 的回傳值。
const hitbox = model.hitbox;
if (!hitbox) throw new Error('This model has not opted into render-surface collision');
const pose = hitbox.frame(); // 複製當前 body / turret / gun / recoil / MG / 輪履矩陣
const result = hitbox.querySegment(previousWorldPosition, nextWorldPosition, {
  frame: pose,
  radiusM: 0,       // 0 = 中心線線段；> 0 = 球形掃掠
  all: true,        // 按沿路距離排序的所有表面接觸，不是穿甲結果
});
const firstContact = result.hit;
// firstContact 可為 null；禁止在 null 後補一個 hull AABB 的命中。
```

返回 `point`（材料上的接觸點）、`center`（球形彈體包絡中心）、`t`（線段比例）、`distance`、`normal`（接觸法線）、`faceNormal`（真實幾何面法線）、重心坐標、零件／節點／mesh／三角形／實例 ID、材質角色，以及可用的 `armorRef`、`moduleRef`。

`armorRef` 是既有裝甲規則的**候選標籤**，不是本工具驗證的歷史厚度圖。炮塔使用粗略扇區映射；環座等需整合者明確完成映射，不能對 null 自動套上首上厚度。機槍、行走輪與履帶標記各自原模組 ID，沒有重新命名武器安裝實例。

`frame()` 的矩陣是與即時 scene node 分開的副本。舊 frame 不會隨新姿態漂移，跨 hitbox 的 frame 被拒絕；呼叫方仍應將其視為唯讀。它不是防篡改網路資料，也沒有跨程式反序列化後可直接使用的信任保證。

實際拆除可用 `setPartEnabled(partId, false)` 或 `node.hitboxDisabled=true`。**X 光、炮鏡隱藏外殼只改呈現，不應讓裝甲變得不可碰撞。** 目前沒有把斷履帶／脫落狀態自動接到這些開關；子節點、單獨履帶 instance 的移除须由物理／損傷 owner 傳遞。

## 4. 炮彈體積與時間的明確限制

`radiusM=0` 是一個時間步內的連續線段測試，不是只看終點有沒有落入箱子，所以長線段能捕捉中途穿越的薄面。`radiusM>0` 是球對三角面的面／邊／頂點連續掃掠；不是把坦克碰撞箱膨脹後直接判中。

但**球形包絡不是完整彈丸尖頭、彈長、尾翼、長桿姿態或旋轉凸體**。若要求炮彈本體也精確按其外觀碰撞，仍需在同一目標三角形上加入該彈種的凸體／彈體幾何掃掠。APFSDS 脫殼後的碰撞半徑不能直接套炮口口徑；選項中的 125 mm 只是審閱用示例，不是所有 125 mm 彈藥的通用飛行包絡。

名義125 mm炮孔是有限邊數的多邊形孔，等直徑球可能先接觸內切的孔緣；審閱器顯示的是該網格的結果，不是實車槍彈配合公差。

每次查詢使用一個**固定目標姿態**，並非運動／轉動目標全時間區間的連續 TOI。高速旋轉炮管與飛行物的共同掃掠、彎曲彈道的時間細分、延遲回溯採樣和真正脫落物體仍需要宿主接入。固定網格也不包括 normal map 的凹凸假象；真正會改 silhouette 的新幾何必須重建並更新摘要。

## 5. Native / WASM 的必要接線點

| 現有入口 | 目前行為 | 整合需求 |
|---|---|---|
| `client/web/src/game/enemies.js::Enemy.intersect` | 舊裝甲平面；未中時仍可回 hull / running gear 大箱命中 | 光改這一層不夠。正式切換時保留 broad phase，但 narrow phase 必須使用同一表面場景；空隙 miss 不可回退成箱子 hit。 |
| `client/web/src/main.js::hitSelf` 及炮彈更新入口 | 自車與他車的舊命中路徑 | 此檔由主會話持有；自車、敵車、線上玩家要一起切换，不能只修敵車外觀。 |
| `client/web/src/game/combat.js::targetDef` / Rust `TargetDef` | plates、modules、crew、turret，以及 MG 幾何設定 | 增加受信任 mesh catalog / surface role / pose binding；不要每發從客戶端送一份任意網格給伺服器。 |
| Rust `Target::posed` | 主要依炮塔 yaw 轉動舊平面／模組 | 補完整 body、turret、trunnion、recoil、MG、輪履與脫落實例姿態，使用射擊時刻而非最新顯示時刻。 |
| Rust `Work::events`, `next_kinetic_event` | 舊平面及模組盒的交點排序與重新相交 | 由同一 triangle BVH 產生外表面事件；後續散射／再相交不能偷偷回舊外殼平面。內部模組盒可先保留，但不可宣稱內部也已精確。 |
| 回放／炮鏡命中事件 | 現有 owner 負責 | 傳相同 pose ID、幾何 hash、part/triangle ID、接觸點、法線；不要在回放時重新隨機或重取當前姿態。 |

只用此元件改出第一個碰撞點，然後讓 Rust 再用舊平面計算穿透，仍會出現「第一點貼模型、穿甲路徑穿空氣」的錯誤。**因此本輪沒有直接替換 Enemy.intersect，也沒有將核心接線標成完成。**

資料匯出：

```sh
node tools/t72a-review/export_surface.mjs target/t72a-surface-review-new
```

它產生 `neutral-render-surface.json`（模板三角形＋中立姿態矩陣）和 `surface-manifest.json`（逐模板 SHA-256、來源雜湊、逐 Float32 比對與 witness rays）。這是供 native owner 審核的可讀交換資料，**不是現成的 TargetDef 擴充或已接入伺服器的註冊格式**。必須在 build / asset pipeline 從可信源產生並核對 SHA；本地遞增 `mesh:n` 及 triangle index 只在同一內容 hash 下有穩定意義。

## 6. 傷害規則不隨幾何偷換

車型、三人乘員、22 組 AZ、模組名字、武器性能、彈藥與六份核心 JSON 不變。新表面法線用於命中斜角，會影響戰鬥結果，仍須戰鬥 owner 核准與驗證。

鑄造炮塔／炮管存在真正的內外壁。接觸清單內的兩個表面不等於要扣兩次完整裝甲；宿主應依 part / material region 配對進出面，處理初始內部、貼邊、同位置多層與穿孔情況。帆布罩不能因為覆在炮盾上就繼承 gun_mantlet 的 200 mm 抗性。本輪沒有把外觀薄附件自動變成全厚裝甲，也没有新建它們的健康值或點火規則。

原版首上／首下平面候選仍記在 `docs/t72a-model-geometry-2026-10-13.json`；全面採 triangle-based 外殼後應避免舊平面重複記帳。內構模組與乘員仍為舊資料的盒／球，不在「外表面一致」這項驗收範圍內。

## 7. 复現與驗收入口

```sh
node tools/t72a_visual.mjs
node tools/t72a_geometry_audit.mjs --out=target/t72a-details-geometry-new.json
node --test client/web/test/t72a-real-hitbox.test.mjs
node --test client/web/test/t72a-model-refinement.test.mjs
node tools/t72a-review/build.mjs /new/path/T72A_RealHitbox_Details.html
python tools/t72a-review/browser_test.py --html /new/path/T72A_RealHitbox_Details.html --out /new/path/preview-evidence --display :98
# 無 X11 環境需自己啟動可用 display；Windows 桌面省略 --display，--chromium 指向瀏覽器。
```

此環境直接導向 file:// 被管理政策拒絕，因此瀏覽器驗證採 about:blank 注入同一 HTML 字節；不宣稱已驗證使用者 Windows / iOS 上雙擊檔案的載入路徑。

完整 production renderer 的畫面驗證仍用上一版 `tools/t72a_browser_review.py`。獨立 review HTML 使用同一模型頂點，但自己的簡化光照；兩種畫面的 receipt 分開存放，不混称。

本輪具體數據見 `docs/t72a-real-hitbox-results-2026-10-13.json` 與交付包 evidence。完整網路傷害／native receipts、回放、損傷脫落及異車體移植整合通過前，保持 review 分支，不能自動部署。

## 8. 算法與外觀參考

- Pharr、Jakob、Humphreys，PBRT 4e，Triangle Meshes：`https://www.pbr-book.org/4ed/Shapes/Triangle_Meshes`，用於三角形／共享邊相交的技術背景。本次 JS 元件為專案原創適配，沒有搬入其美術或整個程式庫。
- PBRT 4e，Bounding Volume Hierarchies：`https://www.pbr-book.org/4ed/Primitives_and_Intersection_Acceleration/Bounding_Volume_Hierarchies`，用於 broad phase / BVH 的技術背景。
- 外觀延續上一份來源表中 Vitaly V. Kuzmin 的 Park Patriot 留存車照片及博物館家族文字。留存車不等於 1979 原廠零件表。本輪未獲得新的原廠測繪資料；新增扣件／護架均標作估算，未複製來源美術。
