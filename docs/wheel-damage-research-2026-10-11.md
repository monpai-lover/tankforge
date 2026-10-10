# TankForge：爆胎與單輪損傷調查

日期：2026-10-11。狀態：唯讀調查與實作建議，**尚未實作**。

檢查工作樹：`C:/Users/24908/.codex/scratch/tankforge-suspension-tracks-v7`。調查最後取得的 HEAD 為 `83e2398f347941f649f83887d5c46fcd9304dd98`；B 的 Task2 與回放工作持續修改同一工作樹，因此下述函式／路徑比行號可靠。本次僅新增本文件；沒有修改 runtime、原始車輛／引擎／裝甲／武器資料、GLB、B／H／R 文件，沒有提交。沒有啟動瀏覽器、HTTP、CDP 或 Playwright，也沒有重建 native／WASM。

## 結論與範圍

輪式車需要逐輪的**充氣輪胎**與**鋼輪／輪轂總成**損傷；履帶車需要逐片輪盤的**實心橡膠輪緣**與**鋼輪盤／輪轂**損傷。履帶車橡膠輪緣沒有胎壓，不能套用爆胎動畫或輪式車的壓力曲線。

最小完整版本建議採用「**保留破壞輪轂與殘片的已損毀總成**」：被擊毀的輪盤不再有完整圓形承載面、不傳遞驅動牽引，剩餘輪轂／殘片僅在其真實位置碰地時承載或拖曳；畫面顯示塌胎、破裂輪盤或外露輪轂。原本分配給該總成的質量仍在該軸位內，避免假造飛走的輪子、未扣除整車質量或突然改變車體動量。這是明確的「attached destroyed assembly」縮減模型，不宣稱已實作輪子脫落。

可安全拆出的輪盤之後可增加有限強度輪轂接頭與獨立碎落剛體，但必須有接頭定義、質量／慣量拆帳與碰撞。單純隱藏輪子再生成無碰撞的掉落特效不算物理脫輪。本輪也不能把單輪損壞改寫成整側履帶斷裂或全車速度倍率。

本功能應在 B 的有限輪盤接觸／負载閉合完成後接入，不能從目前尚未完成的 Task2 分叉重寫其算子。模組註冊、命中幾何與權威機械狀態可先建立，但輪盤損傷的負載驗收必須使用最後通過 B gate 的接觸路徑。

## 現有機制與可重現證據

| 接點 | 目前行為 | 本需求的缺口 |
|---|---|---|
| `client/web/src/sim/wheeled/wheeled.js::wheelsFromVisual` | `visual.running_gear.axles` 展開成 right 全部、再 left 全部；保存 side、x/y/z、r/w、steer、driven | 沒有穩定 wheel ID、axle index、胎／輪轂健康或機械模式 |
| 同檔 `newWheeled` | 每輪有 L、omega、spin、steer、grounded、load、slip、fx | 本來就有獨立輪速，適合增加逐輪物理狀態，不需要用 side 平均替代 |
| 同檔 `stepWheeled` | `t.broken[side]` 只令該側 `z === min(z)` 的最後一轮 `off` | 任何位置命中都損壞後輪；没有爆胎；仍用原 r、mu、muL、rolling、共同 wheelInertia |
| 同檔 `netStateWheeled/reconstructWheels` | 只傳車體、side 平均 rim speed、rpm/gear/steer；遠端按原 r 把每輪放到地面並重建轉動 | 單輪空轉、塌胎、損毀輪／修復中間態不能重播；reconstruct 不讀 broken |
| `client/web/src/game/vehicle.js::wheelPose/_press` | pose 只有 lift/spin/steer；變形 footprint 用第一輪的 r/w，belt 用 `omega*original r` | 損傷半徑／接地寬度／輪模式沒有一路傳到繪圖或地形壓痕 |
| `client/web/src/gfx/tankmodel.js::tyreGeometry/wheeledGear` | 程序輪胎、輪盤、輪轂合成一個 mesh；imported wheel 按 `mount=road_wheel,side,index` 掛載；只有 lift/yaw/pitch | 沒有獨立胎／鋼件 damage role；整個 node 縮放會一起壓扁鋼輪轂 |
| 履帶 `stationsOf`、`gearFromModel`、Rust `GearGeometry::from_visual` | 同 z 輪盤去重成一個 q station，volume proxy 保留全部盤；有限 profile 有 `road:<source index>` | station ID 不是實體輪盤 ID；移除一片盤不能刪除共用的 q／另一片盤 |
| `client/web/src/sim/tank/trackPrimitives.js::runningGearWheelProfiles` 與 Rust `track_primitive.rs` | 程序輪盘已有 sourceParts、材料 role、有限裁槽实体与 entry ID；bearing 使用實際裁切面 | 可增加按輪盤狀態選擇的 survivor parts；不可退回整站圓盤 proxy |
| `crates/damage/src/lib.rs::ModuleKind/Module` | 有 Track，沒有 Tire／RoadWheelRubber／WheelHub；Module 只有 box、health、weapon metadata | 缺逐輪部件種類、binding、真實命中 collider |
| `crates/combat/src/lib.rs::Target::new/posed/Work::events` | Track 由 module.center.x 推導 side；module 用只繞 yaw 的 AABB/OBB；所有模組一次排交會事件 | 輪位升降、轉向、spin、塌胎與破損幾何都不進入 narrowphase |
| 同檔 `caps/start_repair/advance` | side Track health 派生 track_left/right；F 修到60%，固定 repair_targets，不修 ammo rack；死亡／乘員不足取消 | 可以沿用健康／工作量規則，但健康回復不能直接把輪子膨脹／完整盤插入地面 |
| `crates/server/src/server.rs::load_combat` 與 browser `combat.js::targetDef` | 只向 TargetDef.visual 傳 mg_anchors/mg_variants | 即使只改 Target::new，也看不到 running_gear／imported 輪部件來源 |
| `crates/server/src/lobby.rs::State/apply_shot/advance_combat` | 伺服器決定模組健康／修復，車體 motion 仍由 owner 提供；只做位置跳躍檢查 | 輪機械拓撲必須由伺服器保有；不能宣稱已變成 server-side wheeled physics |
| `client/web/src/main.js` 驅動入口 | 每幀由 caps.track_left/right 重新寫 `G.veh.t.broken` | 損傷、修復許可與實際機械交接不能塞進這個瞬時覆寫 |
| `client/web/src/game/enemies.js::follow/pose/applyCombat` | 遠端先 applyNet，靜態敵車主要重建 pose／cstate/caps | 新 wheel 狀態要接玩家、敵車、靜態靶、遠端、死亡車與回放；不能只改玩家 step |

### 已執行的 CPU 探針

1. `node --test test/wheeled.test.mjs`，在 `client/web` 執行：**8/8 PASS**，約1.17秒。包含站穩、加速／步長、轉彎、煞停、倒車、泥地與单轮越凸起；這是健康輪式車基準，沒有驗證新增輪損傷。
2. 全 data wheel inventory：8款輪式車都只有 `wheels_l`／`wheels_r`，kind=Track，各90 health。没有逐輪 damage module。
3. Puma 平地站穩3秒後設 `t.broken={1:true,-1:false}` 再走一步：right 四軸中 z=2.11、0.72、−0.76仍承载，只有 z=−2.12 load=0／grounded=false；8輪原 r 都仍是0.52m。以相同 netState 重建 remote，**8輪全部 grounded=true**。
4. Puma 輪間点 `(x=.975,y=.52,z=1.415)` 位於 wheels_r box，却距最近輪胎外圓仍有 **175mm空隙**；M8 对应轮间点 `(x=.965,y=.47,z=.535)` 的空隙为 **545mm**。这些不是橡膠實體內的點。
5. 用目前已存在的 WASM、原始 Puma target、KPVT bullet，從 `(3,.52,1.415)` 朝 `(-1,0,0)`、20m range 射穿上述空隙：報告仍傷到 `wheels_r` **56.0000076 health**，90→33.9999924；第一 impact x≈1.11就是整側 box 外緣。這證明目前真實戰鬥路徑把車輪間空間當作轮模組，而非只存在於畫面的問題。沒有為本探針重建 WASM。
6. Tiger E 與 Panther G 每侧**16輪盤／8 q stations**，HVSS每側**12輪盤／6 q stations**；每個 station 有兩片輪盤。單盤損壞與整軸損壞必须明確區分。

### 8款輪式底盤

| 車輛ID | 逐側軸數 | 原 r / w（m） | 輪部件來源 |
|---|---:|---|---|
| `de_sdkfz234_2` | 4 | .52 / .27 | 程序；前兩軸與後兩軸反向轉向 |
| `us_m8` | 3 | .47 / .24 | 程序；前軸轉向 |
| `uk_cmp_portee` | 2 | .47 / .30 | 程序；前軸轉向 |
| `xp_kda35` | 2 | .59 / .45 | 車輪為程序；model.json僅含借來的 gun/barrel，不能因 bundle.imported=true 就當作 imported wheel |
| `xp_w78` | 2 | .59 / .45 | 程序 |
| `xp_bmp_k64` | 4 | .58 / .43 | 48個 imported road_wheel parts，每輪6個材質部件 |
| `xp_bmp_k64_atgm` | 4 | .58 / .43 | 借用 BMP-K-64 的 hull／road_wheel |
| `xp_bmp_k64_kornet` | 4 | .58 / .43 | 同上 |

BMP-K-64第一個left wheel的只讀量測（以可信 axle centre `[-1.304,.58,2.04]` 為原點）：texture3的徑向範圍0.2616–0.5842m、texture4為0.5213–0.5842m；texture1等鋼件最高徑向約0.2903m。材質3／4是可檢查的胎／胎紋候選，**不是可僅靠texture index、metal值自動推定的通用role規則**。原 .58m contact radius與mesh外徑約4.2mm差距是既有工程代理，不得把它改寫成已認證的原GLB精確接觸。

## 實作選擇

| 路線 | 代價／結果 | 判斷 |
|---|---|---|
| 分開胎與輪盤的保留破損總成；真實 collider、逐輪contact與F交接 | 可保留原資料和穩定 q；需要damage-role manifest、物理 profile、權威機械狀態及修復支撐 | **推薦第一版**，可完整覆蓋爆胎与輪盤破坏 |
| 每輪有限強度接頭＋真正脫落剛體 | 最完整但需要拆質量／慣量、雙向碰撞、動量轉移、碎落網路與修復装配；目前原模型資料不足 | 第二階段；有明確支承接頭資料的輪件才啟用 |
| side健康降低速度，輪node縮放／隱藏 | 原輪間假hit、完整接触、全側误傷、遠端不一致都保留 | 不满足需求，不作相容fallback偽裝成逐輪功能 |

## 共用描述符、模組與身份

新增一份可信的 wheel descriptor，Rust／JS共用相同項序、數值與profile版本。建議純資料／幾何介面落在 `crates/combat/src/running_gear_damage.rs`、`client/web/src/sim/runningGearDamage.js`；procedural source由B的 finite source parts派生，imported source由新增、hash固定的supplemental manifest取得。**不要修改原GLB或原vehicle/engine/armor/weapons/modules/visual檔來湊出新HP／材料數值。**

wheel ID 建議為 `wheel:R:axle:0`／`wheel:L:axle:0`（轮式），`wheel:R:road:0`／`wheel:L:road:0`（履带盘，數字為原 visual.wheels source index）。descriptor另外保存 `stationIndex`、`sourceEntryId`、原 x/y/z/r/w、材質parts、原node binding、是否為充氣胎、原rolling radius／慣量來源與profile hash。wheel ID不以z四捨五入、sort後下標、臨時mesh下標或vehicle名推導；同樣底盤在換砲塔後保持ID。源陣列若將來改序，必須由explicit ID migration保持身份，不能静默认成同轮。

模組按canonical wheel order一次註冊、一次回傳：

- 轮式：每輪 `:<tire>` 的 Tire 模組、`:<hub>` 的 WheelHub 模組。
- 履帶盘：每個有實心橡膠的盤有 `:<rubber>` 的 RoadWheelRubber，另有 `:<hub>` 的 WheelHub；全鋼輪沒有虛構橡膠模組。
- 同 q station 的各盤仍是不同ID；真正 axle／arm／suspension接頭若另需損傷，使用另一个共有模組與明確binding，不把hub destroyed偷換成整個station不存在。
- 每個module保留external=true、wheel ID／part-role binding；kind加入 `crates/damage/src/lib.rs` 和schema。Target維護binding索引，不用health陣列下標作永久ID。

沿用weapon_damage註冊樣式：在 `Target::new` 完成共同派生，`combat_target`回傳normalized `modules_def`／wheel descriptors／binding_errors；`Combat.prepare/bind`一次採用。server `load_combat`、browser `targetDef`、design compiler／custom target都要提供所需running gear與source manifest。註冊必须**冪等**：normalized bundle再次註冊不追加第二套；缺part或manifest hash不符返回binding error，不能聲稱精確命中已開啟。

### 舊整側wheel module相容

`wheels_l/r`原records可保留在source與舊array位置，但新wheel descriptor成功綁定後，把它们登記為**retired broadside aliases**：不再進入direct／fragment／blast碰撞、work／repair計數、side Track能力或新事件。新增wheel modules append在既有stock／weapon模組之后，順序在native與WASM一致。source舊records未變，不表示還有另一個实体承載健康。

舊存檔只有side健康、沒有hit-wheel資訊時，不可能精確還原哪輪損坏。明確migration：full-health side不產生新輪損傷；任何非full-health side如有原hit location／history，選其最近實際part；否則使用已记录的legacy行為，選同側rearmost wheel的hub，標記 `legacy-inferred`。保留該side原health ratio到這一個選中module；0 health轉為destroyed-hub，部分健康保留部分損傷／原F資格，不能把它洗成full health。無歷史證據時不額外推定其充氣胎已破裂。damage／repair targets按ID一次映射、產生新revision，alias本身不再收傷；不把90hp剩餘值平均灑到四輪，亦不讓同一shot同時傷alias和實體輪。新的registered state只有逐輪真實結果，UI side摘要由子輪derived。

新HP、橡膠耗能、輪轂破壞功與摩擦曲線都是supplemental工程profile；原side90hp不是每輪／輪轂的歷史實測值。可作相容校準起點，但要保留estimated標籤並驗證小口徑打胎與輪轂命中的不同結果。不能把Track的固定20mm absorb直接套到充氣胎，或因同一彈能量而每個part都扣一次完整energy；彈體沉積／碎片帳沿用另份炮彈調查的共同契約。

## 實際命中幾何：本功能的前置依賴

新增module的box只是broadphase与status縮圖。wheel narrowphase必须命中**最後實際顯示的輪／胎part**，包括source的guide carving、轮位 q／lift、轉向、spin、塌胎、破損variant及所在車体完整基底。

程序輪盘直接消费 B 已有 sourcePart／carved survivor triangles；程序輪式胎把現有 `tyreGeometry` 的相同生成primitive拆成明確胎、胎紋、rim、hub、nuts roles，保持健康外觀與來源收據。不要為碰撞另手抄一個通用圓盤。Imported輪使用 `mount/side/index` 加可信role manifest中的part identity／triangle group；BMP variant先resolve shared來源。manifest绑定source hash與part哈希，不能用工坊过滤後的list index，亦不能用metal／rough猜橡膠。

`Work::events` 對有wheel binding的module，先通過box/BVH，再使用有限solid／實際triangle窄相位；普通模組仍走既有OBB。`contains`、outside-blast距離／fragment交會也需同一變體的幾何介面，不能direct hit精確、blast卻继续傷整側空隙。來源若不是封閉实体，可以認證surface ray hit與surface distance，不能宣稱已證明watertight volume。每次連續穿越同一part的進／出面只生成一個module interaction；炮彈可物理穿過兩個不同輪part，但retired alias不計一次，BVH重複三角面亦不重扣傷。

動畫／物理不能把碰撞回退到原中性box：native hit resolver接受的是由server已接受pose和權威mechanical revision重建的part變換。owner可提供有界wheel pose sample，不能提供被打中的任意wheel ID、health、part任意矩陣或任意頂點來覆寫權威。記錄每次shot的descriptor hash、epoch／damage revision、motion sample seq、wheel-part ID、actual contact point，使hitcam與檢視回放可凍結同一幾何。

現有server只有位置trail，`WireShot`只有射線／yaw；移動轮命中不能假裝已有完整歷史回放。最小接點是在既有accepted motion history中保存可信wheel sample，按現有rewind時間選同一幀；缺提示用公開的canonical／舊range fallback並標記pose品質，不把fallback結果標成精確轉向／懸吊命中。若射線／歷史幾何契約未實作，這個功能不得宣稱線上個別輪命中已完成。

## 權威機械狀態與生命周期

模組health與**目前機械狀態**分開。Rust combat／server產生逐輪狀態，離線同一WASM核心產生；`Caps`只提供UI／武器／引擎readout，不能每幀覆寫機械topology。

每個entity保有共用 `epoch/descriptorHash/mechanicalRevision`，每輪canonical slot保有：wheel ID、active tire/rubber variant、active hub mode、damage feature seed或part mask、repairPermit／repairGeneration、最後handover seq；profile中有預先有界的支撐半徑／survivor幾何。充氣胎可有derived `pressure01` proxy，实心橡膠只用rubber-loss variant。這些有限枚舉／proxy為工程狀態，不冒稱真實kPa或材料斷裂應變。

第一版可以在健康跨閾值時切換可重播的充氣／漏氣／flat profile，不必立即增加連續漏氣solver；如增加漏氣，時間常數与transition start由權威clock定義，server的busy条件也要包含漏氣，固定步和重連用同一解析進度。不得只讓畫面慢慢洩氣而物理半徑仍是原值。

真正health下降導致新增damage mode时，revision单调增加；同輪重複擊毀不再重建或清spin。死亡／J取消repairPermit但保留破損車輪的接地／拖曳；重生新epoch。相同幾何工坊換頭按wheel IDs轉移active modes／修復targets／phase anchors／支撐预算，保留軸位及速度；新質心使用B既有origin／COM變換，清contact warm-start。不同底盘／parts hash明確重置，不按车型家族名兼容。

## 轮式车物理与模型

`stepWheeled` 每輪取active profile，使用自己的 `supportRadius/rollingRadius/contactWidth/muLong/muLat/rollingDrag/driveConnected`。必须在下列所有位置替換原 r／共同參數：mount→ground的L、contact P、rim speed與slip、反作用力矩与inverse mass、braking lever、travel、遠端重建、obstacle輪輪廓与地形press footprint。

充氣胎flat後仍可能在塌陷胎／rim上承载，不應一律 `off`。降低support radius讓該角落的懸吊／車体真实下沉；使用同一geometry profile限定塌陷幅度、接地宽度、側壁鼓出，輪盤／輪轂尺寸保持。更低的long／lat grip、更高的滾阻令拉偏、制動距离與可達速度從力／力矩自然改变；不另加全車或整側speed multiplier。

輪轂模式為retained-destroyed时，只剩manifest指定的survivor hub／殘片支撑；完整輪胎／輪盤接觸不再参与。此輪driveConnected=false，無正常wheel traction；stub触地只施加对其实际patch的法向与耗能拖曳。其他輪繼續用自己的健康参数，載荷由原spring／body force的力矩平衡重分配，不按比例人工複製原失去輪载荷。

保留現有引擎／gearbox曲線与总torque预算。原代码是equal driven-branch torque工程近似，並没有真正open/LSD differential solver；新增damage不應宣称已有精確差速器故障模型。最小相容方案保留原branch份额，破損断开支路失去的输入不得白送给其它輪，將损失列为bounded dissipative driveline loss；rpm统计不使用被断开輪的无约束假空转。空中但连接正常的輪仍能空转。新overrides不能改原horsepower、ratios或车体mass。

wheelInertia目前由first tyreR给所有轮。新profile需逐輪I与明确来源；健康相同尺寸继续原值，輪胎折叠不凭半径平方瞬間抹掉转动能。模态切換保留body pose/v/w、L/omega/spin，失去spin能量以有限drag耗散；不要为了稳定直接把omega=0。若需要原始wheel unsprung mass动态化，其质量要从原hull assembly拆出；这不是新增一个完整原车质量。

可用有界有限接觸proxy延續目前輪式工程模型，但新的flat／hub proxy必须由显示survivor幾何標定、與其地面支持范围一致，且清楚標示imported proxy边界；精確shot collider仍是最后实际mesh。至少检测轮宽左右及真实塌胎patch，不能只改r而让钢rim／塌胎穿地。大石／墙接触的 `tm.collide` 也要采用active轮尺寸，保留独立车腹路径。

`wheelPose`追加read-only variant／pressure proxy／support radius／接地法向等必要状态。程序胎把rubber和steel分node；胎变形必须**在轮spin後沿当下接地法向变形**，不能把整个flattened胎mesh跟spin轉成每圈碰地／腾空的椭圆轮。轮轂正常轉動，接地flat保持朝地面；修正变形后的normals与bounds，颜色、阴影、X-ray、hitcam用同一variant。

Imported source buffers與`partMesh`共享cache不可就地改写。新增各instance或不可變damage-variant资源，并保留原texture/normal/UV；弱引用或refcount明确释放，renderer context restore复用最新variant源。现renderer.mesh只做STATIC_DRAW，没有通用dynamic vertex updater；需明确增加bounded更新接口／CPU variant上传，不能每帧free/recreate大型BMP胎。CPU hitmesh／render变形函数必须相同，BVH按variant更新或refit。

## 履带车单轮：与B的接触及质量一致

1. Damage wheel以原 `road:<index>` 选择同side单片profile。实心rubber受损可从该part的可重播损失sector／survivor variant改变承载面；rubber完全失去时仍保留真實钢盘，不變成轮式flat胎。WheelHub destroyed移除完整盘的bearing功能，留下明确retained hub geometry。无rubber的steel wheel直接测试钢盘／hub损伤。
2. 更新 B 的实际sourceParts／`wheelBearingParts`、有限profile、clearance、上下路线support与mechanical active set；cache key必须含damage variant revision。不能只在gfx隐藏盘、trackPath仍沿原盘绕行并复制原载荷。
3. 保留q/qv数组、轴位、bogie heave／rock映射与 `RunningGearModel`的总质量。单片盘失效时同轴另一片可以承载；必须根据实际x宽度／导齿走廊与survivor盘接触求负载，不把整站关掉，也不能让失去盘的轴向半宽仍提供full station disk支撑。两片盘都失效时该station只有剩余hub真实碰地／碰鞋可承载，弹簧仍推动原轴位和被accounted总成质量。
4. 健康track保持同一N、固定pitch与原鞋网格；重新求上／下span、sag／idler和B的非負机械乘子。单轮损伤**不自动伤Track模块／开整侧链**。失去support放大自由span，邻轮载荷／q自然改变；無mechanical load的贴地shoe仍是N=0／traction=0，不能借几何贴地充当承载。
5. broken-track bare-wheel路径也必须用每盘survivor geometry；不能仅在healthy闭环路径处理轮损伤，`supportUnder`／`syncSuspensionPose`／`trackContacts`仍以原r给破带裸轮承载。真正轮盘已经碎裂则不能保留完整bare wheel圆／侧向摩擦。
6. B的wheel／arm translational inertia、耦合mass operator和belt等效惯量继续互易。輪損傷不增加一份独立road-wheel spin inertia，又让同一份mass继续留在belt；retained毁坏模式不改q质量／不清qv。摩擦、法向與路线反作用必须走最后B共同bundle，不能回到旧WheelBlend复制N。
7. 正常radius改变需要连续spin phase：不能把大累积travel直接除以新r而瞬間跳角。每轮保存damage-revision时 `travelAnchor/thetaAnchor`，后续用deltaTravel／active rolling radius增量；材料feature角和对应 `Js`导数同源，正常健康轮沿用B原公式与original r。retained、断开的hub可保存损毁时角度并不再随belt旋转；不能讓其还产生该轮的传动接触。未增加独立角惯量的限制要保留在文档。

删除承载盘只会减去碰撞限制，damage瞬间原已接受销点通常仍可以作为**无幽灵载荷**的短暂安全几何；随后同一个B有界求解依据survivor重建span。不可行不能通过伸鞋、扩张idler范围或伪造原盘contact解决。继续使用B的可行缓存／guard和明确诊断，仅在当前survivor／terrain约束有效时使用缓存；全盘损失等极端情况也需有限恢复、真实车腹支撑和无牵引。若未来要在单轮破坏后模拟脱轨，必须增加独立的可信几何／接头失效判据、权威topology事件与Track修复契约，不能按「有一个hub destroyed」一律开链。

### 真正脱轮的后续扩展边界

只在轮件独立、轴颈和attached parts归属已知时允许detach。新增有限joint strength／累计损伤，可信hit／joint impulse超过profile强度触发一次权威break。释放的刚体初始线速度为body point velocity＋qv支承速度，角速度包含原spin；移走的wheel mass／inertia从同station与整车组合中准确扣除，剩余轴／arm保留原部分，不重复计入。joint break impulse在两体间等大反向，只有真实冲量才添加；无故弹飞不合格。

掉落輪必须有有限实体terrain／obstacle／车体接触、摩擦、CCD或有界子步、sleep／wake；网络传权威detach epoch／revision与独立rigid pose关键帧。否则选择上述retained模式並明示。imported大件如不允许安全拆出，不删原shared source、也不以模糊glb部件边界硬拆轮子。

## F 修复：许可与真实装回分离

沿用F按住入口、服务器计时、60%健康cap、固定repair_targets、乘员限制、禁止弹药修复以及J放弃。一次repair选中的tire／rubber／hub各自计算work，retired side alias不再重复计数。只修tire不会令已毁hub同时恢复，反之亦然。

`repaired`把选中module健康恢复到.6时，仅授予相关wheel的new repairGeneration与target profile；active flat／broken几何、支撑radius和失去traction继续保留。不存在「health从0变正就在下一frame恢复完整wheel」的即时翻转。

用B已批准的**逐qi轴位支承杯／共同有界升降梁**扩展wheel装回：目标升程从新轮／胎真实插入包络与当前轮轴／terrain gap求出，旧毁坏hub仍在力学bundle中。轮式模型没有B的q mass子系统，支承需作用在该轮 mount／L与body的共同运动契约，不能直接改L、body.y或速度；若将wheel unsprung质量拆出才能使用同样轴杯算子，质量／惯量从原assembly中拆账。

以明确的行程、速度、合力和positive-work上限逐步建立新胎／盘所需地面间隙；支撑力不进入普通wheel traction／地形压痕。轮橡胶恢复、同轴两片盘、只修一侧轮、胎和hub同修必须按共同几何目标验证。wheel repair回调保留body/q/qv/omega与其它轮模式／phase；支撑过程中实际brake与失去traction保持。

Owner在新survivor的实体地面／鞋／邻盘净空与B闭环通过后，于同accepted motion包提交按wheel IDs的 `wheelRestoreReady`，携带epoch、mechanicalRevision、seq、各wheel repairGeneration和可信geometry pose。服务器独立验证当前serial／存活／修复完成／crew／permit／generation及source geometry，原子消费所请求wheel许可，revision增加一次；仍有破带的该侧轮装回不会擅自闭合链，链用原B自己的closeReady。

同轮任一新的有效health损失（包括health仍>0）取消其permit和支撑，重新generation；死亡、J、失去足够修复乘员同样取消。别的模块非致命hit沿用既有repair rules。ACK后本地当前位置若已不满足新包络，保留有界pending／安全旧physical mode与diagnostic，继续请求有效交接；不得吸附／瞬移，也不能反向改server已经接受的revision。旧客户端缺扩展的restoration只可走明示canonical/static检查回退，不能永久等待它永远不会发送的ready。

## 网络、静态车、工坊与回放

- `Damage/Status`和late join/reconnect关键帧带server-owned mechanical wheel state，不只带module health。owner state包的`wheelPose`只作有界几何提示，不能覆写state／permit／health。tracked使用B的q顺序；wheeled传精确canonical count的L、omega、连续spin或angle anchor、steer、variant revision，而非side mean wheel speed。
- 上限来自可信descriptor；目前所有source的road wheel entries最多32个（`de_aufkl_panther`等），第一版可取硬上限64个、每entity可选wheel pose raw JSON≤8KiB，并计入B既定rg≤32KiB／整入站message≤64KiB总额。不是每轮各给一份额度；多entity出站关键帧也須分批。count／ID不一致、非有限值、越descriptor派生的L／steer／spin speed界、连续phase／travel anchor超过已声明f64范围、未知profile、旧epoch／revision、raw扩展过大均拒绝提示。合法旧motion保留；optional坏提示不能令整包解析失败。不能容许客户端送任意顶点／triangle数来绕过data binding。
- 遠端只在epoch、descriptor、mechanicalRevision、各wheel mode一致时插值；mode改变用权威关键帧切换，不mix健康胎与碎hub。仅有界短时外推后冻结，不remote自跑泄气／修复jack／wheel damage。side平均rim保留為舊字段，但不作新逐輪pose真相。
- 静态敌车／靶车在wheel损伤或修复支撑期间运行独立固定步／idle物理，才能真实下沉和redistribute load；不重复step玩家，远端不再套本地动力。死亡车的hub拖曳／地面支持也用同mode。
- `loadout.js::buildLoadout/exportFolder`及`workshopImported.js`保留base chassis descriptor／part身份；只换turret不重注册新wheel或全车fresh state。model共享／滤除武器后的source part identity以原decoded part＋origin为准，不能list index作cache或damage identity。实际export包含supplementaldescriptor／roles，而settings import仍不能覆写可信原weapon/projectile/model目录。
- `gfx/interior.js`／damage labels／status缩图按wheel ID表示左右第几轮、tire/rubber/hub；derived side摘要可以显示「左侧2轮受损」，不能继续只报「左履带断」。X-ray透明／highlight必须定位同一part，hitcam／projectile replay freeze含同revision的轮几何，源shared buffers不被回放变形污染。

## 建议修改路径与顺序

| 步骤 | 路径／职责 | 完成门槛 |
|---|---|---|
| 1 可信source与IDs | 新 `client/web/src/sim/runningGearDamage.js`、`crates/combat/src/running_gear_damage.rs`；supplementalrole／profile manifest；`sim/tank/wheelPrimitives.js`、Rust `track_primitive.rs` | procedural／imported／shared／workshop native与JS descriptor完全一致；零source mutation；注册两次byte-equivalent |
| 2 module／真实hit | `crates/damage/src/lib.rs`、schema、`crates/combat/src/lib.rs`、`client/web/src/game/combat.js`、`crates/server/src/server.rs`、`crates/design-wasm/src/lib.rs` | tire／rubber／hub分开；移动/转向/塌胎／guide槽命中正确；轮间空隙无轮伤；alias不double count |
| 3 active物理／visual | `sim/wheeled/wheeled.js`、`game/vehicle.js`、`gfx/tankmodel.js`、`gfx/imported.js`／renderer；B JS/Rust suspension、track path／primitive／feature／contact | 不变健康车辆性能；单轮radius／load／traction与mesh变化；B互易质量与负载通过；原q不重排 |
| 4 repair／authority | combat state／repair、server `lobby.rs`、main entry、enemies、共用B支撑生命周期 | permit与real restoration分开；F/J、hit撤销、crew、pending、重复ready、respawn／换头通过 |
| 5 pose／replay／UI | `game/net.js`、enemies interpolation、interior/status／hitcam/replay owners | 不再靠side speed復原单轮；late join、reconnect、revision冻结与source资源释放通过 |

Rust已有tracked物理镜像，可同步variant、radius、finite contacts及phase derivative。**不存在现成Rust wheeled backend**（wheeled.js文件首行已经明示）；此功能应至少把shareddamage／geometry／repair判定实现到native与WASM，JS实际wheeled步进接入以上effects。若交付聲称wheeled dynamics本身也有native parity，则需新增 `crates/physics/src/wheeled/` 及lockstep，这不能由修改tracked Rust代码自动达成。服务器motion仍是owner-driven的既有边界要保留，不因新module state而声称完整防移动作弊。

## 验收矩阵

以下是未来实现必须执行的验证；除上文8项健康轮式测试與CPU probes外，**本调查没有执行或宣称这些已通过**。

| 领域 | 场景／量测 | 拒收条件 |
|---|---|---|
| Source与身份 | 所有8轮式＋所有35tracked；每side／source wheel entry；imported BMP两shared variants；工坊换头／export/reimport | protected source hash变化、同wheel ID重名、sort／filter导致伤wrongwheel、append重复、健康轮mesh/material被改写 |
| 命中 | 每轮胎肩／胎纹／rim／hub；Puma/M8上述轮间空隙；斜向、hole/guide槽、full steer、q rebound、spin／damage variants | wheel gap命中wheel、整个station误伤、tire与hub错role、shot同时伤alias、server/WASM命中part不同 |
| 投射物 | MG只打橡胶与钢hub分别；AP穿过两part；HE outside blast／fragment／internal protected armor occlusion | 所有小口径同样毁hub、health扣一次以上、跨空隙爆炸伤whole side、energy／part pass重复；不能借此改原武器／armor曲线 |
| Wheeled平衡 | M8、Puma、CMP、BMP前／中／后单flat、single broken hub、same-side两轮、相反角轮；flat→land、坡／bump／mud | support仍原radius／load、flat错误变airborne、wheel穿地、载荷人工复制、body跳pose／velocity、NaN／能量增长 |
| Wheeled驾驶 | 同输入的速度／角速度／制动／拉偏／wheel slip；前轮vs後轮损伤；connected airborne wheel与disconnected hub | 只有全车speed multiplier变化、另一侧参数被改、lost drive torque凭空转送、side mean覆盖single omega |
| Tracked单盘 | Hetzer独立盘、Tiger/Panther双盘、HVSS盘／bogie、steel-wheel；同轴一盘vs两盘；橡胶loss与hub destruction | 同轴另一盘也关掉、原全宽圆盘仍承载、删除q自由度、鞋长变化、单轮伤立刻整侧断带 |
| Tracked负载 | last B coupled operator；邻轮N与q/qv、bogie rock、normal／friction互易、one wheel unloaded、broken-chain bare mode | 幽灵轮N、无load shoe有traction、negative物理N被clip掩盖、重复wheel／belt惯量、contact cache使用旧profile |
| Spin／几何 | damage瞬间角连续、累计travel接近B上限、newrollingR、sameδs derivative／nativeJS对照、导齿corridor | 累积travel除新r跳角、flat patch跟轮轉、render与collider变形不同、失效hub仍推动track |
| F修复 | 胎独修／hub独修／两者同修；修至60%；single wheel／双盘；wheel repair＋broken chain repair；newhealth hit／crew取消／J | HP>0即时插轮、修tire顺便修hub、alias work重复、jack产生普通traction／压痕、事件清qv/omega、无许可自行恢复 |
| 机械交接 | 斜坡／极限rebound／倾斜／车腹落地、预算耗尽、轮净空不足；ready repeat／lost ACK／late ACK／generation变化 | 无限jack正功／行程、磁吸／冻结body、stale ready能恢复、pending永久无诊断、轮修好偷偷闭链 |
| 网络安全 | missing／invalid optional pose、NaN／Inf／oversized/count错、unknown ID/profile、old epoch/revision、连接serial替换、late join/reconnect | client能覆盖damage／health／permit、全旧motion被坏hint杀掉、损坏轮被remote重建健康、跨revision插值 |
| 覆盖与回归 | 玩家、静态靶、敌车、远端、wreck、hitcam与projectile freeze、shared模型多实体 | 玩家有轮伤其他owner无效果、重复step、原geometry cache污染、回放修改活车／shared source |
| 资源／性能 | 相同健康预算；单／多损伤轮；BMP约7k rubber triangles／轮的BVH、variant refit、context restore、dispose重复 | 每frame重新创建mesh／descriptor、无界triangle扫描、GL资源增长、restoration source回退成健康variant |

新测试应以可观察的几何／contact／force／state／authority行为为断言，而非只匹配新增字段。原 `wheeled.test.mjs`、B所有mass/contact/lockstep/gate、modular damage/F/J/weapon、workshop imported／binding/export、数据校验与实际WASM binding最后一起运行；未完成B gate或真实hit依赖时，不把单个「爆胎mesh变了」测试当作整体完成。
