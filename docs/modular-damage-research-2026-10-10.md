# 模块化损伤：开源参考与现状检查

本次检查基线为 TankForge `eba77fc3df79dfa78e305f61d5eb13fbc76fe91e`。本文是调研与基线问题记录；改进方案尚待确认，没有修改游戏运行代码。

## 可用参考

| 项目与固定版本 | 许可核对 | 借鉴价值 | 使用边界 |
|---|---|---|---|
| [ACF-3](https://github.com/ACF-Team/ACF-3/tree/6173764cadbe81df2d34be834d16ff24efb52332) | [MIT，2019 Stooberton](https://github.com/ACF-Team/ACF-3/blob/6173764cadbe81df2d34be834d16ff24efb52332/LICENSE) | 部件健康影响动力；弹药热失控；燃料性质与泄漏；损伤结果与命中信息分离 | 推荐主要参考其机制，以 Rust 独立实现；不引入 Garry's Mod 实体、计时器与素材 |
| [Claude of Tanks](https://github.com/Kevin-Liu-01/Claude-of-Tanks/tree/6072b0de12b94a1090686c8cd79746326c8030ab) | [默认 MIT，有专有内容例外](https://github.com/Kevin-Liu-01/Claude-of-Tanks/blob/6072b0de12b94a1090686c8cd79746326c8030ab/LICENSE-POLICY.md) | 统一模块状态机；按武器区分损伤后果；明确修复事件；兼顾命中、UI 与回放的一致性 | 只研究通用 `src/sim/` 逻辑与 `docs/MODULES.md`，不复制 `src/vehicles/`、`src/world/`、车型标定或素材 |
| [UnityTankBallisticsSystem](https://github.com/XSnipinblazeX/UnityTankBallisticsSystem/tree/25153663d5cdc450cfd50404766293dd88f5ad41) | [MIT，2025 XSnipinblazeX](https://github.com/XSnipinblazeX/UnityTankBallisticsSystem/blob/25153663d5cdc450cfd50404766293dd88f5ad41/LICENSE) | 模块自身定义修复上限；损伤通过中间记录传给整车；舱室作为独立对象 | 作者注明需要未上传的依赖，仅供学习；其弹药架示例一被调用就殉爆，不适合直接移植 |
| [DakTank](https://github.com/Dakota0001/DakTank) | 本次递归文件树未找到 LICENSE／COPYING，GitHub 元数据的 license 为 null | README 提到详细穿透后效，适合作为相关项目线索 | 当前未能核对明确开源许可，不作为可复制代码来源 |

以上实际核对了仓库源码和许可文件，不能把“公开 GitHub 仓库”直接当成可重用授权。本文没有移植任何第三方代码；若后续直接复制 MIT 实现，必须保留相应版权与完整许可文本。

## 具体机制及取舍

ACF-3 的 [发动机](https://github.com/ACF-Team/ACF-3/blob/6173764cadbe81df2d34be834d16ff24efb52332/lua/entities/acf_engine/init.lua) 在 `ACF_OnDamage` 中依据健康比例更新峰值扭矩；[变速箱](https://github.com/ACF-Team/ACF-3/blob/6173764cadbe81df2d34be834d16ff24efb52332/lua/entities/acf_gearbox/init.lua) 在传力时计算损伤损失。这支持“模块轻伤就改变功能，而不是只在归零时失效”的设计。其曲线是游戏参数，不是坦克工程测量结论。

ACF-3 的 [弹药损伤](https://github.com/ACF-Team/ACF-3/blob/6173764cadbe81df2d34be834d16ff24efb52332/lua/entities/acf_ammo/modules/damage.lua) 区分立即爆炸、持续热失控和剩余弹药消耗；[油箱](https://github.com/ACF-Team/ACF-3/blob/6173764cadbe81df2d34be834d16ff24efb52332/lua/entities/acf_fueltank/modules/damage.lua) 区分可爆燃料与泄漏。这些机制适合作为第二阶段参考，但不应照搬其随机函数与墙钟计时。TankForge 的权威逻辑需要固定步进、注入随机种子和可重放的状态。柴油也不能因某个游戏的爆炸开关而被当成永远不会燃烧。

Claude of Tanks 的 [模块文档](https://github.com/Kevin-Liu-01/Claude-of-Tanks/blob/6072b0de12b94a1090686c8cd79746326c8030ab/docs/MODULES.md)、[状态与命中实现](https://github.com/Kevin-Liu-01/Claude-of-Tanks/blob/6072b0de12b94a1090686c8cd79746326c8030ab/src/sim/damage.ts) 和 [通用模块目录](https://github.com/Kevin-Liu-01/Claude-of-Tanks/blob/6072b0de12b94a1090686c8cd79746326c8030ab/src/sim/moduleCatalog.ts) 给出了统一状态、按武器选取故障、固定随机消费顺序、修复完成事件等组织方法。应借鉴这些边界，继续使用 TankForge 原有能量、穿深、破片和乘员模型，不照搬对方车辆数值、命中保留概率或自动修复玩法。

Unity 示例的 [Module](https://github.com/XSnipinblazeX/UnityTankBallisticsSystem/blob/25153663d5cdc450cfd50404766293dd88f5ad41/System/DamageModel/TankComponents/Module.cs) 将战地修复限制到满健康的一定比例；[DamageRelay](https://github.com/XSnipinblazeX/UnityTankBallisticsSystem/blob/25153663d5cdc450cfd50404766293dd88f5ad41/System/DamageModel/TankComponents/DamageRelay.cs) 分离损伤后果；[Compartment](https://github.com/XSnipinblazeX/UnityTankBallisticsSystem/blob/25153663d5cdc450cfd50404766293dd88f5ad41/System/DamageModel/VehicleVolume/Compartment.cs) 描述舱室温度、压力与换气。后者缺少经过校准的车型隔板数据，当前不应宣称移植后就能获得真实舱内超压模拟。

## 我们已有的能力

实际历史车辆由 `crates/combat` 通过同一 Rust 核心在 WASM 和服务器运行：按装甲板、入射角和剩余穿深追踪弹体，按顺序处理模块与乘员，生成破片、射流、爆炸与命中回放记录。状态保留各模块健康、乘员健康与席位、弹药架装填比例、火势与修复时间。外置部件、空弹药架和发射装置已有特殊处理。

工坊试射还使用 `crates/design/src/trace.rs` 与 `crates/damage` 的另一条损伤接口。任何公共模块定义或能力变化都需要检查这条路径，不能只修主游戏后让工坊出现相反结果。

## 已确认的问题

| 项目 | 证据与用户影响 | 建议 |
|---|---|---|
| 转动后的命中体积扩大 | `Target::posed` 将转动后的长方体转换成更大的轴对齐包围盒，并把它用于精确命中，而非仅作粗筛 | 用逆变换后的射线测试原始盒，保留粗筛；绕空角的弹体不应命中 |
| 模块健康可以变负 | 实际 WASM 测试中 100 健康的炮管受击后状态为 −63.061，报告却显示 0 | 在统一损伤入口限制健康范围，保证持久状态、事件与回放一致 |
| 主炮故障连带独立武器 | T-10M 主炮炮闩置零后整车 `can_fire=false`，Oplot 模块仍有 60 健康；`trigger` 在选择武器前直接返回 | 按实际武器实例的依赖检查，区分主炮、独立炮塔、机枪和导弹架 |
| 降级后无法主动修复 | T-34-85 引擎剩余 25% 时动力系数为 0.6，却拒绝修复；归零后才允许，需 10 秒 | 允许低于战地修复上限的可修模块进入修复；保留 60% 上限与 F 三秒准备 |
| 兼任乘员信息被浏览器丢弃 | `targetDef` 重建 crew 字段时遗漏 `also`；T-34 1940 的车长兼炮手与 BMPT 的兼任岗位在原数据中确实存在 | 将兼任字段送入同一核心，验证该乘员死亡、换位与后续恢复 |
| 轻伤后果较粗 | 引擎只取 0、0.6、1 三档；变速箱和方向／高低机多在归零后才改变能力 | 健康比例驱动可控的功能衰减，满健康车型性能保持原数值 |
| 运行数据与模块 schema 不完整一致 | 运行时支持 APS 枪、雷达及 rounds，当前 `modules.schema.json` 的枚举／字段不完整 | 同步公共定义与校验，避免真数据被误判或新增关联被静默丢弃 |

“炮闩损坏影响独立武器”由实际核心能力输出和运行入口共同确认；这不意味着所有独立机枪调用入口都被同一条件阻止，实施时需要逐个检查。兼任字段遗漏已从实际数据和适配器确认，其功能后果应加入新回归。

## 实际核心基线复现

使用仓库现有 `tg_design.wasm`，不是 JS 数值替代。

1. 单一炮管盒中心 `(0,1,0)`、半尺寸 `(0.1,0.1,1)`，炮塔 45°。射线由 `(0.7,10,-0.7)` 向下。该点在真实旋转盒之外，当前核心却报告炮管被击毁；同射线在炮塔 0° 时未命中。这是扩大包围盒空角误判，不是模型穿模。
2. T-34-85 引擎剩余 75%、25%、0% 时分别返回动力 1、0.6、0；前两者拒绝修复，归零才允许。
3. T-10M 主炮炮闩损坏时，独立 Oplot 枪保持健康，但整车开火开关关闭。

测试只调查现状，没有改变数据、核心或页面。本地浏览器限制继续遵守，没有浏览器实景验收。建议首轮修正这些基础一致性问题，再根据用户选择增加舱室火灾、弹药热失控和更细的武器机构。
