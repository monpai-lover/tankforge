# 当前挂载升级（mounted-details-v4）

目录名mount-v3保留以兼容既有接线。当前版本包含之前的F15/Su27、吊舱/副油箱与全部内构升级，并修复F16/F104翼尖侧挂、MiG21四挂与黑帽、MiG29专用S24B支架和NF01/F4U旧外挂穿翼。

F16/F104旋转真实socket与弹体后接到导轨外侧，三条展示路径保留storeRotation。F16内侧原生纵向挂架及前后锁扣按选中挂载启用，GBU12实装近图可验证其已接入。F15每侧源双导轨最多两枚，不另叠第三枚。

MiG21MF新增R3R/R60选项和RP22/SARH链，来源签名清理仅移除四个孤立黑帽的480个三角形，原索引不变。SAMP250是独立程序模型。新增武器/雷达/外形参数有游戏估计标记；旧67预设和老武器定义保留。

- catalog.mjs / catalog-capabilities.json：当前目录、设备、雷达与新增定义；后端需同步能力。
- source-cleanup.mjs：MiG21解码前精确来源守卫。
- fitted-mounts.mjs / fit-profiles.json：最终可用数据；onlyWeapons专用件优先，NF01/F4U按量化几何指纹守卫。
- mount-collision-map.json：17机型107个潜在适配件，使用原伤害ID与相同实际三角形；仅当前fittedMountKey启用，发射保留、载体脱落移除。
- ../hardpoints/native-layout-map.json：17模型55预设379对象的初始布局/旋转；已接受的Native host.p仍保留权威。
- ../mount-v4-audit/weapon-carrier-coverage.json：26×87全部资源关系与385个站位型号菜单项，逐对列可选与缺模型/需适配架/未证实的原因。未声称实机全部外挂已穷尽。

当前证据见包根verification/mount-v4/acceptance.json：126项模型/内构/O/挂载检查、26机型172状态及121套非空实装近LOD0三角面检查通过。9张实际Renderer固定测试姿态PNG和两张总图位于verification/screenshots；不是生成式图片。

按source/TESTING.txt从自己的原网页与升级网页提取资源fixture后运行测试。普通安装直接用最终拟合表；calibration/build/refine脚本需匹配的中间数据，属于重新拟合研究步骤。当前本地空战后端仍需按LOCAL_AGENT_INSTRUCTIONS.txt集成并执行本地验证。
