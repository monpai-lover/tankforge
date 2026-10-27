# R8.2 空战联机与大地图修复

本轮基于 `codex/r81-airwar-agm-fixes` 的 R8.1 已推送源码，修改用户的 TankForge。
Claude-of-Tanks 参考仓库及主 checkout 的用户文件没有参与本轮编辑。

## 已实现

| 项目 | 根因及修正 |
| --- | --- |
| 多人现代机不开火 | AGM/AAM 原先被原投放菜单回退成 `held`，服务端只接受 `single`；确认被拒后客户端同时封住机炮。制导武器现发 `single`，炸弹/火箭弹仍保留原投放程序。 |
| 多人燃油不更新 | 原 HUD 与联机 HUD 用同一飞机作为平滑历史键，但时钟和生命周期不同，交替清空续航历史。联机读数使用独立 `historyKey`，每次仍读取服务器实际库存。 |
| 燃油时长 | 10/20/30/45 分钟选项不变，以 `throttle=1.0`、无加力的耗油量装油；油箱实际容量仍封顶。低油门实际耗油更慢，加力更快，燃油质量继续影响机动。旧 0.65 基准服务器不显示为新的 100% 选项。 |
| 火神炮打地面卡顿 | 同一次实击不再重复计算两遍目标注册指纹；爆炸候选先用当前姿态真实 AABB 保守排除范围外实例。逐发碰撞、射速、弹药、伤害、精确遮挡和多弹回放均保留。 |
| AGM 毁伤 | TNT 当量进入爆炸半径、压力和能量计算；原始装药质量、壳体质量保持。只有已在内部爆炸的压力可绕过其他已注册乘员/模块，装甲及 Unknown 表面仍阻断。没有让外部近失无条件击毁闭舱重甲。 |
| 大地图坐标 | 模型和挂载的显示层保留双精度平移，CPU 完成相机相对变换后上传；粒子、曳光、尾流和干扰弹在写 Float32 前减去相机原点。阴影、HUD 投影和正交状态图使用对应相机。原始几何、碰撞矩阵与联网世界坐标不改。 |
| 大地图周期停顿 | 每跨 750 米，原来主线程重建近景和远景接缝。台海现使用后台 Worker，一次只计算一个任务、合并到最新请求；逐帧上传并原子替换完整地形。旧地形保留到新地形可用。Worker 不可用时保留原同步回退。 |

## 验证与实际边界

- 当前前端完整门禁：131 个文件，811/811 个测试通过，输入指纹前后一致。两项既有历史测试因旧 WASM/ffmpeg 条件不具备，明确保留 NOT_RUN，没有伪造历史输入。
- 核心：205/205 combat、453/453 server 测试，装药/内部压力新回归及燃油 13/13 通过。完整 server 复核中修正了不可变地形策略重复并发发布的缓存竞态，容量保持 4 项；房间桥梁损坏状态仍相互隔离。
- 同源 Windows 新服、两个真实 socket 加原本地飞行 WASM/runtime：Me 262、F-16/AGM-65G、F-15/AGM-65D 成功开炮和投放；F-15/AIM-9M 在没有合法目标时拒绝发射且不扣导弹，机炮仍可用。全部确认 `reference_throttle=1`、燃油下降和 HUD 当前读数。F-15 的少量启动位姿拒绝后恢复保留在证据中，不能声称零拒绝。这些测试的绘制/音频边界是观察桩，不等于浏览器画面实测。
- 高射速实链：6000 rpm、100 发、100 次真实伤害、99 次同会话追加。性能专用改动使 CPU 总耗时 846.51→644.06 ms，较慢帧 19.49→13.74 ms；性能专用前后完整伤害记录相同。最终合并版另有本轮授权的 TNT/内部压力变化，不能宣称相对 R8.1 所有伤害都相同。测量是 CPU 重放，不是 GPU/FPS 数据。
- 台海实际地图两次移动网格：Worker 与同步建造器每个网格的上传数据逐字节一致。主线程原重建约 0.48–0.54 秒；后台版本的测量以 Worker 回归日志为准。未用减少地形、降低射速或跳命中掩盖开销。
- 350 km 平移模型/挂载、实际粒子/曳光/贴花和远坐标干扰弹一致性通过；实际 WebGL2 主着色器/阴影/两种 FX 均编译链接通过。已加入冻结回放直接替换 `world` 矩阵时不复用先前显示姿态的回归。
- 实际渲染表面/WASM 的 312 个 AGM 控制例前后对比：M8 顶部直击从 0/13 击毁变为 9/13；Tiger 顶部已穿入的爆炸能杀伤同舱乘员，仍保留隔断后驾驶员等生存。侧击和两个固定近失控制点另有记录；这些点的名称不代表逐车型离装甲表面精确 2/5 米。
- 仍有显式限制：未知表面阻力继续安全拒绝；本轮没有测定 PBXN 配方的额外当量，也没有把战斗部总重当装药。旧的全 workspace 验证存在悬挂测试引用未集成 API、车辆资料 P008 检查失败，不能声称全仓库所有验证已通过；这两项不属于本轮空战运行路径。

完整 418,811,885 字节交付页面已在 Edge 实际启动，主/阴影着色器链接通过、`frameError=null`。
通过正常大厅 UI 进入台海 AI 观战，真实 Worker 完成一次交换、4 次上传、0 个错误；随后明确退出房间。
使用 SwiftShader，保留截图引起的 ReadPixels stall 警告和单个 404，不据此声明 GPU/FPS 改善。
代码独立复核未发现 P1/P2 阻塞；发现并补齐了 Worker helper 源码漂移检查。
浏览器完整页面实测、原生完整门禁、交付指纹的最终证据随本目录 `evidence/` 保存。
Linux amd64 为 Windows 上交叉构建的静态 ELF；未在用户的 Linux 服务器执行或部署。

## 重建与检查

当前页面按根目录 README 流式重建。完整 HTML SHA-256：
`eeac869b23139cbcfd05512e3c6ab016c8032015704e4bb0168af5d4cc22ee3f`。
当前 combat WASM SHA-256：
`468be618033ade4767913414f8fbbe6e984a5c6f1f6f469aafe9395f48e8df35`。

```sh
node handoff/tools/apply_r82_airwar_fixes.mjs --check
node handoff/tools/sync_design_core.mjs --check --wasm target/wasm32-unknown-unknown/release/tg_design_wasm.wasm
python tools/test_rebuild_current_handoff.py
cargo test --locked -p tg-combat --lib
cargo test --locked -p tg-server --lib
```

前端完整门禁用 `handoff/tools/run_r81_node_gate.mjs`，在显式设置仓库中历史 fixture 和
测试 shell 后执行；工具名沿用 R8.1，清单已包含本轮回归。独立联机情景入口是
`handoff/tests/native-mp-live-runtime-scenario.mjs <ws-url> <new-receipt.json> <scenario>`，
scenario 可选 `me262`、`f16-agm`、`f15-agm`、`f15-aam`。仅对自己的隔离测试服务使用。

Linux 完整包使用 `tools/package_current_linux.py --page <本轮HTML> --server <musl可执行文件> --output <新tar.gz>`。
解压至新目录，运行 `chmod +x tg-server start.sh && ./start.sh`；默认端口 8787。
客户端、服务端和 data 应成套更新，旧版网页缓存需要刷新。
