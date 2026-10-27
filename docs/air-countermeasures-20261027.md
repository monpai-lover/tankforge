# R8.1 反制措施：客户端与型号资料

原生空战继续使用现有输入、飞机、HUD、控制序列、声音及 Effects 缓冲。客户端只发送投放意图，原生宿主决定实际库存、投放间隔、诱饵运动与导引头是否受骗。

## 数据来源与范围

`handoff/tools/export_frontline_aircraft.mjs` 执行交付 app 内的真实 `AIR_CM` 定义和 `TFGuidedAircraftVariants.inheritTables({countermeasures: AIR_CM})`，导出为 `aircraft[id].sensors.countermeasures = {flares,chaff}`。未定义型号与原单机 `loadCountermeasures` 一样导出零；没有按年代、外观或其他型号推测数量。Su-27SKM、MiG-29SMT 使用现有显式变体继承规则，不能据此宣称其真实设备与实战装载已独立考证。导出收据记录定义片段哈希。

这些数量是现有源码中明确标注的游戏装载；本改动保持它们的精确值，并非核实了真实载具携带的弹药盒或任务装载。反制依赖传感器视场、视线、观察时机和机动而非必定有效，是所表达的物理原则；投放对数、0.15 秒间隔、诱饵寿命与阻力、抗干扰概率、雷达 PD 加成、图形大小均是游戏校准，不冒充公开实测曲线。原生求解及其物理测试由 Rust 反制所有者负责，本文件不将客户端图形测试当作导弹实战验证。

## 控制与快照合同

命令为 `{op:'air_countermeasure',unit:{battle,unit,life},epoch,seq,kind}`；`kind` 只允许 `flares`、`chaff`、`both`。`seq` 复用已有 `f.seq`，与 `air_weapon_control`、`air_seeker_control`、`air_input`、`air_pose` 共用接管与防重放边界。

每个己方完整 `AirUnitView` 可以提供库存与诱饵。敌方 `PublicAirPose` 仅在 `intel.visible_aircrafts` 中已被观察到时提供诱饵；现有 contact 转换只保留该公开 `decoys`，不复制敌方库存，也不引入隐藏全局列表：

```js
countermeasures: {
  flares, chaff, max: {flares, chaff}, release_seq, cooldown_remaining_s
},
decoys: [{id,kind,pos:[x,y,z],velocity:[vx,vy,vz],age,ttl}]
```

时间使用秒。`release_seq` 是本机生命内已接受投放的递增事件计数，不是发送控制消息的序列。诱饵身份由 `battle/unit/life/id` 组合；不会被伪装成飞机目标。原生发送错误或丢包时，客户端不扣库存、不创建权威诱饵、不先播放投放声音。下一份已接受快照将库存投影到原 `air.cm`，并仅对新确认的库存减少请求声音。首次接管与重接管不补播过去投放；多个丢失快照中的事件会合并为观察到的一次音组，不重构未知事件。

混合投放只请求一次原生命令；实际投放哪些种类由服务器现有库存决定。周期与程序切换仍是输入意图；每次周期投放经过同一路径。服务器通过已有控制身份与生命校验后，每种最多消耗实际可用的两枚。库存仅在原生认可的整备完成时补充。

## 图形与生命周期

`handoff/tools/frontline_countermeasures.js` 含两个纯客户端所有者：控制投影和可见快照图形。后者使用预分配的最多 192 个槽位，每枚诱饵一张面向相机的四边形，热焰写入现有 additive 缓冲，干扰丝写入现有 alpha 缓冲。不会创建新 GPU 资源、场景网格、Effects 粒子或本地 `airBots.flares/chaff`。图形最多外推 0.15 秒，0.35 秒未更新就清理，并遵循已接受 TTL。过时帧拒绝更新；缺失、生命更替、战局切换、机库、退出和销毁都会清理对应状态。

单机 `cmRelease` 原库存、成对投放与声音路径保留。原生 `cmRelease` 在任何本地改变之前转入意图。单机 `decoysSeduce` 的 `tested` 标记移到目标角度及真实 `missileSees` 的视场、距离、视线通过之后；同一导弹与诱饵首次符合条件时只抽取一次概率，不在每帧重试。

## 集成所有权与验证

根集成者在最后一次 frontline helpers 与 airframe limits 合成后调用 `patchFrontlineCountermeasures`，再冻结 app 与重新导出型号资料。补丁 CLI 必须输出到不存在的新候选路径；拒绝原地或 canonical app 输出。canonical app、Rust 文件、Cargo 工作区和最终打包均不由本子任务修改。

当前旧 `sync_frontline_client.py` / `composeFrontlineGuidedCandidate` 尚未自动维护新增钩子；在最终合成后应用本补丁。若后续刷新旧 native 区块移除了钩子，补丁会明确拒绝声称安装完成，需由根集成者重新组成正确源；正常再次应用是逐字节幂等。

CPU 测试执行实际 `cmRelease`、`decoysSeduce`、established native runtime、receive-frame 过滤分支、Effects.build 和真实整套型号导出，并检查意图前不扣库存、确认去重、共用序列、生命周期、边界与原单机行为。浏览器图形观感、真实键鼠投放、原生导引头反制率与完整服务端对局仍需对应独立证据，不能由这些测试替代。
