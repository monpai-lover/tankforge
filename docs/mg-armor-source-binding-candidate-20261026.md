# 機槍裝甲修正候選：來源特徵綁定（2026-10-26）

此改動只產生候選 app；ROOT 擁有實際 `handoff/bundle/app.js.html`、WASM 及發布整合。R6 的測試紀錄及發布證據沒有覆寫。

## 修正範圍

移除以質心距離、法線和鄰近裝甲平面猜測物理角色的 runtime 降級。共享處理器適用原始26份 stock packet：既有已審核 declaration 保持不變；只有精確匹配原始 manifest／catalog SHA256 的來源特徵可獲新綁定；其餘 unsupported 面保持 unsupported，並回報 `unresolved_surface_resistance_quarantined` 和計數。沒有把不確定面偷偷改成無裝甲，沒有增加0.12 m容差，沒有新增或填滿碰撞幾何。

本輪明確擴充七款：Pz III J／Pz IV H 的四個炮塔側面斜角；T-34-85 的36邊環式炮塔／主炮盾；M4A2／M4A3(75)W及兩款76 mm Sherman的來源環式炮塔、炮盾。逐條來源 ordinal、完整 descriptor、descriptor hash、原始 declaration key、constructor band／edge／cap分組及現有 engineering ref 固定在registry。炮塔分前、左右側、後、頂；不把整個loft當成正面。厚度及材料只取該 packet 的 acceptedAnatomy，例如PzIII側面30、Sherman炮盾89、T34正面90 mm；不宣稱這些遊戲值已完成歷史實測。

保留真正開口：不產生額外三角形，炮塔底部無獨立工程來源的部分保持隔離，裝飾、模組及Crew既有宣告不繼承主裝甲。原始未修改catalog保留已核對父身份的炮管斷裂variant；改過catalog的七款明確停用舊父身份variant並提供 `disabledVariantReason`，避免把原始derivative套到不同catalog。這七款的既有渲染破管仍由原renderer處理，不宣稱物理斷管已重建。

主要檔案：

- `handoff/tools/verified_surface_armor.js`：來源綁定／隔離處理器，沒有DOM或GPU操作。
- `handoff/tools/build_verified_surface_registry.mjs`：從原始bundle和固定constructor schedule重建registry。
- `handoff/qa/verified-surface-armor-registry-20261026.json`：26個精確父packet，七款共368個原始declaration覆核入口；所有來源descriptor留在其中供審查。
- `handoff/qa/verified-surface-armor-outcomes-20261026.json`：候選每車mapped／quarantined／variant前後計數和app hash。拆分整個casting會增加unknown declaration個數，不代表unknown三角形增加。
- `handoff/tools/patch_verified_surface_armor.py`：只寫指定的獨立候選檔，拒絕覆寫ROOT的app或輸入檔；重新套用幂等。
- `handoff/tests/mg-armor-protection.test.mjs`：真實bundle builders、原始embedded stock、真實WASM與renderer幾何。

## 必須保留的限制

Sherman正面複合炮盾／支座的高穿深射線仍有既有kernel的重疊邊界問題：同一material region的多個outer邊界先後出現，會再次收取炮盾阻力，後續出現 `rejected_impact_contact`。本候選沒有把部分外露的支座三角形抹成裝飾來躲過問題，也沒有改Rust。無歧義側面高穿深對照要與raw／legacy一起審查，不能把它宣稱為全部正面高穿深路徑已完成。ROOT已接手此限制的後續決策。

其餘未完成來源綁定的面現在會明確隔離／停止，而不是無阻力穿進Crew。這是可見且保守的未解狀態，並非完整26款全表面裝甲重建；不能宣稱所有車輛已完全完成模型裝甲。

## ROOT 審查後的接入

產生候選（不覆寫實際app）：

```powershell
python handoff/tools/patch_verified_surface_armor.py --input handoff/bundle/app.js.html --output ../task/mg-armor-candidate-20261026.html
node --test --test-reporter=tap handoff/tests/mg-armor-protection.test.mjs
```

測試自行呼叫候選patcher。`TF_MG_ARMOR_UNPATCHED=1`可對原始R6重現最初五項RED；不會寫app。ROOT應審查候選及獨立actual-entry結果後自行採用；不要讓patcher寫入app。增量包builder須把上述兩個 `handoff/qa/verified-surface-armor-*.json`加入顯式QA清單；tools、tests、docs現有遞迴收集會覆蓋其餘檔案。若套入後重新匯出profile／客戶端／服務端，須建立新一輪receipt，保留R6原紀錄。

最初四條實際MG漏甲及共享不透明保護測試先得到5/5 RED，修正後5/5 GREEN。之後擴充canonical連續射擊、高穿深／raw／legacy、外露Crew、裝飾實際接觸、鏡像轉動及全26款實際註冊，最終結果另存新的MG候選log；不借用原R6的501項通過宣稱候選已整合。

最終獨立執行14項PASS、0失敗，64,929.6044 ms；`../task/mg-armor-protection-verified-20261026.log` SHA256 `d43ff3f3efa195486c62c04392bbcbb44d383954b9e1d690ef0625bb50a3a50a`。測試檔SHA256 `f5f85e15d42bfb7f5a79e09ba2c59754119eb6cc416f359caa988099c6c081e8`，helper `c41727015a6be9f1fe06c9fde50190d33ee0257236bd0f9c4ba0f6b2394c2ab3`，registry `9c4dfa5a5b1cd7b9afc670289de4a440c42eb2577f1dcae2f9c1ba83e8e3720c`，outcomes `b53a123565ac31c4b6b60ccb18d5d20d3f971cee1c82d2aa5f100ebc1ac07d8f`。R6來源候選SHA256 `1d7ba05bf2b1b76f4938d602de4e551fdbd6a08168f7b7977a6094f0a2bdd2f9`，重複套用完全相同。ROOT已在同時推進其他app功能，因此接入應在當前app重新套窄patch，不應用此舊候選整檔覆蓋新功能。
