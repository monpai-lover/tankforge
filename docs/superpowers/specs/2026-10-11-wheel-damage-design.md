# 逐輪爆胎、輪緣與輪轂損傷設計

2026-10-11。使用者要求履帶斷裂、輪胎爆胎和輪子損坏。履帶斷鏈仍按已採用B完整執行；本設計增加每個實體輪盤／輪胎的獨立狀態，不將一輪受損改寫成整側斷帶。具體資料、量測和驗收矩陣見 `docs/wheel-damage-research-2026-10-11.md`，為本設計契約。

## 狀態與來源

輪式車有充氣胎 Tire 與 WheelHub；履帶車有實心橡膠輪緣 RoadWheelRubber 與 WheelHub，全鋼輪不虛構胎壓。首版採保留破壞輪轂／殘片的 attached destroyed assembly，有真實位置的有限支撐與拖曳，不宣稱輪子已物理脫落。實際脫輪需要接頭、質量／慣量／動量拆帳和獨立碰撞，不能用隱藏模型＋掉落特效冒充。

可信 descriptor 保存原 side／axle或road source index、station、部件角色、原幾何／慣量與profile hash。每個實體盘有穩定ID；Tiger／Panther雙盤和HVSS同站兩盤不同ID、共用q不刪除。只換炮塔／兼容同底盤按ID保存機械模式、連續相位和修復預算；源幾何不同明確重置。原GLB和车辆／引擎／武器／装甲／visual/modules檔字节保持；新增衍生元数据。

Rust／WASM／server共同注册derived逐轮模块；原轮式 `wheels_l/r` 变legacy side摘要／别名，不再参与窄相位或重复repair work。其他现有Track在履带车仍表示真实带。新的模块种类、schema、外部属性与稳定绑定同步。health、当前机械mode、repair permission和generation分别保存，Caps不逐帧复写mode。

## 命中、物理和显示

最终hit使用X的实际显示part三角形及accepted pose／damage revision。程序healthy材质／网格须与来源完全相同；衍生胎／钢盘／hub roles来自原生成primitive，imported BMP胎／胎纹角色使用hash-pinned人工核验sidecar，不能按metal值猜。原共享缓存不变形；每实例／damage variant有明确资源所有权。轮间空隙／导齿槽不命中轮模块，blast／contains／fragment用同几何，alias无重复扣伤。

每轮active profile控制support／rolling radius、contact width、摩擦、滚阻和drive连接；原engine/gearbox参数保持。flat仍可由塌胎或rim承载，减小支持高度让原spring/body自然下沉和载荷重分配，不直接移动车体或复制失去轮的载荷。hub destroyed只由实际survivor接地承载／耗能拖曳，失去正常驱动牵引。原branch扭矩份额不白送其它轮，断开支路损失记为耗散；不增加未经拆账的质量或spin惯量。

橡胶胎变形在spin后沿实际接地方向执行；钢轮毂保持尺寸，flat patch不随车轮旋转成椭圆跳动。渲染顶点／normal／bounds和hitmesh使用同一有限变形／variant。保留body/q/omega/spin连续，失去的能量有限耗散。改变rolling radius用travel/theta锚点增量，不用大累计travel除新r跳角。程序和imported分开认证：有限地面proxy有明确边界，shot collider始终显示网格。

履带盘active survivor接入B的有限wheel parts、张紧路线、裸轮和共同法向／摩擦bundle，cache带variant revision。失去一片盘不能把共站另一片关掉，也不能让原完整盘继续提供幽灵N。N/pitch/鞋网格不改；无机械载荷鞋无牵引。极端不可行遵循B有限guard/可行缓存与车腹支撑，不伸鞋或扩大idler凑结果。

## 修復與網路

F三秒只开始原修复流程，原工作量／60%健康规则保留。完成health恢复先授予该轮许可；实际flat／毁hub几何继续有效，不能瞬间插回完整轮。B共同有界支承杯／梁建立真实净空，原残片还在bundle，支承力不算牵引／地形压痕。轮式若拆出unsprung质量才能沿用q杯，必须从原总成质量扣除。

Owner提供带accepted motion、epoch/revision/generation的wheelRestoreReady；server独立净空／来源／许可检验后原子消费、增加revision。修轮不偷偷闭合断链，B closeReady独立。新轮伤、死亡、J或修复乘员不足撤销对应许可，预算跨取消／换头／重连不能重置。ACK时本地净空不足保留有限pending并诊断，不吸附／瞬移。

权威关键帧传逐轮机械mode和有限pose，包括wheeled逐轮L/omega/连续spin/steer，不能只用side平均速度；remote按同epoch/revision/mode插值，短外推后冻结，不自跑泄气／jack。坏optional提示保留合法旧motion；新精确模式不得假称缺姿态的legacy回退为精确。每entity轮pose≤8KiB、count≤64，计入B的rg≤32KiB／入站≤64KiB总预算；禁止任意mesh上传。

玩家、静态敌车／靶车、remote、wreck、工坊和R回放都有同mode。静态本地损坏车运行单次固定物理步使其真实下沉；remote不再强制复原健康轮。Xray/status按轮ID定位胎／轮缘／hub，命中快照保存variant，质量设置不改变物理结果。

## 完成边界

B最终contact gate和X最终几何／姿态gate是物理／线上精确命中认证依赖。当前无Rust wheeled dynamics镜像；本功能必须共享damage/geometry/repair到native/WASM，JS接入实际wheeled动力。若未新增完整native wheel solver及lockstep，不声称wheeled dynamics有native parity。健康8车性能保持，35 tracked单／双盘及broken bare模式全覆盖。

执行研究验收矩阵，实际Puma175mm gap/KPVT假伤与remote健康复原作RED。完整模型／资源／修复／authority和B/P/X回归、新SPEC/QUALITY与最终构建全部通过才宣布完成。CPU不是浏览器视觉验收。
