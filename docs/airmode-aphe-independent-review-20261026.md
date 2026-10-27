# 空戰接入與 APHE 獨立複核（2026-10-26）

本複核來自實際 source、Node 實例及 ROOT 執行的原生測試；不是 Linux 發布／線上瀏覽器驗收證明。

## 本輪已確認並修正的繞過路徑

1. 航空本地玩家、AI 與舊聯機預覽原本以「有裝藥」直接製造首次蒙皮爆炸。實際兩種 `AircraftDamage` 命中路徑現區分引信機制；實際呼叫傳入所選彈及來源時鐘；APHE 沒有校準厚度時保留動能貫穿，回報未解保。HE 的接觸爆炸保留。
2. 原生 `AirDamage::hit_projectile`／`hit_shell` 已接種類與原始裝藥，不拿傷害倍率充當毫米；HE 傷害原先正確但缺少爆點記錄。本輪增補實際 `t`／局部點、明確的首次接觸相對時鐘、原始質量及獨立 TNT 當量；`AirWorld::hit` 由該次 accepted pose 保存 `world_position`。兩個真實原生 `contact_record` 測試由 ROOT 跑過 RED→GREEN。
3. `SimWorld` 外層原本仍對任何正裝藥彈執行地面／飛機／設施／地形範圍爆炸，繞過 APHE 未解保。此路徑已由另一任務依實際接觸機制封住，實際 APHE burst 保留在 native report，並由當次目標姿態轉為 `detail.world_bursts`。原生驗證由 ROOT 統一執行。
4. `frontline_client.js` 原本對每個 impact 無條件播 `.05` 爆炸。本輪實際 `receive` 現只接受已記錄 burst、時鐘、位置及強度；實心／未解保／未記錄續程只播接觸火花。地面、航空、地形及設施使用同一入口。六個實際 receive 測試包含未解保 APHE、實心彈、延遲爆點、HE、缺少 accepted pose 及 worldburst 優先權。
5. 獨立視覺測試發現超速 flutter 對 `Node.local=null` 的單位矩陣假設錯誤，第二次 pose 會崩潰；已轉交原 owner 修正並跑過真實視覺路徑。飽和過載造成的零 HP／浮點殘餘未脫翼問題亦由原 owner 補測處理。

## APHE 機制的實際邊界

- 陸戰新 `ImpactState` 路徑具解保、實際殘速續程、停止後延遲爆炸及破碎／跳彈引信失效；以單枚 charge 釋放狀態防止重複爆炸。回放依已記錄爆點及時間，不由視覺猜測。
- 已解保而穿出當前目標後，下一個世界接觸未知，回報 `aphe_armed_exit_continuation_unresolved`；目前沒有跨車／跨世界段的續程爆炸傳播。
- 航空模型的蒙皮尚無校準毫米厚度。原生 APHE 不會從 box 尺寸或 `PartDef.armor` 解保；本地純 helper 雖可接受明確量測接觸，但現有 runtime 並未憑空提供此資料。不能宣稱航空 APHE 已具所有真實延遲爆炸條件。
- UI 的原始裝藥克數、爆炸 damage 的 TNT 當量及單次 burst 的有效原始質量分開保留。外層 worldburst 的 `raw_explosive_kg` 表示該 burst 在當量換算前的量，可能是內外部分配後的份額；整枚彈丸的原始裝藥從 catalog 讀取。
- 51 項 AP 家族的盤點完整，歷史逐發考證未完整。三項 75 mm Pzgr.39 材料修正有原文支援；美軍 M61／M62A1 約65 g Explosive D 得到原文確認。其餘未核值仍明示未核。

## 空戰模式行為已存在的 source 證據

| 需求 | 實際入口與行為 |
|---|---|
| 玩家只駕駛飛機，僅保留地面 AI 進攻 | `frontline.rs` 的 `player_ground_allowed=false`；原生空戰 UI 阻止玩家地面接管及指揮，地面公司仍由服務端推進；開局自動生成 AI 飛機只留在未公開的舊混合模式 fixture |
| 三戰區及占領積分 | `score_zones` 只統計 W2／C2／E2，UI 映射 A／B／C；無爭奪的占領點由服務端累計秒數及隊伍積分 |
| 空戰／對地積分 | `record_damage`／`settle_loss` 依實際受損、最後敵方來源、shot 與生命識別去重；擊落300分、擊毀地面100分，地面存活命中有封頂小額分 |
| 敵機全部消滅立即勝利 | `air_round_outcome` 只計算玩家擁有的飛機生命及尚未使用的第一架出擊容量；雙方成立後才判全滅。停在機場、整備、斷線及已放棄接管但仍存活的飛機不誤算為死亡；不讓舊 AI 飛機拖延勝負 |
| 自訂飛機、掛載、空中／機場出生 | 原有機庫、出擊 adapter、原始 customLoadout／layoutStores 與原生 slotItems 接通；伺服器驗證配置，來源掛點座標單獨固定 receipt |
| 機場修復、補彈、加油及換掛載 | 原生15秒整備狀態；己方可用跑道停穩、低油門、起落架下放且無火；操縱、投放、射擊、受傷或離開會取消；客戶端只顯示 accepted 進度 |

## 必須保留在進度中的缺口

- 原生 `store_unsupported_reason` 尚不開放 AAM／AGM 引導、ECM、sensorpod、引導／集束炸彈。原始掛載資料或 HUD 存在不等於伺服器已實作對應武器。
- 原生橋接層目前明確阻止獨立發動機啟停、反制投放及拋棄掛載；不允許退回本地路徑偷改燃油／彈藥。
- 原生航空接觸仍是 `accepted_aircraft_boxes`；陸戰此模式仍有 `native_legacy_plates_boxes`。視覺模型已復用不代表 hitbox 已完全逐三角形吻合。新的車體 silhouette 漏判由另一路審計。
- `frontline_client` 目前接 native 事件製作場景特效，未見把原生空戰事件串接到既有完整 Hitcam／死亡炮彈回放的入口。現有 APHE 回放修正不等同於原生空戰已有死亡回放。
- 完整瀏覽器聯機、多人伺服器壓測及 Linux 增量包啟動／回滾驗證仍需 ROOT 的最終驗收。本檔不宣稱這些已通過。

## 測試與 provenance

新增 `aircraft-native-slot-items-extension-20261026.json` 只固定新增掛點資料及 C214 起落架失效 ABI。產生器先移除唯一新增 `stores.slotItems`，再確認所有舊 metadata／stores／physics／guns／fuel／完整語意雜湊仍相同；舊 C213 receipt 完全不覆寫。既有七個 RP3 Windows 單 ULP 正規化仍是唯一數值平台例外。

最後R6修復同一客戶端Return接受後離房再出擊的控制epoch殘留：實際Left及初次進房清除本房間控制狀態，無現有成員時不接受控制；同場單調及異場拒絕保留。五項實際receive／applyControl回歸沒有放寬服務端條件。ROOT另行留存同客戶端首次跑道出擊與安全返回、新房空中出擊，以及空中Tab拒絕保留飛行的瀏覽器證據；本檔的Node範圍不代替該證據。

R6 freeze 後已獨立執行81／83個來源測試檔，共501項 PASS、0失敗，包含10項 folding packet、6項 Return握手、地圖／出生委託及控制epoch生命週期回歸。app SHA-256 `8305c62f4c858dbb5fb5ae69e9fd59eb5424243e3c43be68b775df568e076937`、profile `3d9b6e198405ec00295e7d9e3146a57d8790ef58f9b67f8d5da14c3e01318a82`、legacy aircraft `ef1bf83c19a94b28686704313fdbaa7f7f5aff46bbc44ee8cd6157e7d3b2b064`，測試前後均未變；TAP `target-air-frontline-final-node-20261026.log` SHA-256 `f000c1a3b37ddcb9121865cb85ff14ef0238cc45c9a3cdf3dbbbc46b7a8d390b`，scope receipt `target-air-frontline-final-node-scope-20261026.json` SHA-256 `c553e24f1c9d617af3ac0c88fe9a9a65bef6e55e8c8eaa1d093ae95414dee073`。歷史 C212 gear fixture 缺失及音訊 ffmpeg 不可用的兩個測試明確未執行，未當作通過。

舊458、477、480、490、494及496項結果分別另存為 previous458、previous477、r2、r3、r4、r5快照。R5的TAP／receipt SHA-256仍為`34aed4ea7a5f09af35d3300f80a537317653c10b50ed949ad569e9226f350d8b`／`76b3994349fbfcf8a24ded847625dc9ab3e4e5beba9d7526622814514dd5c362`。首輪R6的499／501因兩個部分抽取fixture缺少新依賴而失敗；只補上實際reset函式及正常G4脈絡，凍結production未變，再完整重跑得到上述501。首輪原始receipt／log以`r6-fixture-failure`保留，失敗log SHA-256 `3097650163de8cb6f9c5bb7d704ce4163e79bbf5120ebe509a9fc504a0e4e855`。
