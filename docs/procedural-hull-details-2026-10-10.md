# 局部车体与折板修复记录

本文件对应 `tools/procedural_hull_details.py`，只提供可重建的源规格字典修正。
每个函数原地修改并返回字典，不读写车型文件，不修改导入整车，重复应用结果不变。
主任务负责接入生成流程、定向重产车型、渲染器接入与实际游戏视图验收。

## Flakpanzer 38(t)

`apply_flak38t_fold_clearance(spec)` 保留八块折板的原顶点、厚度、面和铰轴。
Praga档案图已实际查看：侧板落到固定下战斗室外侧，前板落在发动机舱盖上方。
照片不支持所有板都变成统一的水平平台，也未独立量出原厂止点。
[Praga档案照片及说明](https://panzernet.net/domains/panzernet.net/panzernet/en/flaky/flak38t.php)

运行时几何复现了前板在44%行程撞天线、75%行程切入发动机盖、全折切入车体，
以及右后斜板全折撞后部罐体。修复把长直前板的相对转角止点设为116°，其余七板保留
168°向外下折。116°是当前模型舱盖净空的工程适配值，绝非原厂量测角度。
天线和底座沿同一发动机甲板前移至 `z=0.80`；原后部罐体下移至 `y=0.95`，由小支架
连接原下车体。罐体、天线和八块板都保留。

测试使用 `runtimeParts` 构建游戏真实节点，并以 `surfaceCrossings` 检查0至100%的
101个行程采样。折板与每个固定车体部件没有超出铰轴32mm接合区的表面切入。
另查板与板，允许原10mm厚板边缘12mm内的斜接缝；没有新增的板面贯穿。
`touches` 验证天线接底座、底座接甲板、罐体接支架、支架接原下车体。
这是密集离散采样证据，未声称连续数学全姿态证明。

## IS-2固定DT

`apply_is2_hull_mg(spec)` 把原中央首上短管换成右炮塔座圈肩部的小开口和短管。
200厂原始1944年工程信附件已经实际查看，开口位置确在右肩；原信主张删枪，不能用来
证明所有1944型实车已删枪。[原信与CAMD RF 38-11355-2245，第240—241页附图](https://www.tankarchives.com/2019/05/great-minds-think-alike.html)

可见枪口置于 `[1.335, 1.49, 1.605]`，保留固定DT与原 `[2,2,2]` 小射界。
现有 `main.layMg` 从车体机枪数据转轴沿瞄准方向前移0.30m，因此 `position_m` 使用
`[1.335, 1.49, 1.305]`，中立姿态的发射枪口与可见枪口一致。
这些数值由当前右侧斜面及座圈位置适配，未从原图独立量测。黑色小开口嵌入现有肩部，
枪管从开口伸出；枪管为12分段的开口小管，实际口缘中心与武器中立姿态发射点一致。
测试验证管身清除原肩部表面、开口连接肩部、管身连接开口。
车体前两块原壳体、装甲、主要武器及同轴／车顶机枪信息保持原值。

## RSO与PaK40/4

`apply_rso_drive_roles(spec)` 对 `de_rso_flak` 和 `de_rso_pak40` 把后端指定为驱动轮、
前端指定为张紧轮。两个原端轮的中心、不同高度、半径、四站路轮与轨带轮廓都不变。
前张紧轮增加 `teeth` 元数据。12齿继承原源规格估计，未称历史精确数值；运行时仍按
实际闭合履带节距匹配齿圈。

1945年美国军械目录明确后端减速驱动及前后端轮制动；PaK40/4资料独立说明沿用原RSO
底盘、后端传动和前端有齿制动张紧轮。因此该修正适用于两者共同底车。
[1945年原始目录](https://www.lonesentry.com/ordnance/2010/03/14/raupenschlepper-ost-steyr-typ-rso01-full-track-light-prime-mover/)、
[PaK40/4底盘说明与照片](https://panzernet.net/domains/panzernet.net/panzernet/en/stihace/rsopak40.php)
具体2cm FlaK改装身份仍未取得独立档案证明。

### 渲染器接入片段

该段由主任务在其他渲染器编辑完成后接入；本子任务没有编辑 `tankmodel.js`。
仅交换源端轮角色会让前轮丢掉齿圈，因此必须配合下面的分支，并让前轮按闭合轨带齿距
相位转动，避免普通轮转角覆盖齿圈对位。

在现有驱动轮 `teeth` 计算后：

```js
const idlerTeeth = rg.idler.teeth
  ? Math.max(8, Math.round((Math.PI * 2 * (rg.idler.r + rg.track_thickness / 2)) / pitch))
  : 0;
```

用以下段替换原单句 `addWheel('idler', ...)`，并扩展 `sides.push`：

```js
const idler = addWheel('idler', rg.idler,
  shared('idler', () => wheelGeometry(rg.idler.r, rg.track_width * 0.6, 'steel_dish', mats)));
if (idlerTeeth && !idler.node.imported) {
  const ring = idler.node.add(new Node('idler_teeth'));
  ring.mesh = shared('idler_teeth', () =>
    sprocketGeometry({ ...rg, sprocket: rg.idler }, idlerTeeth, pitch, mats, side).teeth);
  ring.kind = 5;
}
sides.push({ side, sprocket, idler, idlerPhaseLoop: {
  front: staticLoop.front, rear: staticLoop.rear,
  sprocketFront: !staticLoop.sprocketFront,
} });
```

在 `updateRunningGear` 中，现有驱动轮相位更新后：

```js
if (idlerTeeth && !sd.idler.node.imported) {
  // Reuse this side's scratch view; avoid allocation in the running-gear loop.
  sd.idlerPhaseLoop.front = loop.front;
  sd.idlerPhaseLoop.rear = loop.rear;
  sd.idlerPhaseLoop.sprocketFront = !loop.sprocketFront;
  sd.idler.node.pitch = sprocketPhase(
    sd.idlerPhaseLoop, pins, linkCount, rg.idler, idlerTeeth);
}
```

后续逐轮旋转分支改为：

```js
if (w.role !== 'sprocket' && !(w.role === 'idler' && idlerTeeth && !w.node.imported)) {
  w.node.pitch = (dyn.travel[w.side] / w.r) % (Math.PI * 2);
}
```

当前 `sprocketPhase` 通过 `loop.sprocketFront` 选择前／后包角；取反才能对齐另一端。
`buildLoop` 按物理前后排序，测试证实交换职责后的 `front`、`rear` 与全体路径点逐项不变。
正式接入需再验证两端齿圈实际存在，前张紧轮在不同履带行程仍对齐对应包角，并由主任务
检查实际游戏视图。该片段只改变声明有齿的张紧轮，其他车型保留普通诱导轮。

### PaK40/4开井射击构型的追加修复

`apply_rso_pak40_firing_config(spec)` 追加独立的停放／射击构型。实际在浏览器查看了
同型车的[开井照片rso4](https://panzernet.net/domains/panzernet.net/panzernet/fotky/stihace/rso/rso4.jpg)、
[关盖照片rso6](https://panzernet.net/domains/panzernet.net/panzernet/fotky/stihace/rso/rso6.jpg)，
以及[座位标注图](https://panzernet.net/domains/panzernet.net/panzernet/fotky/stihace/rso/sedatka.jpg)。
两侧驾驶位开口、中间的固定发动机盖、后壁独立座位与齐平地板弹药箱可以清楚辨认。
Panzernet的同型说明支持全周炮座、3mm非淬硬驾驶舱板与地板内弹药储存；该文字属于
二手技术整理，不能代替尚未取得的原厂尺寸图。

修正只在原两块顶盖的平面范围内开井，把原实体楔形驾驶室换成有内外面的薄壳。
原外形、鼻板、侧板与中央发动机顶盖保留；七块固定顶面区域围绕两处开口。
两块原顶盖成为独立的活动盖板，由现有I控制展开。前缘铰轴及180°向前收纳止点是
当前模型的避让适配，未从原厂图独立量测；照片证明开／关盖构型，不能把本止点当成
原厂转角。盖板的长宽与开口沿用原生成源的盖板平面范围，未称历史精确尺寸。

原连续 `cab_roof` 防护单元换成七块固定顶面和两块携带同一铰轴的活动盖板单元，
顶面／盖板使用3mm `skirt`。全开后防护单元随盖板向前转动，不会留下虚假的封闭顶板。
鼻板／侧板原5至10mm RHA数值本次保持原值；它们仍是来源／精确尺寸复核待办，
本次没有把整个驾驶舱防护一并重设。原四名乘员、履带、炮座与全部枪／炮盾零件的
中立位置保持原值。

全周水平回转在旧模型里本来就没有炮／炮盾与车体切入，因此原±30°不能解释成历史
射击射界。全+22°回转时，旧高置弹药箱会在约57°后被炮尾切入；原始失败检查在60°
实际复现。修正以地板齐平箱盖代替高置箱体，对应两处弹药模块使用 `y=0.829`，
箱盖及模块外移3cm至 `|x|=0.75`，给原燃油箱的 `x=0.58` 外边缘与弹药的 `x=0.60`
内边缘保留2cm净空；箱盖和模块纵向同步至 `z=-0.8`，移到后齿圈包角前方。
储藏体收浅至 `half_y=0.055`，保留原横向及纵向尺寸、燃油箱、其他模块和武器容量。
这些位置和深度仍是当前地板／悬挂的适配值。

停放盖板关闭时保留模型原±30°；盖板动作中保守要求炮位保持±0.05°近正前范围；
仅完全打开才允许±180°。元数据使用原生三阶段合同：`0: [-30,30]`、
`0.5: [-0.05,0.05]`、`1: [-180,180]`。零宽`[0,0]`不符合原严格射界检查，
因此使用经实际净空复核、具有极小宽度的范围，没有更改验证器规则。
`foldYawLimit` 取相邻阶段交集，因此0.001、0.49、0.51、0.99及0.999行程仍为±0.05°，
完全1.0才解除收束。现有 `advanceFold` 会先核对下一姿态的方位／俯角，未回正则暂停
盖板；车库会先调整炮位。活动装甲的旋转也使用同一行程，未增加新的运行时字段。

旧36项方位俯角表已在新壳体与全开盖板上重新验证：前向4.25°，前侧与天线邻区3.75°，
其余5°。值被保留是因为实际重新检查通过，并非假定旧表仍适用。全5°前向加满后座
仍会切入固定发动机顶面／前置盖板，不能仅增加全周射界后忽略它。
机械主炮的5°最大俯角及+22°最大仰角均保留。

新检查覆盖360个整数方位、水平／按实际方位表俯射／+22°仰射、零／半／全后座，
共3240个完全开盖姿态，没有枪／炮盾／炮座与车体的表面切入。
另外101个盖板行程检查盖板与固定车体，以及主炮在-0.05°、0°、+0.05°三个方位、
合法俯仰／后座下的扫掠；
明确包括0.99。关盖±30°内的边界方位也检查了相同俯仰／后座组合。
这些是离散几何采样结果，仍需主任务完成实际游戏开井／关盖／I动作的视觉验收。
工坊换头检查确认原开井薄壳、两个活动盖板与齐平弹药箱盖保留，I仍驱动两个盖板。
独立工坊导出也保留七块车体顶面及两个带铰轴的装甲盖板。

追加真实内装复核使用 `buildInterior` 构建实际弹药网格，再以运行时世界坐标的
`surfaceCrossings` 对轮组逐项检查。旧后置深储藏体实际穿过两侧后主动轮与齿圈；
仅前移而保留原0.30m深度时，路轮上抬0.04m又会触及架体，因此一并收浅为单层。
最终实际弹药架体约 `y=0.768..0.89`、`z=-1.25..-0.35`，位于后齿圈前方并高于
原0.12m悬挂行程的路轮顶部。0、0.04、0.12m三种悬挂上抬和六种左右反向履带行程
均没有弹药与轮体、齿圈或实际燃油网格的表面切入。架体与原横贯车体框架相接。
额外核对实际弹药节点固定于车体；炮座转向±90°／180°时储藏架保持原位。
这避免了把地板弹药因自动装配猜测而误挂到旋转炮座上。
传给 `targetDef` 的中心也保持在原炮座 `pivot.y - 0.12` 门槛以下，和Rust权威伤害模型
的车体／炮座归属判断一致。小容积架体是代表性伤害／显示区域，两架共四枚显示弹不能
当成整车全部弹药的装载容积；保留武器弹量未声称这个小模块能装满全部携弹量。

## 检查命令

```text
node --test client/web/test/procedural-hull-details.test.mjs
python client/web/test/procedural-hull-details.test.py
node --test client/web/test/rso-pak40-firing-config.test.mjs
cargo run -p tg-tools --bin validate -- data --strict
```

Python检查源字典变化范围、重复应用、原八板与铰轴保留、IS-2原装甲／其他武器保留，
以及与独立 `apply_flak38_mount` 的应用顺序兼容。JavaScript检查真实几何与履带契约。
追加Python检查PaK40/4构型的幂等性、原枪／乘员／底盘保留、鼻／侧装甲不变、弹药
模块有限下移，以及与RSO端轮职责修正的应用顺序兼容。
完整生成器检查包含原模块加 `tracks_modules(spec)`；弹药箱初次下移时与燃油箱角部
出现M006，检查实际失败后将模块和可见盖同步外移3cm，重新运行已无模块相交或其他
生成器几何问题。没有添加豁免或放宽检查。
最终±0.05°过渡元数据与对应车型写入后，完整Rust严格检查返回0错误、0警告；
本子任务JavaScript共14项、Python共8项；最终储藏站位更改后需重新运行完整严格检查。
测试通过不代替主任务的浏览器视觉、完整车队复查或发布验收。
