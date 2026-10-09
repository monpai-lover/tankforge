# HVSS 与 M113/M901 成对负重轮修复（2026-10-10）

范围为 `us_m4a3_76w_hvss` 与 `us_m901_itv` 的程序行走机构；未修改任何来源 GLB、进口轮组、武器、装甲、乘员或动力参数。

## 已确认的问题与依据

前轮现实性审计 F4 已区分 **6 个纵向轮站** 与 **12 个轮片**：M4A3(76)W HVSS 原本每侧的六项 `x=0,w=.42`，每项由运行时生成一个宽实心轮。真实 HVSS 的内外轮片分别装在同一轮轴两侧。此次实际读取 [The Sherman Tank Site HVSS 技术页](https://www.theshermantank.com/about/sherman-suspension-and-tracks-the-page-an-easy-to-find-place-for-sherman-suspension-info/horizontal-volute-suspension-system-23-inches-of-ground-pressure-reducing-goodness/)，并检查该页的原始技术插图：

- [Figure 13-1：HVSS 总成 7067331 正面／侧面](https://www.theshermantank.com/wp-content/uploads/HVSS-assembly-7067331-front-and-side-views.png)：分离轮片、中间悬吊臂、横置弹簧、上部避震与车体安装托架。
- [Figure 13-2：悬吊臂与轮片分解图](https://www.theshermantank.com/wp-content/uploads/HVSS-suspension-arm-and-wheel-exploded-view.jpg)：C135843 轮总成、C135844 轮盘、C135846 轮毂及 C135847 轴；实心碟面和八颗大螺栓，而不是通长黑色假减重孔。

M901 继承 M113 行走机构。此次实际读取 [TM 9-2350-261-20-1，网页第 84 页](https://www.nsndepot.com/Library/TM/TM-9-2350-261-20-1?PageNumber=84)，其“TRACKS AND SUSPENSION COMPONENTS”明确写出每侧十个 road wheels、五个 road wheel arms；不能把十个轮片当作十个独立纵向悬吊站。此页标为 `0003 00-9`（网站页码 84），不把不同印次的 1-30 页码混为同一印刷页。[AFV Database M901 图录](https://afvdatabase.com/usa/pics/itvm901/itvm901.html)也已读取，含来自 TM 9-2350-259-10 C4 的原始视图；它们支持车型结构，不提供本次轮片间距的独立实测认证。

## 修复结果与生成来源

| 项目 | HVSS | M901/M113 |
|---|---|---|
| 每侧轮站／轮片 | 保持 6 站，12 片 | 保持 5 站，10 片 |
| 单轮片宽度 | .16 m | .09 m |
| 轮片相对履带中线 | ±.13 m | ±.105 m |
| 胎面间净隙 | .10 m | .12 m |
| 两片合计胎面外包络 | 保持 .42 m | 保持 .30 m |
| 轮片材质／形状 | 新 `hvss_dish`：橡胶胎、实心碟面、八颗短面螺栓、窄轴／轮毂 | `rubber_dish`：恢复橡胶胎；窄轮片使用短面螺栓，避免原通长螺栓侵入导齿槽 |

履带宽、厚度、中线、节距、主动轮、诱导轮、托带轮及现有轮轴 `z/y/r` 不变。运行时已按相同 `z` 去重，因此多个轮片共享原悬吊站；两个轮片及各自轮毂一起升降、旋转，不再额外绘制同位宽胎。履带仍只采样六／五个纵向支撑点，左右各一圈。

HVSS 补入每侧六个窄中央臂，以原有横置弹簧和车体托架连接轮轴。原弹簧中心 `y=.44` 与深 `.30 m` 台车块穿入静态轮缘；弹簧改为 `y=.66`，横向安装片改为 `.50×.06×.14 m`、中心 `y=.68`，处于静态轮顶与上履带之间。所有中央臂使用程序棱柱显式绘制在左右两侧，不依赖 `prism` 不支持的镜射字段。

`tools/procedural_running_gear.py` 提供两个无文件写入的函数：

```python
from procedural_running_gear import apply_hvss_running_gear, apply_m113_running_gear

# tools/gen_vehicles.py 的对应 builder 中：
# sherman() 的完整返回规格经 apply_hvss_running_gear(spec) 返回；
# m113_tow() 的完整返回规格经 apply_m113_running_gear(spec) 返回。
```

函数修改并返回传入的完整规格，按轮站去重后重新建立轮片，重复调用不会增加轮片／中央臂；错误轮站数会报错。这里只定向更新两份 `visual.json`。`schemas/visual.schema.json` 增加 `hvss_dish` 枚举；不需要修改 `tankmodel.js` 的消费者契约。

## 验证与限制

新增 `client/web/test/hvss-running-gear.test.mjs`，在旧数据上实际观察到六项断言失败，然后在修复数据上六项全部通过。覆盖真实轮片网格的胎面净隙、无重复胎面三角形、导齿槽仅由窄轮轴跨越、胎面位于履带以内、静态履带路径不增加轮站、左右独立升降／旋转、轮毂跟随轮节点，以及远距离 LOD 同步复位。

`client/web/test/procedural-running-gear.test.py` 在缺少可重建 helper 时实际断言失败，随后两个测试通过：直接调用真实车辆 builder 与 helper 可以重建这两份行走机构／支撑件；轨带／动力等无关参数不被重写，重复调用结果一致。`node --test test/hvss-running-gear.test.mjs test/tank.test.mjs` 为 16/16 PASS；既有路面、颠簸、HVSS 单侧台阶、障碍与网络悬吊重建回归通过。

将当前 `wheelGeometry` 与修改前 `HEAD` 实际输出比较：四种既有轮型 × 五个宽度（.12、.16、.23、.30、.42 m）共二十个变体网格逐字节一致。除新 HVSS 轮型外，共用函数的变动只作用于宽度小于 .10 m 的窄轮片螺栓；`git diff --check` 通过。

轮片间距、细部尺寸和中央臂轮廓是有来源结构依据的建模估计，未从原始比例尺独立量测。中央臂、弹簧与安装片仍使用本项目固定于车体的近似；此次没有将真实 HVSS 的所有连杆与避震器改为完整机械铰接。M901 通用碟面仍沿用现有程序细节；不是逐颗螺栓的历史复原。实际浏览器多视角证据及整体车队动态验收由本轮主流程另行记录，不把这些局部网格测试称为全部姿态无穿模的证明。
