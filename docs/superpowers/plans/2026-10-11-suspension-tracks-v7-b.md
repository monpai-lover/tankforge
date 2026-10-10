# 悬挂与履带 B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax for tracking. 用户已选 B；任务直接执行，逐阶段先规格再质量审查。

**Goal:** 在原车标定和实际 120 Hz 游戏时序内提供轮组惯性、固定销距、受约束张紧及物理断链，完整保留损伤／修复／联网功能。

**Architecture:** Rust／JS 镜像的实体轮组质量算子、悬挂和履带状态，渲染读取物理拥有者。服务器冻结断销拓扑及修复 revision；远端插值拥有者姿态，不独立自由链求解。

**Tech Stack:** 现有 Rust、JavaScript、WebGL2、JSON/WebSocket、Node 与 Cargo。工作树 `codex/suspension-tracks-v7`；正式要求见相邻 B 规格，基线 `2ebb940`。

---

## Task 1：耦合轮组与稳定接触

文件：新增 `crates/physics/src/tank/running_gear_dynamics.rs` 与 `client/web/src/sim/tank/runningGearDynamics.js`；修改两端 `suspension`、`rigid_body/body`、`track_contact/contacts`、`tank/mod`，`crates/vehicle/src` 的悬挂定义和 `schemas/vehicle.schema.json`；新增 `client/web/test/running-gear-dynamics.test.mjs` 和 Rust 聚焦测试。不改源车JSON或主步频。

- [ ] 写 RED：静态重组 M/C/I 恒等，水平净力 `F=10000` 得 `a=F/M`，自由落体轮／车体一致，阶跃地面轮位不能瞬时跳成输入高度；台车摇摆正阻尼耗能，预载总重、卸载、落地和软止挡有限。
- [ ] 运行 `node --test client/web/test/running-gear-dynamics.test.mjs` 与 `cargo test -p tg-physics running_gear` 确认失败并保存原因。
- [ ] 实现耦合矩阵而非额外全车质量。每轮 `B_i=[I,-skew(r_i)]`，`A=A_s+Σm_i B_iᵀB_i`，`b_i=m_i B_iᵀey`，`D_i=m_i`；`S=A-Σb_i b_iᵀ/D_i`，复用6×6 Cholesky求解。重组静态簧上剩余质心和惯量，包括偏移项；正定性不足确定性缩小6%估计。
- [ ] 外力和重力解 `(A b;bᵀ D)Δv=hQ`；隐式弹簧使用当前相对速度与正定刚度／阻尼、单边接触不得拉地面。现有摩擦、反冲及障碍冲量使用同一算子，不只用簧上质量推进车体。台车 heave/rock 由两轮 q 推导并保留原 travel/lim。
- [ ] 更换过时 `unitPrev`／run/belly 穿透差分的速度来源；接触零负载样本无摩擦，失去接触清空暖启动。按裸轮或完整带厚度生成支撑。新增热循环缓冲复用，不重构无关系统。
- [ ] 原远端3cm门槛揭示新离地轮q无法由旧姿态恢复，Task1提前加入可选 `rg:{version:1,q,qv}` 最小姿态提示，两端NetState／apply／reconstruct一致。精确计数、有限和有界检查；非法／缺提示安全退回旧重建；合法提示不得再次被地面覆盖。测试真实离地snapshot、旧包和错误数组／NaN／越界。Task5仍负责拓扑、revision、epoch、服务器和远端插值。
- [ ] 跑新用例、`tank.test.mjs`、`wheeled.test.mjs` 和 `client/web/tools/tank-lockstep.mjs`，Rust对照更新记录必须来自新实现，原阈值不放宽。精确提交，规格／质量双审及修复。

## Task 2：固定销距的完整带与张紧

文件：新增 `client/web/src/sim/tank/trackPath.js`；修改 `crates/physics/src/tank/track_path.rs`、`client/web/src/gfx/track.js`、两端 Tank owner；新增 `client/web/test/fixed-pitch-track.test.mjs` 与 Rust几何测试。

- [ ] 写 RED，真实35车静态和受限轮位、offset多相位验证每条弦长原pitch、真实接缝和轮／地面净空；检查合成Proto过长路线返回不可行，bias不会改总长。
- [ ] 验证 RED。圈／段求交每次找前进方向第一个根：`|a+t*d-prev|²=pitch²`，保留材质销顺序；有界求导向轮＋松弛，使N次前进接缝闭合，不覆盖最后销。
- [ ] 预分配路线、累计弧长和销缓冲；导向轮0.08m内收且速度受限；紧边根据传递力和主动轮端生成；G.sag为读出。返回规格的独立残差与可行性。
- [ ] 对真实步进中紧带要求用同一质量算子的单边长度冲量限制轮／车体速度，不直接设高度或角度；筛选接触为可行包络，外加强制不可行姿态保留诊断及有限安全缓存。
- [ ] 跑35车几何、原运行机构／HVSS／源网格测试并双审；只提交路径、接触、诊断和测试。

## Task 3：开式断链和休眠

文件：新增 `crates/physics/src/tank/track_chain.rs`、`client/web/src/sim/tank/trackChain.js`，镜像状态和 Tank 步进；新增 `client/web/test/track-chain.test.mjs`／Rust测试，许可 `third_party/tracklab-v7/LICENSE` 和归属记录。

- [ ] RED：转弯／离地多相位切断N板生成N+1节点，初始所有世界坐标／速度不变，端点重复但鞋不消失；重力掉落且鞋长不伸，地面纠正不增加速度；休眠／地形变化唤醒。
- [ ] 按 `[cut,...,cut+N]` 材质顺序初始化，保存3D位置／速度和前一子步，XPBD长度约束 `Δλ=(-C-α λ)/(w_a+w_b+α)`；地面端点／中点接触，8位置/4速度有界扫描及残差提前退出。位置穿透纠正不混进动能速度。
- [ ] 断链权重为表现估计，不加进整车质量，不提供车体冲量／动力。累计稳定接触时间休眠，必要事件唤醒，无wall-clock随机。以当前实际板数分配，防御上限256。
- [ ] 新用例、双端对照及有限压力通过，写清非完整车体双向多体边界，MIT来源完整；双审精确提交。

## Task 4：损伤／修复和模型生命周期

文件：新增 `client/web/src/game/runningGearDamage.js`；修改 `vehicle.js`、`enemy.js`、`main.js`、`gfx/tankmodel.js` 及必要的模型替换接线；新增 `client/web/test/running-gear-lifecycle.test.mjs`。

- [ ] RED：破损能力一次性切断；修复开始／取消开链不变；能力恢复时车体及轮速度不改、另一侧相位不改；死亡／J不修复；重生清epoch；兼容Hetzer换头保持状态，远端不步进XPBD。
- [ ] `runningGearPose()` 复用输出 q/qv/phase/pins/openNodes/diagnostics；step仅物理tick执行，静态敌车单独chain-only更新，玩家不重复。damage adapter接在线／离线权威能力和hit点，按状态转换而非每帧重复cut。
- [ ] 绘图鞋矩阵由世界nodes转local构建，mesh规模／种类／Xray契约保持，原连接杆跟随轮／idler；闭合重建只在可行时退休旧链；无新相机/UI功能。资源精确释放。
- [ ] 运行新的CPU模型／生命周期，现有车辆动作、模块损伤、MG、Oplot、导弹、换头及车轮加速测试；双审精确提交。

## Task 5：服务器权威断销及网络状态

文件：新增 `crates/server/src/running_gear.rs`；修改 `lobby.rs/lib.rs`、Rust NetState、JS snapshot/apply/reconstruct、`game/enemy.js` 插值与重生缓冲；新增 Rust大厅／socket和 `client/web/test/running-gear-network.test.mjs`。

- [ ] RED：旧包无rg合法；伪造健康／断销、错revision、错误N+1数量、非有限／越界、迟到旧epoch扩展被丢弃但旧motion保留；同epoch拓扑插值，不跨断／闭插值；断线、晚加入与重生复位。
- [ ] server authority只由combat before/after caps变化更新，首次破损按最新已接受pose/q/phase的最近材质pin确定cut，fallback模块中心/静态几何，最低索引平局。repair_s结束且cap恢复才清broken并增revision。
- [ ] `rg` version1可选扩展，含epoch/revision/seq/q/qv/phase/idler/chain anchors与量化pos/vel；验证车型期望数量、256上限、有限／界限／字节数，不让owner修改authority。旧pose兼容。
- [ ] 远端同拓扑插值，短时有界外推后冻结；重生清buf时钟offset，重连／晚加入发最新authority及chain keyframe。不独立simulate自由链。
- [ ] 跑大厅／socket、snapshot测试，实际客户端／Rust绑定对照，双审精确提交。

## Task 6：性能、总回归和发布

- [ ] 同机120Hz物理＋60Hz几何重新测健康、最大135板、单／双断链、休眠和多实体，拆分CPU与GPU边界；比较基线，超过预算优化后重测。保存准确参数和median，不把旧1/60数据视为FPS。
- [ ] 跑完整 `node --test test/*.test.mjs`、`cargo test --workspace`、数据/模型校验及新扩展对照。独立release `tg-design-wasm`成功再web build，核对编译/asset/HTML内嵌hash，不接受静默旧核心回退。
- [ ] 与独立座圈修复顺序整合，原GLB／source与武器装甲保护hash检查，更新方案结果MD、README和游戏页面别名；保留所有无关未跟踪dist和研究文件。
- [ ] 最终独立规格/质量复查、diff检查、远端重叠检查，然后按已有授权精确合并推送并核对远端SHA。游戏页面不自动打开／刷新。交付说明必须区分CPU验收与未做浏览器实景验收。
