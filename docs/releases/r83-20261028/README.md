# R8.3 台海海空护航与联机显示（2026-10-28）

本轮在隔离工作区修改 TankForge，基于已推送的 `33bd2ba7ee6883b0941be9d07d4c6b90796615bb`。
保留现有飞机操纵、地图内出击和挂载界面、服务器武器/命中/油弹/胜负权威。

## 本轮功能

- 新地图 `taiwan-escort` 保留原始 `taiwan` 来源图。地理距离和源高程实际压缩为 1:100；飞机、舰船、速度、弹道及秒数保持米制。两岸提供福建/台湾机场及附近空中出生。两条 1600×45 米跑道是为游戏明确配置的局部布局，不宣称真实机场测绘或 1:1 跑道位置。
- 中方运输舰、护航舰与台方舰船使用服务端实际航行、有限弹药和自动交战。可被飞机枪弹、炸弹和 AGM 击中；显示和接触使用同一份 Float32 舰体三角形及炮组轴。没有把舰船画面替代为客户端独立伤害模拟。
- 中方至少一艘登陆舰在近岸登陆区低速存活，连续卸载 15 秒后获胜。台方须击沉全部中方运输舰与护航舰；仅击沉运输舰不会立刻宣告舰队全灭。900 秒超时台方防守胜。这个剧本不再由旧占点分数或空军全灭规则提前终止。
- 小地图随飞机/观战目标移动，附近范围为 **10 km 半径、20 km 窗口**。单位按真实游戏米过滤。压缩后整个 4.72×5.40 km 战区会小于窗口，这是两项用户要求叠加的结果。
- 阵亡后默认观战存活己方飞机，可切换下一位队友；没有己方飞机时，回退己方存活舰队或机场。沿用玩家原队伍已获准的可见数据，不把阵亡玩家升级为全知观察者。处理 Control loss 早于新 Room 成员状态的实际消息顺序。
- 机场在小地图和世界投影中显示名称、距离；跑道有实体可降落表面、标线、白色边灯、绿色入口灯和红色防撞灯。机场维修补给沿用服务端原有 15 秒整备。
- 尾焰/跨声速云移至实际绘制阶段，在完成本机姿态与摄像机更新后生成。GPU 忙碌期间继续输入，不再堆积旧位置的附着光片。
- 机枪每 3 发、M61 等转管炮每 5 发显示曳光；其他机炮遵从当前炮弹目录默认及显式 `tracer:false`。这是本游戏显示规则，不宣称所有历史弹链具有相同配置。所有轨迹来自实际已发射炮弹，保持原弹药、碰撞、射速与伤害；不把 muzzle flash 当成弹道。
- Su-27UBK/SKM 与 MiG-29 9.12/SMT 追加 20 个常规挂载预设；FAB-100/250 仅复用已许可 FAB-500 的挂点和数量。旧预设索引不变。双方仍可选择各国机型，仅限制最高年代。详见挂载审计。

## 验证与边界

- 原生服务端完整测试：**496/496**，0 失败。包含实际 Room 启动、舰船射击、物理击沉全部进攻舰队、连续 15 秒登陆、终局只发布一次、出生朝向与速度、900 秒全船体顶点航路水域核对及团队隐私。
- 前端门禁：**139 文件、858/858**，输入指纹稳定。保留两项缺失历史环境的 NOT_RUN，未用新数据假造旧 WASM 或音效依赖。
- 三个真实 socket 的 M61 测试：100 次实际射击、100 发扣弹、20 个唯一曳光记录；实际客户端 FX 产生可绘制 beams，1 full + 96 delta、0 reset。所有测试 peer 显式离开。
- 完整交付 HTML 在 Edge/WebGL2 中实际启动；通过原大厅创建新台海观战房间，舰船、机场灯、10 km 小地图及后台地形交换通过，随后显式退出。截图使用 SwiftShader，不据此宣称真实 GPU 帧率。
- 最终交付页面另通过真实阵亡观战流程：两名实际联机 peer 提供红方及跑道上的蓝方队友，浏览器用原键盘 `KeyW` 和本地飞控真实坠地，服务端确认损失后自动跟随存活蓝方队友。驾驶控制、出击菜单和旧坦克仪表均退出，0 页面/帧错误，所有连接显式离开。自动化等待原缩略图预热和输入界面就绪，不修改伤害、姿态或生产飞控。
- 同源舰船显示组件 11 项检查，包含炮组 pivot/pitch/yaw 与 native 一致、共享缓冲、离开重进、生命周期及过期帧拒绝。跑道标线与沥青保持不同高度，避免共面闪烁。
- 原始 R7/R8 挂载记录和 pins 保留；新 R83 兼容记录精确列出新增预设/挂点与默认数量，旧弹药装药、原预设、未许可武器和坐标变异继续拒绝。
- 本轮没有凭武器总重虚构装药，没有把 SKM/SMT 的制导能力赋给 UBK/9.12。Kh-31/35、新 KAB、S-13/25、R-27ER/ET 等仍需各自资料、挂载和真实发射路径后才能新增；本轮完成的是已证实常规挂载扩充。
- Linux amd64 是 Windows 上交叉编译的静态 ELF64，已核对没有动态解释器/依赖库；未在用户 Linux 上运行或部署。先前全 workspace 中悬挂 API 与车辆资料检查的历史问题不在上述门禁范围，不宣称已一并修完。

## 交付与启动

完整包：`tankforge-r83-taiwan-airwar-linux-amd64-20261028.tar.gz`，299,786,844 字节，逐个读回验证 2698 个文件。

SHA-256：`e7984f74e118bb4ac7bc44e9bef46c0ed3e60498a5f458950572d8ce777b2bb1`。

增量包：`tankforge-r83-incremental-from-r82-linux-amd64-20261028.tar.gz`，145,891,681 字节，仅适用于已核对的 R8.2 完整安装，必须保留原 data/config。

SHA-256：`12b320552449e8ab4e5006dca51042e6af5e546e26fbe378deb509bbab7ffd96`。

完整 HTML：418,843,963 字节，SHA-256 `96408bd46c2270b70da0351172cf4b8caf510079540c9082e7f737bef5e4b6e6`。

Linux server：6,768,112 字节，SHA-256 `b081325f9a05c53433d0dc95ad5286e09113d97534e9c9889b5afeb226248eb0`。

完整包解压到新目录，停止旧服务后运行：

```sh
chmod +x tg-server start.sh
./start.sh
```

默认 8787；`TF_PORT`、`TF_BIND` 可覆盖。HTTP `/` 与 WebSocket `/ws` 必须转发到同一新版服务，客户端与服务端成套更新。

重建与检查：

```sh
node handoff/tools/apply_r82_airwar_fixes.mjs --check
node handoff/tools/apply_r83_airwar_fixes.mjs --check
python handoff/tools/sync_frontline_client.py --check
node handoff/tools/export_frontline_aircraft.mjs --check
python tools/test_rebuild_current_handoff.py
python -m unittest tools/test_taiwan_escort_map.py
cargo test --locked -p tg-server --lib
```

实际完整页面浏览器入口：`handoff/tests/native-escort-browser-smoke.py <url> --out <new-dir> --sha256 <hash>`。
实际键盘坠地及队友观战：`handoff/tests/native-escort-death-browser.py <url> --out <new-dir>`。
完整门禁仍使用 `handoff/tools/run_r81_node_gate.mjs`，按 `handoff/qa/r81-node-test-inventory.json` 运行；历史 fixture 与测试 shell 环境设置沿用 R8.2 文档。
