# 当前挂点模块与后端初始布局

本模块与 ../mount-v3 共同提供当前 mounted-details-v4 版本。全26机型、67个旧预设的武器ID、顺序、数量及原性能定义保留；本轮还修复NF01/F4U的旧外挂穿翼问题，其余未涉及的非喷气布局保持一致。

F16/F104翼尖使用外侧接合与±90度storeRotation；F15保留原双联导轨规则；MiG21开放4个实际机翼挂点。source owner遵循原模型分组，Su27发动机舱下归属body。模型来源、source socket和明确标注的游戏拟合适配件共同决定安装位置。

## 后端接入

native-layout-map.json 当前覆盖17个模型、55个已有预设、379个初始外挂对象。native-layout-adapter.mjs只用于初始生成/换装阶段，匹配完整序列、数量、来源、旧归属与位置，兼容原始布局或上一包校准位置。返回p/owner/storeRotation/fittedMountKey，保留其它玩法状态，未知/歧义输入拒绝套用。

```js
const result = applySpawnLayout({
  aircraft, sourceMain,
  geometryFingerprint, // NF01/F4U必须匹配map的proceduralGeometry；其它机型可省略
  items: initialStores, phase: 'spawn_layout'
}, layoutMap);
if (result.applied) initialStores = result.items;
```

NF01/F4U的几何守卫按三角数量与1e-4m量化位置计算指纹；算法、量化和三组签名见拟合表。Native已接受的p/count/id/owner仍有权威，浏览器不改写host.p。两处Native展示语句已精确接入storeRotation，其余带标签块逐字保留，变更清单见verification/mount-v4/model-upgrade-merge-report.json。

新自定义组合按当前catalog-capabilities.json、helper.mjs和源socket计算；不能单凭预设索引授权。新R3R雷达/照射功能及SAMP等定义须同步本地后端。此包未修改用户正在开发的本地空战后端。

## 文件与验证

- measured-mounts.mjs、helper.mjs：当前来源绑定和旋转；patch.py：底版接线。
- ../mount-v3/catalog-capabilities.json：当前菜单、设备和新增定义。
- ../mount-v3/mount-collision-map.json：17机型、107个潜在适配件；与实际渲染三角形一致，按每架飞机当前fittedMountKey启用。
- catalog-capacity-manifest.json、catalog-audit-after.md：早期V2审计资料，标为历史；不作为当前菜单或容量依据。

当前验证见包根verification/mount-v4：26机型172状态、121套非空实装的近LOD0三角形检查，全部0标记。实际测试使用生产Aircraft/Renderer的固定姿态，覆盖各菜单型号站位及选定混装；并未穷举所有组合。

运行前按source/TESTING.txt准备本地原网页与升级网页的资源fixture。node perf/hardpoints/test.mjs 验证26/67原预设完整性；node perf/hardpoints/native-layout-adapter.test.mjs验证55个初始布局、幂等、旋转、来源/几何拒绝与玩法状态保留。
