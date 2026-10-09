# TankForge 车辆现实一致性审计（只读）

日期：2026-10-09。范围：审计开始时 `client/web/tools/load-data.mjs` 的41项车库名单；`fun_hexa`不在这份名单中。新增“Hetzer底盘 + Sd.Kfz.140/1炮塔”方案不在这41项历史快照内，身份建议另见末节。工作只读生产仓库；仅在仓库外写入本报告，没有修改、删除、提交或推送生产文件。

## 判定范围和限制

读取了 `SOURCES.md`、`tools/gen_vehicles.py`、名单加载器，解析了41项车辆各自的 `vehicle.json`、`visual.json`、`weapons.json`、`engine.json`、`armor.json`。核对重点为身份/年代、尺寸字段语义、轮站/轮轴布局、炮塔形式与火炮命名。另追踪了 `client/web/src/gfx/tankmodel.js` 与 `track.js` 的轮组生成方式。没有把41项全部在浏览器渲染，也没有对每个模型做博物馆实车或正交图像的独立测量。因此这是一轮参数和结构审计，**不是对全部41项外观的全面认证**。

- **confirmed discrepancy**：具体文件值与明确参考资料冲突；结论限定到已指出的字段或身份。
- **approximate**：历史类型可以辨认，但程序几何、估计值、截面复原或简化结构尚未逐项验证。不是“该车错误”的同义词。
- **speculative or custom**：用户设计、模组、未完成方案的现代复原，或真实部件的假想组合；不能宣称为历史量产/服役车型。
- **not evaluated**：本次没有足够的独立证据；不作真/假结论。

`hull.size_m` 是 `[宽, 车体高度, 长]`，不是整车高度或含炮全长；把车体高与博物馆整车高相比会产生假错误。`barrel_length_mm` 和 `muzzle_offset_m` 分别是炮管参数与安装点到炮口的距离，不能混用。轮组 `wheels` 的记录数也不是悬挂轴数：Tiger/Panther在同一z位置有多个内外轮片。公开资料中的轴距、含翼子板车宽、运输履带车宽和含炮长度也需分别匹配。

## 主要发现

### F1 — Tiger I 后期钢缘轮外形的1943年标签错误

**confirmed discrepancy（年代/身份）。** `data/vehicles/de_tiger_e/vehicle.json:9` 写 `year: 1943`，`:11` 将外形明确说成 `late production (cast cupola, steel-rimmed wheels)`；`visual.json:1285` 实际采用 `steel_dish`。生成源 `tools/gen_vehicles.py` 的 `tiger()` 同样同时输出1943及后期钢缘轮。因此不是仅有一个过时文档值。

Alan Hamby的Tiger I变更表引用Thomas Jentz与Hilary Doyle，明确列出：**1944年2月起钢缘轮替代橡胶缘轮**；并说钢缘轮能识别为1944年2月或更晚生产型。现有外形至少应解释为1944年2月后的车，不宜仍用1943作为这个具体配置的时代标签。8个纵向悬挂站、交错轮片本身不是问题。

来源（已实际读取）：http://www.alanhamby.com/changes.shtml
技术规格供尺寸语义比较：http://www.alanhamby.com/technical.shtml

### F2 — Sd.Kfz.140/1 的 KwK 38 炮管长度字段不符 L/55

**confirmed discrepancy（武器参数，不是视觉测量结论）。** `data/vehicles/de_sdkfz140_1/weapons.json:5` 为 `barrel_length_mm: 1900`，口径20mm，等于L/95。`tools/gen_vehicles.py` 的 `sdkfz1401()` 亦写1900。John Rickard的车型技术页列该车为 **2cm KwK38 L/55 + MG42**，L/55名义炮管长度约1100mm。关于KwK38的汇编资料还区分了标准L/55与部分车辆用的较长L/65；两者都不是L/95。

这应先校正参数定义或数值，同时单独复核用户模型的炮口/炮耳轴位置。当前 `muzzle_offset_m: 1.87` 是安装点到炮口的另一种量，可能包含炮的安装几何，**不能直接认定该距离也必须改成1.10m**；本审计没有据它断言外观炮管长了800mm。

技术页（已实际读取）：http://www.historyofwar.org/articles/weapons_aufklarungspanzer_38t.html
交叉汇编：https://en.wikipedia.org/wiki/2_cm_KwK_30 （KwK38标准/Flak长炮管段）、https://en.wikipedia.org/wiki/Panzer_38(t) （Aufklärungspanzer段）

### F3 — Sd.Kfz.140/1 的车体装甲被写得明显偏薄

**confirmed discrepancy（数据与所命名车型技术表不符）。** `de_sdkfz140_1/armor.json` 把车体首上/首下写为15mm，侧面与后面10mm；`vehicle.json` 的notes也重复这组值。Rickard的该车型表列上部结构及车体正面50mm、侧/后15mm。炮塔正面与炮盾30mm一致；炮塔侧/后在该表为8mm，仓库是10mm。

最应优先复核的是 **50mm ↔ 15mm的车体正面差异**，它会改变战斗表现。精确的分层、各板法线、炮塔侧板角度和局部厚度仍需要针对同一生产配置的图纸/原始资料；本报告不把单一技术表当作所有面板几何的完整证明。该页还列Praga EPA/2，而notes写Praga AC；发动机名称/换装批次尚未独立确认，标为**not evaluated**，不追加“引擎必错”结论。

来源（已实际读取）：http://www.historyofwar.org/articles/weapons_aufklarungspanzer_38t.html
文件关键位置：`armor.json:6,29`（前15），`:52,75,98`（侧/后10），`:213,236,259`（炮塔侧/后10）。

### F4 — M4A3(76)W HVSS 保留6个轮站，但把内外成对轮片合成宽轮

**approximate（能确认的结构简化，不当作尺寸误差）。** `visual.running_gear.wheels` 是6项，全部 `x=0`、`w=0.42`；生成源用 `wheel_row(wz, ..., 0.42)`。`tankmodel.js` 每项每侧只调用一次 `wheelGeometry`，`track.js` 生成一根实心宽轮及左右端面，没有分开的内外轮片/间隙；此车也没有进口轮模型替换它们。

真实HVSS每侧仍是6个纵向轮站，但轮片数量较VVSS加倍，是成对的窄轮片；技术页附原始零件分解图和截面图。现有实现的“6站”是合理的，不能误报“需要12根悬挂轴”。若目标是近看可信外形，优先补内外轮片与中间间隙；若接受当前低细节表现，应把它标为结构近似。

来源（已实际读取）：https://www.theshermantank.com/about/sherman-suspension-and-tracks-the-page-an-easy-to-find-place-for-sherman-suspension-info/horizontal-volute-suspension-system-23-inches-of-ground-pressure-reducing-goodness/
技术表目录：https://www.theshermantank.com/sherman/sherman-model-specification-sheets/

### F5 — 历史身份、现代复原和用户模组需要明确分级

**speculative or custom。** `su_bmpt34/vehicle.json` 明示它是TunderTunder的War Thunder CDK用户模组，并从模组导入模型与损伤/武器数据。`BMPT-34 (1943)`、苏联国别和1943标签不能单独证明这是1943年的真实项目。建议把“用户假想/模组”显示给玩家，而非只在notes中保留。

`de_panther_f` 与 `de_vk1602` 有历史设计背景，但现代完成外形不等于历史完成实车：Panther F配Schmalturm没有已证实的完整服役车，VK16.02计划在原型完成前取消。VK16.02的轻/重方案尺寸有变化，本次**没有**因另一份方案的4.74m/21.9t数值便宣称用户5.4m/26t模型错误。

`de_aufkl_panther` 具体实现是本项目Panther车体加用户VK16.02炮塔；`de_hetzer_mk103*`、`su_att_m46` 为真实部件加用户模型的组合。它们的1943、1945、1960设定目前缺少对应这套具体外形的独立档案证据，应写“方案/用户复原/假想组合”或保持not evaluated，不能当作已经确认的历史量产型号。`su_t10m`的T-10M底车是另一回事；本次没有独立核实Oplot-MO模块与1962这套配置，**不宣称该模块一定不存在**。

公开汇编（已实际读取，低于原始档案等级）：https://en.wikipedia.org/wiki/VK_16.02_Leopard ，https://en.wikipedia.org/wiki/Panther_tank#Ausf._F_and_Schmalturm_turret
BMPT-34的自定义身份证据为仓库自身meta及导入来源，未以缺少网络结果证明不存在。

### F6 — SOURCES.md 的总述已不再覆盖当前模型来源

**confirmed discrepancy（来源文档内部矛盾；不是新增侵权结论）。** SOURCES开头说所有历史外形是程序几何且没有第三方模型/游戏素材，只有乘员和弹种图示例外；但后面的补充以及当前车辆meta记载：Gepard直接使用Scout模型，M56直接使用标为War Thunder的KojfDiscord模型，BMPT-34直接导入用户CDK模组，DShK/M2HB/KPVT等也有直接模型来源。名单中14项vehicle记录含 `model.json`，其中包含仅局部进口的车，**不等于14项整车都直接导入**。

来源总述需要改为逐车/逐部件的现状表。游戏模型、模型站作者署名、用户的“自制”说明和模型页CC标签只说明当前记录的来源陈述；它们都不是历史实车精度的保证。对提取自商业游戏的内容，来源作者/上传者是否有权给底层素材授权也不能仅凭CC标签判断。本次仅记录现状和限制，没有下载额外模型、删除或替换现有素材。

仓库记载的M56模型页：https://sketchfab.com/3d-models/m56-scorpion-war-thunder-2fbe0195de5c4ae19529c7978f433941
仓库记载的Gepard模型页：https://sketchfab.com/3d-models/flakpanzer-gepard-high-quality-model-43746c9ec4a64f8d9a30db81b82843bd
这两页URL来自仓库；本次没有用它们进行独立授权审计。

### F7 — 年代字段兼有原型、设计、配置及服役语义

**approximate / not evaluated（语义不一致）。** 加载器注释称按“year of service”排序，而数据有VK16.02未完成设计、M56原型年代、虚构车设计年代；`main.js:511–513`还将year用于房间时代限制，因此并非纯说明文字。Tiger F1可明确修正；其余各车应先统一year代表“配置年代”还是“首次服役”，再逐车核实，不能批量根据记忆改年。

M56技术文章说T101原型1953、两年后获接受、Scorpion命名1957，资料间的生产年口径也有差异。因此当前1953若表示原型时期可解释，若表示M56服役需复核；本次没有将1953单独列为已确认错误。M56的薄铝合金壳体也不能因写在armor.json中便被误认为历史装甲防护。

来源（已实际读取）：https://www.tankarchives.com/2018/10/airborne-scorpion.html

## 41项快照逐车索引

下列W×L为JSON车体字段，只作为数据审计索引，**不代表已核实历史尺寸**。履带记录以每侧独立z站数计，轮车以轴数计；真实尺寸、炮塔/炮盾比例、炮口端部细节、制退器孔洞和完整开口拓扑除上面的明确发现外均未独立认证。

| ID / 名称 | 标记 | JSON车体W×L / 行走站数 | 本次结论 |
|---|---|---|---|
| `de_pz3_j` / Pz.Kpfw. III Ausf. J (L/60) | approximate | 2.95×5.52 m / 6轮站 | 每侧6站及KwK39 L/60与命名匹配；J包含早/晚型，不能用早期L/42资料判本车错误。 |
| `de_pz4_h` / Pz.Kpfw. IV Ausf. H | approximate | 2.88×5.92 m / 8轮站 | 每侧8轮站，4台车位置可见；KwK40 L/48与H型匹配。车体/炮塔折面和裙板为近似。 |
| `de_tiger_e` / Tiger I (Pz.Kpfw. VI Ausf. E) | confirmed discrepancy | 3.56×6.316 m / 8轮站 | 后期钢缘轮与1943年矛盾；8站×2轮片，交错布局合理。见F1。 |
| `de_panther_g` / Panther Ausf. G | approximate | 3.27×6.87 m / 8轮站 | 8站×2轮片、交错；KwK42 L/70。文档已注明下侧40mm垂直板被单块50mm斜侧板近似。 |
| `de_panther_f` / Panther Ausf. F | speculative or custom | 3.27×6.87 m / 8轮站 | 历史未完成设计的现代复原；不能列为已证实量产/服役车型。炮塔轮廓与测距仪罩未独立量测。 |
| `de_sdkfz234_2` / Sd.Kfz. 234/2 Puma | approximate | 2.36×5.88 m / 4轴 | 4轴8轮、5cm KwK39/1；具体轴距、炮盾与进口炮塔未三视量测。 |
| `su_t34_1940` / T-34 (1940) | approximate | 3×6.1 m / 5轮站 | 每侧5大轮、焊接双人炮塔和L-11；车体复用85型实测参考，1940型具体细节未独立核对。 |
| `su_t34_85` / T-34-85 | approximate | 3×6.1 m / 5轮站 | 每侧5大轮、ZiS-S-53和1944身份吻合；车体与炮塔依游戏参考切片复原，未独立量测博物馆实车。 |
| `su_is2` / IS-2 (1944) | approximate | 3.09×6.77 m / 6轮站 | 6站、1944直首上和D-25T；铸造炮塔以平板表示，不能把平板近似说成真实炮塔为焊接。 |
| `su_t10m` / T-10M (Oplot-MO) | not evaluated | 3.52×6.9 m / 7轮站 | T-10M底车与Oplot-MO配置分开看；用户图面及模块不构成独立历史证明，Oplot-MO身份/年代尚未核实。 |
| `su_bmpt34` / BMPT-34 (1943) | speculative or custom | 3.044×6.33 m / 5轮站 | meta直接注明War Thunder CDK用户模组；1943是模组设定，不是已验证历史身份。 |
| `su_t54` / T-54 (1951) | approximate | 3.27×6.04 m / 5轮站 | 5大轮，前两站最大间距1.10m，余间距约0.82–0.85m，明显特征保留；1951型D-10T。 |
| `us_m8` / M8 Greyhound | approximate | 2.54×4.78 m / 3轴 | 3轴6轮、开放M23系列炮塔与37mm M6；具体型号M23A1和轴距未逐项核实。 |
| `us_m10` / M10 GMC | approximate | 3.05×5.93 m / 6轮站 | 6轮站/3台车、开放炮塔、3in M7；不能用封闭坦克炮塔要求判M10错误。轮廓与炮盾未三视核实。 |
| `us_m4a2` / M4A2 | approximate | 2.62×5.93 m / 6轮站 | 6轮站/3台车VVSS，焊接车体、75mm M3；47°首上具体生产月和柴油机功率口径未核实。 |
| `us_m4a3_75w` / M4A3(75)W | approximate | 2.62×5.93 m / 6轮站 | 6轮站/3台车VVSS，75mm M3；来自用户四视图，图面本身不在库，无法独立复核比例测量。 |
| `us_m4a1_76w` / M4A1(76)W | approximate | 2.62×5.84 m / 6轮站 | 6轮站VVSS，铸造上车体与T23炮塔、76mm M1系列；各截面来自游戏参考，非历史尺寸保证。 |
| `us_m4a3_76w_hvss` / M4A3(76)W HVSS | approximate | 3×5.93 m / 6轮站 | 6纵向轮站正确，但每站是单个宽轮，缺HVSS内外成对轮片与间隙；结构近似。见F4。 |
| `us_m56` / M56 Scorpion | approximate | 2.57×4.55 m / 4轮站 | 开放无装甲乘员区及4站正确；铝合金壳体非战车装甲，6/8mm估计不得当作已核实厚度。1953是原型时期，服役年口径待统一。 |
| `us_m901_itv` / M901 ITV（M113 TOW） | approximate | 2.54×4.86 m / 5轮站 | 5轮站、M113底车与双TOW锤头架；M27发射架形式合理，M220字段属于武器/发射组件命名需精确区分。 |
| `uk_cromwell_iv` / Cromwell Mk IV | approximate | 2.908×6.35 m / 5轮站 | 5大轮/Christie及QF75与IV型匹配；平板炮塔外形、环径、炮盾细部仍为估计。 |
| `xp_kda35` / 35 mm 輪式試驗車 | speculative or custom | 2.55×6.3 m / 2轴 | 用户4×4设计；notes明示APCBC-HE/HEAT-FS未配发给该炮。 |
| `xp_w78` / 78 mm 輪式試驗車 | speculative or custom | 2.55×6.3 m / 2轴 | 用户4×4设计，78mm炮及弹药明确为设计研究。 |
| `de_pzjg1` / Panzerjäger I | approximate | 2.06×4.42 m / 5轮站 | PanzerI Ausf.B五轮站、固定护盾和4.7cm PaK(t)，限定±17.5°；rear armor虚拟板需与开口实形分开。 |
| `de_flakpz38t` / Flakpanzer 38(t) | approximate | 2.15×5.3 m / 4轮站 | 4轮站、后置开放战斗室和折叠护板、FlaK38；开放顶部与折叠护板属于真实特征。 |
| `de_hetzer` / Jagdpanzer 38(t) Hetzer | approximate | 2.63×4.87 m / 4轮站 | 4大轮站，右偏0.38m固定PaK39/Saukopf，左5°右11°。炮盾比例未独立三视量测。 |
| `de_hetzer_flak` / Hetzer 2 cm FlaK | not evaluated | 2.63×4.87 m / 4轮站 | Bergepanzer38(t)+2cm FlaK38组合来自用户图；本次未核实具体实车/改造批次。开放战斗室不是错误。 |
| `de_rso_flak` / RSO 2 cm FlaK 38 | not evaluated | 1.99×3.98 m / 4轮站 | 4轮站、敞开平台；具体2cm RSO改装实车和1944身份未找到本次可用独立来源。 |
| `de_rso_pak40` / RSO PaK 40 | approximate | 1.99×4.06 m / 4轮站 | 4轮站、装甲驾驶室和7.5cm PaK40/4类型合理；炮平台比例、改装批次未独立量测。 |
| `de_gepard` / Flakpanzer Gepard | approximate | 3.27×6.85 m / 7轮站 | 7轮站、后主动轮、双35mm与雷达类别吻合；Scout模型未做独立三视量测，左右轮位对称化已在来源说明。 |
| `uk_cmp_portee` / CMP 6-pdr Portee | approximate | 2×6 m / 2轴 | 2轴、轴距3.98m，与158in(4.013m)相近；炮为朝车尾装载。细部和具体车号未核实。 |
| `de_aufkl_panther` / Aufklärungspanzer Panther | speculative or custom | 3.27×6.87 m / 8轮站 | 程序Panther底盘加用户VK16.02炮塔；未找到能证明这套具体组合真实建造的资料。 |
| `de_vk1602` / VK 16.02 Leopard | speculative or custom | 3.16×5.4 m / 5轮站 | 历史取消的设计之用户模型；重型/轻型方案有变动，不能据另一个方案尺寸判它必错。 |
| `de_hetzer_mk103` / Hetzer 3 cm MK 103 | speculative or custom | 2.63×4.85 m / 4轮站 | 用户自制Hetzer+MK103方案；1945是设定，未建立这套外形对应历史实车的证据。 |
| `de_hetzer_mk103_camo` / Hetzer 3 cm MK 103（三色迷彩） | speculative or custom | 2.63×4.85 m / 4轮站 | 同MK103方案的涂装变体，不是另一个已证实历史车型。 |
| `de_sdkfz140_1` / Sd.Kfz. 140/1 Aufklärungspanzer 38(t) | confirmed discrepancy | 2.15×4.61 m / 4轮站 | KwK38炮管参数与L/55矛盾，车体装甲与车型资料矛盾；开放式Hängelafette是正确特征。见F2/F3。 |
| `xp_bmp_k64` / BMP-K-64 | speculative or custom | 3.1×6 m / 4轴 | 代码明确fictional、1964设定及T-64A部件；不能据此声称是历史BMP/BMPT-K-64原型。 |
| `xp_bmp_k64_atgm` / BMP-K-64 ATGM（9M113） | speculative or custom | 3.1×6 m / 4轴 | 同用户假想8×8底盘加9M113方案，1974为设定。 |
| `xp_bmp_k64_kornet` / BMP-K-64 ATGM 套件（9M133） | speculative or custom | 3.1×6 m / 4轴 | 同用户假想8×8底盘加9M133方案，1994为设定。 |
| `su_att_m46` / AT-T 130 mm 自走炮（M-46） | speculative or custom | 3.18×6.99 m / 5轮站 | AT-T与M-46是真实装备；1960年、苏联身份及这种具体车载组合未独立核实。 |
| `proto_a` / Prototype A (original design) | speculative or custom | 3×6.2 m / 6轮站 | 原创单元测试车型，year=0；无需历史实车对应。 |

## 新增 Hetzer底盘 + Sd.Kfz.140/1炮塔组合的身份边界

**speculative or custom。** 真实Sd.Kfz.140/1是Panzer38(t)车体的侦察改造，不能因为装上它的Hängelafette38炮塔，就把Hetzer底盘组合称为历史Sd.Kfz.140/1实车。合适说明是“Hetzer底盘侦察改装（假想）/Hetzer reconnaissance conversion (fictional)”。真实零部件可以用于假想方案，身份标签应保留这个区别。

Hetzer车体与原Sd.Kfz.140/1车体的宽度、侧板斜面、装甲、炮塔环/座圈位置和驾驶员布局不同。安装方案应以Hetzer车体为底，保留车体数据，仅借用炮塔/炮及其内装；炮塔环尺寸、连接座、炮塔旋转与最大俯角下的碰撞需要另做工程适配验证。本报告不提供未经量测的“真实环径”或宣称这种组合实车可用。F2/F3属于供体数据问题，不授权在这份只读审计中修改生产文件。

## 尚未完成的验证

- 未对41项车辆做完整正交截图对比、真实档案三视图对齐或模型表面测量。
- 绝大部分车体板折点、炮盾宽高/曲率、炮塔后悬比例、炮塔环径、轮轴精确间距及火炮外露长度仍只是仓库自述的估计/参考复原。
- 未全面核验引擎型号、净/总马力或PS/hp换算。Tiger690hp与700PS不应直接报成矛盾；车轮半径几毫米/厘米误差也不自动构成历史身份错误。
- 未核实Oplot-MO档案来源、RSO防空改造的具体车辆、Hetzer各防空组合的实车批次、AT-T/M-46组合的国家/年代，也未认证用户BMP-K-64模型与同名现代乌克兰方案的对应关系。
- Tank Museum和Tank Encyclopedia的若干页面在当前网络读取时返回403，另有旧链接404和Military Today连接失败；没有将这些未读页面当作已验证证据。搜索空结果也没有用于证明不存在。

可继续审计的优先次序：Sd.Kfz.140/1武器/装甲参数 → Tiger具体生产配置与年代 → HVSS双轮片 → 历史设计与假想车的身份展示 → 每个家族一次完整三视图/轮轴/炮盾测量。当前已证实的错误不支持把整个车库判为不真实，未发现明确矛盾的条目也不等于通过了完整实车认证。
