# 2026-10-11 全车炮塔／炮座承载复查

读取全部42款stock bundle，经实际`loadData → decodeAllImported → makeLoadout → buildTank`生成节点及三角形；程序部件保留`visual#`索引，导入部件保留解码／共享底盘后的`imported#`索引。原始GLB与packed资产不修改。

检查从完整主体出发的接触链，而不是任一座圈碰到车体就算整塔连接。固定车体、父炮塔和自身活动组件分开，排除机枪、铰接挡板及乘员避让坐垫／支柱作为承载捷径。`touches`以真实三角面／边／包含关系判断，12mm为候选检测容差；粗包围盒不作为接触证明。源码回归另明确验证新增collar与原车体、完整塔壳各自接合。

## 已确认并修复的八车

| ID | 修前真实支承间隙 | 修复 |
|---|---|---|
| de_tiger_e | 壳`#29`底1.840 → hull`#2`顶1.800，40mm；180°下后舱盖偶然接近不能证明座圈支承 | 按既有1.85m环径补中空collar，底1.798、顶1.842 |
| de_panther_g | 壳`#14`底1.900 → hull`#1`顶1.870，30mm | 既有1.65m环径，中空collar底1.868、顶1.902 |
| de_panther_f | 壳`#14`底1.900 → hull`#1`顶1.870，30mm | 同上，保留Schmalturm现有轴及外形 |
| us_m4a1_76w | 环`#31`为1.928–1.988，壳`#32`最低2.040；环→壳52mm，最近其它塔件仍32mm | 将原实心盘改为中空承载collar，保留0.95m外半径，顶延到2.042 |
| us_m4a3_76w_hvss | 环`#17`为1.798–1.858，壳`#18`最低1.910；同样52mm／32mm | 中空承载collar顶延到1.912 |
| de_hetzer_flak | turntable`#22`顶1.665 → 完整侧架`#23`底1.690，25mm | 只将固定侧架脚下延27mm，原上沿、耳轴和枪轴保留 |
| de_rso_flak | turntable`#31`顶1.605 → 侧架`#32`／横梁`#33`底1.630，25mm | 同上 |
| de_rso_pak40 | pedestal`#31`顶1.370 → cradle`#34`底1.480，110mm；39.05mm的最近物体为乘员坐垫，不能承载 | 双固定叉架与原1.630m耳轴接合，独立固定shield stays支承盾板 |

尺寸来自现有模型三角面量测。collar壁厚、叉架和支条截面为局部建模估计，不冒称历史制造尺寸。所有原pivot、trunnion、muzzle、车辆／武器／弹药／装甲／模块／乘员资料保留。新增支承属于外部显示结构；没有凭视觉新增历史装甲值或damage module。

PaK固定盾→stays→fork→pedestal→hull的回归排除了活动gun与乘员坐垫。耳轴在合法最低／零／最高俯仰保持与原活动cradle连接；全部整度俯仰、0／90／180°及0／半／全后坐下，新增fork／stays与原活动gun无新穿面。FlaK脚只增在原框架下方，其余枪座避让回归通过。

## 工坊

旧生成逻辑使用名义`hull.size_m[1]`：在Hetzer后位z=-2，实际车体面仅1.480256m，旧座底1.890m，中心差409.74mm；前位z=2为481.92mm。加高0.3m时旧支筒仍从1.890m开始，其与真实后／前车体最短距离142.94／246.60mm。MK103后位旧支筒距实际导入底盘308.69mm，中心0.8m环／lift0.3也有82.25mm的真实最短空隙。

新座保留自定义pivot及全部衍生坐标。在构建资料时一次采样实际固定hull三角面（含解码导入／共享底盘），以32段内外缘64个交点派生中空下沿，上沿接原pivot。lift=0有真实间隙也补座；lift>0接到局部斜面。只接受明确固定hull或缺省静态hull，排除原活动塔／枪、MG、轮组及hinge。支座进入正常hull mesh，遵循原fade、dispose、导入／导出路径。无任何足迹交点返回`stats.seatSupport.status=unsupported`，不凭空下柱或扩车体；允许局部环的正常外悬，实际支承弧必须有面交点。

128组构建覆盖Hetzer、MK103、Tiger、Panther G、M4A1、HVSS、T10和BMP底盘，keep／replace、x/z四位置、lift0／0.3，384个0／90／180°实际主体姿态均有固定车体接触链。针对Hetzer与MK103的回归另走真实Mods选择、编译、模型、导出后独立解码再建，验证物理接点和坐标保留。

## 全42逐项记录

表中为中性姿态的一条实际接触链；同车其它合法姿态均进入JSON。折板车辆包括0／1；固定／受限炮座不伪造非法90／180°。T10的附加塔另验证parent0，既有3mm正常源回转缝保留。W78约200mm壳／甲板高差已有真实`#9`支筒，两端均接合，保留。

| ID | 来源 | 实际主体→支持链 | 合法姿态数 |
|---|---|---|---|
| de_pz3_j | procedural | visual#13 → visual#2 | 3 |
| de_pz4_h | procedural | visual#25 → visual#2 | 3 |
| de_tiger_e | procedural | visual#29 → visual#65 → visual#2 | 3 |
| de_panther_g | procedural | visual#14 → visual#36 → visual#1 | 3 |
| de_panther_f | procedural | visual#14 → visual#32 → visual#1 | 3 |
| de_sdkfz234_2 | procedural | visual#10 → visual#1 | 3 |
| su_t34_1940 | procedural | visual#26 → visual#25 → visual#0 | 3 |
| su_t34_85 | procedural | visual#28 → visual#29 → visual#0 | 3 |
| su_is2 | procedural | visual#12 → visual#1 | 3 |
| su_t10m | decoded import | visual#39 → visual#0；extra1 imported#12 → imported#15 | 6 |
| su_bmpt34 | decoded import | imported#54 → imported#9 | 3 |
| su_t54 | procedural | visual#44 → visual#0 | 3 |
| us_m8 | procedural | visual#18 → visual#0 | 3 |
| us_m10 | procedural | visual#24 → visual#18 | 3 |
| us_m4a2 | procedural | visual#30 → visual#6 | 3 |
| us_m4a3_75w | procedural | visual#30 → visual#6 | 3 |
| us_m4a1_76w | procedural | visual#32 → visual#31 → visual#5 | 3 |
| us_m4a3_76w_hvss | procedural | visual#18 → visual#17 → visual#5 | 3 |
| us_m56 | decoded import | imported#19 → imported#4 | 1 |
| us_m901_itv | procedural | visual#16 → visual#0 | 3 |
| uk_cromwell_iv | procedural | visual#13 → visual#1 | 3 |
| xp_kda35 | decoded import | visual#1 → visual#9 | 3 |
| xp_w78 | procedural | visual#1 → visual#9 | 3 |
| de_pzjg1 | procedural | visual#6 → visual#5 → visual#8 | 1 |
| de_flakpz38t | procedural | visual#51 → visual#1 | 6 |
| de_hetzer | procedural | visual#13 → visual#1 | 1 |
| de_hetzer_flak | procedural | visual#23 → visual#1；原base#22另直接验接 | 3 |
| de_rso_flak | procedural | visual#32 → visual#31 → visual#30 | 3 |
| de_rso_pak40 | procedural | visual#32 → visual#50 → visual#31 → visual#30 → visual#29 | 4 |
| de_gepard | decoded import | imported#33 → imported#5 | 3 |
| uk_cmp_portee | procedural | visual#62 → visual#59 → visual#30 | 1 |
| de_aufkl_panther | decoded import | imported#4 → imported#5 → visual#1 | 3 |
| de_vk1602 | decoded import | imported#55 → imported#56 → imported#5 | 3 |
| de_hetzer_mk103 | decoded import | imported#31 → imported#2 | 5 |
| de_hetzer_mk103_camo | decoded import | imported#31 → imported#2 | 5 |
| de_sdkfz140_1 | decoded import | imported#36 → imported#8 | 3 |
| de_hetzer_sdkfz1401 | decoded import | imported#26 → imported#7 | 3 |
| xp_bmp_k64 | decoded import | 原源13mm回转缝候选，保留 | 3 |
| xp_bmp_k64_atgm | decoded import | imported#5 → imported#11 | 3 |
| xp_bmp_k64_kornet | decoded import | imported#16 → imported#13 | 3 |
| su_att_m46 | decoded import | imported#114 → imported#45 | 3 |
| proto_a | procedural | visual#4 → visual#0 | 3 |

共129个合法stock姿态；唯一保留候选为用户提供的BMP-K-64。其imported#71底1.868 → hull#1真面1.855，0／90／180°最短13.00mm，超出12mm检测容差1mm。没有另证据证明该原装小缝需要改；本轮不移动其display mount或原packed模型。不能把该候选描述为零缝，也不能把整个候选计数当作未修错误数。

## 可复现与保护记录

```sh
node --test client/web/test/turret-seat-contact.test.mjs
node client/web/tools/turret-seat-audit.mjs --workshop --out=client/web/dist/turret-seat-audit/final.json
python client/web/test/turret-seat-source.test.py
python client/web/test/procedural-regeneration.test.py
python tools/rebuild_procedural_models.py --ids=de_tiger_e,de_panther_g,de_panther_f,us_m4a1_76w,us_m4a3_76w_hvss,de_hetzer_flak,de_rso_flak,de_rso_pak40
```

- 8车仅`visual.json`变化，连续两次定向重建56个车型JSON的字节哈希全稳定；26个支持的源builder无写入重建与公开七文件逐项一致。
- 8车除visual外的载具／武器／装甲／模块／乘员组合SHA256：`21482f7ad59bdfb762d86abdce99c6b664618c7f51511a8112ae20136f75e6c8`。回归固定该基线，确保原战斗资料未变。
- 19个tracked GLB／WASM／packed model及共享MG资产与基线`2ebb940`逐字节一致，路径＋字节组合SHA256为`c08af75c4960937f8f31723738ec0a44d8fee0c0adac655e368c2488b0a38be7`。
- 本轮Node目标及相关炮座／车体／乘员51项PASS；之前工坊／Hetzer／既有几何48项PASS；相关Python源及再生检查通过。完整web回归、独立复审和发布由主代理接手。

这是CPU三角形及节点验收，本轮未访问本地游戏浏览器。离散合法姿态与64点足迹不证明全部连续／任意工坊组合绝无穿模，历史截面亦未重新测绘。
