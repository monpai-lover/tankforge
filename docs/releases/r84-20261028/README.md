# R8.4 台海比例与附着特效修复（2026-10-28）

基于已推送的 `4591855aa656358c772381ad80baa26fa00c6689`，在隔离工作区修改。

## 本轮行为

- 台海海空护航的地理距离与源高程从 1:100 调整为 **1:30**。原 `taiwan` 来源图保留；派生地图约 15.73×18 km，两岸机场、附近空中出生、舰队航路和登陆区一起调整。
- 小地图保持原有 **188×188 画布、UI 框、位置和 10 km 半径／20 km 窗口**。地图内容随实际地理放大约 3.33 倍；机场图标间距约由 30 像素增至 99 像素。标签用真实字体测量避让边缘、标题、比例尺及其他机场标签。
- 局部实体保持米制尺寸：1600×45 m 跑道、650 m 空中出生高度、180 m/s 初速，以及飞机、舰船、武器距离与速度不随地理比例放大。登陆区域半径改为 100 m，卸载仍需 15 秒，超时仍为 900 秒。
- 地形网格从地图边界推导覆盖范围，避免扩大后仍被旧 3600 m 半径裁切。此地图使用 9200 m 半径、100 m 步长，并保留缓存和后台交换。
- 修正最终打包页面的尾焰／音爆云重复提交。旧补丁把较短的控制更新文本当成“已安装”的证据，但它恰好也是旧文本的前缀，导致 `effects()` 留在控制循环，同时绘制阶段又调用一次。补丁现在先识别完整旧文本，删除控制阶段调用；其他插入保持严格单次检测。附着特效只跟随当前绘制姿态生成。

## 验证

- 最终完整 HTML 在 Edge/WebGL2 实际启动，经原大厅建立新剧本；实际渲染 5 艘服务端舰船、332 个机场灯，地形后台交换和 10 km 小地图通过，显式退出收到确认。截图使用 SwiftShader，不据此宣称硬件帧率。
- 最终完整页面使用原出击流程、原键盘输入与真实本地飞控加速，经过 Mach 0.99 至 1.02。单发动机每次绘制最多一组喷口火焰，位置与实际绘制姿态最大偏差 **0.000242495 m**。旧 R8.3 页面同一探针测得最大偏差 42.3856 m，并出现重复提交。
- 上述实飞截图仍显示 `stale_initial_flight_pose`；探针没有记录服务端姿态接受计数。因此此项证明本机绘制与特效一致，不能作为服务端已接受整个跨声速航程的证据。另保留最终打包桥接器的控制循环零特效提交、绘制单次提交检查。
- 实飞特效测试的效果断言通过，但退出等待出现一次 30 秒超时；浏览器已关闭，辅助 peer 的显式离开记录通过。此项不计为干净的退出验收；另一次完整页面观战测试的显式退出已通过。保留原始 receipt，不隐去该限制。
- 地图 Python 检查 **7/7**，重建检查 **8/8**；原生舰队重点检查 **33/33**、纯剧本 **5/5**。实测首次 AI 开火约 111.3 秒，登陆卸载约 693.5–708 秒，满足 900 秒期限。
- R82／R83／R84 补丁幂等、客户端源码同步、28 机型导出检查通过。
- 完整前端门禁 **142 个文件、867/867 通过**，输入指纹稳定；保留两项历史 NOT_RUN。
- 优化版原生完整检查 **496/496 通过**，151.40 秒，包含真实三 socket 回合重置测试；使用原断言与原超时，没有修改业务代码或降低门禁。
- 调试版原生完整检查仍为 **495 通过／1 失败**，失败项为上述真实三 socket 回合重置测试，严格单独重跑也失败。该环境在 18 秒墙钟等待内仅推进到 3.2 秒模拟时间；优化版通过说明执行配置会影响结果，不能单凭它确定唯一根因，也不能抹去调试版失败。
- Linux 版本在 Windows 交叉编译，静态 ELF64 x86_64，无动态解释器或依赖库；**未在 Linux 执行或部署**。先前历史需求与不在本轮范围的 workspace 检查不据此宣称完成。

## 交付

完整包：`tankforge-r84-scale30-airfx-linux-amd64-20261028.tar.gz`，299,869,751 字节，逐个读回验证 2698 个文件。

SHA-256：`73fc983ae76eb05f9bcc8463a55245d7e46ca0b3364837edbe6065d79e82ed27`。

增量包：`tankforge-r84-incremental-from-r83-linux-amd64-20261028.tar.gz`，145,963,809 字节，读回验证 7 个替换文件；**仅适用于已核对的 R8.3 完整安装**。保留其余 data/config，未知旧版本使用完整包。

SHA-256：`190cd73852436ae9e768907dbf7bc6dfe6e9e9d4d205e72a01e63d5c36fec97c`。

完整 HTML：418,847,958 字节，SHA-256 `4f3ce0ace34bca9eac736ea912c931858a2d825b10e8df623762f0c7a20ac696`。

Linux server：6,768,624 字节，SHA-256 `df4c74626062414f72fec1f1d8d04ded2c19847891c05ec97252c7ce649d1832`。

完整包解压到新目录，停止旧服务后运行：

```sh
chmod +x tg-server start.sh
./start.sh
```

默认端口 8787；`TF_PORT`、`TF_BIND` 可覆盖。HTTP `/` 和 WebSocket `/ws` 必须转发到同一新版服务。客户端与服务端成套更新。

本地最终页面测试服务：`http://127.0.0.1:8895/`。

重建、检查及真实浏览器入口：

```sh
node handoff/tools/apply_r84_airwar_fixes.mjs --check
python handoff/tools/sync_frontline_client.py --check
node handoff/tools/export_frontline_aircraft.mjs --check
python tools/test_rebuild_current_handoff.py
python -m unittest tools/test_taiwan_escort_map.py
cargo test --locked --release -p tg-server --lib
python handoff/tests/native-escort-browser-smoke.py http://127.0.0.1:8787/ --out <new-dir> --sha256 4f3ce0ace34bca9eac736ea912c931858a2d825b10e8df623762f0c7a20ac696
python handoff/tests/native-airfx-live-browser.py http://127.0.0.1:8787/ --out <new-dir>
```

完整前端门禁沿用 `handoff/tools/run_r81_node_gate.mjs` 与清单 `handoff/qa/r81-node-test-inventory.json`；历史 fixture 与 shell 设置沿用 R8.2 文档。保留两个历史 NOT_RUN，不替换缺失历史输入。
