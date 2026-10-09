# 2026-10-10 全程序车队模型检查与修复

本轮覆盖全部 **27 款未加载整车模型的程序车辆**。按实际 `bundle.model` 判断范围，不能按 `vehicle.model="model.glb"` 占位字段判断。15 款已提供／已导入整车模型排除；原始 GLB、packed 模型、共享机枪资产及既有设计局 WASM 单独检查字节不变。

## 修复内容

- M4A3(76)W HVSS 改为每侧六站、每站内外两个轮片，留出中央导齿通道并补台车轴／支承；M901 改为每侧五站橡胶缘双轮片。保持原轮站、履带路径及轮组外包络。HVSS 连杆仍是简化静态结构。
- M8／M10 把乘员上半身移回炮塔内，保留原职责；两车使用已有程序炮闩随炮管后坐，避免出现重复的通用炮闩。工坊新装炮塔仍显示自己的炮闩。
- 对八款开放车辆检查实际乘员的转炮／装填动作；修正六车十个站位的下肢外露，九个坐姿站位有真实坐垫与地板支柱。M10 装填手保留站姿，其较高站位已另作侧面人工复查，仍注明是网格避让估计。
- 三款 FlaK38 修正后部机匣长度、固定侧架／横梁／瞄具及支承，保留耳轴、炮口、口径和原射界。M901 锤头改为有净空的叉形支承，保留双发射管与枪口方向。
- 九款屋顶机枪按实际枪体活动范围提高支点并等量延长支柱，保留底座位置；Hetzer 使用无步兵肩托的遥控 MG34 显示变体。高度为本模型的避让估计，未冒称原厂实测尺寸。机枪射弹与闪光改从可见枪管的真实枪口发出。
- Pz.IV H 与 RSO PaK40 的俯角随方位考虑满后坐包络，只在会碰甲板／驾驶舱的方向收限。机械武器参数保留。
- Flak38(t) 前折板使用独立止点，天线与后罐避让，保留其余七板原结构。八块上折板的 **16 个三角装甲单元**从可见源面直接派生，准确保留多边形、厚度及铰轴；折下后不再留下空中隐形装甲。固定下墙保留。
- RSO 两型修正为后驱、前端有齿张紧轮，两端齿圈跟随对应履带相位；IS-2 固定 DT 移至右肩／座圈旁，开孔枪管与武器炮口同步。
- RSO PaK40 的两处驾驶井、独立盖板及地板内弹药箱按同期照片修正。I 键展开盖板；动作中火炮收束至正前 ±0.05°，完全打开后允许全周回转，关盖会等待火炮回正。顶面／盖板的活动防护同步，地板弹药显示与损伤单元避让燃油箱、端轮、满行程路轮，并固定在车体上。
- 后期钢缘轮 Tiger 标为 1944 年；具名早期 M1A1 的 M4A1(76)W 移除误复制的制退器，保留原枪口位置。M1A2、CMP 六磅炮的既有配置保留。

最终验收数值见文件末尾的交付记录。

## 逐车覆盖

每款均有正前、前斜、侧、后、俯视五张实际 WebGL 图，共 135 张；另检查合法仰角／俯角、后坐、屋顶机枪及可用折板。表中“保留”表示本轮没有证据支持再改该结构，并不代表每个截面尺寸都已经历史测绘。

| 车型 ID | 本轮处理／判断 |
|---|---|
| de_pz3_j | 检查六轮站、车体／炮塔与炮盾接口；保留 |
| de_pz4_h | 修满后坐炮口与后甲板／侧支条碰撞方向的俯角 |
| de_tiger_e | 保留晚期钢缘轮外形，年份修为 1944 |
| de_panther_g | 检查交错轮、斜车体、炮盾与炮口；保留 |
| de_panther_f | 保留方案型身份，检查窄炮塔及枪座接口 |
| de_sdkfz234_2 | 检查八轮、轮罩及炮塔；保留 |
| su_t34_1940 | 检查五轮、早期炮塔与炮盾；保留 |
| su_t34_85 | 检查五轮、85 mm 塔及后坐接口；保留 |
| su_is2 | 修 DShK 支承／活动避让及右肩固定 DT |
| su_t54 | 修装填手侧 DShK 支承／活动避让 |
| us_m8 | 修炮塔内乘员、重复炮闩及 M2 支承 |
| us_m10 | 修炮塔内乘员、装填手下肢、重复炮闩及 M2／配重避让 |
| us_m4a2 | 修 M2 与杯塔避让，保留晚期 75 mm 外形 |
| us_m4a3_75w | 修 M2 与杯塔避让 |
| us_m4a1_76w | 修 M2 支承及早期 M1A1 无制退器枪口 |
| us_m4a3_76w_hvss | 修双轮片／台车连接及 M2 支承，保留 M1A2 制退器 |
| us_m901_itv | 修橡胶双轮片及全仰角锤头支承 |
| uk_cromwell_iv | 检查五大轮、无托带轮及 QF75；保留 |
| xp_w78 | 用户原创，检查四轮支撑、炮塔／炮管运动，不套用历史车型 |
| de_pzjg1 | 检查五轮、开放后部、47 mm 炮及固定护盾 |
| de_flakpz38t | 修 FlaK38 炮座、折板／附件避让、活动装甲与乘员脚部外露 |
| de_hetzer | 修屋顶遥控 MG34，保留此前参考修形与工坊换头 |
| de_hetzer_flak | 修 FlaK38 炮座与乘员下肢，保留用户组合方案及开放上舱 |
| de_rso_flak | 修 FlaK38 炮座、乘员与后驱／前有齿张紧轮；具体改装身份仍待档案支持 |
| de_rso_pak40 | 修驱动端、满后坐俯射、驾驶井／活动盖板、地板弹药储藏与乘员 |
| uk_cmp_portee | 修乘员下肢与支承，检查四轮车架及尾向射界，保留可存在的六磅炮制退器变体 |
| proto_a | 原创测试车，检查闭体、支撑和炮塔／后坐，不捏造历史类型 |

排除的导入车型：`su_t10m`、`su_bmpt34`、`us_m56`、`xp_kda35`、`de_gepard`、`de_aufkl_panther`、`de_vk1602`、`de_hetzer_mk103`、`de_hetzer_mk103_camo`、`de_sdkfz140_1`、`de_hetzer_sdkfz1401`、`xp_bmp_k64`、`xp_bmp_k64_atgm`、`xp_bmp_k64_kornet`、`su_att_m46`。

## 来源与可复现检查

完整历史型别核对、读取成功／失败的来源和未量测限制见 [27 车历史审计](procedural-reality-audit-2026-10-10.md)。几何工具与修前候选见 [几何证据](procedural-geometry-audit-2026-10-10.md)。专项修复见 [轮组](hvss-model-refinement-2026-10-10.md)、[炮座](procedural-mount-clearance-2026-10-10.md)、[屋顶机枪](procedural-pintle-repairs-2026-10-10.md)、[车体细节](procedural-hull-details-2026-10-10.md)、[乘员](procedural-crew-clearance-2026-10-10.md)。

局部重建使用 `python tools/rebuild_procedural_models.py --ids=<明确的逗号分隔 ID>`。修复集中在有 ID 边界、可重复执行的源 helper，普通 `write_vehicle` 也应用它们；不为局部修复重写整队、共享弹药或导入资产。

```sh
npm --prefix client/web test
cargo test --workspace
cargo run -p tg-tools --bin validate -- data --strict
npm --prefix client/web run build
node client/web/tools/procedural-fleet-audit.mjs --out=client/web/dist/procedural-audit/final.json
node client/web/test/procedural-fleet.browser.mjs
node client/web/test/procedural-extremes.browser.mjs
node client/web/test/procedural-pose.browser.mjs
node client/web/test/hetzer-workshop.browser.mjs
node client/web/test/workshop-refresh.browser.mjs
node client/web/test/folding-flaps.browser.mjs
node client/web/test/rso-pak40-firing.browser.mjs
```

Python 源回归另见 `client/web/test/procedural-*.test.py`、既有 Hetzer builder 与 folding-source 测试。

## 验收界限

扫描以真实运行时网格和节点变换为依据，检查闭体拓扑、固定连接、离散合法枪姿态、后坐、折板和屋顶机枪。正常炮盾套筒、耳轴、铰链接合与开放战斗室不会当作孔洞或穿模。机枪枪口另通过真实开火特效检查，不能只比较两个复制同一公式的坐标。

离散姿态和截图不能证明连续运动的所有组合绝无穿模。悬挂连杆细节、不同制造批次附件、完整炮盾曲率、屋顶枪座高度及多数截面仍有建模估计。软件 WebGL 捕获用于外观验证，不提供硬件帧率结论。原创／待证改装始终保留其身份，不宣称已达到历史测绘精度。

## 本轮验收记录

- 27 款程序车全部检查，17 款车型数据有修复；15 款导入车及共享资产共 155 个保护文件与基线 `afbab48` 字节一致。
- 最终真实几何扫描为 **19,159 个合法离散姿态，固定浮空候选 0**。已确认的外露穿模各有针对性回归；报告仍保留正常炮盾／套筒／耳轴／铰链接合，不能把其候选总数当作未修 bug 数。
- 整体网页 **228/228 PASS**；Rust 工作区 **206 PASS、4 个既有 ignored**。最终数据另跑严格校验 **0 错误、0 警告**，并复跑 vehicle／combat 46 项。
- 26 个支持的源 builder 在内存重建后与公开数据七个文件逐项一致；17 款修改车实际连续重建两次，所有车型／资产文件哈希保持完全不变。Prototype A 沿用独立旧 patcher，本轮未重建它。
- 真实 WebGL 基础五视角 135 张、全车合法仰／俯姿态 54 张，修改车再拍；人工检查全部车型图及重点活动姿态。九款屋顶机枪真实开火的闪光与显示枪口误差均小于 1 cm。
- Hetzer 两类实际工坊换头路径、工坊武器／瞄具／导入／导出、既有 I 键挡板和 RSO 新开井／安全关盖通过实际浏览器回归。
- 独立审查发现的 Flak38(t) 隐形折板装甲与 RSO 地板弹药／驱动轮交叉均复现后修复，最终审查没有剩余已确认 P1／P2。

本地截图与机器记录保存在 `client/web/dist/verification/procedural-*`、`rso-firing-final`；几何候选 JSON 在 `client/web/dist/procedural-audit/final.json`。这些验收输出为本地生成物，不把大批截图放入源码提交。
