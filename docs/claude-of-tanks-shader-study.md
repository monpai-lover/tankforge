# TankForge 对照研究：Claude of Tanks 的着色器

研究日期：2026-10-09。

TankForge 基线：[`8f547c5e`](https://github.com/monpai-lover/tankforge/tree/8f547c5e0dab73639801ab3079baf67eec132e08)。Claude of Tanks 参考版本：[`6072b0de`](https://github.com/Kevin-Liu-01/Claude-of-Tanks/tree/6072b0de12b94a1090686c8cd79746326c8030ab)。本文只研究参考仓库的 MIT 默认覆盖范围，不包含其专有车辆、世界代码、贴图和美术标定数据。

## 1. 结论：保留自有 WebGL2 架构，迁移算法而非框架

TankForge 已经有自写 WebGL2 渲染器，不是 Three.js 项目。它具有 GGX 材质、线性 HDR、大气单次散射、体积云、云影、光束、Bloom、高度雾、软粒子及动态分辨率。升级不必从零重建，也不需要为了参考 Claude of Tanks 而换引擎。

当前最值得借鉴的部分依次为：阴影采样稳定性与覆盖范围、降分辨率后的空间重建、直接光与间接光分开处理、针对车辆的接触及腔体遮蔽，以及重型天空和粒子计算的分摊方式。

本文是代码学习与适配建议，没有修改实际着色器，没有进行渲染效果或 GPU 性能实测。功能存在与功能默认开启分别核对，历史注释不能替代当前控制逻辑。

## 2. 两套渲染流程与已有能力

### TankForge 当前流程

```text
初始化生成 3D 噪声
  → 分块更新天空穹顶：大气 + 云
  → 单张太阳阴影图
  → 前向材质：太阳 × 物体阴影 × 云影 + 半球光 + 天空反射
  → 可选 MSAA 场景解析，取得颜色与深度
  → 独立软粒子层
  → 半尺寸光束、四分之一尺寸 Bloom
  → 高度雾 + 散射 + 粒子合成 + 曝光 + ACES + 色彩
  → 可选像素风格
```

来源：[renderer.js](../client/web/src/gfx/renderer.js)、[shaders.js](../client/web/src/gfx/shaders.js)、[atmosphere.js](../client/web/src/gfx/atmosphere.js)。

### Claude of Tanks 参考流程

```text
大气 LUT 与环境照明
  → 多级太阳阴影，按级调度更新
  → HDR 场景与可选 MSAA
  → 空气透视、接触阴影、车辆腔体遮蔽、高亮闪烁抑制
  → 可选 GTAO（当前预设关闭）
  → 晚期透明战斗特效
  → Bloom
  → ACES + 输出色彩转换 + 分级
  → SMAA
  → FSR1 EASU + RCAS
```

来源：[post.ts](https://github.com/Kevin-Liu-01/Claude-of-Tanks/blob/6072b0de12b94a1090686c8cd79746326c8030ab/src/engine/post.ts)、[quality.ts](https://github.com/Kevin-Liu-01/Claude-of-Tanks/blob/6072b0de12b94a1090686c8cd79746326c8030ab/src/engine/quality.ts)。TAA 代码存在，但桌面预设默认关闭；High 不开启场景 MSAA，Ultra 为 4×。体积云文件头保留旧的 opt-in 描述，实际 `sky.ts` 控制逻辑在支持的路径上默认允许，`clouds=off` 或 `baked` 禁用。

### 逐项对照

| 项目 | TankForge 已有 | Claude of Tanks 可学习点 |
| --- | --- | --- |
| 材质 | GGX、Schlick Fresnel、金属度／粗糙度、导数凹凸与导数切线法线贴图 | 控制微小高亮、区分太阳和环境光的遮蔽 |
| 太阳阴影 | 2048 单图、3×3 PCF、跟随 focus | 级联覆盖、光空间 texel 对齐、各级 bias 与更新调度 |
| 大气 | 12 个视线采样，每步 4 个光照采样；天空分块缓存 | 透射率、多次散射与天空视图 LUT，参数变化才重建 |
| 云 | 3D 噪声、光线步进、云影、16 块穹顶更新 | 屏幕稀疏采样、历史重投影、邻域限制与空空间跳步 |
| 烟火 | CPU 粒子、软深度交界、噪声侵蚀、烟的近似受光 | 固定实例池、出生时上传、共用 shader 时钟 |
| 后处理 | Bloom、ACES、高度雾、光束、线性采样放大 | SMAA、FSR1、邻域高亮限制与定向色彩处理 |
| 降级 | 渲染比例 0.7–1，快速降、缓慢升，反弹后延长等待 | 进一步区分分辨率压力、重型效果压力及硬件上限 |

源码已经在 `game/fx.js` 和 `gfx/renderscale.js` 注释中注明参考 Claude of Tanks；[SOURCES.md](../SOURCES.md) 也记录了这部分学习。软粒子和动态分辨率属于继续完善的基础，不应重新列为尚未实现的功能。

## 3. 阴影：先稳定，再扩展覆盖

### 当前观察

TankForge 使用 `SHADOW_EXTENT = 24`，正交投影在光空间 x、y 各覆盖 `[-24, 24]`，即每轴约 48 m。超过阴影图投影范围的片元直接返回可见太阳。对于公里级地图，近车可得到高 texel 密度，但远处物体不在同一张物体阴影图的覆盖内；云影是另一项独立计算。

`lightVP` 每帧直接跟随 focus，未在此路径看到光空间 texel snapping。PCF 使用固定深度偏置 `0.0022`，阴影绘制另加 `polygonOffset(2, 4)`。这些是当前实现观察，尚未通过实际画面确认抖动或悬浮程度。

### 参考算法与适配

Claude of Tanks 将太阳阴影按视距分成多个 cascade，为不同覆盖范围分配贴图尺寸；[shadowStability.ts](https://github.com/Kevin-Liu-01/Claude-of-Tanks/blob/6072b0de12b94a1090686c8cd79746326c8030ab/src/engine/shadowStability.ts) 对光空间坐标做 texel 对齐，并按物理 texel 尺寸调整法线偏置。

```text
worldUnitsPerTexel = cascadeSpan / shadowResolution
snappedCoordinate = floor(lightSpaceCoordinate / worldUnitsPerTexel)
                    × worldUnitsPerTexel
```

建议先对现有单图实现光空间中心对齐，再试两级或三级 CSM，而不是直接扩大单图或照搬四张高分辨率贴图。级联切换需要混合，最远级可以降低更新频率；每次必须同时更新该级的投影矩阵和深度图，不能移动投影却采样上一姿态的旧图。

TankForge 的太阳方向、矩阵及米制坐标应由自身接口提供。不要直接复制参考项目的 bias 数值、远平面或曝光，它们对应不同的投影、模型比例与光照标定。

## 4. 直接光和间接光分开处理

### 4.1 接触阴影

参考 [contactShadows.ts](https://github.com/Kevin-Liu-01/Claude-of-Tanks/blob/6072b0de12b94a1090686c8cd79746326c8030ab/src/engine/contactShadows.ts) 在空气透视 pass 中，沿太阳方向对场景深度做短距离搜索，补足履带、轮子和墙脚与地面的细缝。当前为 12 个采样，靠近接触点更密，远距离淡出。

关键不只是 ray march，而是只扣除太阳直射部分，避免把已经在阴影中的环境光再压黑：

```text
sunShare = directSun / (directSun + ambient)
result ≈ sceneColor × (1 − occlusion × sunShare)
```

这是说明性表达；参考项目实际使用可见度及估计的光照份额，并非拥有完整延迟渲染 G-buffer。

TankForge 已有解析深度和视线重建，可以在新增屏幕阶段或 composite 中实验。但还需太阳可见度和材质分类，否则会误伤透明水面、树叶和未受光对象。不能在当前场景绘制时直接读取同一 framebuffer 的深度附件，这会产生反馈风险。

### 4.2 车辆腔体遮蔽

参考 [vehicleOcclusion.ts](https://github.com/Kevin-Liu-01/Claude-of-Tanks/blob/6072b0de12b94a1090686c8cd79746326c8030ab/src/engine/vehicleOcclusion.ts) 只对车辆像素搜索周围深度高程；固定 8 个方向、每方向 4 步，世界半径 0.8 m，120 m 之外淡出。目的是让炮塔环、裙板后方和轮舱有层次，同时避开场景级 GTAO 对草地、树叶的颗粒污染。

```text
result ≈ sceneColor × [1 − cavity × strength × (1 − sunShare)]
```

它主要压低环境光份额，与接触阴影主要压低太阳份额互补。TankForge 的 `litFS` 已分别计算 `direct`、`amb`、`env`，便于从概念上保持这一区分。

### 4.3 场景 alpha 元数据不能直接照搬

参考项目在浮点 HDR 的 alpha 中存储 `2 + sunVisibility`，车辆再增加分类标记，供后处理识别。TankForge 当前 alpha 还表示透明度，而且会回退至 RGBA8；大于 1 的编码在归一化 RGBA8 中会被截断。因此应设计单独、格式明确的 mask／光照 metadata attachment，或使用适合自身的打包方式，并核对 WebGL2 MRT 与 MSAA resolve 路径。

### 4.4 地面反弹光

参考 [groundBounce.ts](https://github.com/Kevin-Liu-01/Claude-of-Tanks/blob/6072b0de12b94a1090686c8cd79746326c8030ab/src/engine/groundBounce.ts) 用解析式估计朝下表面看到的地面反射，不是完整 GI：

```text
lowerHemisphereView = clamp((1 − normal.y) / 2, 0, 1)
bounce = max(estimatedSunlitGround − existingGroundFill, 0)
         × lowerHemisphereView
```

实际还按太阳高度、面朝向和阴影可见度修正。TankForge 已有 `uGroundColor` 与半球光，适配时应只补缺失的部分，避免把地面环境光加两次。若暗面已经过亮，应先调整现有填充光，而不是无条件加 bounce。

## 5. 降分辨率后的清晰度与高亮稳定性

### 5.1 FSR1 和抗锯齿

TankForge 的动态分辨率最后通过 composite 的普通纹理采样放大。可学习参考 `post.ts` 的 EASU 边缘自适应空间重建与 RCAS 对比度自适应锐化，让 0.7–0.9 比例的画面少一些放大后的模糊。

实施前应明确渲染尺寸和原生 canvas 尺寸，将 scene/composite 先输出至中间图，再在明确的输出色彩空间做抗锯齿和重建。保留像素风格模式独立路径，HUD 也应保持原生显示。

FSR1 不使用运动向量，没有影格生成，不等于 FSR2／FSR3，也不能消除所有时间闪烁。SMAA、MSAA 与 FSR1 各解决不同问题，不能用“更锐”替代“抗锯齿”。参考项目已经试过 TAA 并因细节损失将其默认关闭，不能只因代码中存在就推荐默认启用。

### 5.2 Firefly 与 Bloom

参考后处理在 Bloom 前检测孤立 HDR 高亮，与邻近亮度比较后限制异常峰值；粒子还按卡片做 soft-knee。TankForge 已有粒子亮度压缩及 Bloom 输入上限，下一步可以对“细小金属高光引发整片 Bloom 闪动”做邻域实验。

重点是保留合理的炮口及太阳高亮，不把所有发光压成普通颜色。测试应比较行驶中的玻璃、远处金属边缘、树叶和夜间炮口；静态截图无法证明时间稳定性。

### 5.3 HDR 回退与合成约定

TankForge 支持 RGBA16F，也在不支持浮点颜色目标时用 RGBA8 的 `ENC`／`DEC` 压缩。增加 pass 必须保持“哪个 buffer 是线性颜色、哪个已经编码、哪个存储预乘 alpha”的契约，不能简单复制参考项目默认浮点 HDR 的片元输出。

例如透明混合在何种空间执行，以及雾和 Bloom 是否正确解码，应作为回退设备测试项。这里是适配时需验证的风险，不是本次已复现的错误。

## 6. 天空与粒子：已有基础，优化计算分摊

### 6.1 大气 LUT

TankForge 单次散射算法已经按论文实现，不需要用“新增大气”作为升级目标。参考 [atmosphere.ts](https://github.com/Kevin-Liu-01/Claude-of-Tanks/blob/6072b0de12b94a1090686c8cd79746326c8030ab/src/engine/atmosphere.ts) 将透射率缓存为 256×64、多次散射为 32×32、天空视图为 200×100，只在相关参数变化时重建。

可把天空辐射计算从云采样循环中分开，减少重复积分，并统一环境填充、地平线颜色和空中雾化使用的天空来源。是否值得替换，需以现有穹顶分块更新的实际 GPU 成本决定；它本来就有缓存，并非每帧全屏重新积分。

### 6.2 体积云历史重建

TankForge 用 4×4 大块穹顶更新，一次完整扫过为 16 帧，并将新旧穹顶渐变。参考 [volumetricClouds.ts](https://github.com/Kevin-Liu-01/Claude-of-Tanks/blob/6072b0de12b94a1090686c8cd79746326c8030ab/src/engine/volumetricClouds.ts) 则在半分辨率历史中交错采样，使用 4×4 Bayer 顺序、历史重投影和邻域限制，并跳过空云区。

两者都有时间分摊，但缓存坐标不同。不能把参考屏幕空间重投影矩阵原封不动接到 TankForge 的穹顶方向纹理。优先学习空空间跳步与相机切换时的历史失效策略，再评估是否改为屏幕交错重建。近地移动、快速转向及改变视野角应单独测试。

### 6.3 固定 GPU 粒子池

TankForge 当前在 CPU 中更新粒子对象，使用 `push`、`shift`、`splice` 管理寿命，再生成 billboard 顶点。参考 [particles.ts](https://github.com/Kevin-Liu-01/Claude-of-Tanks/blob/6072b0de12b94a1090686c8cd79746326c8030ab/src/fx/particles.ts) 采用固定实例池，在发射时上传初始参数，用共用时间计算位置、大小、旋转与图集进度。

对应 WebGL2 可使用 instanced attributes 与 `drawArraysInstanced`，先迁移普通烟尘，再迁移火焰和火花。需要 CPU 碰撞的碎块可保留单独路径。shader 解析运动不是完整物理碰撞或流体模拟；实例化降低 CPU／上传成本，但不解决大量透明粒子覆盖同一像素的 fill-rate 成本。

## 7. 建议顺序与验收

以下是研究后的建议，没有实施这些改变。

| 顺序 | 改动方向 | 要验证的结果 |
| --- | --- | --- |
| 1 | 现有阴影 texel 对齐与 bias 检查 | 固定镜头与慢速行驶中阴影稳定，斜面不增加 acne，履带不悬浮 |
| 2 | 先两级或三级 CSM，明确近中远预算 | 远处车辆和建筑得到阴影，级联边界无突变，最差帧成本受控 |
| 3 | 降分辨率重建与选择性高亮抑制 | 比较 1.0、0.9、0.7 比例下轮廓、树叶、炮口；避免锐化光晕 |
| 4 | 元数据格式与车辆局部遮蔽 | 只影响车辆及正确光照份额，透明物体不误判，HDR 回退可用 |
| 5 | 大气 LUT 与云空空间跳步 | 相同天空条件减少 GPU 开销，转镜头和变时段不残留历史 |
| 6 | 烟尘的 GPU 实例池 | 齐射时降低 CPU 分配与顶点上传，暂停／重播和跨局清理正确 |

每次改动都应保留开关，固定车辆、地图、镜头、时间与随机种子进行 A/B，再观察移动序列。记录 CPU/GPU 时间、p95／p99 影格时间、目标分辨率及绘制预算；GPU 查询需处理 disjoint，软件渲染结果不能冒充玩家硬件性能。

初次导入时的基线为网页 `npm test` 57 项通过；当时尚未安装 Rust，也未执行浏览器图形测试。后续车辆修复已安装隔离的 Rust 工具链，并执行后端与真实 WebGL 回归，结果见 [本轮修复验收](vehicle-fixes-2026-10-09.md)。这些检查不代表已经实施或验证本节建议的全部着色器改动。画面、特效、后端与本节的完整合并版见 [综合研究](claude-of-tanks-research.md)。

## 8. 授权与来源边界

参考项目采用 MIT 默认授权及明确专有内容例外，见 [LICENSE-POLICY.md](https://github.com/Kevin-Liu-01/Claude-of-Tanks/blob/6072b0de12b94a1090686c8cd79746326c8030ab/LICENSE-POLICY.md)。学习范围为引擎、后处理及特效算法；不要取用其 `src/vehicles/**`、`src/world/**` 或 `public/fx/**` 等内容。

本文没有复制完整 shader，也没有为 TankForge 添加新的项目授权。如果后续直接复制 MIT 实作，应保留完整版权和许可文字。FSR1 的内嵌代码另含 AMD MIT 声明，也必须保留；不能只用“灵感来源”注释替代直接复制代码所需的许可文本。

建议继续维护 [SOURCES.md](../SOURCES.md)，逐项记录后续是独立重写算法、直接使用授权代码，还是使用第三方资源，避免与上游专有内容混淆。
