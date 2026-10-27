# 原生空戰飛彈與掛載接入（2026-10-26）

使用者最新要求：伺服器預設開放來源catalog內實際允許的掛載配置。配置相容性、掛點數量、來源位置及機型年份仍需驗證；沒有鎖定、沒有照射或導引頭準備中是實際發射條件，不應用「伺服器未開放」把整列來源配置塗灰。

原灰色R-73／R-27T／R-27R的入口已查明：`store_unsupported_reason()`對所有AAM／AGM回`unsupported_authoritative_guidance`，來源slot.options仍存在；客戶端只顯示服務端的拒絕原因。原生飛彈不能僅解鎖UI；需經實際資源帳本、發射、飛行、引信、命中／爆炸與分數擁有者。

## 實際來源模式清單

來源`data/aircraft/frontline.json`在model-mount-v4前有：IR、SARH、ARH、AIM-54中段／末段、電視TV、熱像IIR、半主動雷射、雷射駕束、無線電指令、反輻射；另有雷射導引炸彈GBU-10／12、CBU-87／RBK-500及其子彈藥、ALQ-131和Pave Spike／Sniper／LITENING吊艙。v4新增的R-3R／R-60、吊艙／掛架及實際掛點須作為新來源組合，而不是被本輪舊snapshot覆寫。

原browser已有的導引頭準備／捕獲時間、LOS、FOV／gimbal、IR尾後／迎頭距離、SARH照射、ARH資料鏈／終端、自主TV／IIR、過載、推進及壽命數值，是遊戲既有估值。原生接入會明示此來源，不把它們說成歷史實測。射手只傳控制意圖和目標UnitRef，目標位置、命中與資源消耗由服務端取得。

## 機型能力與來源

當前wire ID `su27`其實是Su-27UBK（1992），`mig29`是MiG-29 9.12（1983）；保留其原有AAM、普通炸彈及火箭能力，不將整個家族都說成原裝支援精確對地武器。wire ID `f15c`的當前模型與metadata已是雙座F-15E，應保留該wire ID兼容保存資料，顯示F-15E並加相應Maverick配置。

新增`su27skm`及`mig29smt`為分開的升級能力配置；其繼承現有模型／飛行資料只是本輪視覺近似，不能宣稱單／雙座、機背、油量及新雷達天線都已重建。候選helper應於v4來源之後執行，保留原配置與所有v4新增掛架。

- [美國空軍AGM-65資料](https://www.af.mil/About-Us/Fact-Sheets/Display/Article/104577/agm-65-maverick/)列F-15E為載機，並區分TV、IIR與雷射變體；[波音的F-15E發射AGM-65B資料](https://secure.boeingimages.com/archive/F-15E-Strike-Eagle-Launches-AGM-65B-Maverick-Missile-2F3XC5Y2VBF.html)亦有直接製造商紀錄。
- [Su-27SKM出口型錄文字鏡像](https://janes.migavia.com/rus/sukhoi/su-27skm.html)列R-73E、R-27及Kh-29T／TE／L；[MiG-29SMT出口型錄文字鏡像](https://janes.migavia.com/rus/mig/mig-29smt.html)列Kh-29T／TE，並說明雷射Kh-29L需相應光電吊艙。這兩頁是型錄數位鏡像，不是假稱目前製造商官方網站。
- [Vympel官方Kh-29TE資料](https://vympelmkb.ru/production/production/upravlyaemye-rakety/aviatsionnaya-upravlyaemaya-raketa-kh-29te/)確認它是日間目視條件的TV射後不理武器。這不能被當成全天候IIR或雷射型。
- 年份若取2005，應標成當時出口型錄可用年，而非宣稱服役年；MiG-29SMT在俄軍2009年接收另有同期資料。型號新配置的年限制須由所選年份來源與ROOT審查一起固定。

## 原生所有權

`frontline_air_missiles.rs`管理型別化導引及限制；`frontline_air.rs`保存導引頭狀態、來源掛點和資源；`frontline_sim.rs`仍是唯一外部彈體、地形／設施／地面及航空接觸、爆炸與事件擁有者。`frontline.rs`驗證控制生命／epoch／seq及收件人資料；missile snapshot不含目標座標，敵彈只經己方觀測者LOS顯示。ROOT負責前端模型／音效／HUD串接及Cargo／發布證據。

初始IR／SARH／ARH／TV／IIR gate與新seeker意圖先得到兩項預期RED；其後七項模組／協定檢查通過。依最新全開配置要求，測試再改成逐profile實際slot.options必須全部可配置，並先重現ALQ-131舊拒絕的RED；後續發射與完整模式結果需以新的實際測試記錄為準，不借用R6原501項紀錄宣稱此接入已完成。


## 完整模式的驗證清單（開放配置後繼續執行）

- IR／TV／IIR：導引頭準備與捕獲、實際LOS、FOV／gimbal及目標生命；射前無鎖不扣彈，射後不再依賴射手雷達。
- SARH：實際來源雷達安裝且開機，保持同一目標的照射；超過來源記憶時間後不再取得目標新位置。
- ARH／AIM-54：實際來源雷達提供中段更新，進入來源activeRange後由彈上雷達自行取得；失去射手仍可繼續終端追蹤。
- 雷射飛彈／GBU：實際內置Klen-PS或來源掛載的雷射吊艙；只向服務端解析出的UnitRef目標照射，遮擋或停照超過記憶時間後失去導引。GBU仍是無推力炸彈、沿用來源2.5G控制上限。
- 駕束：實際具備beam能力的來源瞄準設備，保持射手視軸與LOS；不是自動尋標的TV/IIR彈。
- 無線電：只接受有界手動俯仰／偏航指令；無需捏造一個目標UnitRef；射手失控／超出控制距離停止指令，禁止同一射手同時操控兩枚。
- 反輻射：只能以實際發射中的雷達為更新來源，關機後嚴格採用各自來源memory策略。現有地面AA角色不等於已建立雷達發射機模擬，不據此虛構地面電磁訊號。
- ECM：必須真的攜帶未毀損ALQ-131，依來源search／track係數削弱雷達有效距離；不影響IR／TV／雷射武器。開機控制本身不授予無裝備機種干擾能力。
- 集束：按來源高度、數量與散布解開父彈，產生36枚BLU-97或40枚PTAB-1M的獨立彈體與真實既有子彈藥投射物；由同一host命中／傷害／得分鏈接管，不替換成單一大爆炸。

以上是實作與測試驗收條件；需由ROOT保存各個原生RED／GREEN與前端接線證據後，才能把對應項目標成完成。


## 本輪驗證與接線狀態

ROOT已依實際Rust執行回傳：原生17項導引／配置／資源／飛行／引信／毀傷／集束測試全部通過；其中R-73走過真正的捕獲、扣彈、獨立彈體、相對運動近炸、既有傷害擁有者及消耗流程。CBU-87／RBK-500在正常預算下各產生36／40枚原生子彈體。獨立只讀審查找出的兩個P2已先重現真正RED再修復：耗盡R-27R的18km鎖不能授權15km外的12km R-27T；開舱不得把未處理的已接受彈體排除於兩萬發上限之外。X只取消本枚捕獲、保留雷達與原目標時，已發射SARH保持照射。

前端11項實際Aircraft視覺測試已在28個邏輯機型上通過，明確檢查新增SKM／SMT並沿用來源機型有限的損傷投影。第18項實際host view測試曾得到Su-27SKM缺fin→tail投影的正確RED；已改按明示inheritedModelId辨識來源，仍只投影原有aggregate資料，不建立新的碰撞／損傷部件。第18項GREEN與最終全套native／Node／網路／瀏覽器結果由ROOT統一保存，本文不提前宣稱通過。

固定意圖協定為`air_seeker_control`的unit／epoch／seq／enabled／radar／target，外加預設false的laser／ecm及預設[0,0]的manual[pitch,yaw]。pitch正值向上、yaw正值向右；只傳意圖和UnitRef。狀態持久，前端只在變更時發送。導引頭準備與雷達／設計器支持分開；pod的UnitRef是指向意圖，服務端解析bearing並保留真實來源設備的上下／方位／範圍／LOS條件。`missiles`保留原View欄位，包含所有實際飛彈、炸彈、火箭和子彈藥；無導引彈體用ballistic phase。視覺從accepted age及原catalog推進段決定煙，不能再次跑本地碰撞或傷害。

明確邊界：目前原生導引目標是實際敵方航空／地面單位的UnitRef；自由地面點及設施尚無此目標身份，不能以偽造ID接入，普通炸彈／火箭仍由原生接觸鏈命中設施。flare／chaff尚未建立原生資源／誘騙擁有者；地面雷達發射機亦未因AA角色而虛構。ARM只接實際已開啟的來源航空雷達發射源。這些限制不能以本地特效或所有掛載已開放來掩蓋。
