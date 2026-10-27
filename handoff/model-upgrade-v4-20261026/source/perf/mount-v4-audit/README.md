# 全26机型挂载菜单复核

本表核对当前包内具体机型身份、既有可选项与资源缺口。它不把一次资料检索等同于实机全部挂载组合认证。上级集成者应将通过模型适配与运行验证的候选项标为已实现；本表候选本身不修改菜单。

|机型ID|模型实际名称|既有槽数|状态|说明|
|---|---|---:|---|---|
|nf01|NF-01 試飛機|4|fictional_existing|Game prototype; no historical real-aircraft completeness claim.|
|nf02|NF-02 噴射戰鬥機|10|fictional_existing|Game test platform; cross-national modern missiles are explicitly test capabilities and must not authorize them on historical carriers.|
|p51d|P-51D 野馬|4|candidate_existing_resource|AN-M65 1000lb candidate at each existing inner bomb station. Five-HVAR-per-side capacity needs a new row layout and mixed-clearance audit; do not simply raise the current count.|
|bf109g|Bf 109 G-6|1|preserved_variant_guard|G-6 single center bomb station preserved. Do not add SC500 or gun pods from generic Bf109 family without its rack/variant evidence. SC50 and small-bomb racks lack exact models.|
|spitfire9|噴火 Mk IX|3|preserved_variant_guard|Current 2x250lb wing plus500lb center are kept; do not borrow rockets or late Spitfire capabilities for MkIX.|
|mig15|MiG-15bis|2|preserved_pending_exact_resources|MiG15bis 2 wing stations retained. Correct drop tanks and exact larger-bomb clearance require model and primary station evidence; no K13/R3/R60 expansion.|
|f86f|F-86F 軍刀|6|candidate_existing_resource|AN-M65 1000lb candidate at each existing inner bomb station. No Sidewinder addition absent evidence that this specific F model includes that operator retrofit.|
|f104g|F-104G 星式|4|fix_geometry_preserve_variant|Wingtip rail position fix is separate. Additional ventral catamaran rail, correct tip/wing tanks and rocket clearance need dedicated geometry; F104S Sparrow capability must not leak into F104G.|
|mig21|MiG-21MF|2|active_repair|Expand from2 to4 wing stations and implement dedicated R3R resource/definition. R60M must not be substituted for museum-named R60 without an exact MF retrofit source. Correct MF tank shapes are not PTB800.|
|fw190a8|Fw 190 A-8|1|preserved_pending_exact_rack_evidence|Existing SC500 center is retained. SC250 is a plausible same-rack candidate but no dedicated primary rack source was established in this audit. Small-bomb ER4 racks and gun/rocket kits require new models.|
|yak9u|Yak-9U|0|preserved_variant_guard|No external menu retained for Yak9U. Bomb carriage of Yak9B or other Yak9 derivatives is not inherited.|
|a6m2|A6M2 零式艦戰 21 型|2|preserved_variant_guard|Model21 pair of60kg bomb stations kept. Do not inherit late A6M fighter-bomber250kg racks or suicide load configurations.|
|f4u1d|F4U-1D 海盜|6|candidate_existing_resource|AN-M64 500lb can be game-fitted to the same existing twin bomb stations that already allow AN-M65; exact lug interface is inferred, not a newly sourced manufacturing clearance.|
|me262|Me 262 A-1a 燕式|2|preserved_source_sockets|A1a24R4M source sockets retained. No bombs borrowed from A2a.|
|hunter6|Hunter F.6 獵人|4|preserved_variant_guard|F6 current bombs/RP3 retained. FGA9, Swiss Mk58 Maverick or experimental SRAAM capabilities are not transferred. Exact larger British bomb and tank resources missing.|
|mig17f|MiG-17F|2|preserved_variant_guard|Existing FAB250/UB16 at2 wing stations retained. Lim6 and Chinese export modernizations are distinct; no missile capability assumed.|
|mirage3e|Mirage 5F 幻象|4|samp250_model_and_menu_implemented|Source identity is Mirage5F. A new independent SAMP250-class game-estimate procedural asset and symmetric inner choices are now implemented from aircraft capability and actual-carriage photograph evidence. It is not a Mk82 alias. Current-build geometry acceptance is separate. ExactSAMP subtype, RPK/JL100 tank-carrier and ECM/chaff resources remain explicit gaps.|
|f4e|F-4E 幽靈 II|9|preserved_variant_guard|AIM7E/AIM9L, supported AGMs, bomb/rocket and PaveSpike options retained. AIM7F/M or later targeting pods need block/operator retrofit evidence and placement; no automatic family expansion.|
|f15c|F-15E 打擊鷹|9|preserved_variant_guard|Actual source F15E, native dual rail and fixed LANTIRN recognized. Existing new AMRAAM/Sidewinder/bombs retained. Sniper/LITENING replacement requires hiding source pod and a mount path; do not show2pods at once. JDAM/SDB families missing definitions/models.|
|mig29|MiG-29 9.12 支點|6|candidate_existing_resource|Early9.12 candidate UB16(57mm) and S24B(240mm) on existing mid attack stations. No RVVAE/Kh31P/Kh29TE from upgraded later variants.|
|f16v|F-16V 戰隼|9|candidate_existing_resource|GBU10 Block70 compatibility confirmed, candidate single on each existing mid attack pylon with Sniper. AGM65D supported by broader F16 primary material but this audit does not treat it as an exact V station clearance. Correct370gal/300gal tanks and JDAM/SDB are separate resources.|
|su27|Su-27UBK 側衛|9|preserved_variant_guard|Actual Su27UBK source kept with R73/R27T/R27R, existingbomb/rocket options. Su27SKM/SM R77 or guidedAGM upgrades not inferred for UBK. Correct serial station mapping and mixedfit remain geometry work.|
|a10a|A-10C 雷霆 II|11|preserved_variant_guard|Actual source A10C;11 numbered pylons and source-hash-gated Sniper/LITENING kept. No blanket expansion to every store on every pylon. JDAM/APKWS need distinct model/behavior; current unguided Hydra is not APKWS.|
|su25|Su-25 蛙足|10|preserved_variant_guard|Ten numbered pylons already expose gunpod/tanks/rockets/bombs/Kh25ML/Kh29L. Do not inherit Su25T Vikhr or new radar AGM without its targeting integration.|
|me262a2a|Me 262 A-2a|2|preserved_source_sockets|A2a2SC250 source release sockets retained. SC500 needs exact clearance/adapter checks and code generalization beyond current source_bombs expectedSC250 guard.|
|me262u4|Me 262 A-1a/U4（试验型）|0|preserved_prototype|Experimental50mm cannon prototype has no external source release sockets; no new menu inferred from otherMe262 subtypes.|

## 有现成资源的优先候选

这些是飞机级能力证据与现成资源交集，挂点选择属于待运行验证的游戏拟合，不是实机挂载手册。

- p51d / inner / anm65 ×1每侧；依据 p51d。
- f86f / inner / anm65 ×1每侧；依据 f86f。
- f4u1d / inner / anm64 ×1每侧；依据 f4u1d。
- mig29 / mid / ub16 ×1每侧, s24b ×1每侧；依据 mig29a。
- f16v / mid / gbu10 ×1每侧；依据 f16_block70。

## 全量武器兼容覆盖

新增 `weapon-carrier-coverage.json` 与 `coverage.schema.json`，对当前26机型×全部87个武器定义逐对标出菜单状态。available 表示当前菜单可选；missing_model / requires_adapter / unverified 分别标缺建模、缺适配架与具体变种兼容未证实。component_only 和 ground_only 不能当作飞机直接外挂。兼容覆盖仍需当前构建的几何/运行验收，不能据此声称所有实机组合已经做完。

Mirage5F 的 SAMP250 已新增独立程序模型及双侧内挂点选项；尺寸、精细子型号、色彩和伤害数值均为游戏估计。实际摄影来源：T.Laurent，1990年9月，https://www.airhistory.net/photo/159898/46 。保留遗留ID mirage3e，不修改原预设索引。

重建覆盖：`node perf/mount-v4-audit/export-coverage.mjs path/to/current-app-script.html`。模型/目录源码改动后应重建；它读取实际生产layout函数与当前catalog模块。

## 来源与适用边界

- mig21_mf — [Polish Aviation Museum](https://muzeumlotnictwa.pl/eksponaty/mikojan-guriewicz-mig-21mf-6504/)：MiG-21MF has four wing hardpoints and four R-3S, R-3R or R-60 missiles. This does not establish R-60M as an exact variant.
- f16_block70 — [US Government Publishing Office / Department of Defense](https://www.govinfo.gov/content/pkg/FR-2024-10-18/pdf/2024-24144.pdf)：Opening continuation of arms-sales notification 2024-24122 describes Jordan F-16C/D Block 70, APG-83, Sniper and GBU-10 kits. It establishes aircraft-level compatibility, not a per-station clearance matrix.
- f86f — [US Air Force](https://www.af.mil/News/Photos/igphoto/2000593829/)：F-86F-35 photo caption names a pair of 1000-pound or smaller bombs and eight HVAR rockets. Exact source model block is not specified in the game.
- p51d — [National WWII Museum](https://www.nationalww2museum.org/visit/museum-campus/us-freedom-pavilion/warbirds/north-american-p-51-mustang)：P-51D maximum load 2000 pounds of bombs or ten five-inch rockets. This is a total aircraft limit, not evidence every mixed arrangement is valid.
- f4u1d — [Smithsonian National Air and Space Museum](https://airandspace.si.edu/collection-objects/vought-f4u-1d-corsair/nasm_A19610124000)：F4U-1D operational narrative includes carriage of two 1000-pound bombs. Adding smaller AN-M64 on existing bomb stations is a game fit inference from already modelled AN-M65 capability.
- mirage5 — [Dassault Aviation](https://www.dassault-aviation.com/en/passion/aircraft/military-dassault-aircraft/mirage-5/)：Mirage 5 derivative was designed for tactical support; more external load attachments and up to fourteen bombs. Page explicitly discusses 50 French Mirage 5F aircraft. It does not identify the precise bomb mark or station chart.
- mig29a — [National Museum of the US Air Force](https://www.nationalmuseum.af.mil/Visit/Museum-Exhibits/Fact-Sheets/Display/Article/197174/mikoyan-gurevich-mig-29a/)：Early MiG-29A six air-to-air missiles, bombs and 57mm, 80mm, 240mm rockets. This supports existing UB-16, B-8M1 and S-24B resource classes; exact station placement remains a game fit inference.
- f104g — [Deutsches Museum](https://www.deutsches-museum.de/flugwerft-schleissheim/ausstellung/militaerluftfahrt/f-104-g)：Confirms F-104G multirole fighter-bomber subtype. No exact weapons or station clearance table on this page, so it is not used to authorize extra stores.
- a10c — [US Air Force](https://www.af.mil/News/Article-Display/Article/129371/a-10-upgrade-effort-transforms-warthog-capabilities/)：A-10 Precision Engagement upgrade basis; prior package uses source hash and A-10C model identity guards before exposing targeting pods.
