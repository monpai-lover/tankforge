# R8.5 最终验证证据

这些文件对应最终 R4 页面（完整 HTML SHA-256 `c40762271537e5377100b660289db7081d65c6f3401dd6876c0b0e2def6980b5`）。原始收据中的本机路径和提交前基线标识按原样保留。

- [前端门禁](node/receipt.json)：149 个文件、907/907，输入前后不变；两个历史 NOT_RUN 明列在收据中。
- [原生门禁](native/receipt.json)：501/501，229 项输入一致；[原始运行日志副本](native/cargo-test-server-lib-release.txt)仅改变文件扩展名，字节与收据日志哈希一致。
- [Linux 构建](linux/receipt.json)：amd64 musl 静态 ELF；附完整输入清单和飞机来源元数据差异证明，未在 Linux 执行或部署。
- [MiG-17 挂载](loadout-mig17-r4-final.json)与 [F-15 挂载](loadout-f15-r4-final.json)：保留普通 UI 操作和原生接受状态，仅移除重复的 `options` 目录快照；各自包含原始收据路径及 SHA-256，原始文件未改写。
- [单人恢复与防护查询](state-protection/receipt.json)：最终页面实际操作；[装甲截图](screenshots/armor-thickness.png)已目视检查。
- [V3 回放](replay/receipt.json)：真实快照／渲染器和合成记录轨迹，覆盖连续命中与立即换目标，不作为实际毁伤或 FPS 证明。
- [海水着色器](water/receipt.json)：实际 HDR／回退编译及像素回读；[同步对比](screenshots/water-comparison-t3.png)已目视检查。
- [台海舰队页面](fleet/receipt.json)：实际原生 14 艘舰船、头顶提示、机场灯、地形后台交换；[舰队及海水截图](screenshots/fleet-water-hints.png)已目视检查。SwiftShader 测试不代表硬件帧率，非致命控制台消息保留在原收据。
- [独立收尾审计](final-audit/final-audit-receipt.json)：运行时与二进制无漂移，五段资源与基线相同。历史构建清单与最终脚本之间唯一差异为加强防护查询测试；最终 9/9 页面测试使用加强后的版本。原始清单和差异均保留。
- [交付包收据](packages/)：完整包 2700 个文件、R8.4 增量包 10 个替换文件，均已逐项读回验证；大型 HTML、服务器二进制及压缩包保存在 Downloads，未重复放入 Git。

`SHA256SUMS` 记录本目录的收据及截图字节，用于独立核对；不包含本清单本身。
