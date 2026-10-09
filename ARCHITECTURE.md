# TankForge — 架構設計(原創專案,不使用任何《戰爭雷霆》素材/數值)

## 1. 系統架構

```
 Browser                                   Server (Rust, Tokio)                     Storage
 ┌───────────────────────┐   WebSocket    ┌──────────────────────────────┐        ┌────────────┐
 │ JS shell (UI, Three/  │◄─────────────►│ gateway: auth, rooms, codec  │◄──────►│ PostgreSQL │ vehicles, materials,
 │ Babylon / wgpu canvas)│  (WebTransport │ room task (1 per match, 30Hz)│        │            │ shells, accounts, shot logs
 │ ┌───────────────────┐ │   later)       │  ├ VehiclePhysics            │        ├────────────┤
 │ │ WASM (Rust):      │ │                │  ├ ProjectileSystem          │◄──────►│ Redis      │ room registry, matchmaking,
 │ │ prediction, interp│ │                │  │   ├ BallisticsEngine      │        │            │ pub/sub across server nodes
 │ │ ShotEvent→replay  │ │                │  │   ├ PenetrationEngine     │        └────────────┘
 │ └───────────────────┘ │                │  │   └ DamageEngine (spall)  │
 └───────────────────────┘                │  └ ReplaySystem (ShotEvent)  │        Admin web UI ─► REST ─► Postgres
                                          └──────────────────────────────┘        (hot-reload data into rooms)
```

原則:**伺服器權威**。客戶端只送輸入;位置、開火、彈道、穿透、傷害全在伺服器。客戶端收到 `ShotEvent` 後只負責重建動畫,不重算穿透。
所有數值來自 JSON/PostgreSQL(資料驅動),引擎 crate 只認 struct,不含任何寫死的車輛/炮彈數據。
ECS:房間內採 Bevy ECS(standalone `bevy_ecs`,無渲染)——引擎 crate 本身為純函式/純資料,與 ECS 解耦,方便單測。
渲染:wgpu(WebGPU)為主;編輯器與早期原型可用 Three.js 作顯示層,資料與邏輯仍來自 WASM。

## 2. Rust Workspace 結構

```
tankforge/
├ Cargo.toml                 workspace
├ crates/
│  ├ shared/        ✅ Vec3, Rng(確定性), EntityId
│  ├ armor/         ✅ Material, ArmorPlate, ray/plate, LOS
│  ├ weapon/        ✅ ProjectileDef, GunDef, 穿深曲線;turret(炮塔/俯仰控制、炮口幾何);fire(裝填、射擊閘、散布)
│  ├ ballistics/    ✅ 重力+空氣阻力積分
│  ├ penetration/   ✅ 跳彈/過穿/破碎/標準化/穿透判定
│  ├ damage/        ✅ 破片生成、傳播、乘員/模組、Capabilities
│  ├ replay/        ✅ ShotEvent、回放時間軸
│  ├ sim-slice/     ✅ 無頭垂直切片(完整鏈路+測試+CLI)
│  ├ vehicle/       ✅ 載入 vehicle 資料夾 + 內容驗證器
│  ├ tools/         ✅ validate CLI(材料/炮彈/地形/全部車輛)
│  ├ physics/       ✅ VehiclePhysics(動力、自動變速、履帶打滑、地形、爬坡、轉向型式)
│  ├ network/       ⏳ 協議、快照、delta、預測
│  ├ server/        ⏳ Tokio 閘道 + room loop + sqlx
│  ├ client/        ⏳ WASM:輸入、預測、插值、X-Ray 重建
│  └ editor/        ⏳ 編輯器邏輯(Armor Viewer、驗證)
├ data/             materials.json, projectiles/, vehicles/<id>/*
├ schemas/          JSON Schema
├ tools/            gen_vehicles.py(由規格產生歷史戰車資料夾與炮彈)
└ client/web/       ✅ 可玩原型(零依賴 WebGL2 顯示層 + 暫時的 JS 模擬對照版);⏳ 編輯器/後台 UI
```
依賴方向:`shared ← armor/weapon ← ballistics/penetration/damage ← sim-slice/server`;引擎 crate 之間互不依賴(除 shared/資料型別)。

## 3. Client / Server 通訊

| 方向 | 內容 | 通道 | 頻率 |
|---|---|---|---|
| C→S `Input` | seq, throttle, steering, turret_yaw, gun_pitch, fire, weapon_sel | WS 二進位(bincode) | 30–60Hz |
| S→C `Snapshot` | tick, ack_seq, 各車 transform/速度/炮塔角/模組狀態 | 不可靠優先(WebTransport datagram,先用 WS) | 20–30Hz |
| S→C `ShotEvent` | 見 §9 | 可靠 | 事件 |
| S→C `Spawn/Despawn/Projectile` | 炮彈生成/消失(僅位置+速度,曳光用) | 可靠 | 事件 |

- 客戶端預測自己車輛:本地用同一份 physics crate(WASM)跑輸入;收到 `ack_seq` 後回滾重放未確認輸入(reconciliation)。
- 他車:插值(渲染延遲 ≈ 100ms,緩衝 2–3 快照)。
- 距離分級:近(<300m)全頻,中(<800m)½,遠 ¼;視錐外只送低頻位置。
- Delta:以 baseline tick 為基準,按位元遮罩只送變動欄位;位置量化(1cm)、角度量化(16-bit)。
- 反作弊:客戶端無法決定命中/傷害;開火需過伺服器檢查(can_fire、裝填、俯仰限制);輸入做範圍與速率驗證;ShotEvent 含 seed 可重播稽核。

## 4. 戰車資料格式

```
vehicles/<id>/  vehicle.json  armor.json  weapons.json  engine.json  crew.json  modules.json  model.glb
```
`vehicle.json`:id、schema_version、車體/炮塔尺寸、炮塔環直徑、炮塔位置、質量、質心、懸掛/履帶參數,並以 `files` 引用其他檔。
`modules.json`:每個模組 `{id, kind, center, half_extents, max_health, health}`,kind ∈ engine/transmission/fuel_tank/ammo_rack/gun_breech/gun_barrel/turret_drive/horizontal_drive/vertical_drive/radio/track(位置全部可自訂:油箱、彈藥架、引擎、履帶…)。
`crew.json`:`{role, pos, radius, health}`,角色 commander/gunner/loader/driver/radio_operator。
`weapons.json`:主炮 GunDef、炮口位置、副武器(機槍)`secondary[] = {id, position_m, weapon, mount, arc_deg}`——`weapon` 指向 `data/machine_guns.json` 的型號,`mount` 為 coax / hull / pintle(§22);`engine.json`:Engine(馬力、轉速、扭矩曲線)+ Transmission(檔位/齒比/末傳比)。
`vehicle.json` 另有 `meta`(國別、`class`、`year`、`outline`、取材與估計項目說明)與 `turret.open_top`(無頂炮塔,§23)。
範例見 `data/vehicles/proto_a/`。外部 `model.glb` 僅作視覺;**判定一律用資料中的幾何**(裝甲/模組),避免模型與判定不一致。

座標系(所有車輛資料共用):**+Z 前、+X 右、+Y 上,原點在車體中心的地面**。車體箱 x/z 置中、y∈[0,H];炮塔箱以 `position_m` 為底面中心。

## 5. 裝甲資料格式

`materials.json`(全域):`{id, kind, density_kg_m3, hardness_bhn, kinetic_factor, chemical_factor}`。
kind:rha / cha / high_hardness_steel / aluminium / spaced / composite / applied / skirt / era。因數為相對 RHA 的 LOS 等效倍率(動能與化學分開,ERA 對化學彈 ×2.5 這類差異都在資料裡)。
`armor.json`:ArmorPlate 陣列 `{id, zone, material, thickness_mm, center, normal, axis_u, half_u, half_v, curvature}`;zone 涵蓋首上/首下/側/尾/頂/底、炮塔前/側/尾/頂、炮盾、裙板。
路線:MVP 為矩形板;下一步升級為 `ArmorVolume`(凸多面體/網格,每面帶厚度與材料,射線穿過體積取進出點算真實厚度),`intersect` 介面不變。間隙/複合/ERA 以「多層體積+層間空隙」表達。JSON Schema 見 `schemas/`。

## 6. 炮彈資料格式

`ProjectileDef`:id, name, kind(ap/aphe/apcbc/apcr/apds/apfsds/he/heat/heat_fs/hesh/smoke), caliber_mm, mass_kg, muzzle_velocity_ms, explosive_mass_kg, explosive_type, penetrator_material, length_mm, drag_coefficient, penetration_curve[(distance_m, pen_mm @0°)], ricochet_angle_deg, normalization_deg, shatter_angle_deg, fuse_delay_s, fuse_sensitivity_mm。
`GunDef`:口徑、炮管長、後座、射速、裝填、旋轉/俯仰速度、俯仰極限、散布、重量、可用彈種。
穿深曲線為資料(可由管理員調),原創數值,不採用任何遊戲專有數值。

## 7. 穿深計算流程(PenetrationEngine)

```
每 1ms 步進 BallisticState(重力 + 二次空氣阻力)
  └ 對每段位移做 swept 線段 vs 裝甲(first_hit)→ 無穿隧
命中:incidence = acos(-dir·n)
  1 過穿(overmatch,動能彈):口徑 ≥ 3×厚度 → 取消跳彈
  2 跳彈:incidence ≥ ricochet_angle
  3 破碎:脆性彈 + 硬板(BHN≥350) + incidence ≥ shatter_angle
  4 標準化(動能彈):有效角 = max(0, incidence − normalization);化學彈不標準化
  5 LOS = thickness / cos(有效角);required = LOS × 材料因數(動能/化學)
  6 pen(distance) ≥ required → 穿透,否則未擊穿
穿透:residual = pen − required;出口速度比 = √(1 − (required/pen)²);殘餘能量 = ½ m (v·比)²
```
單測涵蓋:100mm/150→穿、100mm/90→不穿、80mm@60° 依 LOS 重判、高角跳彈、過穿。
待做:彈體變形/鈍化(降穿深)、APHE 引信延遲引爆、HEAT 引信靈敏度、HESH 背面剝落、間隙/ERA 多層串接。

## 8. Damage / Spall 流程(DamageEngine)

```
穿透 → 出口點 = 命中點 + dir × 板厚
generate_fragments:
   [0] 彈芯(penetrator,保留 65% 能量,沿原方向)
   [1..n] 破片:n = base + residual_mm × k(上限 max);共享 35% 能量;錐形均勻分布(半角 30°);RNG 由 seed 決定
propagate:每個破片沿射線找 最近的存活乘員(球) / 完好模組(AABB),在 frag_range 內命中即停止並扣血
   傷害 = min(能量 × energy_to_damage, 上限)(彈芯上限 ×4)
結果:module_damage / crew_damage / newly_destroyed / newly_killed
capabilities():
   炮手死或炮閂/炮管毀 → 不能開火;裝填手死 → 裝填 ×2;駕駛死或引擎/變速箱毀 → 不能移動
   車長死 → 偵察 ×0.5;彈藥架毀 → 殉爆;油箱毀 → 起火
```
所有係數在 `DamageParams`(資料),並非硬寫「命中 −300HP」。後續:乘員替補、起火持續傷害、殉爆判定機率、二次破片(爆炸類)。

## 9. Hit Replay 資料(ShotEvent)

```
ShotEvent { shot_id, tick, seed, shooter_id, target_id, projectile_type,
  muzzle_position, impact_position, impact_normal,
  armor_plate, armor_thickness_mm, impact_angle_deg, effective_thickness_mm,
  penetration_value_mm, penetration_result(miss|ricochet|stopped|shattered|penetrated),
  projectile_path[{t,pos}], fragments[{origin,end,energy_j,damage,is_penetrator,hit}],
  damaged_modules[{id,kind,damage,destroyed}], damaged_crew[{role,damage,killed}],
  outcomes[miss|ricochet|stopped|…|crew_killed|ammo_detonation|fuel_fire|engine_damaged|barrel_damaged|breech_damaged|track_broken] }
```
客戶端 `build_timeline` 產生四段:Flight(慢動作,time_scale<1)→ Impact → Interior(極慢,hull_alpha→0.15 做 X-Ray 透明)→ Aftermath。
角落視窗用同一台車的 glb 與模組/乘員位置,以 ShotEvent 的 path/fragments 動畫化;不重算物理。

## 10. 多人 Tick / Snapshot

- 房間任務:固定 30Hz 模擬 tick(physics 60Hz 子步),每 tick:收輸入 → 車輛物理 → 開火(驗證)→ 炮彈步進(1ms 子步 CCD)→ 傷害 → 發 ShotEvent → 組快照。
- 輸入含 seq;伺服器記每車 last_processed_seq 放入快照 `ack_seq`。
- 快照 20–30Hz,依興趣管理(AOI)與距離分級過濾;delta + 量化 + 位元遮罩;每 2s 全量基準快照。
- 延遲補償:炮彈本身是實體,無需倒回命中;開火時刻用玩家看到的炮口姿態做最多 ~150ms 的炮口位置回溯,防高延遲吃虧。
- 8v8 / 16v16:單房間單執行緒,車輛 32 輛 + 炮彈數百為量級;瓶頸在快照序列化,後續分片 AOI。

## 11. MVP 開發順序

1. ✅ 核心引擎 crate + 單測(armor / weapon / ballistics / penetration / damage / replay)
2. ✅ `sim-slice`:無頭完整鏈路(射擊→穿透→破片→傷害→ShotEvent),`cargo run -p tg-sim-slice`
3. ✅ `vehicle`:載入 + 內容驗證(`cargo run -p tg-tools --bin validate -- data`),規則編號見 §12
   (決定:先完成內容驗證,再做 physics 與多人伺服器)
4. ✅ `physics`:履帶車輛(扭矩曲線→齒比→履帶力、牽引上限/打滑、轉向型式、側滑、制動、坡度、地形)
4a. ✅ `weapon::turret` / `weapon::fire`:炮塔與火炮旋轉限制、炮口幾何、裝填、散布;`ballistics::range_table`:瞄準鏡距離刻度
4b. ✅ 四國歷史戰車資料(Tiger I、T-34-85、M4A3(76)W HVSS、Cromwell IV)+ `visual.json` 模組化程序模型
4c. ✅ `client/web` 可玩原型:駕駛手感、按住 C 自由視角、炮手瞄準鏡(倍率 + 彈道刻度)、射擊與特效(見 §14)
5. ⏳ `server`:Tokio + WS,單房間 2 人,輸入→模擬→快照;ShotEvent 廣播
6. ⏳ `client`(WASM):把 crates 編成 WASM 取代 `client/web/src/sim/*.js`,加上預測/插值
7. ⏳ X-Ray 回放視窗(先用方塊模型+ShotEvent 動畫)
8. ⏳ 編輯器(Armor Viewer + X-Ray)與管理後台(Postgres + 熱載入)
9. ⏳ 8v8、TDM、AOI/Delta、更多彈種/地形
10. ⏳ 地圖組(見 §15)

注意:目前的開發環境無法安裝 Rust 工具鏈,所以 Rust 程式碼尚未在此編譯;數值行為由 JS 對照版(同一套公式)的測試驗證。第一次 `cargo test --workspace` 若有編譯錯誤,請回報後修正。

## 12. 內容驗證規則(`tg-vehicle` validator,CLI 在 `tg-tools`)

載入階段:各檔 `deny_unknown_fields`(打錯欄位名直接報錯);檔案引用只允許車輛資料夾內相對路徑(擋 `../` 與絕對路徑,玩家上傳車輛的安全底線)。
語意規則(Error 會擋上線、Warning 只提醒):

| 前綴 | 檢查 |
|---|---|
| T | 材料:id 重複、密度/硬度/因數 ≤ 0、因數 > 5 |
| J | 炮彈:數值 > 0、穿深曲線遞增/非負、動能彈穿深不應隨距離上升、跳彈角 (0,90]、填藥量 ≤ 質量一半、HEAT 不該有標準化、id 重複 |
| V | 車輛:id 格式、schema_version、尺寸/質量、質心在車體內、炮塔環可放入炮塔、履帶寬度、單位壓力、功重比、模型檔存在、資料夾名=id |
| P | 裝甲:材料存在、厚度範圍、法線/axis_u 單位且垂直、zone 與法線方向一致、尺寸、中心在車體/炮塔內、id 重複 |
| M | 模組:id、血量、尺寸、**整個箱體**在車內、必要模組(引擎、炮閂)、建議模組、模組互相重疊 |
| C | 乘員:有乘員、位置在車內、缺少角色(該角色的懲罰會被略過,故警告) |
| W | 武器:彈種存在、口徑吻合(APDS/APCR/APFSDS 例外)、俯仰極限、炮/副武器位置;副武器的機槍 id 存在、`weapon` 與 `mount` 成對、射界格式(W014、W015) |
| G | 機槍表 `machine_guns.json`:id 重複、口徑/射速/初速/彈重/彈鏈/換彈時間 > 0、熱模型參數 > 0 |
| E | 動力:扭矩曲線遞增、轉速範圍、檔位數=齒比數且遞減、末傳比、倒檔 |

這套規則同時是編輯器的即時檢查與管理後台的「發布前閘門」:不通過就不能進伺服器資料庫。

## 13. VehiclePhysics 模型(`tg-physics`)

- 狀態:位置(x,z)、航向、機體座標速度 `u`(前)、`w`(側)、偏航率 `r`、檔位、換檔計時、轉速。純函式 `step(params, state, input, env, dt)`,伺服器與 WASM 客戶端共用 → 才能預測/回滾。
- 油門 = 速度桿(目標速度比例),力 = 引擎扭矩 × 總齒比 × 效率 / 驅動輪半徑,隨速度誤差飽和;降油門有引擎煞車(×0.25)。
- 自動變速:轉速 >85% 升檔、<45% 且低檔不超 80% 才降檔;換檔期間 0.5s 無動力;倒車固定用第 2 檔齒比。
- 轉向:目標偏航率 = steer × `max_turn_rate_deg_s`;差動力由再生式轉向機構提供(不影響直線力),原地轉向 = 兩側履帶反向。
- 牽引:每側履帶力上限 `traction_mu × N / 2`,超出即打滑(`track_slip`)。
- 阻力:滾動(車輛係數 × 地形倍率)、空氣、坡度、煞車;皆以「不跨零的庫侖衝量」處理 → 精確靜摩擦、30Hz 也穩定。
- 側滑:側向摩擦減速 `μ_lat·g` 對上離心需求 `u·r`;不足時 `w` 增長 = 推頭/甩尾。泥地、雪地會明顯漂移,柏油不會。
- 地形 `terrains.json`:`rolling_mult`、`traction_mu`、`lateral_mu`(road/dirt/grass/sand/mud/snow),可由後台調整。
- 與懸吊的耦合(`Env.drag_n`、`Env.load`):懸吊回報履帶下的地面坡度(進 `slope_rad`)、兩側履帶實際承重比例(每側牽引上限 × 承重比,一側離地就打滑)、阻尼器消耗的功率(÷ 車速 → 額外阻力,崎嶇地面跑不快)。
- 已知簡化:無縱橫向摩擦圓耦合、車體平面運動與懸吊姿態分開積分(懸吊只經坡度/承重/阻力回饋)、f32 的 sin/cos 在不同平台可能有微小差異(靠 reconciliation 吸收)。

後續新增的規則:`V014` 含 `min_turn_radius_m ≥ 0`;`V015`/`V016` 外觀檔存在且格式正確(有 `visual.json` 時不再要求 `model.glb`);
`M004` 對車外模組(炮管、履帶)改為只檢查距離,`M006` 重疊檢查略過車外模組;`W008` 射速與裝填時間不一致;
`W009` 瞄準鏡倍率/視野/順序;`W010` 炮口偏移;`E110` 換檔時間;`R001–R003` 地形(在 `tg-physics`)。

§13 補充(與程式一致的現況):
- 離合器打滑:低速時引擎維持在峰值扭矩轉速(`launch_rpm`),所以能在 20° 坡上起步。
- 變速箱看力不看轉速:下一檔在換檔後的出力 > 需求 ×1.15 才升檔;出力 < 需求 ×1.05 才強制降檔。上坡與泥地不會來回跳檔(有測試)。
- 倒檔用「能到達倒車極速的最低前進檔齒比」。
- 駐車煞車:放開油門且車速 < 1 m/s 自動煞住,斜坡上不會溜車;油門與行進方向相反時先自動煞車再換向。
- 轉向型式(資料 `min_turn_radius_m`):0 = 可原地轉向(Tiger、Cromwell);> 0 = 偏航率上限為 |u|/R,只按轉向鍵時會自動低速前進畫弧(T-34-85 離合器制動式 R=1.3 m;M4 受控差速器 R=9.45 m)。
- 轉向前饋抵銷履帶側滑阻力,實際偏航率能到達資料設定值;轉向會吃掉前進速度(制動式轉向全額,再生式 30%)。

## 14. 客戶端顯示層與可玩原型(`client/web`)

- **為何是 WebGL2 而不是 WebGPU/Three.js**:開發環境的 npm 與 CDN 都被擋,無法取得 Three.js 來實測,所以寫了一個零依賴的 WebGL2 渲染器(`src/gfx/renderer.js`),所有交付內容都在無頭 Chromium 實際跑過。渲染器只暴露 `mesh / texture / render(nodes, camera, fx)`,之後換成 wgpu(WebGPU)後端時遊戲層不用改。
- **渲染**:單一受光通道(GGX 高光 + 半球環境光 + 天空反射近似)、太陽陰影貼圖(2048,3×3 PCF)、程序化天空與霧、ACES 色調映射;塗裝斑駁/泥污/履帶紋路/地表都在著色器內程序生成,不需要貼圖檔。特效為 CPU 粒子(炮口焰、煙、履帶揚塵、彈著、曳光、彈痕)。
- **模組化模型**(`visual.json`,schema 見 `schemas/visual.schema.json`):`parts` 由四種基本形狀組成(`prism` 側面輪廓橫向擠出、`plan` 俯視輪廓垂直擠出並可內收、`box`、`cyl`),每個零件標 `mount`(hull / turret / gun)與是否隨炮管後座;`running_gear` 描述路輪、主動輪、惰輪、托帶輪,履帶環由這些輪子的外包絡自動生成。場景節點:車體、炮塔、炮架、炮管、左右履帶、每個輪子各自獨立,可單獨動畫/隱藏(之後的 X-Ray 與裝甲檢視直接用)。玩家自訂戰車不需要 3D 軟體,改 JSON 就有模型;要用美術模型時仍可掛 `model.glb`。
- **操作與手感**:第三人稱時滑鼠控制鏡頭,炮塔以資料中的迴轉/俯仰速率追準星,圓圈標示火炮目前指向;按住 `C` 自由視角(炮塔保持原瞄準方向,鏡頭繞車體中心,可拉近拉遠,放開後 0.2 秒回到原方向);`Shift` 進炮手瞄準鏡;車體在懸掛上的俯仰/側傾由縱向/側向加速度驅動(起步抬頭、煞車點頭、轉彎外傾、粗糙地形抖動),開炮時炮管後座、車體搖晃、鏡頭震動;輪子與履帶依左右履帶速度各自轉動;引擎聲隨轉速與負載變化。
- **瞄準鏡**:畫面圓形視野 = 資料中的真實視野(例如 TZF 9b 23°、M71D 13°),倍率可有多段(滾輪/`Z` 切換)。刻度:橫向千分位刻度(依倍率自動選 4/8/16 一格);距離刻度由 `ballistics::range_table` 依所裝炮彈計算(每 200 m 一格,數字為百公尺)。瀏覽器測試驗證:把 800 m 刻度壓在 800 m 靶心開火,彈著偏差 < 0.1 m。
- **JS 模擬對照版**(`src/sim/*.js`):與 `crates/physics`、`crates/weapon`、`crates/ballistics`、`tg_shared::Rng` 同公式,只為了在沒有 WASM 的情況下讓原型能跑;`npm test` 的數值測試與 Rust 單測是同一組情境。WASM 可用後整個目錄刪除。
- 測試:`npm test`(模擬數值)、`npm run test:browser`(無頭瀏覽器:每台車的截圖、行駛、自由視角、瞄準鏡、射擊命中、手機寬度)。

## 15. 地圖組(第一張已實作,見 §25.5;以下為原規劃)

- 做法:參考常見陸戰地圖的**佈局原則**做原創地圖——雙方出生點對稱或鏡像、三個據點呈一線或三角、2–3 條主要進攻路線、據點周圍有掩體、長短交戰距離混合;不照描任何遊戲的實際地圖。取材方向:東歐村莊與河谷、沙漠稜線、城鎮巷戰、雪地丘陵。
- 資料格式(待實作):`maps/<id>/map.json`(尺寸、出生點、據點、邊界)、`height.png`(高度圖)、`terrain.png` 或向量分區(對應 `terrains.json` 的地形 id)、`props.json`(建築/掩體的碰撞箱與外觀)。物理的 `Env.slope_rad` 與 `terrainAt` 已是這個介面。
- 順序:高度圖 + 坡度接入物理 → 掩體碰撞(車輛與炮彈)→ 第一張 1.2 km 對稱小圖 → 地圖編輯工具。

## 16. 自訂戰車:多炮塔、多炮、佈局決定裝填(`weapons.json` 擴充)

- **資料**:主炮塔沿用原欄位(`main_gun`、`mount_m`…),再加 `rack_m`(彈藥架)、`loaders_m`(裝填手席位)、`facing_deg`、`yaw_limit_deg`、`extra_guns[]`(同炮塔的其他火炮)、`extra_turrets[]`(其他炮塔,各自有 `position_m`、`ring_diameter_m`、`size_m`、`traverse_deg_s`、射界、裝填手、瞄準鏡、`guns[]`)。舊資料不用改。schema:`schemas/weapons.schema.json`;Rust:`tg_vehicle::files::{GunMount, TurretMount}`。
- **裝填時間**(`tg_weapon::design::layout_reload_time`,JS 對照 `sim/design.js`):`操作時間(彈重) + 搬運時間(彈重, 裝填手→彈藥架→炮閂的距離)`。操作時間 `1.6 + 0.22 m + 0.012 m²` 秒,搬運 `距離 × (1 + m/20) / 1.6` 秒。口徑決定彈重(`15.6 × (口徑/100)³` kg),所以大口徑、遠彈架、偏遠的裝填手席位都會變慢。
- **裝填佇列**(`tg_weapon::loading`):一個裝填手一次只裝一門炮,等最久的先裝;沒有專職裝填手時由炮手兼任 ×1.6。六炮車配一個裝填手 = 齊射後要等很久。
- **炮塔射界**(`turret::traverse_limited`):有限射界的炮塔停在邊界上,不會穿過禁區;不能指向目標的炮塔不參加齊射。
- **設計公式**(工坊用,`design.rs`):初速 `clamp(300 + 9 × 倍徑, 350, 1150)`、炮重 `0.003 × 口徑² × 倍徑^0.95`、炮塔迴轉 `clamp(42 − 10 × 座圈 − 炮重/150, 5, 40)`°/s、炮塔重 `2200 × 座圈² + 炮重`。穿深用 De Marre。這些是遊戲用的估算式,不是任何實車的數值。
- **驗證**:`W011`(額外炮塔)、`W012`(彈藥架/裝填手位置)、`W013`(射界)等規則;工坊匯出的資料夾在瀏覽器端用同一組幾何規則(`checkFolder`)先檢查。範例:`data/vehicles/fun_hexa`(三炮塔六炮)。

## 17. 測距、表尺、自動裝表

- `sight.rangefinder {time_s, error_pct, max_range_m}`(缺省 2.5 s / 5 % / 2500 m)。按鍵後經過 `time_s` 取得「真距離 ×(1 ± 誤差)」,誤差用 `tg_shared::Rng`,伺服器可重現。
- 表尺(sight setting)= 讓瞄準線低於炮軸一個仰角:`ballistics::elevation_at(range_table, 距離)`。多炮車每門炮各用自己的彈道表,所以不同口徑會匯聚到同一距離。
- 自動裝表開啟時,測距結果直接成為表尺;關閉時玩家用按鍵 ±50 m 調。

## 18. 渲染管線(`client/web/src/gfx`)

整個畫面在線性 HDR(半浮點)裡算,最後才調色:

1. **天空穹頂**(`shaders.js: domeFS`):每個方向做一次大氣單次散射積分(Rayleigh + Mie + 臭氧吸收,球形地球)再疊上**體積雲**的光線步進。雲由一張啟動時在 GPU 上生成的可平鋪 3D 噪聲(Perlin-Worley 基底 + Worley 細節 + 天氣圖)雕出來,往太陽方向再步進取得自陰影,用三個「八度」近似多次散射。穹頂貼圖每幀只重算 1/16(一塊),並與上一輪混合去噪;顯示時在前後兩輪之間交叉淡化,所以雲會飄、會長消,但每幀成本很低。
2. **光源一致**(`atmosphere.js`):同一組大氣常數在 CPU 上算出「到達地面的太陽輻照度、天空平均輻亮度、地面反光、曝光」,所以換時間(午後/正午/黃昏/清晨薄霧)時太陽顏色、天光、霧、雲的受光都一起變。
3. **場景**:GGX 受光 × 陰影貼圖 × **雲影**(同一個雲密度函數投到地面,所以看得到的雲縫就是陽光照下來的地方);高光反射取樣天空穹頂。4× MSAA。
4. **體積光**(半解析度):沿視線在高度霧裡步進,算「這條視線上的霧有多少比例照得到太陽」(被雲影切成一束一束,就是丁達爾效應);另加從太陽螢幕位置放射的光束(被雲和前景遮擋)。
5. **合成**:依深度解析地套用指數高度霧與散射進來的光,泛光,曝光,ACES(Hill 擬合)色調曲線,輕微暖色平衡。
6. **像素風格(可選,預設關)**:整個畫面改以 1/2、1/3 或 1/4 解析度渲染再硬邊放大;亮度分階並保留色相(不再有彩色雜點),階與階之間用輕微的有序抖動,強邊緣的暗側加深一條線。

- 畫質三檔(低:無 MSAA/體積光/泛光;中;高)。戰鬥中幀率偏低時先降**場景解析度**(`gfx/renderscale.js`:每 1.5 s 量一次,
  慢就降 0.1、最低 0.7,快且穩定一陣子才升回;升回後馬上又慢,下次等待時間加倍),解析度到底仍偏慢且沒手動選過畫質才降一檔。
- **特效(`game/fx.js` → 兩條路)**:彈痕/車轍貼花與曳光照舊和場景一起深度測試;**粒子**改在 MSAA 解析之後畫成**軟粒子**:讀場景深度,
  離背後物體越近越透明(不再在地面或車體上切出硬邊),前方有物體就不畫。煙以雲用的 3D 噪聲兩個八度雕出團塊、隨年齡侵蝕邊緣,
  用卡面上的假法線受光(向陽面亮、背光時薄邊透光),每顆粒子帶種子與自轉;火焰是噪聲侵蝕的小火舌,內白外紅,每張卡有柔和亮度上限。
  有浮點目標時粒子畫進**獨立的特效層**,在粒子自己的距離上套高度霧,合成時疊在已加霧的場景上(否則遠處地面的霧會把近處的煙洗掉);
  泛光也讀這一層,火光照樣會暈開。
- **裝置遺失**(驅動重設、手機回收記憶體):渲染器記住每個網格的來源資料與每張貼圖的來源圖,`webglcontextrestored` 時重建自己的程式/目標/噪聲,
  再把網格重新上傳(物件不變、只換內部控制代碼)、貼圖重新建立並對照,地圖與裝甲圖層重送;車轍視窗由遊戲端重送。期間遊戲照跑、畫面蓋一層提示,
  10 秒還沒好才出現「重新載入」按鈕,絕不自動重新載入。
- **啟動畫面**:讀資料、解開車輛模型(進度條,n/N)、建立場景三個階段,開頁就看得到,不再是空白。
- 材質:裝甲塗裝在著色器裡做(褪色、朝上的面積塵、側面雨痕、成片的掉漆與鏽、底部泥污、鑄造/軋製的微凹凸法線);行走機構是裸金屬材質(氧化鋼、磨亮的接觸面、凹處的鏽、依地形顏色沾上的泥)。
- 限制:開發環境只有軟體光柵(SwiftShader),**真實 GPU 上的幀率沒有量過**;所有通道都編譯並跑過,但效能數字要在實機上確認。

## 19. 行走機構:履帶、主動輪、懸吊、地面力學

- **履帶**(`gfx/track.js`):每一塊履帶板是一個實例(單一 draw call),沿著由負重輪/主動輪/誘導輪/托帶輪現在的位置算出的封閉路徑,以「銷到銷」的弦擺放,所以繞過輪子時會折成多邊形。上支段在支撐點之間以拋物線下垂(`running_gear.track_sag`;無托帶輪的車垂得多),下垂量隨履帶張力變化:主動輪拉的那一側繃緊、另一側鬆,油門變化時會晃一下再穩定。`link_style`:`center_guide` / `twin_guide` / `rubber_block`。
- **主動輪**:齒數由節距算出,齒對準正在嚙合的那塊履帶板;負重輪、誘導輪、托帶輪依履帶速度轉。
- **懸吊**(本節描述的是舊的 3 自由度簧上質量模型,已由 §25.1 的剛體戰車模型取代,`tg_physics::suspension` 與 `sim/suspension.js` 已刪除):
  - 負重輪站:彈簧+阻尼,用車輛資料的 `physics.suspension.stiffness/damping`(每站;換算的自然頻率夾在 0.9–2.4 Hz、阻尼比 0.15–0.7),各站的靜載依質心前後位置分配,
    靜止時車體是平的。壓到 `travel_m` 撞緩衝塊(12 倍剛度+額外阻尼);卸載時輪子掛在回彈止擋(`min(靜態壓縮, 0.45 × 行程)`),不會無限下垂;輪子只推不拉。
  - 台車(`suspension.kind` = `volute` / `hvss` / `leaf_bogie`):相鄰兩輪裝在同一支可擺動的臂上,彈簧作用在樞軸,一輪壓上凸起時另一輪仍貼地,臂擺到底才一起抬。
    `torsion_bar` / `interleaved` / `christie` 是獨立輪。
  - 履帶跨越:每個輪子站在履帶上而不是地面上:輪子正下方、加上前後一個輪距內的地面高點以約 31° 的履帶下垂角傳過來(圓輪邊緣內用輪廓),
    所以比輪距窄的坑會被履帶跨過,凸起在輪子到達前就先把輪子托起。
  - 前後斜段:由第一/最後一個負重輪往主動輪、誘導輪的那段履帶固定在車體上;地面高過這段時產生只推不拉的接觸力,車頭先被抬起(爬壕溝、土埂)。
  - 輸入:呼叫端沿兩條履帶在 `zs`(車體座標,每 0.1 m)取樣的地面高度、縱向/側向加速度、開炮衝量(以實際衝量,不放大)。
  - 輸出:姿態、每個輪子相對車體的位置(畫圖用)、兩側承重比、接地輪比例、地面坡度、阻尼功率。
  - 畫面:行走機構(主動輪、誘導輪、托帶輪、履帶迴路)掛在車體節點下,跟著車體起伏;只有負重輪依彈簧相對車體上下,履帶下支段以車體座標貼著地面。
- **越野場**(`world.js: FIELD`,x 24–110、z 300–540):真實起伏的地形網格(1 m 格點、平滑法線,平面在此挖洞),含起伏、反戰車壕、土埂與彈坑;
  `groundHeight` 同時供物理取樣,`groundHit`/`groundRay` 讓炮彈、子彈、測距打到起伏的地表。
- **車體姿態影響射擊與穩定器**(`main.js: STABILIZER / trackHull / aimTurrets`):火炮裝在車體上,車體俯仰、側傾、轉向都會直接帶動火炮與瞄準鏡。
  炮手對車體運動的認知以一階延遲追上(無穩定器:俯仰 0.45 s、方向 0.4 s),炮手只能用手輪速率(資料的俯仰/迴轉速率)修回 →
  行進間、急停、開炮後(尤其連射)火炮都會偏。`weapons.json` 的 `stabilizer`:`vertical` 由陀螺以 30°/s 的伺服另外抵銷俯仰(炮手的手輪只管瞄準),
  `two_plane` 再加上方向(40°/s)。瞄準鏡畫面也跟著同一個偏差晃動(鏡內刻度顯示火炮剩下的追蹤誤差)。
- **地面力學**(`tg_physics::terra`,JS 對照 `sim/terra.js`;土壤參數在 `terrains.json` 的 `soil`):
  - Bekker 壓力—沉陷:`p = (kc/b + kφ)·zⁿ` → 沉陷量 `z`(受軟土層厚度限制);接地壓力大的車陷得深。
  - 地形阻力倍率 `rolling_mult` 是以 80 kPa 接地壓力校準的;實際倍率 = `1 + (rolling_mult − 1) × (p/80 kPa)^((n+1)/n)`(夾在 0.6–1.8)。所以虎式在泥地比 T-34 慢得多。
  - Janosi–Hanamoto 剪切:`F = Fmax·(1 − K/(iL)·(1 − e^(−iL/K)))`,反解出「要輸出這麼多牽引力需要多少滑轉率 i」;需求超過地面能給的就空轉。履帶本身的速度 = 地面速度 +滑轉。
  - 回饋:HUD 顯示滑轉率與下陷量、履帶空轉時甩出的土更多、軟地留下車轍、履帶與輪子沾上當地顏色的泥。
- 已知簡化:縱向牽引上限仍用 `traction_mu`(與土壤的 `c·A + W·tanφ` 大致一致但未強制相等);懸吊不回饋到平面運動(不會因為彈跳而失去牽引);地面起伏是程序函數,不是真正的地形。

## 19b. 履帶與地形障礙、車內透視(後續補充)

- **履帶長度固定**(`track.js: fitLoop`):每幀先算出下支段(貼地、繞過障礙)用掉多少履帶,再解出上支段的下垂量,使整圈長度等於出廠長度。負重輪被頂開或履帶折過障礙時上支段繃緊,輪子收攏時鬆弛的部分垂在上面。
- **下支段貼著地形**:兩個負重輪之間原本是直線;地面(或障礙)高過這條線的地方,履帶就鋪在地面上。主動輪/誘導輪到第一、最後一個負重輪之間也一樣。
- **輪子是圓的**:每個負重輪的接地高度取輪下一段範圍內「地面高度 + 圓弧」的最大值,所以會沿著障礙的形狀滾上去,而不是在正下方突然跳起。
- **懸吊測試道**(`world.js: HUMP_LANES`):道路右側兩排半圓凸起。第一排左右同步(車體升沉與俯仰),第二排左右錯開(車體側傾)。
- **車內透視(O 鍵)**(`gfx/interior.js`):外殼改用透視材質(正面幾乎透明、輪廓處較明顯),顯示與損傷模型同一份 `modules.json` / `crew.json`:引擎、變速箱、油箱、彈藥架(依口徑排出炮彈)、炮閂、迴轉機/高低機、無線電,以及坐在席位上的乘員;每個部件有名稱標籤。炮塔內的部件與乘員跟著炮塔轉。自訂戰車用工坊產生的模塊與乘員。
- **虎式外形**:依使用者提供的四視圖量取比例重描(側視 75.6 px/m、垂直 78 px/m;正視 159 px/m),見 `tools/gen_vehicles.py: tiger()` 的註解。其他參考車仍是依公開尺寸表估的外形,等圖面。

## 20. 車庫與戰鬥兩個畫面(`main.js: G.mode`)

- 開場是**車庫**(`mode = 'garage'`):載具停在道路起點旁的停車坪上(`world.js: GARAGE`、`buildMotorPool` 的棚廠與雜物),鏡頭繞車慢轉,
  拖曳可自己轉、滾輪調遠近。鏡頭會依畫面比例與面板佔掉的範圍(`measureInsets`)自動退到整台車放得進空白處的距離,所以直式手機、橫式手機、桌機都看得到整台車。
- **載具配圖**不是預先做的圖檔:開場時用同一個渲染器把每台車各拍一張(`queueThumbs` → `thumbStep`,每幀一台,固定的四分之三視角、長焦),
  拷進卡片上的 2D canvas。資料夾裡新增車輛,卡片就自動有圖;工坊改完自訂車,離開工坊時那一張會重拍。
- 國別篩選、← → 換車、規格表(`hud.showSpec`:重量、功重比、極速、接地壓力、炮塔、火炮、穿深、瞄準鏡、機槍,以及外形是「照圖面描繪」還是「依公開尺寸建模」)。
- 按「開始戰鬥」才把車放到靶場起點、顯示戰鬥 HUD(`startBattle`);戰鬥中不能換車,`Tab` 或左上角按鈕回車庫(`toGarage`)。內構透視與改裝工坊都在車庫裡用(戰鬥中仍可按 O 看內構)。
- **戰鬥 HUD**:左下車況(車速、檔位、地形、滑轉/下陷、轉速條)、下方中央武器列(每門炮的裝填條;每挺機槍的槍管溫度條與彈鏈剩餘)、右下小地圖
  (`hud.drawMinimap`:地形分區、懸吊測試道、靶位——遠的釘在邊緣、車體朝向、火炮方向、視野扇形)、上方方位帶(`hud.drawCompass`:鏡頭方位,
  另標出車體與火炮方位)。第三人稱鏡頭略為下移,讓車身落在武器列上方。操作說明預設收合(H)。排版位置參考常見陸戰遊戲的慣例,樣式是自己的。
- 觸控:搖桿與按鈕只在戰鬥中出現;儀表移到上緣(左上車況、上方中央武器列、右上小地圖),訊息在搖桿與按鈕之間(橫式)或上方(直式)。新增「機槍」「內構」按鈕。

## 21. 瞄準鏡與第三人稱同一套瞄準

- 以前瞄準鏡的畫面綁在火炮上:滑鼠只是「要求」,畫面要等炮塔轉過去才動,炮塔慢的車(虎式 9°/s、M10 手搖 4.5°/s)瞄起來很鈍,而且和第三人稱手感不同。
- 現在兩個視角用同一段程式:滑鼠立刻轉動畫面(靈敏度都是 `0.0023 × 目前視野 / 第三人稱視野`,所以不管幾倍,滑鼠移動同樣距離、畫面上移動的距離相同),
  每幀由畫面中央往外找到的落點就是瞄準點,所有炮塔以資料中的速率追它。
- 瞄準鏡的鏡頭仍在炮上(炮耳軸前 0.6 m),只是轉向跟滑鼠;鏡內的密位與距離刻度畫在**火炮目前實際指向**的位置(把瞄準線方向投影到畫面),
  中央另畫一個小圈表示要求的位置。火炮追上後兩者重合,就是原本的瞄準畫面;還沒追上時刻度落在後面,超出視野時鏡緣有箭頭指出火炮在哪一邊。
- 因為鏡頭位置在炮軸上,刻度位置是純角度投影,追上後的彈著與以前相同(測試:800 m 測距裝表後命中靶心,偏差 6 cm)。瞄準鏡視角下不畫自己的炮塔。

## 22. 機槍(`machine_guns.json`、`tg_weapon::mg`、`sim/mg.js`)

- 機槍型號集中在 `data/machine_guns.json`:口徑、循環射速、初速、彈頭重、阻力係數、彈鏈/彈盤發數、換彈時間、散布、曳光間隔、100 m 穿深、熱模型兩個參數。
  目前有 MG 34、DT、SGMT、DShK、M1919A4、M2HB、Besa 與原型車用的一挺。
- 車輛在 `weapons.json` 的 `secondary` 寫每挺的位置、`weapon`(型號 id)與 `mount`:
  - `coax` 同軸:和主炮剛性相連,跟著炮塔與俯仰,用主炮的瞄準線(所以主炮裝了遠表尺時機槍會打近,和實物一樣)。
  - `hull` 車體球形槍座:在 `arc_deg`(左右半角、俯、仰)內由人手轉向瞄準點,超出射界就不射;固定前射的機槍用很小的射界表示。
  - `pintle` 車頂槍架:裝在主炮塔頂、可轉一圈,模型由程式產生(槍架、機匣、槍管、彈箱),跟著瞄準點轉。
  後兩種會依自己彈頭的彈道表(和主炮同一套 `range_table`)加上該距離需要的仰角。
- `mg::step`:按住扳機時以循環射速出彈;彈鏈打完自動換彈(`reload_s`);每發加 `1/heat_rounds` 的熱、每秒散 `1/cool_s`,到 1 就停火,降到 0.55 以下才能再打
  (MG 34 的 `heat_rounds` 250 對應操典「連續射擊不超過 250 發」;冷卻時間是估計)。簡化的熱模型,不是量測值。
- 子彈是實體彈道(重力 + 阻力,與炮彈同一個積分器),逐段與靶板、地面求交;曳光彈才畫光跡,顏色寫在資料裡(只為了辨識)。
  槍口焰、彈著土花、靶板彈孔、槍聲(合成;可放 `mg_light` / `mg_heavy` 錄音)。HUD 顯示每挺的槍管溫度、剩餘發數、換彈倒數、過熱、射界外。
- 尚未做:機槍對裝甲/乘員的傷害(等命中分析與損傷流程接上)、車長露頭操作車頂機槍的限制。

## 23. 開放式炮塔與新增載具

- `visual.json` 的 `plan` 零件多了 `hollow`(壁厚):不蓋頂、牆有內面與頂緣、看得到底板。`vehicle.json` 的 `turret.open_top`(以及 `extra_turrets[].open_top`)
  標示無頂炮塔:不產生炮塔頂裝甲板,炮塔內的乘員模型平常就看得到(不必開內構透視)。M10 是第一台;改裝工坊每個炮塔可選「封閉式/開放式」,開放式輕約四分之一。
- 新增:Pz.III J (L/60)、Pz.IV H、Panther G、IS-2 (1944)、T-54 (1951)、M10、M4A3(75)W。`meta.class`、`meta.year`、`meta.outline` 供車庫分組與標示。
- **M4A3(75)W 的車體、VVSS 行走機構與炮塔俯視輪廓是照使用者上傳的四視圖描的**(側視以圖上比例尺換算 90.35 px/m);M4A3(76)W HVSS 與 M10 共用這個描出來的下車體。
  其餘新車是依公開尺寸與裝甲表建的外形(`outline: dimensions`),比例正確但細節是簡化的,等圖面再重描。
- 圓頂鑄造炮塔(IS-2、T-54)用 `gen_vehicles.py: dome()` 疊數層內收的 `plan` 近似。

## 23b. 操作:倍率與表尺

- `Z`:瞄準鏡切到下一個倍率,已是最高倍率則回到最低(兩段式瞄準鏡就是開/關);第三人稱時切換拉近。右鍵按住拉近照舊。
- 滾輪:戰鬥中轉表尺(每格 50 m,上滾加遠),準星旁(瞄準鏡內在中心下方)顯示「表尺 xxx m」,剛改過時放大高亮;`Ctrl`+滾輪調鏡頭距離,自由視角時滾輪仍是鏡頭距離。

## 23c. 設計局(`crates/design` = `tg-design`,WASM 橋 `crates/design-wasm`,前端 `client/web/src/design`)

- 存檔是 `VehicleDesign`(`schemas/vehicle_design.schema.json`,`schema: "tankforge.design/1"`):車體/炮塔多邊形網格(面有穩定 id)、逐面裝甲(厚度、每角厚度或厚度圖、材料)、
  多層裝甲堆疊、附加裝甲、炮塔環、火炮安裝(炮耳、俯仰範圍、後座行程、炮盾)、內部模組、乘員席位、引擎/傳動/懸掛/履帶/火炮/穩定器/彈藥的**選擇**,以及編輯器狀態(不透明)。
- 伺服器不信任客戶端:`accept.rs` 拒絕任何衍生欄位(重量、防護、穿深、馬力結果……,D100)、未知欄位(D101)與過大的網格(D102),
  再由同一份 Rust 程式重算:網格封閉/自交、裝甲體積與質量、質心、前中後懸掛負荷、內部空間與模組碰撞、炮塔環/迴轉掃掠、炮閂與後座空間、俯角隨方位(`depression_by_yaw`)、
  機動(用 `tg-physics` 跑加速/極速/爬坡)、`validate.rs` 的 D001–D095 規則,最後 `compile.rs` 把設計編成與歷史車同格式的 vehicle/weapons/engine/modules/crew/visual 檔,進入同一套物理、穿深與損傷流程。
- 防護分析與試射:`trace.rs` 讓射線穿過每一層實體裝甲(入口/出口、附加裝甲、炮盾),`tg-penetration::stack` 逐層結算(跳彈、碎裂、HEAT 間隙損失),
  機率 = `1 − Φ((需要 − 穿深) / (σ·穿深))`,σ = 6%;試射靶場的命中回放依時間軸播放 彈道 → 裝甲 → 擊穿 → 破片 → 乘員/模組。
- 前端:`doc.js`(參數底形+編輯歷史重放、復原/重做)、`mesh.js`(點/邊/面操作)、`gen.js`(底形)、`view.js`(WebGL2 編輯視圖)、`bureau.js`(控制器、gizmo、對稱編輯)、
  `panels.js`(11 個步驟)、`templates.js`(空白/輕/中/重範本與自動配置)、`game/testrange.js`(試射靶場)。

## 23d. 車內透視的細節

- 炮閂與搖架(`interior.js: breechGeometry`,依主炮系統藍圖建模):搖架套筒、炮耳軸、側板、駐退/復進筒、高低機齒弧、防危板與彈殼袋(隨火炮俯仰),
  炮尾環、橫楔式炮閂、擊發機構、閉鎖機構拉桿(隨火炮後座),高低機手輪(固定在炮塔)。尺寸依口徑,與設計局的炮閂間隙規則相同。
- 乘員:CesiumMan(CC BY 4.0)蒙皮網格離線擺成坐姿與裝填手站姿(`client/web/tools/crew-prep.py` → `assets/crew_model.json`,int16 位置、int8 法線),
  制服依角色上色(車長紅、炮手藍、裝填手黃、駕駛綠、無線電手紫,對照車組佈置藍圖)。
- 彈種圖示(`assets/ui/shell_icons.png`,`game/shellicons.js`):AP、APHE、APCBC、APCR、APDS、APFSDS、HE、HEAT、HEAT-FS、HESH、煙霧彈;用在武器列、車庫規格、試射靶場與設計局彈藥配置。

## 25. 戰車物理重做、戰場地圖、戰雷式介面(本輪)

### 25.1 履帶 / 懸掛 / 負重輪 / 車體(`crates/physics/src/tank`,JS 對照 `client/web/src/sim/tank`)

力的傳遞鏈:地形 → 履帶接地 → 負重輪 → 懸掛 → 車體剛體;驅動:引擎 → 變速箱 → 終傳 → 左右履帶 → 履帶與地面的摩擦 → 車體。
車體姿態從不直接設定(沒有「車體轉向 = 地面法線」),俯仰、側傾、重量轉移全是力在作用點上的結果。

| 系統 | Rust | JS | 內容 |
|---|---|---|---|
| VehicleRigidBody | `rigid_body.rs` | `body.js` | 質量、質心、對角慣性張量(設計局由各重量項目算出 `inertia_kgm2`,否則以車體箱估算)、線/角阻尼、陀螺項、`add_force_at` |
| SuspensionSystem | `suspension.rs` | `suspension.js` | 每站彈簧+阻尼(壓縮阻尼輕、回彈阻尼重)、預載依質心分配、緩衝塊、回彈止擋;台車兩輪一臂 |
| RoadWheelSystem | `road_wheel.rs` | `suspension.js` | 每輪的 rest/compression/速度/接地點/負載;輪子站在履帶上(履帶跨越窄坑、圓輪包覆凸起);輪轉角 = 履帶行程 / 半徑 |
| TrackPathSystem | `track_path.rs` | `gfx/track.js` | 主動輪→上支段→誘導輪→前弧→負重輪→後弧的連續路徑;固定長度(上支段下垂解算,誘導輪張緊器吸收 ≤ 8 cm);履帶板依弧長與切線擺放 |
| TrackContactSystem | `track_contact.rs` | `contacts.js` | 每側 8–16 個接地點(負載由附近負重輪分配)、縱向/側向滑移、摩擦橢圓、土壤剪切(Janosi–Hanamoto)需要滑轉才有牽引;以投影 Gauss–Seidel 衝量求解 |
| TrackDriveSystem | `track_drive.rs` | `drive.js` | 左右履帶目標速度(直行相同、轉彎內慢外快、原地轉向反向)、引擎(平均速度)與轉向機構(速度差)兩個速度馬達、煞車 |
| PowertrainSystem | `powertrain.rs` | `drive.js` | 扭矩曲線、調速器、離合器打滑起步、看力換檔(換檔損失 < 75% 車速才升檔) |
| TerrainContactSystem | `terrain.rs` | `contacts.js` | `Ground` trait(高度、地面類型)、兩條履帶下的地面取樣、履帶斜段與車腹的剛性接觸 |
| Obstacles | `obstacle.rs` | `obstacles.js` | 履帶外緣(下支段、兩端弧、上支段、兩側邊)與車體箱的取樣點對地上的箱體(牆、車輛)做彈簧阻尼+摩擦接觸 |

- 多人同步:伺服器權威 `NetState`(車體原點、x/z 軸、線/角速度、兩側履帶速度、轉速、檔位);客戶端 `apply_net_state` + `reconstruct_running_gear` 重建負重輪(誤差 < 3 cm)與履帶。
- 驗收(`cargo test -p tg-physics`、`client/web/test/tank.test.mjs`,同一組情境):靜止水平且每輪有載、正弦波上前中後輪依序抬起且車體慢於輪子、
  5/15/30/極速都會俯仰且回彈後穩定、單側路緣與交錯波浪會側傾、加速重心後移/煞車前移/坡上下坡端負載大、原地轉向、高速轉彎側滑外傾、
  泥地起步打滑多、遠端重建、撞牆停止且不穿透;另有 JS↔Rust **同步比對**(`lockstep.json`:同一輸入兩邊結果差 < 2 mm)。
- 地形變形(`game/terrain.js`):16 m 分塊、12.5 cm 格;軟地依 Bekker 壓陷出車轍並在兩側堆土,壓過的車轍阻力較小;硬地只留印痕;渲染端以環繞貼圖顯示。
- 除錯:F3(重心、懸掛射線、接地點、法線、懸掛力、履帶力、速度、角速度、各輪數值表、懸吊測試場定速);設計局「懸掛除錯」(§25.7)。
- LOD:近處每塊履帶板與地面貼合,中距離簡化路徑,遠處固定迴路只捲動。

### 25.2 彈種切換(`weapons.json: ammo / ammo_count`)

- 每門炮列出歷史上配發的彈種與攜彈量(`tools/gen_vehicles.py: AMMO`),`tg_weapon::GunDef.ammo_count`(驗證 W005:數量要一一對應)。
- 遊戲(`loadout.js` + `main.js: selectAmmo`):每種彈有自己的射表;膛內一發、裝填手下一發裝「選定」的彈種;1–4 選彈,連按兩下退彈立即換裝;打完的彈種自動改裝下一種;全部打完顯示「彈藥耗盡」。
- 設計局的彈藥配置(`ammunition`)編譯時帶出順序與數量。

### 25.3 瞄準鏡倍率

全部車輛依歷史裝備(見 SOURCES);單一倍率的瞄準鏡按 Z 會提示只有一種倍率,多段的依序切換。

### 25.4 戰雷式介面(`hud.js`)

左下車況圈(俯視車形、炮塔指向、乘員點、受損模組變黃/紅,乘員數)+ 檔位(N/R/1…)、轉速、巡航、速度、地形;下方中央彈種格;右下小地圖
(戰場時整張地圖、A–J 列與 1–10 欄、雙方出發點、敵車、視野扇形與 200 m 比例);中央命中提示(擊穿/未擊穿/跳彈/擊毀)。

### 25.5 戰場地圖(`tools/map-prep.py` → `data/maps/<id>/map.json` → `game/battlemap.js`、`mapworld.js`)

- 手繪圖 → 找出 10 × 10 格線(不等寬也可)→ 每個像素依顏色歸類(水、沙、草、森林、路、岩)→ 去掉格線、標籤、坦克圖示 → 重新取樣到世界座標(1024² 地面類型、512² 高度,zlib + base64)。
- 高度由離岸距離決定:沙灘從水線緩升、內陸起伏、森林略高、岩地成丘;海床與河床隨離岸距離加深(湖較淺);道路壓平,跨水的道路變成高出水面的堤道(圖上的橋)。
- 同一個雙線性取樣在 JS(物理、射線)與 GLSL(地形頂點)完全一致;地形格網延伸到 2.6 km;水面是一張混合繪製的平面(淺處透明、岸邊泡沫、天空反射)。
- 樹:森林裡約每 7 m 一棵(冷杉/闊葉,實例化繪製 450 m 內),車體撞上會倒並吃掉一點動量。
- 涉水:水深造成阻力(隨速度增加),超過 1.3 m 引擎進水熄火。
- 敵車(`game/enemies.js`):紅方出發點各一輛,以自己的懸吊站在地面上,炮塔朝藍方;命中以 `armor.json` 的板判定(厚度、入射角、正規化、跳彈角、該距離穿深);有炸藥的彈一發擊穿即擊毀,實心彈要兩發;擊毀後起火冒煙。

### 25.6 碰撞

履帶與車體對地上箱體(靶場棚廠的牆與門、戰場上的敵車)是實體接觸(§25.1 Obstacles);低矮障礙(凸起、台階、壕溝)屬於地形,由懸掛與履帶接地處理。

### 25.7 設計局「懸掛除錯」

懸掛步驟的工具列開啟:用同一套戰車物理把編譯後的設計放在平地/12° 坡/路緣上,情境可選靜止、全油門起步、緊急煞車、坡上駐車、單側路緣;
每個負重輪標示負載 t、壓縮 %、彈簧力 kN、阻尼力 kN(面板表格),綠箭頭 = 地面支撐力、黃箭頭 = 懸掛推車體的力。

### 25.8 地形資料

`terrains.json` 新增 `gravel`(碎石)與 `wetland`(濕地)。

### 25.9 未完成

- 使用者上傳的 GLB(兩個乘員、Pz.IV G、M56)尚未放進遊戲:模型是依材質合併的單一網格(沒有炮塔/火炮/輪子分件),要拆件、減面、壓縮貼圖並補上車輛資料;
  著色器已預留貼圖模型的材質(kind 9)。授權見 SOURCES。
- 敵車目前是靜止標靶(沒有 AI、不會開火);戰場只有一張圖。

## 26. 聯機:大廳、房間、對戰(`crates/server` = `tg-server`,前端 `game/net.js`、`game/lobbyui.js`)

### 26.1 伺服器

- 只用標準函式庫(加 serde):`ws.rs` 手寫 WebSocket(RFC 6455:握手用自己的 SHA-1/base64、幀編解碼、遮罩、分段、ping/close、單則 64 KB 上限);
  `lobby.rs` 是純邏輯(不碰 socket),每則客戶端訊息經 `Lobby::handle` 回傳「要送給誰什麼」,所以整個遊戲流程可以不開網路就測;`server.rs` 把它接到執行緒上:
  每條連線一個讀取執行緒 + 一個寫入執行緒(有上限的佇列,跟不上的客戶端直接斷線),一個 20 Hz 的 tick 執行緒送快照,全部共用一把鎖裡的 Lobby。
- 同一個埠:`GET /` 給遊戲頁面(`client/web/dist/tankforge-range.html`,朋友只要開網址)、`GET /rooms` 房間列表 JSON、`/ws` WebSocket。
- 防護:每連線每秒 240 則訊息(漏桶)、最多 256 條連線、30 秒沒訊息斷線、名字/聊天過濾控制字元並限長、64 個房間上限、壞 JSON 回錯誤不中斷。
- **斷線重連**:歡迎訊息附一個只給本人的座位權杖。戰鬥中斷線時座位(車、損傷、戰績)保留 20 秒(`RESUME_GRACE`),新連線帶權杖 `hello{resume}`
  就以原本的 id 接回(權杖換新);每條連線有序號,舊 socket 晚點才發現斷線時不會把已接回的玩家踢掉。不在戰鬥中斷線則立即離開。
- **延遲補償**:客戶端每次 ping 附上次量到的往返時間,伺服器取最近 8 次的中位數一半當單程延遲;每位玩家保留 2 秒的位置軌跡。
  命中回報時,在「發射時刻 + 飛行時間 − (單程延遲 + 客戶端內插 0.13 s,回溯最多 0.25 s)」到「+0.15 s」之間找目標位置,
  與射手發射時位置的距離要和回報的射距相符(容差 15 m + 5%),否則拒收(`rejected_hits` 計數)。沒有軌跡時採信。
- **關注分級**:快照依接收者與各玩家距離決定頻率:450 m 內每 tick、1100 m 內每 2 tick、更遠或已擊毀每 4 tick(依 id 錯開);
  收到相同名單的人共用一則序列化結果。

### 26.2 規則(伺服器說了算的部分)

- 房間:建立(房名、地圖、2–16 人)、加入(自動補人少的一邊、給隊內序號)、換邊(開戰前,每邊不超過一半)、準備、離開;房主離開由下一位接手,空房刪除。
- 開戰:只有房主能開,且每個人都選了車(只收 `data/vehicles` 裡的車;自訂/設計局的車只在本機);戰鬥中加入的人直接出擊;房主可結束戰鬥,回房間看戰績。
- 命中:射手先報 `fire`(序號、炮口、方向、彈種,轉給同房其他人看),命中時報 `hit`(序號、目標、結果、命中板)。伺服器只在這發是**這個人真的打過、8 秒內、還沒算過**,
  目標在同一場、是敵方、還活著時才算;傷害由**伺服器的彈藥資料**決定(有炸藥的彈一發擊穿 100、實心彈 55),擊毀記擊殺與陣亡;10 秒內最多 16 發。
- 重生:被擊毀 5 秒後可重生(回自己隊的出發點、滿血滿彈);活著時要求重生 = 棄車(卡住、淹水),算一次陣亡。
- 移動:各客戶端模擬自己的車,20 Hz 送 NetState(`sim/tank/tank.js` 的 `netState`:位置、車體軸、速度、角速度、履帶速度、轉速、檔位,加上各炮塔方向與火炮仰角);
  伺服器拒絕出生 2 秒後超過 30 m/s 的位移(瞬移)。

### 26.3 客戶端

- 車庫右上「聯機大廳」:伺服器位址(由 tg-server 提供頁面時自動填同一台)、名字、房間列表、建房、房內兩隊名單(車、準備、擊毀/陣亡)、換邊、準備、開始(房主)、聊天。
  在下方卡片換車就是換房內的車。
- 戰鬥:其他玩家是 `Enemy`(`game/enemies.js`)加上 `remote` 旗標,放在 `G.enemies` 裡,所以擋炮彈、擋視線、擋履帶(碰撞箱)都跟電腦敵車一樣;
  畫面落後最新快照 0.1 s 內插(位置、車體軸、炮塔),快照遲到時以自身速度外推最多 0.3 s,再用 `reconstructRunningGear` 依地面放負重輪。
- 自己的炮彈打到別人:用對方的 `armor.json` 判定板、角度、穿深(和單機一樣),結果報給伺服器;伺服器回 `damage` 才扣血/擊毀。友軍不計傷害。
  別人的炮彈只在本機畫出彈道與命中火花。
- HUD:上方比分列(兩隊擊毀、自己的擊毀/陣亡、耐久、延遲)、左上擊殺/聊天訊息、名字標籤(友軍藍、敵軍紅;敵軍要在視線內才顯示)、小地圖上友軍藍點敵軍紅點。
  Enter 聊天、R 重生/棄車、Tab 離開房間、房主有「結束戰鬥」。
- 靶場也能聯機:藍方在起點(z = 0),紅方在 430 m 外迎面;戰場地圖用地圖的兩隊出發點,人多時同一點左右每 9 m 排開。

### 26.4 測試

- `cargo test -p tg-server`:SHA-1/base64/握手金鑰對照 RFC、各長度幀、分段/ping/close、拒收未遮罩與過大的幀;大廳建房/加入/換邊/房主轉移/開戰/中途加入/結束、
  快照轉送與瞬移拒收、命中只認真的炮彈與不重複、友軍不傷、擊殺陣亡、重生等待與棄車、JSON 格式;真 socket 兩個客戶端建房開戰互射、HTTP 路由。
- `node client/web/test/online.mjs [輸出資料夾] [range|coast]`:啟動 tg-server,兩個無頭瀏覽器從它提供的頁面進大廳,建房、加入、換車、聊天、準備、開戰,
  看到對方的位置、看到對方開炮、命中被伺服器扣血、擊毀與計分、重生、戰鬥中聊天、**戰鬥中斷線自動重連並保住座位**、房主結束、離開後房間消失。

### 26.5 還沒做

- 伺服器端物理:目前移動由客戶端模擬、伺服器只做速度檢查(信任客戶端);`crates/physics/src/tank` 已有同一套物理與 NetState,下一步是伺服器跑物理、客戶端預測與校正。
- 命中仍由射手判定裝甲板(伺服器驗證這發存在、時間、對象,並用延遲補償檢查射距合理);伺服器重算彈道與裝甲需要把 Rust 的 ballistics/penetration 接上地圖地形。
- 沒有帳號、沒有 TLS(要公開架設請放在反向代理後面用 wss)、樹倒與地形車轍不同步、單一伺服器程序。

## 24. 接下來的順序

1. (已完成第一版:§25.5)地形系統與第一張地圖;接下來是建築/掩體與炮彈對掩體的碰撞、敵車 AI。
2. 實體炮彈(有尺寸的彈體、掃掠碰撞)+ 命中分析回放:未擊穿/跳彈/擊穿,擊穿後以動畫標出受損模塊與受損程度(Rust 的 penetration/damage/replay 已有資料流);機槍傷害一併接上。
3. 從車體開始的設計器:內構(引擎、變速箱、油箱、彈藥架)與乘員席位配置、半開放式炮塔;乘員模型的裝填/開炮動畫。
4. 其餘參考車照圖面重建(需要上傳四視圖);年代再往前後補(戰前輕戰車、戰後主力戰車)、防空車。
5. (已完成第一版:§26)聯機大廳與對戰;接下來是伺服器端物理與命中重算、WASM 取代 `sim/*.js`。
