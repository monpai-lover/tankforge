# 模块化损伤实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 实施用户已确认的方案 A，使实际模块命中、独立武器能力、轻伤后果和战地修复在 Rust、WASM、网页、工坊与服务器之间一致。

**Architecture:** 公共模块健康与性能语义归 `crates/damage`，持久状态、精确命中及实例化武器能力归 `crates/combat`。浏览器转交真实资料并查询核心结果，服务器从本车配置校验具体武器；提示与回放消费同一结果。

**Tech Stack:** Rust / serde / WASM，原生 JavaScript、WebGL2、Node test，现有 websocket 服务。复用隔离工作树 `C:/Users/24908/.codex/scratch/tankforge-runtime-bugs` 的 `codex/modular-damage-refinement` 分支。

## 1. 真实碰撞与模块状态

Files: `crates/combat/src/lib.rs`, `crates/combat/src/tests.rs`；公共性能函数放在 `crates/damage/src/module_state.rs` 并从 `lib.rs` 使用。

- [ ] 写失败回归并运行：`cargo test -p tg-combat -p tg-damage`。100 健康炮管盒 `(0,1,0)` / `(0.1,0.1,1)` 在 yaw=45° 时，向下射线 `(0.7,10,-0.7)` 不得命中；过量受击后持久健康必须为零。加入 0°／90°／真盒中心命中与模块遮挡的对照。
- [ ] 实现局部盒命中：保留中心、原半尺寸及 yaw，使用 `rotate_yaw(o-center,-yaw)` 和 `rotate_yaw(d,-yaw)` 对原盒执行 slab 求交；起点是否在盒内和距离到盒也使用同一局部空间。各破片、弹体与爆炸消费一致几何。
- [ ] 统一 `health_ratio`、健康级别与性能曲线，损伤状态限制到 `[0,max_health]`；火灾和工坊传播使用同一健康限制。测试健康分级、曲线端点、单调性和零值。
- [ ] 实现轻伤修复并先补失败测试：`TargetState` 增加有默认值的 `repair_targets`，按低于 60% 的可修部件冻结索引；时间 `6+4×sum((0.6-h)/0.6)+2×missingCrew`。完工只恢复本轮目标，毁车／弃车／不足两名乘员取消。旧状态缺少目标时兼容原修复。
- [ ] 原测试与新增测试通过后精确提交；审查几何与状态，确认没有改变随机消费顺序或满健康能力。

## 2. 武器实例和公共数据绑定

Files: 新建 `crates/combat/src/weapon_damage.rs`、相关 Rust 测试；扩展 `TargetDef`、`Caps` 和 `crates/design-wasm/src/lib.rs` 的目标登记结果；校验 `schemas/modules.schema.json`。

接口约定：普通炮／发射架使用稳定键 `gun:<turret index>:<gun index>`；机枪使用原 secondary 项的稳定实例 id `mg:<secondary id>`，不使用枪械型号作为实例身份。`Caps.weapons` 返回以稳定键索引的 `{can_fire, dispersion_mult, reload_mult, traverse_mult, elevate_mult, reason}`；`Caps.drive_power` 为引擎与传动效率的乘积。

- [ ] 先写失败测试：主炮炮闩毁坏后健康 Oplot、机枪和独立导弹仍可用；独立组件损坏只禁用所属实例；同型号多个实例不能串联。原 launcher weapon_group 及双发弹药消费保留。
- [ ] `TargetDef` 接收有默认值的原 `weapons` JSON；Rust 统一解析主炮、extra_guns、extra_turrets、secondary 和 APS 的关联，登记时完成工作。保留已有显式 weapon_group；单武器旧炮管／炮闩归本炮，多武器通过明确关联和可验证的几何归属适配，歧义明确报错。
- [ ] 每个实例只查询自己的关键部件和操控岗位；共享方向机按所属炮塔关联。没有独立模块的旧机枪补从原 mount / position / barrel 描述派生的外置损伤记录，使用独立实例关联，不构造假炮闩。登记结果返回标准化模块给浏览器状态／X 光消费者，并避免重复追加。
- [ ] 测试全部 42 款资料、工坊生成与导入、明确分组和旧资料默认值；同步 schema 中的 APS、rounds 及新增字段。装甲、武器数值、GLB 几何不重产。
- [ ] 定向 Rust 与真实 WASM 回归通过后精确提交，进行规格与代码质量审查。

## 3. 浏览器接入与反馈

Files: `client/web/src/game/combat.js`、新建 `client/web/src/game/weaponDamage.js`、`main.js`、`loadout.js`、`hud.js`、`gfx/interior.js`，新增 `client/web/test/modular-damage.test.mjs`。

- [ ] 失败测试验证 `targetDef` 保留 crew 的 `also`，T-34 1940 车长兼炮手失能时不得继续开火；健康恢复与岗位接替消费真实核心结果。
- [ ] 适配器将原 weapons JSON 交给核心，记录登记返回的标准化模块。`weaponDamage(caps,key)` 查询实例结果；旧核心只在字段不存在时使用兼容整车字段，新核心未知实例明确禁用。
- [ ] 玩家／AI／机枪／Oplot／导弹的入队和实际发射入口均查询相应实例；炮塔速率、散布、装填采用对应结果，驾驶采用 drive_power。满健康为 1，保留原 F/J、双发导弹、瞄具和工坊换头流程。
- [ ] 状态小窗及命中提示区分受损、损毁、修复与受影响武器。回放保持实际弹体与轨迹，新增模块从同一损伤描述绘制和标注。
- [ ] 实际 WASM、按键入口、排队后受击、42 款目标登记与工坊回归通过后精确提交，审查功能与表现接线。

## 4. 服务器校验与工坊一致性

Files: `crates/server/src/lobby.rs`、消息定义所在文件、资料加载入口、`crates/design/src/trace.rs` 及相应测试。

- [ ] 为新 fire / launch / mg 请求增加可选实例标识；新客户端明确发送，服务器从本车武器清单验证，不能信任客户端提供的故障或健康结果。
- [ ] 旧请求没有实例标识时，匹配该弹药且可用的实例必须唯一；未知、不属于本车、损毁、重复序号和歧义请求不消耗弹药、不造成损伤。
- [ ] 服务器目标登记使用相同原 weapons JSON 与 Rust 标准化绑定，修复／火灾／死亡仍由服务器推进。验证健康 Oplot 在主炮故障后可开火、损坏自身后禁止，以及混合车炮／导弹相互独立。
- [ ] 工坊公共健康、传播和能力语义与主游戏一致，增加真实编译设计的损伤用例；不把外部发射装置改回炮闩。
- [ ] `cargo test -p tg-server -p tg-design -p tg-damage -p tg-combat` 与定向网页测试通过，精确提交并审查。

## 5. 综合验收与交付

- [ ] 运行完整网页 `npm --prefix client/web test` 与相关 Rust 回归，检查全部失败而不是只记录首项。
- [ ] 使用现有 Rust 环境重建实际 WASM 与页面：设置 RUSTUP_HOME / CARGO_HOME 至 `C:/Users/24908/.codex/scratch/tankforge-rust` 下的现有运行时，ESBUILD_BIN 使用依赖中实际 exe；`npm --prefix client/web run build`，禁止旧核心回退。
- [ ] 审计源数据和内嵌资料差异：原装甲、武器数值、GLB 及车型列表保留；仅记录本轮声明的损伤关联／公共 schema 变化。核对资产、编译和内嵌 WASM 完全相同，记录页面 SHA。
- [ ] 独立先审规格覆盖，再审代码质量与整体回归，修复所有重要问题；写 `docs/modular-damage-refinement-2026-10-10.md` 并更新 README 研究与交付索引。
- [ ] 主项目干净、远端未发生未审阅变动后快进合并、推送，核对远端提交。同步两目录的 artifact、标准页面、原有 12 个别名和新 `tankforge-modular-damage-20261010.html`，核对全部独立页面 SHA。
- [ ] 使用实际核心、CPU 几何／SVG、状态与构建验证；不调用浏览器、不自动打开／刷新游戏，不移除工作树。
