# 精確表面查詢的保守剔除獨立複核

複核版本：`handoff/tools/surface_collision_readiness.js` SHA-256 `8750205af51d875774bbc25aefee17ee5793ae7469aceb793fd6e3d0c02cd102`。本複核未寫入實際 app 或核心。

已完整閱讀 helper、候選安裝器、`LocalSurfaceCombat`、Renderer 的靜態頂點上傳／實例更新及 Body 的座標轉換。快取只有在實際 exact trace／pose 已成功後才封存；頂點界取自註冊的 Float32 位置流。GPU buf／vao、renderer `_live`、節點成員、buffer 陣列及順序、shape／geometry revision、rows 任一不符都回到原 exact 查詢。每次查詢重新 `root.update()`，同 tick 的世界矩陣或實例變化也會更新界；不以車體半徑代替炮管等突出幾何。

第一次複核找到並可執行重現一項極端仿射消去問題：三角形全 x=8、X 縮放 1e16、平移 -8e16、正常正交機體原點 x=1 時，最終 world 界為 x=0，而核心座標組合的舍入會使 world x=1 的射線仍能相交。只以最終世界量級計算的 padding 會誤剔除。現版本納入 node×instance 與頂點變換的絕對乘加項、機體局部端點轉 Float32 的誤差量級；不可靠機體座標系直接回到 exact。這是數值誤差容差，不增加幾何碰撞半徑。

更新後獨立執行21項實際候選 Node 測試全部通過，包含突出炮管、有限弦及含邊界、同 tick 姿態、鏡像／非均勻縮放、實例、部分更新失敗後恢復、上傳及 renderer 失效、原位 membership 改變、上述消去反例、局部端點 Float32 及錯誤恢復。此外以固定種子 `0x120e5` 執行1,000組旋轉／鏡像／非均勻縮放及旋轉機體座標，共3,000個變換後三角形頂點，沒有一個被剔除；更新後的消去反例亦保留 exact 路徑。

此測試涵蓋 helper 與來源擁有者的行為；core fixture 使用明確的 trace stub，不能單獨代替真實 WASM 命中／裝甲測試。GPU 句柄未變時，不受支援的 CPU 頂點陣列原位變更不代表已上傳的新渲染幾何；真實重新上傳會更換句柄並失效快取。匯入節點的 key／origin 目前仍每次 `JSON.stringify`，有小量配置成本；整體只檢查節點／實例，不逐幀掃描頂點。實機效能及最終 app 雜湊仍由 ROOT 驗收。
