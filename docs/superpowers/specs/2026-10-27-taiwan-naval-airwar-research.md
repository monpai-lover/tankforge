# 台海海空护航剧本：现状核查与最小实现研究

日期：2026-10-27。性质：只读研究与未批准的实现设计；不是已实现功能、已批准规格或测试完成声明。

研究工作区：`D:/TankForge-workspaces/r81-push-20261027`。本次仅新增本文，不修改台湾地图、武器数据、canonical bundle 或当前 R8.2 修复源文件。

## 1. 用户目标与待定边界

用户期望：中方从福建机场或附近空域出生，台方从台湾机场或附近空域出生；双方 AI 舰船会主动交战；中方护送登陆舰到台湾完成登陆获胜，台方歼灭登陆舰队获胜；希望真实世界地图按 1:100 压缩；补充符合具体机型与使用方的 Su-27、MiG-29 挂载。

**1:100 的含义仍在向用户确认，未答复前不得缩放数据。** 必须区分缩短真实航程、只缩小地图显示、以及缩小地理位置但保留飞机/机场实体尺寸三种不同产品行为。本文列出影响，不替用户决定。

仍需在实现前明确的规则是：一艘还是指定数量登陆舰完成登陆才获胜；卸载过程多久；时间耗尽如何判定；完全失去机动但未沉没是否算被歼灭；玩家失去飞机后能否继续观战/再出击。这些均应保存为剧本规则，不能散落在客户端判断中。

## 2. 当前地图的直接数据证据

主资产是 `data/frontline/taiwan.json`。本节直接读取该资产，而不是从历史验收报告推断当前状态。

### 2.1 坐标与尺度

| JSON 位置 | 当前值 / 含义 |
| --- | --- |
| `/coordinateFrame/sourceCrs` | `+proj=aeqd +lat_0=24.075 +lon_0=120.075 +datum=WGS84 +units=m +no_defs` |
| `/coordinateFrame/x`、`/coordinateFrame/z` | `easting-originE`、`originN-northing`；原点 E/N 均为 0，北为负 z |
| `/coordinateFrame/y` | EGM2008 DSM 米制高程与明确的游戏整地覆盖 |
| `/coordinateFrame/sourceBoundsWgs84` | `[117.8,21.65,122.35,26.5]` |
| `/bounds` | x `[-236000,236000]`，z `[-271000,269000]`；投影包围盒约 **472 × 540 km** |
| `/terrain` | 640 × 733，共 469120 高程样本；cellX 737.5 m，cellZ 736.6984993178718 m |
| `/terrain/patches` | 5 个局部补丁：3 条地面战线的 30 m 网格及 RCMQ/RCKU 两个约 30 m 机场网格 |
| `/sampling/order` | base → native_patches → roadbeds → pads → runways |

导出与采样定义可追溯至 `docs/air-frontline/research/taiwan_runtime_common.py` 的 `CRS_TEXT`、`xz()`、`sample()`；运行时双方必须使用同一个派生资产与同一采样顺序。没有任何当前 1:100 航程变换。

### 2.2 机场并不是当前需求的两岸分配

资产含 20 个机场参考点，只有 **2 个启用**，并且这两个都在台湾本岛。福建三个参考点均未启用，只有 `candidateRunway`，没有已启用机场使用的 `runway` 运行记录。

| ID | 地点 | team | enabled | 世界 x / y / z，米 |
| --- | --- | --- | --- | --- |
| ZSAM | 厦门高崎 | null | false | -197320.270 / 12.580 / -53311.931 |
| ZSQZ | 泉州晋江 | null | false | -150300.355 / 6.501 / -80647.998 |
| ZSFZ | 福州长乐 | null | false | -40326.023 / 8.363 / -205460.416 |
| RCMQ | 台中／清泉岗参考 | 0 | true | 55442.307 / 200.558 / -21152.601 |
| RCKU | 嘉义参考 | 1 | true | 32234.838 / 24.384 / 67679.615 |

RCMQ 当前跑道长 3660.721 m、宽 45.1104 m；RCKU 长 3036.401 m、宽 45.1104 m。两条均标记为明确游戏整地、`operational:true`，并明确不代表机场测绘或机型障碍物净空认证。参考机场的现代真实用途不能据此推导成所有年代的合法出生点。

目前 `team 0/1` 是 Blue/Red 游戏队伍，不是已实现的解放军／台方阵营限制。新剧本要明确阵营映射及机型目录，不能仅把 UI 文案改成两岸名称。

### 2.3 实际空中出生点

`/airspawns`，注意字段为复数 `airspawns`，不是 `spawns`：

| ID | team | airportId | pos，米 | 资产 yawRad / speed |
| --- | --- | --- | --- | --- |
| B-REAR-AIR | 0 | RCMQ | `[55442.307,4500,-36152.601]` | 0 / 180 |
| R-REAR-AIR | 1 | RCKU | `[32234.838,4500,82679.615]` | π / 180 |

它们各距关联机场参考点 15 km，均不在福建。

重要的代码约束：`crates/server/src/frontline_air.rs:1338` 的 `spawn_configured_fuel()` 当前只按启用状态和 team 取第一个出生记录，并硬编码朝 `C2`。它没有采用资产里的 `yawRad` 和 `speed`；喷气机使用 210 m/s，非喷气机 110 m/s，另外生成 80 m 横向、180 m 纵向、40 m 高差的编队槽位。因此只改 JSON 的 yaw/speed 不会完成需求。`step_with_kinematics()` 同样以 `C2` 作为默认任务点。

跑道出生同样取队伍的首个启用机场，并依赖 native `LandingArea`、关闭区、占用距离和机场设施绑定。启用福建机场至少需要真实来源或明确游戏作者定义的跑道几何、对应整地与设施、服务/关闭区和 native 起降验证；`enabled:true` 不是完整实现。

### 2.4 现有地面剧本与海域覆盖

当前 `/initialScene/id` 是 `taiwan-central-west-three-front-campaign`：12 条道路、15 个目标、6 个地面集结点。`/campaign/scope` 明确是台湾本岛的三条虚构既有对峙地面战线，**没有跨海地面边**。

`/navigation/hydroCoverage` 只有台湾中西部战线附近一个区域，x `[31093.036,59434.677]`、z `[-6095.470,21444.027]`；外部是 `unknown_fail_closed`。224 个 waterAreas 主要用于局部河流/湿地与桥梁接触，不是整个海峡的可航海面。

`/geography/maritime` 直接写明：`implemented:false`、`seaRoutes:[]`、`bathymetry:null`、`groundCrossesWater:false`。战略海岸线来自 Natural Earth 1:10,000,000 制图尺度，资产明确说明它不认证小岛岸线、港口或水深。不能把 DSM 的海面零值当作可航水深，也不能反转现有 tank 的 dry/deck 通行判断来当舰船导航。

## 3. 原生能力：可复用什么，缺什么

在 `crates/server/src`、`crates/gameplay/src`、`crates/vehicle/src` 的 Rust 源码中检索 ship/naval/vessel/boat/torpedo/buoyancy/waterline，并结合当前 actor 与 tick 代码核查：没有发现一个现成可接入的舰船实体、舰船 AI 或海上胜负框架。下面的 naval 模块全部是拟新增设计，不能对外报告为已存在。

| 需求 | 已有可复用点 | 需要新增或拓展的真实工作 |
| --- | --- | --- |
| 统一生命与权威时钟 | `frontline.rs` 的 `UnitRef {battle,unit,life}`、Room、事件和对局重启 | 给舰船分配同一全局 unit ID；不能另用同号船 ID 或客户端计时 |
| 固定步进 | room 的 STEP=0.05 s；`frontline_sim.rs:3914` 的 `step_combined()` 在 FIXED_DT=1/120 s 推进飞机与地面 | 舰船接入同一个固定步进，AI 决策可低频，不能独立 wall clock 或浏览器动画驱动位置 |
| 武器弹道与伤害 | `frontline_sim.rs` 的实际 rounds、有限弹道段、装填/弹量、原生爆炸；`tg-combat` 的已注册表面响应 | 新增舰船发射入口、目标枚举及有限接触/伤害适配，保留每一发弹药身份；没有“复用后自动可打船” |
| 导引目标 | `frontline_air_missiles.rs:50` 的 `Target`；`:117` 的 `eligible()` | 当前只有 air=true/false，采集来源仅地面与飞机；需明确 Naval 目标类别、发射平台/传感器资格与舰船 LOS，不能仅把船伪装为 tank |
| AI 目标选择 | `frontline_air.rs` 的 nearest_visible；地面 native LOS/aim/fire 分离 | 新增水面侦测、选敌、炮塔/火控与护航任务；当前飞机 AI 默认寻找飞机/坦克，未寻找舰船，且不会自动发射所选挂载来完成反舰任务 |
| 能见度与网络隐私 | `frontline_perception.rs:32` 的 ActorKind、团队授权视图、观察者真值；`frontline.rs:2042` 后的 audience 分发 | ActorKind 当前仅 Ground/Air；需增加 Naval 并拓展其公开缓存、丢失接触、事件过滤与客户端消费 |
| 传输 | `frontline_wire.rs` 的通用无损 full/delta、重置逻辑 | 身份验证当前只遍历 units/aircrafts（约 `:370`）；新增 vessels 后须纳入身份/容量验证与完整快照/恢复测试，而不是只附加 JSON 字段 |
| 结果与下一局 | `frontline.rs:2129` 后 `RoundResult`、Ended、release、intermission/restart | 增加场景专属终局策略，替换此场景现有空中歼灭/1000分/中点占区逻辑；不能只向现有 result 附一条 UI 提示 |
| 登陆与陆战占领 | `frontline_campaign.rs` 的 Presence 与占领规则 | Presence 当前来自实际地面接触，舰船靠岸不会自然成为占领。第一版应明确“完成卸载”即任务完成，不声称已有步兵或载货坦克登陆 |
| 视觉/回放 | 原有 accepted pose、WebGL Node、事件 FX、冻结回放模式 | 舰船模型与碰撞注册、wake/沉没表现、naval minimap/HUD 与回放 actor 均需接入；视觉沉没不能决定伤害或胜负 |

`docs/hitbox-conventions.md` 要求新载具的可见表面与碰撞查询使用同源三角形、内容哈希和稳定 instance/triangle ID；AABB 只能做候选筛选。新船不能靠画一个船模型，再用大盒子填平上层结构空隙来宣称已完成该方向。

## 4. 三种实现途径

1. **推荐：独立海空护航场景与精简 native NavalWorld。** 保留旧的台湾三战线剧本作为原场景；新场景数据绑定机场、出生、船队、路线、登陆区和终局。只做固定水面上的有惯性转向运动、真实有限射线/弹道接触、模块损伤和服务器卸载计时，不做全流体、人员登舰或玩家操船。范围可验证，能实际满足“舰船自动交战”。
2. 把现有坦克地面单位改成漂浮舰船。看似代码少，但地面接触、淹没、履带动力、捕获 Presence、导航与 actor 公开视图均不匹配；会污染权威路径，不建议。
3. 先建通用六自由度海战、浮力/进水、港口、所有导弹与两栖运输框架。长期可扩展，第一版工作量大，且当前地图缺少水深与近岸资料，不能作为完成本需求的最小路径。

推荐路径仍需新造完整的海上接触链，不是只新增一段航点动画。公开里程碑应分别称为“路线/实体”、“可交战”、“登陆/终局”、“客户端与打包验证”，避免先把研究或模型预览称为海战已完成。

## 5. 推荐的最小服务器权威设计

### 5.1 数据与模块边界

拟新增 `data/frontline/scenarios/taiwan-landing-escort.json`，以 `baseMapId`、`baseMapRevision` 与明确派生空间变换绑定地图。也可使用独立派生 map ID，但当前 `frontline.rs:754` 只枚举 korea/taiwan，若新增 ID 必须同时扩展安装白名单、地图注册与服务端 HTTP/客户端选择路径。

剧本至少包含：version/id、team→faction、era/aircraft allowlist、团队 airportId 与空中 spawn records、海面高度、显式允许航行区/禁行岛屿、route corridor、舰船定义和队形槽位、登陆区、胜负规则与超时规则。场景与基础地图保持不同身份，旧房间仍受原 map_revision 约束。

拟新增 `crates/server/src/frontline_naval.rs` 管舰船生命周期/运动/AI/登岸状态；另设小型 `frontline_scenario.rs` 管场景装载、出生选择与唯一终局判定。只在 Room 与 combined tick 的接入点做必要改动，避免继续把所有海军规则塞进已经很大的 frontline.rs。

### 5.2 舰船运动和路线

每艘船有 UnitRef、team、role、source model/geometry revision、accepted pose、velocity、speed/acceleration/turn limits、weapon resources、damage state 与 route cursor。最低角色是 transport、escort、interceptor；不要求玩家操舰。

运动采用固定水面上的 2.5D 运动：受速度与转向上限约束沿显式海上 corridor 行驶，局部避让同队船和沉船；每一步以船体足迹的扫掠验证水域与障碍。航点、转弯或卡住时不能 teleport 到下一点。水面起伏/横摇先作为受约束表现，不宣称已实现物理浮力。

当前没有 bathymetry，因此第一版只能把经过审查的 corridor 视为**明确作者定义的游戏通航区**，不声称按真实吃水验证。登陆区必须有独立详细岸线/游戏坡道与靠泊接近区；不可从战略粗海岸线最近点自动生成“真实登陆点”。实际登陆区及舰种由后续内容研究决定，本文不编造已存在来源。

### 5.3 自动交战和飞机打船

护航/拦截 AI 在 native 合法侦测与 LOS 下选敌；目标优先级是场景角色规则，不能读取敌队未授权快照替代侦测。先以一种有来源的舰炮和实际炮弹完成船对船交战链，包含炮口、弹量、射速、炮塔瞄准、有限飞行段、最早实际接触、命中部件和单次损伤。不要靠“距离够近每秒扣船血”充当炮击。

把 naval 接触候选加入同一弹道段内的地形/设施/地面/飞机最近接触竞争。每一发只结算最早接触一次；击沉、弹药殉爆与爆炸记录继续使用接受的发射与伤害因果。可复用 tg-combat 的注册表面/模块机制，但舰体 armor/module/crew 响应数据必须单独作者定义并验证，不借附近坦克装甲厚度。

飞机的枪弹/炸弹/兼容 AGM 必须能命中同一 naval scene；目标存在于导引列表仍不等于弹药被准许锁定。当前 `air:false` 需要明确拓展为非空中目标策略，保留武器真实支持的平台、导引方式和目标类型。第一版不必加入鱼雷、掠海反舰导弹、舰载雷达/防空导弹，但不能把未有来源的能力加到现有 Su-27UBK 或 MiG-29 9.12 上。

### 5.4 登陆与胜负的单一权威

建议登陆状态为 sailing → approach → unloading → landed；任意状态均可因真实损伤变成 disabled/sinking/sunk。unloading 仅在接受的船体位于指定登陆区域、朝向/速度符合约束、仍有有效登陆载荷且无既定阻断条件时累计 native simulation time；驶离或失去资格则暂停/重置，规则需显式数据化。客户端只显示状态。

建议第一版将“登陆成功”定义为指定数量/载荷的存活 transport 完成卸载计时。它表示场景货物完成登陆，不虚构实际出生并完成战斗的士兵；若用户要求可见坦克/步兵卸载，那是额外 cargo continuity + ground spawn admission 功能，必须保持原 cargo 身份和真实可通行陆域。

终局统一在 fixed-step 伤害和卸载更新后计算：达到 landed 目标→中方胜；所有具任务资格 transport 沉没或按已批准规则不可恢复→台方胜；超时按用户批准规则判定。双方同一步发生边界事件必须定义可重复顺序/平局政策；结果一旦接受不得后续翻转。仅损失护航舰、所有玩家飞机被击落或占领旧 C2，不能提前结束海上任务。

现有 `air_round_outcome()` 会按玩家飞机歼灭或 1000 分/45 分钟结束空战；`Campaign::terminal_winner()` 在 air_frontline 模式直接返回 None。新模式必须通过场景 outcome dispatcher 唯一选择规则，不能与旧终局并行触发。

### 5.5 公开状态与客户端

Frame/Snapshot 增加明确 `vessels` 与场景 mission progress，公开完整友军、侦测准许的敌船、丢失接触记忆；观察者才能获得允许的完整真值。扩展 ActorKind、LOS 遮挡、事件脱敏、wire2 身份验证、重连完整快照/差量重置。登陆进度是否全局公开应是场景规则，不能随意通过进度条泄露尚未侦测的精确敌船位置。

客户端只消费 accepted transforms、损伤与结果，负责船模/炮塔、尾流、沉没、目标标记、任务 HUD 与观战。绘制相机原点可继续采用现有精度修复；不能借浮动原点改变服务端坐标或已注册碰撞字节。一次下一局重启必须同时释放旧 ship scene、目标缓存、特效与资源，不保留上一局 ID。

## 6. 1:100：数学后果与字段清单

### 6.1 可直接复算的航程对比

以下仅由当前机场参考点计算 x/z 直线距离，**不是海军可航路线，也不是实际飞行作战航线**：

| 参考点 | 当前距离 | 全部位置 x/z ÷100 后 |
| --- | --- | --- |
| ZSAM → RCMQ | 254.800 km | 2548.002 m |
| ZSQZ → RCMQ | 214.172 km | 2141.722 m |
| ZSFZ → RCMQ | 207.704 km | 2077.040 m |
| ZSAM → RCKU | 259.489 km | 2594.889 m |
| ZSFZ → RCKU | 282.614 km | 2826.138 m |

全剧场会变约 4.72 × 5.40 km。以假设 20 kn = 10.2889 m/s 的游戏运输船为例，一条明确作者定义的 200 km 路线原需约 324 分钟，压为 2 km 后约 3.24 分钟，均未计卸载。实际 ETA 必须用最终合法 corridor 长度。

### 6.2 三种尺度政策不能混为一谈

| 方式 | 能否缩短 native 航程 | 主要后果 |
| --- | --- | --- |
| 只缩小地图 UI/渲染显示 | 否 | 不满足“飞行/海运距离压成 1/100” |
| 经纬地理布局 x/z ÷100，车辆/跑道/武器保留米制实体大小 | 是 | 大机场、船体、转弯半径、雷达/导弹射程会相对剧场变巨大；须作者重新布局局部设施与空域，已不是各字段完全均匀缩放 |
| 地理、机场、车辆与所有长度统一 ÷100 | 是 | 不是简单地图编辑：需重新推导速度/时间/质量/重力/武器参数和 native 精度，几乎改变整个模拟；不推荐为本需求第一版 |

如果用户确认确实压航程，建议生成**单独的压缩剧场资产**，保留原始地理来源及 transform 元数据；按明确政策保留飞机/舰船的物理大小，机场/海峡通道作游戏布局设计，并把这种局部调整诚实标识。若用户要求所有距离严格 1:100且正常飞机能够真实起降，必须先解决下面的跑道冲突，不能承诺两者天然兼容。

### 6.3 派生资产需要检查/变换的字段

| 范围 | 需要处理的当前字段/数据 | 注意点 |
| --- | --- | --- |
| 空间身份 | coordinateFrame、bounds、geography 的 derived extents、scale/transform revision | WGS84 和真实来源坐标保留为来源；不可改成看似真实的缩短经纬度 |
| 基础栅格 | terrain.x0/z0/cellX/cellZ、heights；patches 同字段与 blendMeters | 明确垂直尺度独立政策；仅横向压缩会使坡度放大 100 倍 |
| 道路与索引 | roads.points、halfWidth、lengthMeters、roadbeds.segments/cellSize/cells | 对 spatial cells 重新构建，不能只除 segment 坐标后保留旧键 |
| 水域 | waterAreas.ring/holes/triangles/level；hydroCoverage.bounds 与覆盖策略 | 岸线拓扑和孔洞保留；海面高度、河流 level 是否缩放不能漏掉 |
| 桥梁 | deckThickness、halfWidth、profileLengthMeters、minimumGameWaterClearanceMeters、jointGeometry 所有几何、关联路段 | 引用 ID 保留但几何与证明重建；不能继续使用旧接触/净空报告 |
| 场站整地 | pads.center/halfSize/height/blendMeters；runways.center/halfSize/height/blendMeters/forward | forward 是单位方向，不除100；重算端点与高程一致性 |
| 机场 | pos、candidateRunway/runway.center/endpoints/lengthMeters/widthMeters/height、服务与设施布局 | 物理跑道和机场当地设施必须重新注册、验证 |
| 出生与战线 | airspawns.pos、机场关联、staging.pos/radius/spawnSlots/slotFootprintMeters、objectives.pos/radius、initialScene 相关引用 | 新场景出生槽位/安全间距和目标不能沿用原米制常量而不检查 |
| 拟新增海军数据 | route/corridor/navmesh、出生队形、登陆区、船间安全距离、港口/坡道、作者定义吃水/通航政策 | 由统一派生坐标建造；不能缩完地图再随手补一个客户端坐标 |
| 缓存/发布身份 | map id/revision SHA、HTTP maps registry、facility geometry/layout hash、客户端地图缓存与派生几何、测试输入/证明 | 同一房间/快照必须绑定同一个新资产；旧地图哈希和旧几何收据不能冒充新验收 |

不应机械 ÷100 的字段：ID、source way/node IDs、unit vectors/yaw、year、team、counts、loadout station indexes。飞机/舰船本体几何、质量、速度、武器射程/引信/寿命、装甲厚度、伤害、燃油和计分时间要由已批准尺度政策单独决定，不能被通用 JSON 数值遍历修改。

### 6.4 必须先解决的缩放冲突

- 原 RCMQ/RCKU 跑道全缩后只剩约 36.61/30.36 m。native runway spawn 当前仍使用 140 m 起点偏移、35 m 占用距离，并按喷气机 1200 m/螺旋桨600 m的逻辑挑可用段；简单缩放无法起降。保留 3 km 跑道又会占据 5.4 km 剧场的很大比例。
- 原 15 km 机场后方出生距缩后是 150 m，不能原样称作安全后方。现有 80/180 m 槽位、4500 m 起始高度、飞机 AI 的 250/450 m 高度门槛都要显式重新审查。
- 只缩 x/z 不缩高度会产生近乎垂直地形；三轴都缩会使山体约几十米高，改变原有飞行遮蔽。不得在 native 与 client 采用不同处理。
- 16 m 道路会变 0.16 m；96×130 m 集结清地会变 0.96×1.30 m，原坦克尺寸无法通行。海空独立模式应明确不沿用旧地面三战线，而不是悄悄把它弄坏。
- 现有 7/12 km AI 观察、导弹锁定/最小射程、炮弹范围和机动半径可能覆盖整个压缩剧场。缩短地理不等于平衡已完成；应选择适合该剧场的规则并说明其游戏性调整。
- 压缩后水道、码头与船宽产生几何冲突，需要 corridor/岸线足迹验证；海岸点在屏幕上看似正确不能证明船可航行或可登陆。

## 7. Su-27 / MiG-29 的接入边界

当前 `data/aircraft/frontline.json` 的 `aircraft.su27.metadata` 是 **Su-27UBK，1992，中国，双座战斗教练机**；`mig29.metadata` 是 **MiG-29 9.12，1983，苏联**。不能按泛称 Su-27 或现代改型给它们整套后期制导武器，也不能因为它们都在游戏目录就把 MiG-29 9.12称作解放军装备。

现有 Su-27UBK 空战预设为 4×R-27R、2×R-27T、4×R-73（包括 center 的2枚），对地预设含 FAB-500/B8M1；MiG-29 9.12 空战为 2×R-27R、4×R-73，另有 R-27T/R-60M 近战和 FAB-500/B8M1 对地预设。这是**当前游戏数据的事实，不是历史兼容性验收**。

后续挂载研究应逐条提供“具体改型＋使用国/年代＋实际站位/挂架＋弹药/发射导引要求”的来源，并在 canonical store definitions、slots/options、loadout items、native accept_loadout、传感器能力与模型挂点中一致落地。仅增下拉选项不能称为可用挂载。现有 `AirWorld::options(era)` 主要按 year 筛选，台海阵营 allowlist 需新场景额外约束；MiG-29 的实际挂载补充可以独立于是否允许它进入本剧本。

本文没有联网开展机型武器史证据搜集，也没有据现有预设宣布这些挂载“实际正确”；该部分应作为独立内容核验子任务，与地图/海军实现解耦。

## 8. 后续批准后才执行的验证要求

1. 场景/坐标：投影转换、派生缩放可重复、机场阵营选择、native/client sampler 一致、runway/空中出生安全、路线船体足迹全程不穿岛；未覆盖海域拒绝通行。
2. native 交战：实际 AI 发现→瞄准→逐发扣弹→弹道→最早表面命中→损伤→沉没；飞机枪弹/炸弹/兼容导弹同链；孔洞命中/错失、舰船移动、爆炸友伤规则与原因归属分别覆盖。
3. 任务终局：到岸但未卸载不获胜；驶离/停摆/沉没打断；最后一艘死亡与最后载荷同一步完成的顺序；不被玩家飞机歼灭、旧 C2 占领或旧 score_limit提前结束；Ended只接受一次。
4. 生命周期/协议：同型多船、唯一 battle/unit/life、重连/观察者/两队视图、失去接触不泄露实时船位、wire2 full/delta/reset、下一局清理/重新建队、已结束战斗拒绝后续操作。
5. 真正产品验收：实际浏览器可选择两岸机场/空中出生，看到 AI 舰船互射并可实际攻击船体，两种胜利都能在 native+客户端走通；截图/视频、自动测试、性能、源匹配的 Linux完整服务端/page/data 包分别留证。没有运行就不记 PASS。

当前只完成源码与数据核查，以上实现和验收均未执行；1:100 的用户答复仍是地图派生设计的前置输入。
