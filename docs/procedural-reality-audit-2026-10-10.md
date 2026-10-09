# 程序车队现实结构复核（2026-10-10）

## 范围与判定边界

范围按本轮开始时 `client/web/tools/load-data.mjs` 实际 `loadData()` 的结果确定：42项车库中，27项没有已加载的 `model`，15项有已加载的导入模型。这里的“程序车型”只表示运行时整车 bundle 没有 `model.json`；屋顶机枪仍可能使用已提供的公共机枪资产，某些程序形状曾用用户图面或参考模型量得的数值重建。`proto_a` 的 `vehicle.model` 虽写 `model.glb`，但加载器不会加载该值，故也在本次范围内。

本报告独立读取了设计、实现计划、`SOURCES.md`、前一轮现实审计、27项 `vehicle/visual/weapons`、生成源及轮组渲染代码。历史外形证据优先采用原始技术手册、制造商档案照片、实物研究照片和博物馆记录；二手技术汇编只作交叉检查。未下载、导入或使用新的商业游戏美术。

这里是**历史身份及可辨认结构的复核**，不是27辆的博物馆级比例认证，也不替代主审计的实际浏览器姿态、部件连接及碰撞检查。主审计已保存27辆的五视图于 `client/web/dist/verification/procedural-fleet-baseline/`。本报告直接查看过 M4A1(76)W 左视、M901 前左视、Hetzer 顶视，及下文指定的原始参考图；其他车型的完整视图判断由主审计记录承担。表中“保留”仅指没有足够证据要求改变该项结构。

- **确认差异**：具名配置与具体来源冲突，或程序几何明确遗漏已确认的结构。
- **近似**：类型特征可解释，但截面、板折点、细部、制造批次或独立实测不足。
- **方案／原创**：按该设计的连接、姿态和自述检验，不强求不存在的量产实车。
- **待量测**：有可复查候选，但不能据不同尺寸定义直接改模型。

尺寸必须同义比较：`hull.size_m=[宽,车体高,车体长]` 不是整车高或含炮全长；有些“overall”还包括翼子板、裙板、排气及制退器。炮管名义长度、炮耳轴至炮口距离与炮盾外露长度不同。轮站数、轮片数、悬挂臂数也不同。

## 可直接提交主修复流程的差异

### R1：Tiger后期钢缘轮配置的年代

本轮 baseline 的 `de_tiger_e` 年份是1943，`based_on` 却明确是后期铸造指挥塔／钢缘轮，`running_gear.wheel_style=steel_dish`。Hamby引用Jentz/Doyle变更表明确把钢缘轮的引入放在**1944年2月**。最小修正是把这个已存在的配置标为1944，不要为了保留1943而把轮组改回中期橡胶轮。该变更表不要求模型同时具备1944年所有后来出现的细节。[变更表](https://www.alanhamby.com/changes.shtml)

### R2：M4A3 HVSS的六轮站被合成六根宽轮

`us_m4a3_76w_hvss` baseline 每侧六条轮记录均 `x=0,w=0.42`。渲染器把每条生成一根实心宽轮，不能表示内外轮片的中间间隙。HVSS原始分解／截面图显示每个纵向站的两片轮；六站应保持，不能改成12个悬挂轴。履带的中央导齿要在轮片间通过。最小修正是每站分成内外两片轮，同时保留轮站位置、轨宽与真实接地高度；片宽、偏移和间隙如未按原图量取，继续写为工程近似。[HVSS结构及原始图](https://www.theshermantank.com/about/sherman-suspension-and-tracks-the-page-an-easy-to-find-place-for-sherman-suspension-info/horizontal-volute-suspension-system-23-inches-of-ground-pressure-reducing-goodness/)、[履带原始图与导齿区别](https://www.theshermantank.com/about/sherman-suspension-and-tracks-the-page-an-easy-to-find-place-for-sherman-suspension-info/tracks-they-are-a-weapon-too/)

VVSS四款／M10已使用 `rubber_block` 而HVSS是 `center_guide`，两者不能为了一致而改成同一种导齿。原始图支持VVSS端连接器导齿与HVSS中央导齿的差别。

### R3：M901轮缘材质与双轮片

`us_m901_itv` baseline 是五条 `w=0.30` 的宽轮，`wheel_style=steel_dish`。`track.js` 的这个样式直接把外缘设成 `mats.steel`。M113家族原始维护手册描述每侧**10片路轮、5支轮臂**；原始操作检查还要求检查轮胎橡胶与金属的分离。当前双轮片合并及钢质外缘都不应作为该车实车特征。[TM9-2350-261-20-1，工作包0003 00-9](https://www.nsndepot.com/Library/TM/TM-9-2350-261-20-1?PageNumber=84)、[原始TM9-2350-259-10图与实物照片](https://afvdatabase.com/usa/pics/itvm901/itvm901.html)

最小修正为保留五站及前主动轮／后诱导轮，以橡胶缘双轮片表示每站。不要全局把 `steel_dish` 改成橡胶：Tiger后期、IS-2和RSO钢轮都有不同的来源依据。2.54m车体宽与常见2.69m整体宽暂不列为错误：外侧箱体／履带罩在模型里也贡献整体宽，需量实际总包络。

### R4：M4A1(76)W的M1A1继承了后型炮口套体

`us_m4a1_76w` 的武器ID为 `m1a1_76`，但 `t23_turret()` 和HVSS共用末端0.28m长、半径0.085m套体及0.10m端缘。baseline左视可见这一粗套。原始军械目录1944年3月的76mm Sherman照片是无制退器的炮管；TM9-1308第VII节、图示明确说明带制退器的M1A1C／M1A2构型。实物／档案照片研究也区分了无螺纹M1A1、M1A1C保护圈和后来安装的制退器。[原始1944目录PDF，第22页／PDF第31页](https://www.ibiblio.org/hyperwar/NHC/NewPDFs/USArmy/US%20military%20Technical%20and%20Field%20manuals/Standard.Ordnance.Items.Catalog.Vol.1.1944.pdf)、[TM9-1308原始页47、49及M62安装图](https://www.theshermantank.com/about/sherman-lee-and-variants-gun-data/m1m1a1m1a2-description-and-data-from-tm9-1308/)、[76mm炮塔及档案照片研究](http://the.shadock.free.fr/sherman_minutia/turret_types/76mm_turrets.html)

最小修正是给共用T23函数明确的**无制退器M1A1选项**，把同一炮口位置前的粗套段接成正常炮管；HVSS的M1A2保留制退器并独立检查其气窗。不要仅因表格7.47m和模型字段合算6.86m就把全炮拉长0.61m：后者未包括相同的裙板／后部附件定义，前者明确包含制退器，仍需用同配置的前部外露长度及全包络复核。

### R5：Hetzer远程MG34带入了步兵枪托

baseline `de_hetzer-top.png` 中屋顶MG34尾部可见棕色枪托。实际Rundumfeuer的MG34以无枪托枪身固定在前夹和后挂点之间，枪座是短空心柱和偏心俯仰摇架。实物研究照片明确显示这种形态；1945年情报图同样把它描述为可从车内操纵的有护盾、50发左侧弹鼓的远程枪座。[1977年AFV News实物研究及照片](https://www.pzfahrer.net/hetzermgs.html)、[1945年原始情报简报](https://www.lonesentry.com/articles/remotemg/index.html)

优先给Hetzer屋顶展示一个**去枪托的专用显示变体**，保留提供的公共机枪原文件；再检验偏心俯仰支撑和后部接收机扫掠。不要先增加一根很高的杆来回避多余枪托。实物文章的19英寸“overall height”包括内侧控制构件，不是可直接采用的外露支柱高度。上述来源没有给出可信的固定最高仰角，不能把修复用的限制值冒充历史数值。

### R6：IS-2固定车体机枪的位置

baseline `is2()` 把短枪管放在 `[0.60,1.28,2.78]`，武器炮口是 `[0.60,1.28,2.90]`，位于中央首上附近。1944年200厂原始工程信及附件草图讨论的是炮塔座圈旁**右侧车体肩部**机枪孔；斜首上改变后，该孔把右侧装甲削弱。附件本次已实际查看，不能把这个机枪解释成普通正面球形航向机枪。[200厂工程信，CAMD RF38-11355-2245，第240-241页及附图](https://www.tankarchives.com/2019/05/great-minds-think-alike.html)

这是已确认的位置近似；主审计前／斜视只看到极小的点，视觉影响低于HVSS和M1A1炮口。若修，须在本模型的右肩实际表面上适配枪管及武器起点，保留固定、小射界功能；不在缺少尺寸图时给出未经量测的精确x/z。该信建议删枪，不足以证明所有1944型实车都已经删掉它。

### R7：RSO把驱动端与诱导端反过来

`de_rso_flak`、`de_rso_pak40` 共用 `rso()`，baseline定义主动轮在 `z=+1.62`，诱导轮在 `z=-1.51`，函数注释也说前主动、后诱导。原始1945年Steyr RSO/01目录明确描述传动轴及减速齿轮驱动后端；PaK40/4的实物／技术资料亦描述后驱、前端张紧轮。前端张紧轮也有齿和制动器，因此不能仅把光滑轮与有齿轮交换后便称完整准确。[1945年原始RSO目录](https://www.lonesentry.com/ordnance/2010/03/14/raupenschlepper-ost-steyr-typ-rso01-full-track-light-prime-mover/)、[PaK40/4照片与技术交叉检查](https://panzernet.net/domains/panzernet.net/panzernet/en/stihace/rsopak40.php)

修正应保留前后轮中心的不同高度，把后端指定为驱动端，同时为前张紧轮保留有齿／制动轮形态；核对履带相位、传动节点和装配，不能把整个四轮悬挂倒转。FlaK车本体沿用RSO结构，但**这个具体2cm改装车及1944标签仍未取得独立档案证明**。

## 可辨认结构中的保留项及姿态修复依据

### Flakpanzer38(t)折板不能照搬Möbelwagen

主审计已复现现有上折板在75%／全折状态切入机舱／车体。独立读取并查看了Praga制造商档案中的同型折下照片：上板折到下战斗室外侧，前折板落向机舱盖附近。该图不能支持“全部在90度旋转处变成水平平台”的统一替代。Möbelwagen是另一种全高折板车，不能以它的水平平台证明Flak38(t)的所有终点。[Praga同型折板档案照片及上下文](https://panzernet.net/domains/panzernet.net/panzernet/en/flaky/flak38t.php)

推荐按板分别核对铰轴位置、初始斜角、端点与机舱净空。这里的“水平90度”还容易混淆绝对面板姿态与相对铰轴转角；原图是斜视，尚未独立量出每块转角。安全终点若由本模型碰撞得到，应标为工程适配值，不称原厂量测。开放战斗室和折下后暴露的内部都应保留。[1945原始车型确认](https://lonesentry.com/manuals/tme30/ch7sec5sub5.html)

### 屋顶机枪的实际支撑与合法高仰角

主审计指出IS-2／T-54、M8／M10、四款Sherman及Hetzer在屋顶枪仰起时，后部枪身可能扫入舱盖或车顶。这是姿态装配问题；应先核对资产坐标中的真实俯仰轴与枪座工作姿势，再做最小净空修正。

- M8的原始D67511及D7058824折叠枪座有收纳和升起射击姿势；后型原始资料给出-12°/+85°和360°回转。可按升起的摇架／叉架修模型，不应把它简单限制在30°以隐藏错误。[原始Weapon Mounts及TM9-743图](https://afvdatabase.com/usa/pics/lacm8/lacm8.html)
- Sherman／M10枪座有舱盖／外置座架及不同收纳位置；应按家族选结构、保留现有连接点，以模型实际扫掠检验最小外露高度。主修复量得的提升距离不自动等于历史实测。M10的开放炮塔与后部配重应保留。[TM9-752及实物照片](https://afvdatabase.com/usa/pics/3ingmcm10/3ingmcm10.html)
- T-54(1951)是右侧装填手舱盖的环形DShKM座及弧齿俯仰摇架，不能移成1947型后部滑环枪座，或挪到左侧车长舱盖。Tankograd包含手册式图与实物照片，给出的仰角范围为-5°/+85°；确切支柱高没有本次独立量测。IS-2车长侧枪座需独立处理。[T-54装填手枪座资料及图](https://thesovietarmourblog.blogspot.com/2017/01/t-54.html)
- Hetzer先按R5去掉多余枪托并正确表示偏心遥控摇架，再检查接收机净空。若确有局部遮挡，可实施有来源／实形依据的方位限制，但不能把通用限制伪装成已核实史实。

### 简化制退器与缺少侧向气窗

`muzzle_brake()` 及Tiger、Puma、Cromwell、RSO、T23末端当前主要用轴向圆柱／圆环。`addPart()` 的炮管孔规则只生成轴向膛孔，不能生成实际制退器的横向气窗。原始Puma目录确认KwK39/1有制退器，原始M1A2／M62图可直接看到侧窗。[Puma原始目录](https://www.lonesentry.com/ordnance/2010/01/19/sdkfz-234-german-8-wheeled-armored-car/)、[M1系列原始图](https://www.theshermantank.com/about/sherman-lee-and-variants-gun-data/m1m1a1m1a2-description-and-data-from-tm9-1308/)

这是可见的结构简化，不是所有炮口都被堵死的证明；直炮管的轴向开口由渲染器生成。若修侧窗，需按单／双室或具体制退器样式分家族，不给PaK39 Hetzer和早期M1A1强加制退器。保存炮口／弹道起点与后座一致。尚未按原图独立量取各侧窗长宽，因此优先改确定的型式错误R4；其余保留近似标记和近景检查。

### CMP六磅炮候选撤回

`uk_cmp_portee` 的 `qf6pdr_mk2` 与末端粗套曾被列为候选，因为一般型别说明把MkIV和制退器联系在一起。但澳洲炮兵历史学会引用GM-Holden原始战时生产记录，描述过MkII同长度炮管改成带螺纹、可安装制退器的生产修订，之后才加长为MkIV。故**不能仅凭MkII名称要求删除此炮口**。[GM-Holden生产记录引用，《Aiming Post》2000/1，PDF第8页](https://artillerywa.org.au/archives/2000_1.pdf)、[一般型别说明](https://norfolktankmuseum.co.uk/ordnance-qf-6-pounder/)

该CMP具体车号／炮配置和用户四视图未在本次独立量测。车体2轴、3.98m轴距、向后载炮以及开放驾驶室继续按参考复原看待。

## 27项完整覆盖表

W×L是本轮baseline车体字段的审计索引，**并非本次核准的整车历史尺寸**。此表不把未确认的局部误差升级成整车错误；“复核重点”列给主审计实际截图／姿态检查使用。

| ID | 身份／W×L m | 可辨认结构及来源检查 | 处置／复核重点 |
|---|---|---|---|
| `de_pz3_j` | 历史J长炮；2.95×5.52 | 六小轮站、三托带轮、前主动轮、封闭炮塔及50mm L/60；原始[TM-E30-451](https://www.lonesentry.com/manuals/tme30/ch7sec6sub2.html)确认长炮和六轮悬挂。 | 近似；不拿J早型L/42判本车错误。保留，查看驾驶员板／炮盾接合。 |
| `de_pz4_h` | 历史H；2.88×5.92 | 八轮／四台车、四托带轮、前主动、L/48、裙板；原始[TM-E30-451](https://www.lonesentry.com/manuals/tme30/ch7sec6sub3.html)有四双轮台车。 | 近似；裙板与炮塔折面仍为简化。检查裙板支架及侧向炮塔扫掠；不据一张缺裙板照片删除它。 |
| `de_tiger_e` | 历史后期；3.56×6.316 | 八站交错钢缘轮、无托带轮、直板车体和弯曲炮塔；[变更表](https://www.alanhamby.com/changes.shtml)与原始[技术说明](https://www.lonesentry.com/manuals/tme30/ch7sec6sub4.html)。 | **R1确认**；年1944。交错轮片接近／遮挡是本来结构，不能自动报穿模；炮口近景检查气窗。 |
| `de_panther_g` | 历史G；3.27×6.87 | 八站双片交错轮、前主动、斜首上、L/70、球座机枪；原始[TM-E30-451](https://www.lonesentry.com/manuals/tme30/ch7sec6sub4.html)。 | 近似；下垂直侧板被单斜板近似已公开。G不必一律有后期下巴炮盾；保留制造期差别，不强改。 |
| `de_panther_f` | 历史方案复原；3.27×6.87 | Panther底车、Schmalturm窄塔、两侧测距仪罩和无制退器炮；[现存塔的实物照片](https://www.panther1944.de/index.php/en/the-last-of-their-kind-69360/schmalturm)。 | 方案／近似；现存炮塔不证明整套车型已服役。检查窄塔前盾、罩子支撑及尾向俯角。 |
| `de_sdkfz234_2` | 历史Puma；2.36×5.88 | 四轴八轮、前后转向、封闭炮塔、Saukopf和有制退器KwK39/1；[1945目录](https://www.lonesentry.com/ordnance/2010/01/19/sdkfz-234-german-8-wheeled-armored-car/)。 | 近似；原始IWM侧图是生成源参考但本轮未独立重新量取。检查前／斜视炮口，保持单室型别，不改为PzIII无制退器。 |
| `su_t34_1940` | 历史1940复原；3×6.1 | 五大轮、后驱、无托带轮、焊接小塔、单大舱盖、短L-11及上方复进机；[1940年原始安装信](https://www.tankarchives.com/2019/02/l-11-installation.html)。 | 近似；85型底车复用不是细部同年的证明。外置油桶已从程序1940车移除；检查塔后悬和引擎盖，不添加85型车长塔。 |
| `su_t34_85` | 历史1944；3×6.1 | 五大轮、后驱、无托带轮、铸造大塔和85mm炮；[AWM实物说明](https://www.awm.gov.au/collection/C110416)。 | 近似；AWM明确它的starfish轮是战后替换，不能据此强迫本1944车也换战后轮。轮型和工厂细部仍待具体批次。 |
| `su_is2` | 历史1944；3.09×6.77 | 六钢轮站、三托带轮、后驱、直首上及D-25T双室制退器；原始[200厂草图](https://www.tankarchives.com/2019/05/great-minds-think-alike.html)。 | **R6确认位置近似**；正文给界限。铸造炮塔的三层面片仅为近似；钢缘不改橡胶，检查DShK高仰角。 |
| `su_t54` | 历史1951；3.27×6.04 | 五大轮、第一／第二站最大间隙、后驱、无托带、1951圆塔／D-10T；[手册图与实物研究](https://thesovietarmourblog.blogspot.com/2017/01/t-54.html)。 | 近似；不加T-54A稳定器／大型抽烟器。右侧装填手AA座型式适用；优先检查俯仰摇架和尾部净空。 |
| `us_m8` | 历史M8；2.54×4.78 | 三轴六轮、后双轴组、开放圆塔及37mm；原始[TM9-743图](https://afvdatabase.com/usa/pics/lacm8/lacm8.html)。 | 近似；开放顶部不封闭，检查乘员与内壁、M2升起叉架以及轮罩净空。 |
| `us_m10` | 历史M10；3.05×5.93 | 六轮／三VVSS台车、开放斜面炮塔、后配重、无制退器M7；[TM9-752与原始零件目录图](https://afvdatabase.com/usa/pics/3ingmcm10/3ingmcm10.html)。 | 近似；不拿Achilles的17磅炮／制退器替代。检查乘员手臂和内壁、AA座与盾／配重姿态。 |
| `us_m4a2` | 历史晚型75mm；2.62×5.93 | 焊接大舱盖车体、75mm炮、VVSS；[档案／实物生产研究](http://the.shadock.free.fr/sherman_minutia/manufacturer/m4a2largehatches/m4a2_largehatches.html)支持1943年底的大舱盖生产。 | 近似；1943标签不因47°首上就必错。柴油机后板细部仍需同配置量测；检查AA座。 |
| `us_m4a3_75w` | 历史1944；2.62×5.93 | 焊接大舱盖、75mm圆铸塔、视觉车长塔、VVSS；[原始目录M4系列](https://www.ibiblio.org/hyperwar/NHC/NewPDFs/USArmy/US%20military%20Technical%20and%20Field%20manuals/Standard.Ordnance.Items.Catalog.Vol.1.1944.pdf)。 | 近似；用户四视图本轮未重新量。保留无制退器M3，检查炮盾、AA座和后部油机甲板。 |
| `us_m4a1_76w` | 历史1944；2.62×5.84 | 铸造车体、T23塔、VVSS、具名M1A1；[原始1944目录及TM9-1308](https://www.theshermantank.com/about/sherman-lee-and-variants-gun-data/m1m1a1m1a2-description-and-data-from-tm9-1308/)。 | **R4确认**；用无制退器炮口。全长候选需同义测量，不批量拉伸车体／炮管；检查AA座。 |
| `us_m4a3_76w_hvss` | 历史1945；3×5.93 | 焊接车体、T23塔、76mm M1A2、23in轨／中央导齿；[HVSS原始图](https://www.theshermantank.com/about/sherman-suspension-and-tracks-the-page-an-easy-to-find-place-for-sherman-suspension-info/horizontal-volute-suspension-system-23-inches-of-ground-pressure-reducing-goodness/)。 | **R2确认**；分内外轮片。保留M1A2制退器，检查台车支撑、导齿间隙、AA座。 |
| `us_m901_itv` | 历史1979；2.54×4.86 | 五悬挂臂、前驱、封闭M113车体、双管锤头／中间瞄具；原始[TM9-2350-259-10图](https://afvdatabase.com/usa/pics/itvm901/itvm901.html)。 | **R3确认**；橡胶双轮片。锤头+35°净空与正确斜臂支撑由主审计解决；不要削减仰角来掩盖支撑顶碰撞。 |
| `uk_cromwell_iv` | 历史IV；2.908×6.35 | 五大轮、后驱、无托带轮、平板铆／螺栓塔及QF75；[博物馆同型](https://tankmuseum.org/tank-nuts/tank-collection/cromwell/)。 | 近似；不要改成六磅炮或Comet的77mm。炮盾／首板和制退器近景仍需量测。 |
| `xp_w78` | 用户原创；2.55×6.3 | 两轴4×4、用户四视图车体／炮塔、78mm设计研究炮；当地bundle及`SOURCES.md`是设计身份依据。 | 原创；不给它捏造历史制造商或量产配置。检查轮罩／车体、炮塔旋转、附属机枪／炮口。 |
| `de_pzjg1` | 历史改装；2.06×4.42 | PzI B五小轮、四托带轮、固定护盾、开放后部、47mm炮；[同型实物照片元数据](https://commons.wikimedia.org/wiki/File:PanzerjaegerI.jpg)及用户图面重建。 | 近似；Alkett／Škoda护盾有批次差别，五／七片不能混套。检查盾、后部开放腔及枪座；本轮没有独立测量各片边线。 |
| `de_flakpz38t` | 历史Flak38t；2.15×5.3 | 四大轮、前驱、后置开放战斗室、2cm FlaK38及上折板；[Praga档案照片](https://panzernet.net/domains/panzernet.net/panzernet/en/flaky/flak38t.php)。 | 近似＋主审计确认动态板碰撞；按板调整铰轴／端点，不照搬Möbelwagen。板折起／落下和内装均要复核。 |
| `de_hetzer` | 历史Jagdpanzer38；2.63×4.87 | 四大轮、前驱、右偏PaK39／Saukopf、封闭战斗室、屋顶遥控MG；[实物／遥控枪座证据](https://www.pzfahrer.net/hetzermgs.html)。 | **R5确认**；去枪托显示变体。保留无制退器PaK39与非对称射界，原版参考精修不批量覆盖。 |
| `de_hetzer_flak` | 用户参考组合；2.63×4.87 | Bergepanzer38样式开放上舱、四站Hetzer底车、2cm FlaK38。来源是用户图面，具体改造身份无独立档案。 | 方案／近似；不封屋顶，也不宣称1945量产。检查甲板炮座、后板／排气及主炮全方位俯仰。 |
| `de_rso_flak` | RSO底车＋待证FlaK改装；1.99×3.98 | 四钢轮、无托带、货台与2cm炮；[原始RSO目录](https://www.lonesentry.com/ordnance/2010/03/14/raupenschlepper-ost-steyr-typ-rso01-full-track-light-prime-mover/)。 | **R7底车方向确认**；具体改装仍待证。检查炮平台、木板／座椅连接和前后有齿端轮。 |
| `de_rso_pak40` | 历史PaK40/4载炮；1.99×4.06 | 四钢轮、低开放装甲驾驶台、旋转载炮、PaK40／护盾；原始RSO结构＋[同型照片交叉](https://panzernet.net/domains/panzernet.net/panzernet/en/stihace/rsopak40.php)。 | **R7确认**；后驱／前张紧轮。驾驶员上方开放、舱盖工作姿势需主审计看；不按不同文献全长一律拉长底盘。 |
| `uk_cmp_portee` | 历史类别／参考复原；2×6 | 两轴C60L158in类别、开放No13驾驶室、六磅炮自带小轮架、朝车尾载炮。 | 近似；制退器删除候选撤回。检查卡车／炮架支撑和尾向射界；具体战时车号／MK配置尚未量证。 |
| `proto_a` | 原创测试车；3×6.2 | 六站履带、原创封闭壳体和75mm炮；元数据明确“original design”。 | 原创；按连接、地面支撑及合法炮塔／炮姿态测试，不用历史轮站标准判错。 |

## 本报告的完成条件与剩余限制

27项覆盖已经完成；没有已加载整车模型的条目遗漏，也没有把部分导入整车纳入本次修改范围。确认差异R1-R7应由主修复者按目标车型重建、实际视图及姿态重新检查，最终修复状态由本轮综合验收报告记录。表中不冒用未运行的测试或“已修复”结论。

仍待独立量测：多数炮塔／车体截面、悬挂轮片宽／偏移、精确轮轴距、制造批次小附件、炮盾曲率、每型制退器窗口及屋顶机枪枪座高度。图面／参考模型的生成源自述并不自动等同于历史尺寸认证。IWM与Commons图片有读取失败或限流，不能把未取得的像素计为视觉证据；Praga折板图、MG34实物图、IS-2工程附件、M901原始图、TM9-1308和1944军械目录指定页面则确已查看。

用于核对的下载及临时手册页只保存在仓库外的 `C:/Users/24908/AppData/Local/Temp/tank-procedural-reality-audit/`；本报告未编辑生成源、车型数据、模型资产或网页构建，也未stage／commit。历史类型保留“近似”并不妨碍主审计继续修复已在浏览器暴露的连接或碰撞缺陷。
