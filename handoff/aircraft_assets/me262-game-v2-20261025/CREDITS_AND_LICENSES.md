# 署名、素材来源与许可

## 原始飞机

- 上传文件：`helijahs_me_262.glb`
- 上传文件内的作品标题：**Helijah's Me 262**
- 上传文件内的作者署名：**Secret Weapons - Arma 3 Mod**
- 作者主页：https://sketchfab.com/sabrezor
- 原作品链接：https://sketchfab.com/3d-models/helijahs-me-262-9af086bc21a64400ade304876218ca62
- 上传 GLB 元数据声明的许可：**Creative Commons Attribution 4.0 International (CC BY 4.0)**，https://creativecommons.org/licenses/by/4.0/
- 本次更改：按部件减少重复细分、校正整体 X / Y 比例、重新组织分组、外部涂装重绘、玻璃材质调整、追加内构、武器与驾驶员。原座舱内饰及仪表图片保留。

保留“Helijah”在原作品标题中的归属；本文件没有将原机体作者改为本次重制者。

## 原始人物身体、脸部及其纹理

- 上传文件：`ussr_pilot_late_war_thunder.glb`
- 作者：**KojfDiscord**
- 原作品链接：https://sketchfab.com/3d-models/ussr-pilot-late-war-thunder-9acefd3e5f854e69a0ed6fb7bbfce9dc
- 上传 GLB 元数据声明的许可：**CC BY 4.0**，https://creativecommons.org/licenses/by/4.0/
- 本次更改：减面、静态关节 / 身体姿势调整、手脚与座舱适配、替换现代硬壳头盔外观、增制软质飞行帽、护目镜、面罩、软管及救生衣附件。身体和脸部仍衍生自上述素材，并非从零创建。

## 本次原创添加及重制

本次重制在 ChatGPT 协作中制作：新增的静态武器外形、木架、内构示意网格、飞行装备配件、材质与照片参考重绘底色，随本资产以 **CC BY 4.0** 方式提供。使用或再分发衍生模型时，请保留原飞机、原人物以及本次重制的署名与更改说明。不要把本次重制标注为馆方制作或认可的精确复原。

历史文献和参考照片用于观察外形、色块和空间关系，没有把参考手册或博物馆场景制成模型的一部分。

## 随附实拍照片

`references/` 中四张照片均为 Smithsonian National Air and Space Museum 提供的 **CC0 1.0** 图片；摄影者 Mark Avino / Eric Long、馆藏编号、官方图片页与下载来源逐项列于 `references/photo_sources.md` 和 `references/photo_sources.json`。

- CC0 说明：https://creativecommons.org/publicdomain/zero/1.0/
- Smithsonian Open Access：https://www.si.edu/openaccess

照片不属于本次生成图；它们保持下载后的原始内容。Deutsches Museum 的工作参考照片、第三方托管的整本手册和论文扫描件没有随包再分发。

## 查看器软件与字体

- Three.js 及其附属加载器：**MIT License**。完整署名和许可见 `source/viewer/THIRD_PARTY_NOTICES.txt`；同一许可文字也嵌入 HTML。
- Noto Sans CJK 中文字体子集：**SIL Open Font License 1.1**。完整许可见 `source/viewer/OFL-Noto.txt`；字体仅作字符子集化，许可随包保留。
- 本次查看器整合代码与流程脚本：**MIT License**，见下方。上述三维模型、纹理和照片继续遵守各自对应的许可，不能仅因包含在代码目录或 ZIP 内就将它们改为 MIT。

## 本次流程与查看器整合代码的 MIT 许可

Copyright (c) 2026 Me 262 remake contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the “Software”), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


---

## 本轮游戏资源包补充署名与范围（2026-10-25）

以上原始署名与许可正文原样保留，记录此前资产的来源和更改。上文的 `references/`、`source/viewer/` 路径属于此前源包结构；本次可导入游戏包没有再次附带这些参考照片、研究扫描件或 Blender 工程。当前随包第三方许可置于本 `LICENSES/` 目录。

本轮更改由用户与 ChatGPT 协作完成，归于 **Me 262 remake contributors**：

- 拆分副翼、升降舵、方向舵、内外襟翼、分段缝翼及座舱盖，制作可独立采样的动画。
- 制作主起落架、前起落架、舱门与简化可见连杆的分部收放，补充途中反向控制和轮胎自转接口。
- 制作 Revi 16B 族瞄具外形、准直反射准星的 WebGL2 实现及 Three.js 适配；A2a 的16D采用族外形近似，范围见历史说明。
- 制作 A2a 的两座 Wikingerschiff 挂架、两枚SC250，以及 U4 的50毫米炮外形、制退器与机鼻整流罩；按配置移除机炮、弹箱和发射接口，封补原炮口。
- 组织四个完整GLB配置、运行时接口、离线查看器及使用文档，保留原飞机、人物和纹理的来源归属。

本轮新增三维外观、材质及重制部分沿用 **CC BY 4.0** 提供；新增运行时代码、查看器整合和流程代码采用 **MIT License**，见 `MIT-runtime-and-integration.txt`。这不改变原素材各自的许可，也不将博物馆或文献来源的版权转授给使用者。

历史照片与手册用于外形观察和资料核对，没有把博物馆场景或整本扫描件作为本次资源包内容再分发。原型、涂装和机构近似范围见包根目录 `HISTORICAL_NOTES.md`。

### 本轮查看器与字体

- 查看器内嵌 Three.js **0.186.1** 及对应加载器；完整上游MIT许可见 `THREE-LICENSE.txt`。
- 使用Noto Sans CJK字体子集；SIL Open Font License 1.1见 `OFL-Noto.txt`。
- `me262_preview.html` 中的模型与贴图继续遵守各自三维资产许可，不因嵌入HTML而变为MIT软件素材。
