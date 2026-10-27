# 原生空戰機庫與共用 HUD 生命週期複核

本輪依 ROOT 的實際瀏覽器回報修復原有介面的生命週期，沒有新增另一套出擊頁面，也沒有將飛機 ID 寫入陸戰的 `G4.id`。

`renderAirInfo()` 本來會替換整個 `#g-air` 內容。切換飛機、切換預設及自訂掛載後，原生空戰的出生按鈕因而消失。來源安裝器現在於此擁有者函式結尾呼叫 `refreshGarageControls()`；後者只在本局原生空戰的原機庫脈絡中重建控制，保留有效的空中／跑道選擇，離房清除脈絡。提示固定為「己方跑道停妥、低油门，按K整备15秒（维修/补弹/加油）」，使用原有 `rearm` 動作。

接受的飛機擁有共用標頭中的機型名稱與模式說明；原來的車庫按鈕、Tab／F8 使用原生返回路徑。離房時恢復原來標頭。頂部分數條限制寬度並省略過長文字，完整地圖名稱保留在可懸停的原生 tooltip。大廳姓名與在線狀態佔第一列，完整分數佔第二列，避免繼承的兩欄樣式將中文名稱擠成直排。

回歸測試執行實際 `showAirType()`、`renderAirInfo()`、掛載編輯及車庫按鈕處理器；DOM fixture 模擬 `innerHTML` 替換時子元素真正消失。新增的提示、tooltip 與大廳列三項曾得到預期 RED，修復後四份 focused test 共18項 PASS。候選安裝器重複套用結果相同，候選完整 app script 通過 `node --check`。測試未寫實際 app；其當時 SHA-256 為 `a2c6e7c22897468cb60c3de4797f304631f7779a5e1d0cd66e1f844dfdf6dcf6`。

ROOT 隨後已同步來源 helper、安裝窄 hook 並重新匯出 profile。第一輪 app SHA-256 `051b2170b2a371bb442a7a1a90d1a87fa9c0bdc01e8e4ca4f0fc89ea4648dee6`、profile `7b5f823769da14ec9a4aa7657b8cf9287af23ec1c671aea6334665399a7ad63e` 凍結後，獨立全套 Node 執行80／82個來源測試檔，共477項 PASS、0失敗；此輪已另存為 previous477 歷史快照。

其後實際瀏覽器驗收發現：跨機型／開關自訂編輯器後，「僅機砲」看似已選中，出擊卻因原保存索引不可用而被拒絕；明確重按該按鈕即可出擊。可重現的來源原因是 `airLoadoutHtml()` 將保存值靜默 clamp 成另一個視覺索引，原生出擊仍使用保存原值。本輪已將原生顯示與出擊共用同一個嚴格索引讀取器：僅將 canonical 非負整數字串規範成同一個數字索引，非法／已刪除的索引不選中任何預設，顯示「保存配置不可用，请重新选择」，等待玩家明確選擇。有效但伺服器未開放的原選擇仍保留並拒絕出擊，不回退其他掛載；各機型保存內容及開關編輯器不被修改。

增加三項測試並擴充 fixture 使用實際 `AIR_LOADOUTS`、按鈕渲染、編輯器完成、跨機型切換、原生 callback 及出擊 API，覆蓋越界、NaN、非法字串、canonical 0／1、有效未開放預設，以及明確點選後出擊。focused 合計21項 PASS，候選安裝器幂等且完整 script 解析通過。另一位 agent 已只讀獨立審查此窄修，沒有發現阻擋接入的語意問題。

最後實機驗收另找到 Return 握手錯誤：服務端以 `not_at_deployment` 拒絕未停穩的飛機時，前端先開機庫並以 `returnPending` 停止綁定，導致原機仍受控卻無法繼續駕駛。窄修現在只發送 Return 意圖，保留原駕駛橋；既有 `applyControl(null)` 及 shared 通知收到服務端接受後才開機庫。拒絕顯示中文己方跑道停穩條件，不更改控制權、彈藥或燃油；也不再讓舊pending flag抑制原駕駛。六項實際API／receive／applyControl測試涵蓋拒絕重試、重複Tab、中間仍受控狀態、接受解除控制的幂等通知，以及斷線後重連。獨立review已批准，未放寬服務端條件。

另一次實機定位了非法掛載索引的生成入口：出生選擇容器借用 `air-lo` class，原本的委託點擊以 `.closest('.air-lo')` 找到容器DIV，將不存在的 `data-lo` 轉成NaN並保存。候選安裝器現在只接收 `button.air-lo[data-lo]`。回歸fixture把實際出生按鈕沿 `g-air`→`g-info` 父鏈冒泡，掛載按鈕由實際 `airLoadoutHtml()` 標籤建立，證明兩種出生都不修改掛載，而合法0仍能選擇、保存及出擊。這修掉錯誤寫入；前述嚴格顯示仍負責既有損壞保存值。

首次開啟空戰時，地圖目錄尚未載入會使DOM的選擇值暫空。來源helper現在只在DOM值非空時更新保存的地圖選擇，保留預設Taiwan及之後明確選擇的Korea；延遲目錄及反序刷新回歸已通過。兩項窄修均經獨立review，沒有修改Return或物理規則。

R5 app SHA-256 `160f0fce113d93bc33f666bcd7b174704f4837943eafc6a9b50b39ce676e87b2`、profile `59501659db1602ed3dc87714a90e230a10e4e3a79daeccafd0f943fe618147f7` 凍結後曾得到81／83個來源檔共496項 PASS、0失敗。此歷史紀錄已另存為r5：TAP SHA-256 `34aed4ea7a5f09af35d3300f80a537317653c10b50ed949ad569e9226f350d8b`，scope receipt `76b3994349fbfcf8a24ded847625dc9ab3e4e5beba9d7526622814514dd5c362`。先前480、490及494項紀錄分別另存為r2、r3、r4。

最後 R6 實機定位到控制 epoch 的房間生命週期：同一客戶端首次出擊取得epoch1，安全返回接受epoch2，離房後加入新房的首架飛機回到epoch1；舊前端仍保留2，因而拒收新房控制並停在機庫。窄修只在現有房間與成員有效時接受控制；實際Left及初次進房使用原有重設擁有者清除epoch、序號及輸入時間。同一場內的單調檢查及異場控制拒絕仍保留；沒有放寬協定或服務端驗證。新增五項實際receive／applyControl測試覆蓋Return2→Left→無主控制拒絕→新房1、初次房間殘值、同場與異場邊界、無成員拒絕，以及機庫拒絕訊息可見性。服務端已接受的實機跑道返回、同一客戶端重建房間後的空中出擊、空中Tab被拒後仍保留飛行，由ROOT另存瀏覽器證據。

最終 R6 app SHA-256 `8305c62f4c858dbb5fb5ae69e9fd59eb5424243e3c43be68b775df568e076937`、profile `3d9b6e198405ec00295e7d9e3146a57d8790ef58f9b67f8d5da14c3e01318a82` 凍結後，全套81／83個來源檔共501項 PASS、0失敗。app／profile／legacy aircraft 三份輸入測試前後雜湊相同。缺少歷史 C212 fixture 及 ffmpeg 的兩個測試明確未執行，未列入通過。TAP `target-air-frontline-final-node-20261026.log` SHA-256 `f000c1a3b37ddcb9121865cb85ff14ef0238cc45c9a3cdf3dbbbc46b7a8d390b`，scope receipt `target-air-frontline-final-node-scope-20261026.json` SHA-256 `c553e24f1c9d617af3ac0c88fe9a9a65bef6e55e8c8eaa1d093ae95414dee073`。首輪R6的499／501是兩個部分抽取fixture缺少實際reset擁有者及正常G4脈絡；只補齊fixture依賴後重跑，未修改凍結的production。首輪原始receipt／log以`r6-fixture-failure`保留，失敗log SHA-256 `3097650163de8cb6f9c5bb7d704ce4163e79bbf5120ebe509a9fc504a0e4e855`。本Node範圍不宣稱瀏覽器或Linux執行驗收；該證據由ROOT另行留存。
