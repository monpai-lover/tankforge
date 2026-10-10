# 測距設備分類與操作設計

日期：2026-10-11。延續使用者已授權的修復：激光立即測距、合像加速，保留短 F 測距與長 F 三秒修復。研究依據見 `docs/rangefinder-equipment-research-2026-10-11.md`。

## 行為

設備分為 `manual`、`coincidence`、`stereoscopic`、`laser`。普通瞄準鏡沒有測距設備資料時，維持乘員估距；不能按年代、倍率、熱像、雷達或激光制導猜測種類。現有明確條目只有 `de_panther_f` 的 `TZF 13 + EM 1.32 m R`，使用立體光學且標示計畫裝備／遊戲重建。

乘員估距保留原數值。兩種光學設備等待 `min(legacy time_s, 1.0)` 秒，為有限正值；此速度是遊戲近似。激光在短 F 釋放產生 range 動作時直接呼叫同一完成函數，不建立零時長進度，也不在 keydown 提前完成。误差、量程、固定亂數、五米取整和自動裝表保持原規則。

所有量距動作仍要求活車、battle 模式、非工坊／暫停狀態。長 F 只修復，放開不補一次測距。測距途中切換炮塔／武器、車輛、模式或失去有效控制時取消；不能用新設備完成舊設備的計時。獨立機槍使用乘員估距，明確同軸且共享主瞄具的機槍才繼承其設備。

## 資料與工坊

選完整相容格式擴充，而非另外建立未接通的 sidecar：Rust `RangefinderDef` 增加 optional `kind`，enum 只接受上述四值。缺省仍可讀取舊檔；serde serialization 對 None 省略欄位。`schemas/weapons.schema.json` 同步 enum，缺省說明改成乘員估距。保持原 `time_s > 0` 資料要求；瞬測由種類控制，不靠 time_s=0。

集中設備 resolver 驗證種類與數值；顯式合法 kind 優先，其次精確来源車 ID＋瞄具名稱 registry，最後 manual。非法 kind 不能變成激光。無效計時／誤差／量程採受驗證預設或拒絕工坊輸入；不得產生 NaN、Infinity 或无限等待。registry 有来源說明，不在原庫存 JSON 補写欄位。

工坊每座新炮塔增加「測距設備」：繼承瞄具、乘員估距、合像、立體、激光。缺省繼承实际 sight donor，換底盤／火炮不改变设备。显式override属于遊戲改裝。正規化、儲存、設定匯入／匯出、完整 bundle／資料夾导出再载入都保留选择；生成 weapons 的 rangefinder.kind 通过新的 Rust/schema，来源对象不变。保留原武器／keepStock 的塔依其来源设备，新增塔采用本塔设置；旧设置和预设兼容。

## 驗證

测试实际短 F 动作＋main start/finish 路径，激光在同一释放调用结束并恰好完成一次；光学有限加速、manual基准耗时。真实LOS、固定seed、失败、autoZero、声音与量程结果共用原实现。测试切换时取消、独立／同轴机枪、全42车分类、不把Kornet/Gepard推定激光、工坊所有donor和导出往返；Rust读取老档、合法新enum、拒绝非法enum，校验生成导出档。构建检查与CPU测试不等于浏览器视觉验收。

原始车辆／武器／模型／装甲／发动机数据不改。只增加设备契约和工坊行为，不扩写不存在的历史硬件。
