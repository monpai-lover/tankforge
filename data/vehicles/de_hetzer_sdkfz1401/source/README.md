# Hetzer · Sd.Kfz.140/1 炮塔移植模型

源文件：`Hetzer_Sdkfz1401_Turret.glb`，42,647,628 bytes。

SHA-256：`e2bca986bb858916221338dfdeb91c9b2051321783102a507fc9b3b1d7be1005`。

从用户提供的最新版 `Hetzer_Sdkfz1401_Turret_Viewer.html` 下载数据区提取，校验与查看器声明一致；未执行其中的脚本。GLB 字节保留不变，重建命令：

```text
python tools/build_hetzer_sdkfz1401.py
```

工具需要 NumPy、Pillow。仅输出此变体，不重生成其他车辆。转换时去除炮组已烘焙的 25° 展示姿态；固定车体与炮塔不作该旋转。抛壳布袋、MG 42 落壳箱附件与炮塔固定的瞄具／弹匣支架保留在炮塔固定层，避免把柔性接收袋作为刚性俯仰炮组。

游戏中的 `de_hetzer_sdkfz1401` 是用户自定义／假想改装，不是历史量产车型。底盘质量与防护沿用项目 Hetzer 的估计值；移植后的重量、内装和机动没有历史实测。

GLB 内的 `asset.extras` 保留完整来源与修改说明，其中记录：

- 底盘：KojfDiscord，Jagdpanzer 38(t) Hetzer (War Thunder)，CC BY 4.0 标签；https://sketchfab.com/3d-models/jagdpanzer-38t-hetzer-war-thunder-078a0cf60058413fb1ff40eca7c77242 。该标签是文件记录，不能单独证明所有基础素材权利均已核实。
- 炮塔：MMD_SonicNewYear，Sd.Kfz. 140/1，CC BY 4.0 标签；https://sketchfab.com/3d-models/sdkfz-1401-f71069d81c444f4cbc9d3e84630f9ead 。
- 用户修订：炮塔移植、整片首上封板、安装适配座、内装细节、材质修订与标记；具体说明和参考资料保留在源 GLB 中。

CC BY 4.0 文本：https://creativecommons.org/licenses/by/4.0/ 。本目录没有给上游来源或整个 TankForge 项目重新授权。
