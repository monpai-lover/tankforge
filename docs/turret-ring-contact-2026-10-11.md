# 炮塔座圈与炮架承载修复

日期：2026-10-11。检查以 TankForge 当前运行时三角形和真实节点变换为准；完整主体经座圈／支架到车体的连通路径才算承载，单个底座接触车体不能证明炮塔不浮空。

## 本轮修复

| 车型 | 原问题 | 修复 |
|---|---|---|
| Tiger I `de_tiger_e` | 炮塔底与车顶约 40 mm 支承空隙 | 加中空承载 collar，保留原转轴 |
| Panther G/F | 底与车顶约 30 mm | 加中空 collar，保持两型各自炮塔 |
| M4A1(76)W、M4A3(76)W HVSS | 原环触及车体，但与主壳约 52 mm 脱开 | 将原实心薄盘改为接壳的中空环 |
| Hetzer FlaK、RSO FlaK | 侧架下脚高于原转盘约 25 mm | 延伸固定侧架底脚，上沿和耳轴不移动 |
| RSO／PaK 40 | 原座与火炮摇架之间约 110 mm 缺连接；乘员软垫的靠近不能算承载 | 增加固定耳轴叉架、销轴和炮盾支撑，保留原火炮轴 |

共八款程序车型。车体、炮塔轴、炮口、武器、装甲、模块、乘员、发动机和悬挂参数保持。中空环保留中央通道，不以实心柱填满车内。

工坊原先按名义车体高度生成支筒，追猎者斜顶和偏前／后加装位置会产生浮空。现在在建造时对固定车体真实三角形，以32段环的内／外缘采样下沿；零抬升但实际有间隙也生成贴顶中空底座。旋转炮组、MG、车轮和铰接挡板不作为支承面。没有可支承足迹时返回明确的 `unsupported` 诊断，保留原自定义转轴和派生战斗坐标。

## 保留项

- 原始 GLB／packed 模型不改。BMP-K64 原模型约13 mm接缝作为来源候选保留，本轮没有用新座柱填它。
- W78 约200 mm高差由原支筒实际连接，保留；T10M 的附加炮塔挂在真实父炮塔，原约3 mm回转缝保留。
- 追猎者换头、保留原炮塔再加装、导入底盘的工坊模型导出／再解码保留。
- I 键侧板、各枪原俯仰范围、X 光淡出和模型资源释放沿用原接线。

## 源与验证入口

源修补：`tools/procedural_turret_seats.py`、`tools/procedural_mounts.py`，由现有 `procedural_refinements.py` 调用；工坊连接：`client/web/src/game/turretSeat.js`。

```text
node --test client/web/test/turret-seat-contact.test.mjs
python client/web/test/turret-seat-source.test.py
node client/web/tools/turret-seat-audit.mjs --workshop --out=client/web/dist/verification/turret-seat-audit.json
```

测试检查真实承载链、合法旋转、PaK俯仰／后座扫掠、无支承诊断、战斗资料保护，以及工坊导出再建模型。审计覆盖车库42款主／附加炮组的129个合法姿态，以及128组代表工坊配置的384个姿态。逐车结果见 [全车审计](turret-seat-fleet-audit-2026-10-11.md)。

源码提交 `fd8aab153ba2dc0e7e2de8d0d7955bc1ecd9067b`。主代理独立完整网页回归414项通过、0失败；Python座圈、炮架、行走机构及全生成器再生／幂等8项通过。八车保护的战斗／乘员资料组合SHA-256为 `21482f7ad59bdfb762d86abdce99c6b664618c7f51511a8112ae20136f75e6c8`；19个原始模型／WASM／packed／MG资产与基线相同。

实际release核心编译及网页构建成功；编译产物、资产和网页内嵌核心SHA-256均为 `6f542f80e38ea9c65f059eb1f3a489658dbabe26e51cae883021414e4e542ce3`。座圈修复网页SHA-256为 `95130c2a34dbb8bb8bfcf1c01662f2769f951b517e592ef8db312ab6bedc8ea1`。此核心和功能沿用已有模块损伤版本。

本轮使用CPU真网格验收，未进行浏览器实景验收。

独立规格与质量复审均通过；复审另以0.01mm接触容差检查修复接合，并对109个实际生成collar确认有限值、正确朝外法线及闭合网格，无退化／非流形边。主代理独立重跑全审计得到42车129姿态、128工坊384姿态；唯一保留候选仍为原BMP小缝。
