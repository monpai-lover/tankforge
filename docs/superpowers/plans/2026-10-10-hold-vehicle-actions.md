# 长按修复与弃车实施计划

**目标：** 实现用户确认的短按 F 测距、长按 F 三秒修复、长按 J 三秒弃车和轮圈／扳手进度。

**结构：** 独立 CPU 长按状态机负责时序及取消；main 接入已有损伤、联机、输入与生命周期；原生 SVG HUD 负责显示。保留既有修复核心和服务器协议。

- [x] 在 `client/web/test/vehicle-actions.test.mjs` 写失败回归：F 短按一次测距，2.99 秒不修复、3 秒只启动一次，J 3 秒只弃车一次；修复中松开保留真实 repair_s 进度；取消和阵亡／移动拒绝。命令：`node --test client/web/test/vehicle-actions.test.mjs`，先确认目标断言失败。
- [x] 创建 `client/web/src/game/vehicleActions.js` 的长按与 HUD owner；在 `client/web/src/main.js` 接入 keydown／keyup、帧推进、重置、失焦／隐藏、聊天，加入离线／联机弃车函数和 R 重生分支。修复继续调用 `repairVehicle()`，联机仍发 `{t:'repair'}`／`{t:'respawn'}`。
- [x] 更新 `client/web/template.html`，添加轮圈、中心扳手、外圈圆环和弃车提示，修正操作帮助；用实际动作函数、实际 WASM 和 SVG／DOM 属性检查验证接线及进度显示。
- [x] 跑定向与完整 `npm --prefix client/web test`，实际重建网页／WASM，核对完整内嵌车辆资料不变；完成独立只读审查与交付说明。

验收记录：新增 17/17、定向 32/32、完整网页 320/320 PASS；实际 WASM／网页构建通过，完整内嵌数据与基线一致。说明、哈希和本地证据见 `docs/vehicle-actions-2026-10-10.md`。

交付方式：精确提交源码、测试与文档，确认 main 干净且仍位于基线后快进合并并推送；将同一构建同步到标准页面、已有别名和新的 `tankforge-vehicle-actions-20261010.html`，核对 SHA。不自动打开浏览器。
