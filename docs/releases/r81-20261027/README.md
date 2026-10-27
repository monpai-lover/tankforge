# R8.1 源码同步与验证

本次同步的是已验证的 `tankforge-penetration-r8.1-linux-amd64-20261027` 源码。
Git 目录结构沿用原仓库：Rust、客户端源码、数据及工具位于根目录相应位置，当前完整航空客户端保存在 `handoff/`。
保留已有模型、表面几何、装甲绑定、归属和许可记录；没有提交编译缓存、临时抓包或完整测试 HTML。

## 重建当前页面与服务端

```sh
python -c "from pathlib import Path; Path('client/web/dist').mkdir(parents=True, exist_ok=True)"
python tools/rebuild_current_handoff.py --output client/web/dist/tankforge-r81.html
cargo run --locked --release -p tg-server -- --data data --page client/web/dist/tankforge-r81.html
```

页面大小为 418,794,158 bytes；SHA-256 为
`f2d507c002fa0a8aed351ce606685cb76fa5d926c0ed1db7c5d4ced41373e4fa`。
重建只使用仓库内的 `head.html`、五个 gzip 分段和 `app.js.html`，不需要原下载目录。
默认重建校验固定为本次交付；后续修改客户端时，应同时更新预期哈希或明确传入新版本的 `--expected-sha256`。

当前独立 C 飞行核心、base64 及页面内嵌版本均为 C215；combat 核心的四个 revision 均为 1。
当前页面内嵌 combat WASM SHA-256 为 `ad3d62b8a311f3c23a127317e55f4930a902fbcd4cb64e3f8638585e42335f32`。
原 `client/web/assets/tg_design.wasm` 是旧客户端的历史回退输入，不能将旧 `npm run build` 的回退结果当成本次页面。
维护当前内嵌 combat 核心时，使用 `handoff/tools/sync_design_core.mjs --wasm <新核心> --check` 或 `--write`。

## 自动验证

```sh
python -m unittest discover -s tools -p test_rebuild_current_handoff.py -v
node --test --test-concurrency=1 handoff/tests/agm-ground-point-runtime.test.mjs handoff/tests/frontline-ground-point.test.mjs handoff/tests/frontline-guided-control-20261026.mjs handoff/tests/frontline-guided-consumers-20261026.mjs handoff/tools/agm_launch_fix.test.mjs
cargo test --locked -p tg-server --lib native_agm_point
cargo test --locked -p tg-combat -p tg-penetration -p tg-missile
```

完整 Node 选择集还需要由当前 Rust 源码构建的 combat WASM（构建输出不提交 Git），以及固定的历史输入。
仓库在 `handoff/tests/fixtures/history/` 保存历史输入的原始字节；Linux 示例：

```sh
rustup target add wasm32-unknown-unknown
cargo build --locked --release -p tg-design-wasm --target wasm32-unknown-unknown
TF_OPTICS_BASE_APP="$PWD/handoff/tests/fixtures/history/frontend-app-20261025.html" \
TF_LEGACY_SURFACE_CORE_BASE_WASM="$PWD/handoff/tests/fixtures/history/surfaceCore-original-active.wasm" \
TF_TEST_SH="$(command -v sh)" \
node handoff/tools/run_r81_node_gate.mjs ./target/r81-node-check
```

输出目录须为新目录。Windows 下可用对应 PowerShell 环境变量设置同样的绝对路径；
`TF_TEST_SH` 指向实际 Git `usr/bin/sh.exe`，不使用会重写测试 PATH 的外层启动器。

原始交付证据保存在本目录的 `manifest.json`、`source-delta.json` 和 `evidence/`，未经重命名伪装为新的运行。
已经执行的结果：

| 范围 | 结果 |
| --- | --- |
| 最终客户端专项 | 44/44 |
| 最终资料上的原生地面点专项 | 11/11 |
| combat／penetration／missile | 239/239 |
| 完整已选 Node 检查 | 784/784，123 个文件 |
| 更新包装工具 | 101/101 |
| primary、R6、R7、R8 安装／回滚 | 四队列全部通过 |

完整服务端 448 项单元测试和 3 项集成测试在飞机资料更新来源哈希之前通过，作为 `REFERENCE` 保存。
随后实际导出器只更新了 `source.appSha256`；所有运行时数据和其他来源段逐字段相同，并在最终资料上重新执行了原生地面点专项。
两项缺少历史运行条件的 Node 测试仍明确记为 `NOT_RUN`，没有制作替代夹具。

Linux amd64 静态服务端已由同源源码交叉编译并核对 ELF；没有在 Linux 实机启动、远端部署或人工 GPU 飞行验证。
便携安装和回滚入口为 `tools/air-frontline-update-r8.1/install.py`；
`build_delivery.py`／`finalize_delivery_r8.py` 是原机器上的封存交付流程，保留路径和收据，不作为通用重建器。

## 素材与许可

保留 `SOURCES.md`、飞行核心许可证、命中回放许可证及各模型的 attribution／credits。
代码与资源沿用各自原有许可；模型、人物、照片和字体不能统一改标 MIT。
