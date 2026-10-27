# TankForge R8.1 穿透与航空作战增量工具

新包名固定为 `tankforge-penetration-r8.1-linux-amd64-20261027`，源目录固定为 `D:/TankForge-workspaces/r8.1-penetration-20261027/online-source`。工具从 R8 独立复制；R8 工具、发布包和收据保持原样。`install.py` 和 `verify_actual_release.py` 按字节复用 R8，保留完整基线队列、路径约束、dry-run、事务安装和回滚。

本轮范围包含穿透与炮管信任修复、航空与导弹原生逻辑及飞机气动表现。包名保留 `penetration-r8.1` 是兼容命名，并不限定变更只有穿透。Linux、Windows 服务器和 combat WASM 必须由冻结后的最终候选源重新构建；本轮的炮管信任与原生导弹变更需要这些新产物。flight WASM 使用候选源中的权威 C215 文件。包装工具检查显式 ELF、内核导出、C215/revision 1 和 app 内嵌字节一致性；结构检查不代表在 Linux 上执行过。维护者须在冻结源、重建产物及最终验证后才执行 `prepare`。

源增量发现覆盖 `data/barrel-shapes/**` 的全部文件类型，包括内容寻址的 `.bin` 几何、记录及信任索引；与原始 intake 收据哈希相同的文件不重复收录。运行时 data 允许覆盖本轮三份装甲文件：`data/vehicles/de_pz4_h/armor.json`、`data/vehicles/de_panther_g/armor.json` 和 `data/vehicles/de_panther_f/armor.json`；其源增量条目复用同一运行时 payload。其他车辆文件继续受原有严格白名单约束，Pantsir 精确恢复条目及来源核验保持不变。

## 固定兼容基线

可重复传入 `--alternate-baseline-package`，每项都必须是完整、不可变的准备包：

| 队列 | manifest SHA-256 |
| --- | --- |
| R6 | `e7988f2fac6fe99550431785cf973dbae6af4fb2cafae76d923105183c1f6b93` |
| R7 | `662114bf8a950a4b469f893880b9e3b8f67d7eccc9c70e875c17a04fa77bba7a` |
| R8 | `42d5d7461ea8d794a64d427b004014c71de05497e6a3ce9d17f3999b24ed3fa3` |

R8 包路径为 `D:/TankForge-validation/delivery-r8-verified-20261027/tankforge-airwar-r8-linux-amd64-20261027`。替代队列从各包完整 data 队列和 overlays 推导，固定 HTML、尾段、服务器、所有运行时 data 与缺失状态。未指定的队列不会自动加入；混合文件、重复包和未知 pin 均拒绝。

## 冻结后准备

在本工具目录运行，所有输出目录必须尚不存在：

```powershell
python -m unittest discover -s . -p "test_*.py" -v
python build_delivery.py prepare --folder D:/TankForge-validation/delivery-r8.1-verified-20261027/tankforge-penetration-r8.1-linux-amd64-20261027 --binary D:/TankForge-validation/rust-r81-target/x86_64-unknown-linux-musl/release/tg-server --flight-wasm D:/TankForge-workspaces/r8.1-penetration-20261027/online-source/handoff/flight/flight_core.wasm --combat-wasm D:/TankForge-validation/rust-r81-target/wasm32-unknown-unknown/release/tg_design_wasm.wasm --alternate-baseline-package D:/TankForge-validation/delivery-final-r6-20261026/tankforge-air-frontline-models-aphe-linux-x86_64-20261026 --alternate-baseline-package D:/TankForge-validation/delivery-r7-final-20261027/tankforge-airwar-models-guided-linux-amd64-20261026-r7 --alternate-baseline-package D:/TankForge-validation/delivery-r8-verified-20261027/tankforge-airwar-r8-linux-amd64-20261027
```

准备生成独立新目录和 `tankforge-penetration-r8.1-linux-amd64-20261027-test.html`。历史 October25 intake 只用于原资源前缀和来源，不代表 R8.1 新验证。准备不启动服务器、不操作浏览器，也不部署。

## 每个完整部署队列分别验证

```powershell
python verify_actual_release.py --package <R8.1准备目录> --baseline <完整部署副本> --clone <不存在的新验证目录> --receipt <新install收据.json>
```

`--baseline` 必须是保存的完整部署目录，不能传入仅含 payload 的增量包。primary 及准备时加入的 R6/R7/R8 队列分别执行；R8 结果的 `selectedBaseline` 应为 `tankforge-airwar-r8-linux-amd64-20261027`。验证器复制完整部署，检查 dry-run 保全，执行离线 apply/rollback，核对所有原文件与新增运行时文件缺失状态恢复。一个队列的收据不能证明另一个队列。

## 最终证据与归档

当前复制的 `finalize_delivery_r8.py` 保留 R8 的证据策略及 `TankForgeR8RunSetV1` / `TankForgeAirwarR8ValidationV1` envelope；其中 `version` 已固定为本次 R8.1 包名，旧 R8 version 不能授权本包。文件名保留是兼容安排。它要求新的 native/combat/node/package-tools 和各 install 队列 PASS；维护者若采用更窄的 R8.1 验证策略，应先完成对应 finalizer 与测试，再冻结工具哈希。不得把 R8 原收据改名成 R8.1 新运行。

```powershell
python finalize_delivery_r8.py --folder <R8.1准备目录> --linux-binary D:/TankForge-validation/rust-r81-target/x86_64-unknown-linux-musl/release/tg-server --windows-binary D:/TankForge-validation/rust-r81-target/release/tg-server.exe --print-inputs
python finalize_delivery_r8.py --folder <R8.1准备目录> --linux-binary D:/TankForge-validation/rust-r81-target/x86_64-unknown-linux-musl/release/tg-server --windows-binary D:/TankForge-validation/rust-r81-target/release/tg-server.exe --runs <新的R8.1-run-set.json>
python build_delivery.py archive --folder <R8.1准备目录> --destination <新的R8.1.tar.gz>
```

归档重新核对 manifest、payload、源增量及已绑定证据，逐个重算 tar 成员哈希。修改源、工具或证据后，既有准备及新鲜验证作废，应选择新目录重新完成对应检查。具体交付结果以对应包的 manifest 和 validation 证据为准；本工具文档不代表实际部署或 Linux/GUI 验证完成。
