# 全武器Hit提示 Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development。用户已明确要求，按现有HUD样式实施，先规格再质量审查。

**Goal:** 机枪等所有本人有效命中都有稳定的Hit反馈。

**Architecture:** 复用Hud.hitMarker，短寿命状态控制刷新与击毁优先；main中的单人确认和联机服务器回执统一接入。若归一化结果和提示生命周期需要独立CPU单元，新增game/hitFeedback.js。

**Tech Stack:** 现有JavaScript、HTML/CSS、Node；工作树codex/suspension-tracks-v7。

## Task H：命中路由与显示

- [x] 先写并运行RED：真实updateBullets机枪stopped且modules/crew为空仍通知；miss不通知。运行真实服务器damage回调，本人非致命通知，他人／自身／miss不通知。真实靶板命中通知。
- [x] 改client/web/src/main.js中的updateBullets、updateShots、本人导弹命中及net.damage，沿用命中确认和来源判定；在线遥控敌车预测不重复给确认。保留伤害与X光原路径。导弹地面近弹提示保留owner。
- [x] 最小修改crates/server/src/lobby.rs的无损MG早退：有效非miss发送仅射手的既有damage形状回执，HP／能力不变；实际大厅射击证明测试验证拒绝／miss无提示、旁人不收到假伤害。
- [x] 改client/web/src/game/hud.js和client/web/template.html：Hit主标签与短结果，共用短TTL，连射刷新而不强制读取offsetWidth，不重置可见动画；击毁优先，切屏过期清除。添加必要的小型CPU生命周期单元及测试。
- [x] 跑新测试和已有HUD／武器／网络相关测试，精确检查差异；根因routing测试须有行为证据，不能只搜索调用字符串。36项相关web测试及47项server lib测试PASS；不进行浏览器／构建／发布。
- [ ] 精确提交仅本项文件／main命中区块，不混入未完成Task2履带改动或B规格文档。新规格代理PASS后新质量代理APPROVE，修复后复审。
- [ ] 恢复Task2原实现代理继续完整B；本项随最终构建发布，不提前发布未完成的履带核心。
