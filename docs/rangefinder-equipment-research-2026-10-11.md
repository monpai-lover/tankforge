# 測距設備研究 — 2026-10-11

範圍：`tankforge-suspension-tracks-v7` 的現有可玩車、工坊與測距路徑。這是研究與實作建議；未修改執行程式、原始車輛資料或模型。使用者要求：激光測距立即完成，合像測距加速；短按 F 測距及停車按住 F 三秒修復必須保留。

## 結論

現在缺少的是「設備身分」，不是測距計算。JavaScript 對任何沒有 `sight.rangefinder` 的普通瞄準鏡都補上相同的 2.5 秒、5%、2500 m 數值；JSON schema 把這稱為預設合像測距儀，但 Rust 同一欄位的說明實際是乘員估距。不能因此把所有普通放大瞄準鏡升格成合像測距儀，也不能用較快的 `time_s` 推論為激光。

載入器 `client/web/tools/load-data.mjs:ORDER` 有 **42 個可玩車與 42 個工坊瞄具來源**。只有 `de_panther_f` 明確把测距设备寫在瞄具名稱中；`fun_hexa` 是額外資料夾，沒有列入 ORDER，實際六炮怪入口是工坊 `hexa` 預設。工坊及設計局已有匿名測距數值，但没有设备类别選項。目前没有足夠的現有設備資料能把一輛可玩車確定分類為合像或激光；豹 F 的真實預定設備是立體式光學測距儀。

最小誠實方案：保留無設備資料者為乘員估距；豹 F 可按現有模型的裝備設定分類為 `stereoscopic`；工坊提供明確的「繼承瞄具／乘員估距／合像／立體／激光」選項。光學兩類都可以採較快且有限的遊戲等待，名稱仍區分。激光在短按動作釋放後直接走既有完成路徑，不建立零時長進度狀態。所有速度係數都是遊戲估計，不寫成真實硬體測量時間。

## 現有程式路徑與缺口

| 路徑 | 現有行為／最小改動點 |
| --- | --- |
| `client/web/src/game/vehicleActions.js:1` | 短按窗口 0.35 s；F 釋放才產生 `range`；持續按住滿 3 s 產生 `repair`，不再於釋放產生測距。此輸入分流應完整保留。 |
| `client/web/src/main.js:2722` | `performVehicleAction('range')` 呼叫 `startRanging()`。瞬測應在這之後，不應在 F keydown 提前測距。 |
| `client/web/src/main.js:2888` | `startRanging()` 只檢查正在測距、工坊及 battle 模式，直接使用 `sightTurret().rangefinder.time_s` 作為 total。 |
| `client/web/src/main.js:3955` | update 累加 dt，達 total 後呼叫 `finishRanging()`。沒有獨立名為 updateRanging 的 owner。 |
| `client/web/src/main.js:4386` | 進度直接為 t/total。零、NaN 或 Infinity total 不應進入此狀態；單純改成 time_s=0 不是可靠的瞬測實作。 |
| `client/web/src/main.js:2900` | 完成時才重新讀取當前炮塔 RF，再取得 currentLos；最高射線距離 6000 m，truth 是命中點到所選武器 muzzle 的歐氏距離。量程超出或無目標失敗；誤差來自既有 seeded RNG，最後以 5 m 取整。保留這些規則。 |
| `client/web/src/main.js:2894,3438` | 畫面中心射線以 G.camPos 起算，測距真值以 sightMuzzle 起算；機槍模式改用機槍 muzzle。設備分類變更無需順便重寫座標或瞄具投影。 |
| `client/web/src/main.js:1374` | 切換瞄準武器沒有取消 `G.ranging`。現有等待可在舊設備開始、以新設備完成。建議測距期間固定設備／武器上下文，或切換時取消；不要把兩者混合。 |
| `client/web/src/game/loadout.js:15,140–156` | `DEFAULT_RANGEFINDER` 補齊數值；`turretEntry` 複製 `sight.rangefinder`。目前沒有 normalizeSight 的設備正規化；只有 sightLevels 的倍率整理。設備 resolver 應集中在這裡或獨立純 CPU owner。 |
| `client/web/src/game/loadout.js:402–413` | 工坊先按 `sightSource` 取瞄具，再複製完整 sight；未選 donor 則產生匿名 1.8 s／3%／3000 m 測距。需要另傳 source ID／設備 metadata，不能只在 `makeLoadout('custom',...)` 查 custom 車 ID。 |
| `client/web/src/game/workshopCatalog.js:23` | 瞄具來源只有 label 與原始 sight，來源 ID 可供已核對 registry 使用。工坊基底、火炮 donor 與瞄具 donor 是不同選項。 |
| `client/web/src/game/workshop.js:188` | 目前只有瞄具與穩定器選項，沒有测距设备种类。新增明确类别選项能让激光／合像在当前项目实际可用，不必伪造历史车装置。 |
| `client/web/src/game/workshopBuild.js:55` | 正規化只保留 sightSource；任何新设备字段若未加入会被设置导入静默剥除。必须验证 enum 和保存／导出／导入往返。 |
| `client/web/src/game/loadout.js:449,584` | buildToBundle 的 strip 与 exportFolder 需保留设备上下文；当前普通车文件导出仅列 vehicle/armor/weapons/engine/crew/modules/visual。 |
| `crates/vehicle/src/files.rs:193–210` | RF 缺省明文为乘員估距；RangefinderDef 只有三个数值。SightDef / RangefinderDef 使用 deny_unknown_fields。若把 kind 直接塞入 sight.rangefinder 并导出，需同步 Rust 与 schema，不能只改 JS。 |
| `schemas/weapons.schema.json:280` | 「缺省合像」说明与 Rust 不一致，适合改为「缺省乘員估距」；没有必要重写原始车辆 weapons.json。 |
| `crates/design/src/compile.rs:270–273` | 设计局固定产生匿名 2.0 s／4%／3000 m；设计 schema/UI 未发现设备种类。若本轮只做工坊，设计局应保留既有有限计时并标为 untyped/crew estimation，不能自动称为合像。 |

## 全车资料审计

下表「乘員估距」是设备证据缺失时的**保守运行策略**，不等于已证明现实中从未携带任何外部测距器。除注明者外，原始 sight 均无 RF 字段，运行数值是 2.5 s／5%／2500 m。年份与倍率不参与分类。

| 现有 ID | 瞄具名称 | 可采用的设备身份 |
| --- | --- | --- |
| de_aufkl_panther | TZF 4b | 乘員估距 |
| de_flakpz38t | Flakvisier 38 | 乘員估距 |
| de_gepard | PERI (Gepard) | 暂用乘員估距；1A1／B2L 装备有歧义，见下节 |
| de_hetzer | Sfl.Z.F. 1a | 乘員估距 |
| de_hetzer_flak | Flakvisier 38 | 乘員估距 |
| de_hetzer_mk103 | Flakvisier 38 | 乘員估距 |
| de_hetzer_mk103_camo | Flakvisier 38 | 乘員估距 |
| de_hetzer_sdkfz1401 | TZF 3a | 乘員估距；明确假想改装 |
| de_panther_f | TZF 13 + EM 1.32 m R | 立体式光学；现有 3.0 s／2%／4000 m 是项目估计 |
| de_panther_g | TZF 12a | 乘員估距 |
| de_pz3_j | TZF 5e | 乘員估距 |
| de_pz4_h | TZF 5f | 乘員估距 |
| de_pzjg1 | Sfl.Z.F. | 乘員估距 |
| de_rso_flak | Flakvisier 38 | 乘員估距 |
| de_rso_pak40 | ZF 3x8 | 乘員估距 |
| de_sdkfz140_1 | TZF 3a | 乘員估距 |
| de_sdkfz234_2 | TZF 4b | 乘員估距 |
| de_tiger_e | TZF 9b | 乘員估距 |
| de_vk1602 | TZF 4b | 乘員估距 |
| proto_a | Prototype sight | 未指定设备；乘員估距 |
| su_att_m46 | OP4M-35 | 乘員估距 |
| su_bmpt34 | K-8T | 乘員估距 |
| su_is2 | TSh-17 | 乘員估距 |
| su_t10m | T2S-29-14；副塔「奧普洛特-MO 瞄準具」 | 两者都没有 RF 字段；副塔 APS 的雷达不证明主瞄具激光测距 |
| su_t34_1940 | TOD-6 | 乘員估距 |
| su_t34_85 | TSh-16 | 乘員估距 |
| su_t54 | TSh-2-22 | 1951型普通瞄准镜／乘員估距，不能套后期升级 |
| uk_cmp_portee | Telescope No. 22C | 乘員估距 |
| uk_cromwell_iv | No. 50 x3 | 乘員估距 |
| us_m10 | M70G | 乘員估距 |
| us_m4a1_76w | M71D | 乘員估距 |
| us_m4a2 | M70F | 乘員估距 |
| us_m4a3_75w | M70F | 乘員估距 |
| us_m4a3_76w_hvss | M71D | 乘員估距 |
| us_m56 | M186 | 乘員估距 |
| us_m8 | M70D | 乘員估距 |
| us_m901_itv | M27 TOW sight | 乘員估距；导弹火控不自动等于激光测距 |
| xp_bmp_k64 | PP-61 | 乘員估距；本车为假想车辆 |
| xp_bmp_k64_atgm | 9Sh119 | 乘員估距；导弹型号不证明 RF |
| xp_bmp_k64_kornet | 1P45 + thermal | 不凭激光驾束制导或 thermal 名称分类为 laser RF |
| xp_kda35 | periscope sight | 未指定设备；乘員估距 |
| xp_w78 | periscope sight | 未指定设备；乘員估距 |

额外 `fun_hexa` 资料：主塔与两座副塔都是「工坊瞄準鏡」，各自明写 1.8 s／3%／3000 m，但无设备型号。只能记录「项目原创、种类未指定」；不得伪称历史合像／激光。若决定给它工坊合像，应明确记录游戏设计选择。

## 工坊预设审计

| 预设 | 基底／瞄具来源 | 当前 RF |
| --- | --- | --- |
| hetzer20 | de_hetzer／de_hetzer_sdkfz1401 的 TZF 3a | 2.5 s／5%／2500 m；缺设备资料 |
| bmpTwin | xp_bmp_k64／xp_bmp_k64_atgm 的 9Sh119 | 同上 |
| kda35 | xp_kda35／同 ID 的 periscope sight | 同上 |
| hexa | proto_a／三座通用工坊瞄具 | 每座 1.8 s／3%／3000 m；未指定种类 |
| twin | de_tiger_e／通用工坊瞄具 | 1.8 s／3%／3000 m；未指定种类 |
| porcupine | us_m4a3_76w_hvss 保留原塔＋三座工坊副塔 | 原塔 2.5 s／5%／2500 m；副塔各 1.8 s／3%／3000 m |

三座实用预设并没有激光或合像 donor。仅增加 enum 到内部 resolver、没有加入工坊选择，会让使用者无法实际试到激光。设备选择应以炮塔为单位，默认「继承瞄具」，明确 override 才改装；更换火炮不能改变 donor 设备。

## 硬体来源与变型边界

本节来源已实际打开并阅读；不把只返回搜索摘要、无法读取正文的 ODIN 页面作为实施证据。

- **合像与立体不是普通倍率瞄准镜的别名。** 原始美海军光学手册分别说明两类测距器的光路、双端基线和量距调整。它支持把两者作为独立光学设备，也说明真实操作依赖操作者与环境；并不能推出某个固定游戏秒数。[US Navy, Fire Control Installations, chapter VI](https://www.ibiblio.org/hyperwar/USN/ref/FireControlInst/FireControlInstsCh6.html)
- **豹 F：保留立体名称与预定装备语境。** 本项目 `tools/gen_vehicles.py:2081` 明称侧部罩为 stereoscopic RF，`vehicle.json.meta.notes` 明说 RF 数值与 TZF 13 倍率是估计。外部二手史料也称 Zeiss EM 1.32 m 为研制中的立体测距器；本轮未读到其原始厂家档案，不能声称已有服役量产设备或准确测量时长。现有项目装备已明确，可作为游戏内 registry 的 `stereoscopic` entry，但 provenance 要标「计划装备／游戏重建」。[史料校对入口](https://tanks-encyclopedia.com/ww2/germany/panther-ausf-f.php)
- **M47／M48／早期 M60 不是当前车库。** 美军原始火控手册说明 M47 用 M12 立体测距器，M48 早期系统用 M13，M60 的 M17C 是合像；M60A3 改用 AN/VVG-2 激光。DLA 原始 M17C 规范进一步明确适配 M48A2C 与 M60。不能给整条 M48 或 M60 家族统一标 laser 或 coincidence。[MIL-HDBK-799(AR), §§1-2.5.3.1–2, pp.1-34–1-35](https://www.casa.co.nz/equipment/Military/CI-799-MH-3983-2901-516p.pdf)；[DLA MIL-R-45677 M17C](https://quicksearch.dla.mil/qsDocDetails.aspx?ident_number=24836)
- **T-64A 与 T-64B：具体瞄具优先于家族名。** 1973 年原始 T-64A 手册，§3.1、印刷 pp.160、183–185，说明 TPD2-49 是光学设备，量距区间 1000–4000 m，操作者合并分割影像；原手册名称为 monocular-stereoscopic，不宜忽略其原名而声称与任何美制合像器完全相同。1983 年 T-64B/B1 手册，§4.3、印刷 pp.16、51、59–60，列出 1G42 的光学量子发生器及脉冲返回计时，即激光测距，区间 500–4000 m。两类在当前车库都不存在；BMP-K-64 借 T-64A 底盘或装甲不继承 TPD2-49。T-64A 后续改装应凭实际 TPD-K1／1A40 标识另建条目，不凭 A/B 字母或年份通配。[T-64A 原始技术与操作手册](https://djvu.online/file/FsLF9RLfTXhRk)；[T-64B/B1 原始技术与操作手册](https://djvu.online/file/NmTSl52FUfHQ2)
- **原始 T-54／T-55 不等于后期激光改装。** 原始 T-54 手册「日间仪器」，印刷 pp.73–78，将 TSh2-22 描述为可切换倍率的铰接望远瞄准镜；与当前 T-54(1951)、TSh-2-22 名称一致。不能从 7× 或后续 T-54M/T-55M 的装置逆推本车激光。当前没有 T-55；本轮后期 T-55 的官方 PDF 未能成功读取，故不提出具体 T-55 升级 registry。[T-54 原始技术与操作手册](https://djvu.online/file/Sv97oUruImEyM)
- **Gepard 需完成型号证据才改。** 当前 meta 指定 Gepard 1A1，但未写 B2L 或激光装置，原始武器 RF 空白、雷达明确「只显示不模拟」。原兵种协会的技术表列 Gepard 与 1A2 激光设备，但没有细分 1A1/B2/B2L；官方 Bundeswehr 页面说对地目标光学手动交战。此证据不足以直接给当前 PERI instant laser。以后确认具体 B2L 装备、安装位置及地面测距模式后可加确定的 registry entry；雷达不是本次两类 RF 的替代证据。[原兵种协会 Gepard 技术表](https://www.gemhflatr.de/joomla/images/dokuhflatr/R25_Gepard_Internet.pdf)；[Bundeswehr Gepard 说明](https://www.bundeswehr.de/de/meldungen/flugabwehrkanonenpanzer-gepard-5400072)
- **Kornet 不升级成激光测距。** 本项目 1P45 + thermal 只表明瞄具／热像，9M133 的 laser beam riding 是制导方式。未找到可实际读取且精确对应该假想双管套件的原厂家 RF 配置。保留未知，须明确游戏改装选择后才赋予激光测距；不把激光制导字段当作测距类型。

## 建议的最小实现

1. 独立设备 resolver，区分 `manual`、`coincidence`、`stereoscopic`、`laser`，并保留 provenance。合法明确设置优先，其次经过核对的「来源车 ID＋瞄具名称」registry，最后 manual/untyped。legacy RF 数值单独保存；数值存在不证明类型。注册表至少可包含 de_panther_f；Gepard 留 unresolved。不可用名称中含 optical/periscope、年份、倍率或导弹 guided 自动识别。
2. 仅改变运行计时。例如保留 manual 的 legacy time_s；已认定的光学 RF 用有限正数的缩短计时。可选 `min(originalTime, 1.0 s)` 作为明确的**游戏估计**；豹 F 因此 3→1 s，比 2.5 s 乘员估距快。具体常数由主实现选择，不把原始 3.0 改成硬件史实。laser 在 startRanging 的动作分支立即完成。error_pct、max_range_m、RNG、5 m 量化、autoZero 开关维持既有值。
3. 非激光等待必须检查 Number.isFinite(total) 且 total>0，再建立状态；进度夹至 [0,1]。激光不创建 `{total:0}`。未知 enum、无设备、错误类型或导入脏值不能变成瞬测。
4. 工坊新增每塔设备选择；缺省继承 donor。正常选择 donor 时，registry 的设备身份一起传给生成塔；基底和火炮 donor 不影响它。设置 import 正规化验证枚举，源资料用 clone、不得 mutation。保留旧预设匿名有限计时，除非明确加入游戏装置选项。
5. 如果保持数据格式不变，设备作为 runtime bundle 的独立 metadata 加到每塔，并在完整工坊导出的设置／独立设备 sidecar 保留；不能把未经 schema/Rust 支持的 kind 写进现有 weapons.json。设置 JSON 往返与独立导出加载必须有明确接线。另一种更完整但较大方案是添加可选 RangefinderDef.kind，同步 Rust Deserialize/schema/validator 与导出，仅新生成工坊文件写它，所有原始库存文件不动。本轮建议前者；设计局更多 UI／Rust schema 扩展可另做。
6. 设备快慢应在实际 start/finish owner 测试。若等待中切武器，采用清楚的一致规则：取消，或 snapshot 设备和测距上下文；目前「旧 total、新 rf、新枪口」混用应避免。普通独立机枪不凭最后选中的炮塔继承一个新激光设备；同轴机枪可按明确共享主瞄具策略处理。不要以改设备种类为由改现有瞄具倍率、近焦或枪口坐标。

## CPU 验证与需补的回归测试

本轮运行 `node --test test/vehicle-actions.test.mjs test/workshop-loadout.test.mjs`：**29/29 通过，0 跳过**。包括实际 main.js keydown/keyup 提取执行、短 F 单次测距、三秒 F 真正开始 core 修复、移动与焦点取消、导入／来源瞄具／副塔继承和源资料不变。设备新行为尚未实施，下面是需要补充的验证，而非完成声明。

- 用实际 VehicleActions＋真实 main startRanging 路径：F keydown 不生成激光结果，≤0.35 s 释放在同一次调用取得结果；3 s hold 只修复，松开不补做测距；重复键、死车、暂停、焦点及取消沿用原行为。
- 对同一个确定 ray hit，manual 开始后尚无结果、保持基准耗时；coincidence 与 stereoscopic 均较快且 total 有限大于零，完成恰好一次；laser 不等待 update，G.ranging 始终不是零时长状态，画面进度绝无 NaN／Infinity。
- 即时与等待完成调用同一真实量距计算：固定 seeded RNG 后 measured、truth、sound 次数一致；autoZero=false 只给读数，true 设置表尺；超过 max_range_m、天空无命中仍失败。不得因为 laser 而无证据删除原误差／量程。
- 全 fleet resolver audit：42 playable＋副塔；de_panther_f 为 stereoscopic；普通 TSh/TZF/M71/PP scopes 不能升级；Kornet 的激光制导不能触发 laser；Gepard unresolved 不静默赋予 laser；missing RF 与只有 time_s 的匿名 RF 不等于 coincidence。
- 工坊矩阵：不同 base／gun donor／sight donor，主塔／副塔／keepStock，都从实际 sight donor 与显式设备选择获取种类。用豹 F donor 搭不同底盘验证立体 RF；用通用工坊 laser selection 实际测试瞬测。设置导入、存储、完整导出与再次加载保留该选择；旧设置缺字段兼容；冻结源对象确认未改写。
- 边界：未知 kind、字符串 time_s、0、负数、NaN、Infinity、空 RF、部分字段；不可意外得到激光、无限等待或 NaN 进度。设备身份与时间校验分开，不用 zero time 当类型识别。
- 上下文：主炮瞄具、同轴／独立机枪、不同炮塔及近距离目标；保留画面中心 ray 与选择武器 muzzle 的现有距离定义。切换途中遵循已选的取消／snapshot 规则；不以新炮塔的 error/range 完成旧炮塔的计时。

不确定项：豹 F 原设备尚为计划／重建配置；现有 RF 数值皆为游戏近似；Gepard 1A1 的具体 B2L 配置没有定论；Kornet 假想套件与原创车没有确定 RF 硬件；未来 T-64A 改装、T-55 或 M48 变型必须另核对具体设备。这些不妨碍在工坊加入明确标注为游戏改装的三类设备。
