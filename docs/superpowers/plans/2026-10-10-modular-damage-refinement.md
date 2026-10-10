# 模块化损伤实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 实施用户已确认的方案 A，使实际模块命中、独立武器能力、轻伤后果和战地修复在 Rust、WASM、网页、工坊与服务器之间一致。

**Architecture:** 公共模块健康与性能语义归 `crates/damage`，持久状态、精确命中及实例化武器能力归 `crates/combat`。浏览器转交真实资料并查询核心结果，服务器从本车配置校验具体武器；提示与回放消费同一结果。

**Tech Stack:** Rust / serde / WASM，原生 JavaScript、WebGL2、Node test，现有 websocket 服务。复用隔离工作树 `C:/Users/24908/.codex/scratch/tankforge-runtime-bugs` 的 `codex/modular-damage-refinement` 分支。

## 1. 真实碰撞与模块状态

Files: `crates/combat/src/lib.rs`, `crates/combat/src/tests.rs`；公共性能函数放在 `crates/damage/src/module_state.rs` 并从 `lib.rs` 使用。

- [x] 写失败回归并运行：`cargo test -p tg-combat -p tg-damage`。100 健康炮管盒 `(0,1,0)` / `(0.1,0.1,1)` 在 yaw=45° 时，向下射线 `(0.7,10,-0.7)` 不得命中；过量受击后持久健康必须为零。加入 0°／90°／真盒中心命中与模块遮挡的对照。
- [x] 实现局部盒命中：保留中心、原半尺寸及 yaw，使用 `rotate_yaw(o-center,-yaw)` 和 `rotate_yaw(d,-yaw)` 对原盒执行 slab 求交；起点是否在盒内和距离到盒也使用同一局部空间。各破片、弹体与爆炸消费一致几何。
- [x] 统一 `health_ratio`、健康级别与性能曲线，损伤状态限制到 `[0,max_health]`；直接命中、火灾与基础模块传播使用同一健康限制。测试健康分级、曲线端点、单调性和零值；工坊传播补齐由第 4 项完成。
- [x] 实现轻伤修复并先补失败测试：`TargetState` 增加有默认值的 `repair_targets`，按低于 60% 的可修部件冻结索引；时间 `6+4×sum((0.6-h)/0.6)+2×missingCrew`。完工只恢复本轮目标，毁车／弃车／不足两名乘员取消。旧状态缺少目标时兼容原修复。
- [x] 原测试与新增测试通过后精确提交；审查几何与状态，确认没有改变随机消费顺序或满健康能力。提交 `9ab2928`；40 combat + 11 damage PASS，15 项原错误 RED；独立规格与代码质量审查均通过。

## 2. 武器实例和公共数据绑定

Files: 新建 `crates/combat/src/weapon_damage.rs`、相关 Rust 测试；扩展 `TargetDef`、`Caps` 和 `crates/design-wasm/src/lib.rs` 的目标登记结果；校验 `schemas/modules.schema.json`。

接口约定：普通炮／发射架使用稳定键 `gun:<turret index>:<gun index>`；机枪使用原 secondary 项的稳定实例 id `mg:<secondary id>`，不使用枪械型号作为实例身份。`Caps.weapons` 返回以稳定键索引的 `{can_fire, dispersion_mult, reload_mult, traverse_mult, elevate_mult, reason}`；`Caps.drive_power` 为引擎与传动效率的乘积。

- [x] 先写失败测试：主炮炮闩毁坏后健康 Oplot、机枪和独立导弹仍可用；独立组件损坏只禁用所属实例；同型号多个实例不能串联。原 launcher weapon_group 及双发弹药消费保留。
- [x] `TargetDef` 接收有默认值的原 `weapons` JSON；Rust 统一解析主炮、extra_guns、extra_turrets、secondary 和 APS 的关联，登记时完成工作。保留已有显式 weapon_group；单武器旧炮管／炮闩归本炮，多武器通过明确关联和可验证的几何归属适配，歧义明确报错。
- [x] 每个实例只查询自己的关键部件和操控岗位；共享方向机按所属炮塔关联。没有独立模块的旧机枪补从原 mount / position / barrel 描述派生的外置损伤记录，使用独立实例关联，不构造假炮闩。登记结果返回标准化模块给浏览器状态／X 光消费者，并避免重复追加。
- [x] 测试全部 42 款资料、工坊生成与导入、明确分组和旧资料默认值；同步 schema 中的 APS、rounds 及新增字段。补齐工坊作者身份与保留原炮塔的映射，资料 schema／Rust loader 一致，已提交可复现的 MG 几何测量工具。装甲、武器数值、GLB 几何不重产。提交 `32cf3a7`、`3a7e861`；独立规格审查通过，180 Rust + 38 Node PASS，1 项原有忽略。
- [x] 定向 Rust 与原生 JSON 核心回归通过并精确提交，完成独立规格与代码质量审查；真实 WASM 在第 3 项网页接入时重建验收。最终提交 `ec2f10a`，184 Rust PASS，1 项原有忽略；修正错误关键部件引用、完整炮组依赖及单武器驱动归属。

## 3. 浏览器接入与反馈

Files: `client/web/src/game/combat.js`、新建 `client/web/src/game/weaponDamage.js`、`main.js`、`loadout.js`、`hud.js`、`gfx/interior.js`，新增 `client/web/test/modular-damage.test.mjs`。

- [x] 失败测试验证 `targetDef` 保留 crew 的 `also`，T-34 1940 车长兼炮手失能时不得继续开火；健康恢复与岗位接替消费真实核心结果。
- [x] 适配器将原 weapons JSON 交给核心，记录登记返回的标准化模块。`weaponDamage(caps,key)` 查询实例结果；旧核心只在字段不存在时使用兼容整车字段，新核心未知实例明确禁用。
- [x] 登记在模型／内构构建前完成，覆盖核心异步就绪、玩家、AI、靶场与联网敌车；同 id 的新工坊资料刷新登记，标准化模块不重复追加。目录以 `Object.values(data.machineGuns)` 传入，不附带整个 visual 模型资料。
- [x] 玩家／AI／机枪／Oplot／导弹的入队和实际发射入口均查询相应实例；炮塔速率、散布、装填采用对应结果，驾驶采用 drive_power。满健康为 1，保留原 F/J、双发导弹、瞄具和工坊换头流程。
- [x] 驾驶系数进入实际动力／传力限制，而不是仅缩小油门所请求的目标速度。物理输入增加默认 1 的可选系数，网页履带／轮式及原生履带／简化镜像一致；禁止移动时清零驱动与转向请求。保留原离合接合、健康加速及 lockstep，验证轻伤低力与零动力不起步／不原地转向。项目尚无原生轮式后端，不新建该后端。
- [x] 自动 APS 的实际伺服与散布也读取同一实例能力：共享 `crates/missile/src/world.rs` 的 Actor 增加默认 1 的兼容系数字段；网页传入公共能力，服务器第 4 项从自身权威状态赋值。源 ApsDef、RPM、制导及过载参数不变。
- [x] 状态小窗及命中提示区分受损、损毁、修复与受影响武器。回放保持实际弹体与轨迹，新增模块从同一损伤描述绘制和标注。
- [x] 实际 WASM、按键入口、排队后受击、42 款目标登记与工坊回归通过后精确提交，审查功能与表现接线。

Task 3 提交 ae96e19、c33ce15、5c26285、2158d86。完整网页 360 PASS；后续实际核心定向验证与独立复审通过，修正延迟接线覆盖弹药架、空架装填系数缓存，以及护板分析状态键。规格和质量审查均通过；最终全套及重建在第 5 项运行。

## 4. 服务器校验与工坊一致性

Files: `crates/server/src/lobby.rs`、消息定义所在文件、资料加载入口、`crates/design/src/trace.rs` 及相应测试。

- [x] 为新 fire / launch / mg 请求增加可选实例标识；新客户端明确发送，服务器从本车武器清单验证，不能信任客户端提供的故障或健康结果。
- [x] 新机枪客户端发送 `mg_fire`（seq、instance、gun、o、d），`mg_hit` 附可选 seq／instance；新路径在发射时校验健康，命中使用已验证发射记录，不能因飞行途中武器损毁而拒绝在途子弹。旧无 seq 的机枪请求仅接受唯一匹配且可用的实例。
- [x] 旧请求没有实例标识时，匹配该弹药且可用的实例必须唯一；未知、不属于本车、损毁、重复序号和歧义请求不消耗弹药、不造成损伤。
- [x] 服务器目标登记使用相同原 weapons JSON 与 Rust 标准化绑定，修复／火灾／死亡仍由服务器推进。验证健康 Oplot 在主炮故障后可开火、损坏自身后禁止，以及混合车炮／导弹相互独立。
- [x] 服务器 Actor 的 APS 系数读取自身公共能力，忽略网络输入的健康或倍率。导弹实体接触边界与旋转模块保守粗筛分离；不能让长炮管的整圈粗筛包围盒充当最终接触体积。
- [x] 工坊公共健康、传播和能力语义与主游戏一致，增加真实编译设计的损伤用例；不把外部发射装置改回炮闩。
- [x] `cargo test -p tg-server -p tg-design -p tg-damage -p tg-combat` 与定向网页测试通过，精确提交并审查。

Task 4 提交 2cfec4f、68a0f04、e849457。独立规格和质量审查通过；补齐开火回执、重生序号下限、显式零弹药导出再导入、有效空架后效与显示。最终全工作区 302 PASS、4 项原有忽略，完整网页使用最终默认核心 372 PASS；无浏览器调用。

## 5. 综合验收与交付

- [x] 运行完整网页 `npm --prefix client/web test` 与相关 Rust 回归，检查全部失败而不是只记录首项。
- [x] 使用现有 Rust 环境重建实际 WASM 与页面：设置 RUSTUP_HOME / CARGO_HOME 至 `C:/Users/24908/.codex/scratch/tankforge-rust` 下的现有运行时，ESBUILD_BIN 使用依赖中实际 exe；`npm --prefix client/web run build`，禁止旧核心回退。
- [x] 审计源数据和内嵌资料差异：原装甲、武器数值、GLB 及车型列表保留；仅记录本轮声明的损伤关联／公共 schema 变化。核对资产、编译和内嵌 WASM 完全相同，记录页面 SHA。
- [x] 独立先审规格覆盖，再审代码质量与整体回归，修复所有重要问题；整轮最终规格与质量审查均在 `0a979fd` 通过。完成 `docs/modular-damage-refinement-2026-10-10.md` 和 README 研究／交付索引；完整 Rust 313 PASS／4 原有忽略，默认核心网页 379 PASS／0 忽略，实际重建与原资料审计通过。
- [x] 最终规格发现复现与修正：显式关键部件不得借用其他实例已声明的归属；公共破片传播跳过零容量弹药架；修复反馈显示 F 三秒并覆盖低于 60% 的可修轻伤。提交 `aa20d2d`，原问题失败回归与修正后定向验证通过；独立整轮规格复审通过，重新 release 编译与页面构建，完整 Rust 310 PASS／4 原有忽略，默认核心网页 377 PASS／0 忽略。
- [x] 最终质量发现复现与修正：联机持续烧伤、修复及换位没有新事件时，仍按现有 4 Hz 节奏发布权威状态／能力；休眠车辆不增加状态广播，命名事件和死亡归属保留。提交 `66d0f5c`。补齐无效／缺失炮塔父节点的内构安全降级，保留核心禁用结果，提交 `0a979fd`；原问题 RED，修正后 GREEN，独立规格和质量复审均通过。
- [ ] 主项目干净、远端未发生未审阅变动后快进合并、推送，核对远端提交。同步两目录的 artifact、原有 12 个独立页面（含标准页）和新 `tankforge-modular-damage-20261010.html`，核对全部独立页面 SHA。
- [x] 使用实际核心、CPU 几何／SVG、状态与构建验证；未调用浏览器、未自动打开／刷新游戏，保留工作树。
