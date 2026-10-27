# AP／APHE 裝藥、引信與航空彈鏈審計（2026-10-26）

已逐項盤點全部 91 個地面彈藥 JSON，其中 AP 家族 51 項：16 項有炸藥裝藥、35 項為零裝藥。這是資料及執行路徑審計；**沒有把全數歷史數值宣稱為已核實**。每一項的現值、來源檔案 SHA-256 與未核實狀態保存在同名 JSON。

## 已接入本地來源的修正

- 三項75 mm Pzgr.39材料修正已套入目前的資料JSON及boot資料解析後的runtime覆蓋；原始壓縮assetprefix保留。下表與JSON是修正後的目前來源快照；`aphe-primary-correction-manifest-20261026.json`保留修正前PETN→RDX的審查記錄。這不等於Linux已發布。
- 航空模型原本只要 TNT 當量大於零，就在第一層蒙皮爆炸並截斷動能路徑。現在實際 `kind`＋原始裝藥區分 APHE 延遲引信、HE 接觸引信與實心／燃燒／次口徑彈。
- 飛機零件的 `armor` 是傷害倍率，並非毫米厚度。沒有校準蒙皮厚度時，APHE 回報未解保，不假造爆炸；延遲終點超出當前已解算彈道段時回報未解算續程，不向外推算爆點。這也代表目前**未完成跨彈道段的 APHE 續程引信**，不可宣稱所有航空 APHE 已具完整延遲爆炸。
- 本地玩家、AI 與舊聯機預覽的爆炸畫面／聲音依實際 `bursts`，不再由「有裝藥」直接製造接觸爆炸；聯機傷害仍歸服務端。
- UI 顯示 `explosive_mass_kg ×1000` 的實際克數與材料，沒有以 TNT 當量冒充裝藥。彈鏈保留每種彈的比例，庫存數不乘到每發裝藥上。
- `data/aircraft/aircraft.json` 的舊 `filler_kg` 是 TNT 當量；已增補24個舊航空彈識別字的原始裝藥／種類／引信欄位，保留原 `filler_kg`、物理值及既有旗標。別名只由實際槍械定義與單彈種彈鏈建立。
- 原生航空HE已記錄實際接觸點、首次接觸相對時鐘0及獨立原始／TNT質量，並由accepted pose保存世界爆點；原生事件顯示不再無條件播接觸爆炸。
- ROOT的真實WASM記錄 `aphe-real-wasm-receipt-20261026.json`：實際匯出MK214 A的17 g彈對實際PzIV資料，約6.1 ms解保、2.4 ms延遲、8.5 ms內爆，結果為detonated。這證明該實際路徑，沒有替所有車型或未知航空蒙皮做歷史認證。

## 原始文獻及已套用的材料修正

原始掃描：[TM 9-1985-3, German Explosive Ordnance, 1953](https://www.ibiblio.org/hyperwar/USA/ref/TM/pdfs/TM9-1985-3-German.pdf)。下載檔 SHA-256：`3f402900ffea30ed1e10d1f307ac141f87efc5d0fe76bf189771bfbc12445efb`。掃描為圖片，以下頁面已直接看過圖，不以空的 PDF 文字抽取當證據。PDF 頁碼為一開始的 1-based 頁碼。

| 紙本／PDF 頁 | 精確識別與觀察 | 處理 |
|---|---|---|
| 398–399／56–57 | 7.5 cm Pzgr.39 KwK40／StuG40／Pak40，主裝藥 Cyclonite；PETN/wax 另列為 booster | 普通及 L/43 兩項材料已petn→hexogen；17 g 與引信值保留 |
| 423／81 | 7.5 cm Pzgr.39/42，KwK42／StuK42(L/70)，Cyclonite/wax90/10 | /42 材料已petn→hexogen；頁面質量與其他資料衝突，保留17 g |
| 395–397／53–55 | 5 cm Pzgr.Patr.KwK，0.87 oz PETN/wax87/13；沒有明示 Pzgr.39 | 不用其24.66 g覆寫現有50 mm Pzgr.39的17 g |
| 437–438／95–96 | Flak41用88 mm Pzgr.39小藥室型，2.12 oz Cyclonite | 與遊戲KwK36/L56不可直接混用；保留59 g待核 |
| 448／106 | KwK36(L56)等用88 mm Pzgr.39，1/4 lb Cyclonite/wax90/10 | 材料／質量有疑點，保留當前59 gAmatol並明示未核實，先解決批次／變型差異 |

Cyclonite 即 RDX；`hexogen` 是遊戲已有枚舉，並未模擬精確 RDX／蠟混合配方。三項材料修正讓現有當量換算由 PETN 的1.66改用RDX的1.6（17 g原始裝藥仍是17 g；當量28.22→27.2 g）。這不是提高裝藥／威力。具體前後值、檔案雜湊及文獻頁碼見 `aphe-primary-correction-manifest-20261026.json`。
美軍M61／M62A1約65 g Explosive D的原文已確認，見 `aphe-us-primary-confirmation-20261026.md`；4.7 cm36(t)的TNT材料已確認但18 g質量仍與原文衝突，見 `aphe-47mm-primary-discrepancy-20261026.md`。蘇聯BR-471的原文MD-8識別與尚未核實數值見 `aphe-soviet-primary-progress-20261026.md`。

## 全部51項現值與核實狀態

「目錄」表示已查程式資料，歷史裝藥／引信數字仍未逐發原始文獻核實。「材料已核」只適用指定型號；不代表引信數字同時已核。美軍約65 g亦已核實指定實裝變型。零炸藥不代表沒有燃燒劑；API燃燒劑不視為HE炸藥。

| ID | 類別 | 原始裝藥 g | 材料現值 | 延遲 ms／靈敏度 mm | 狀態 |
|---|---|---:|---|---|---|
| `ap_37_m74` | ap | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `ap_57_mk7` | ap | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `ap_75_generic` | ap | 0 | none | 0／0 | 遊戲／估計配置；非歷史認證 |
| `ap_75_m72` | ap | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `ap_custom_37_l45` | ap | 0 | none | 0／0 | 遊戲／估計配置；非歷史認證 |
| `ap_custom_75_l48` | ap | 0 | none | 0／0 | 遊戲／估計配置；非歷史認證 |
| `ap_custom_88_l56` | ap | 0 | none | 0／0 | 遊戲／估計配置；非歷史認證 |
| `apbc_100_br412` | aphe | 65 | a_ix_2 | 2.4／15 | 目錄；歷史參數待核 |
| `apc_50_pzgr39` | apcbc | 17 | petn | 2.4／15 | 原文型號不完全吻合；保留17 g待核 |
| `apc_90_m318` | apcbc | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `apcbc_130_br482b` | apcbc | 120 | tnt | 2.4／15 | 目錄；歷史參數待核 |
| `apcbc_37_m51` | apcbc | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `apcbc_47_pak36t` | apcbc | 18 | tnt | 2.4／15 | TNT已核；18 g與原文衝突待核 |
| `apcbc_57_mk9` | apcbc | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `apcbc_75_m61` | apcbc | 65 | explosive_d | 2.4／15 | 指定變型約65 g／材料已核；引信數值待核 |
| `apcbc_75_m61_m3` | apcbc | 65 | explosive_d | 2.4／15 | 指定變型約65 g／材料已核；引信數值待核 |
| `apcbc_75_pzgr39` | apcbc | 17 | hexogen | 2.4／15 | 材料已核並已改RDX；質量／引信待核 |
| `apcbc_75_pzgr39_42` | apcbc | 17 | hexogen | 2.4／15 | 材料已核並已改RDX；質量／引信待核 |
| `apcbc_75_pzgr39_l43` | apcbc | 17 | hexogen | 2.4／15 | 材料已核並已改RDX；質量／引信待核 |
| `apcbc_76_m62` | apcbc | 65 | explosive_d | 2.4／15 | 指定變型約65 g／材料已核；引信數值待核 |
| `apcbc_88_l56` | apcbc | 59 | amatol | 2.4／15 | 材料及變型衝突；保留待核 |
| `apcbche_35` | apcbc | 22 | hexogen | 0.8／8 | 遊戲／估計配置；非歷史認證 |
| `apcr_145_bs41` | apcr | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `apcr_20_pzgr40` | apcr | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `apcr_30_pzgr40` | apcr | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `apcr_50_pzgr40` | apcr | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `apcr_75_pzgr40` | apcr | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `apcr_75_pzgr40_42` | apcr | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `apcr_75_pzgr40_l43` | apcr | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `apcr_76_m93` | apcr | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `apcr_85_br365p` | apcr | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `apcr_88_pzgr40` | apcr | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `apcr_90_m304` | apcr | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `apds_122_3bm11` | apds | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `apds_20_dm43` | apds | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `apds_35_kda` | apds | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `apfsds_125_3bm22` | apfsds | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `apfsds_35_pmc287` | apfsds | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `apfsds_78_xp` | apfsds | 0 | none | 0／0 | 遊戲／估計配置；非歷史認證 |
| `aphe_122_br471` | aphe | 156 | tnt | 2.4／15 | 目錄；歷史參數待核 |
| `aphe_122_br472` | aphe | 156 | tnt | 2.4／15 | 目錄；歷史參數待核 |
| `aphe_76_br350a_l11` | aphe | 155 | tnt | 2.4／15 | 目錄；歷史參數待核 |
| `aphe_85_br365` | aphe | 164 | tnt | 2.4／15 | 目錄；歷史參數待核 |
| `api_145_b32` | ap | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `api_23_bza` | ap | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `apit_145_bzt44` | ap | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `apt_20_pzgr39` | ap | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `apt_20_rh202` | ap | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `apt_25_br132p` | ap | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `apt_30_pzgr` | ap | 0 | none | 0／0 | 目錄；歷史參數待核 |
| `pantsir_30_ap_est` | ap | 0 | none | 1／1 | 遊戲／估計配置；非歷史認證 |

## 航空派生與舊目錄別名

`ap_50_mk214a` 由實際 `airShell("ap_50_mk214a","apc_50_pzgr39",...)` 生成：保留 `kind:apcbc`、17 g PETN、現有2.4 ms／15 mm，再覆寫MK214遊戲配置的名稱／速度／彈重。這是 **MK214 A**，不改叫BK5；原程式已明示「遊戲AP配置」，沒有認證其歷史彈種完全相符。

航空其他彈種與24個舊目錄識別字的精確關聯、增補欄位清單及未核實清單由 `enrich_aircraft_projectile_metadata.py` 產生，見 `aphe-aircraft-metadata-manifest-20261026.json`；所有別名保留原TNT當量。

## 接入檔案與尚未完成

- `patch_projectile_filler_info.py`：實際HUD、陸戰出擊、車庫及飛機資訊的原始克數。
- `patch_aircraft_projectile_fuze.py`：本地實際兩種命中路徑及玩家／AI／舊聯機預覽呼叫；保留彈藥殉爆。
- `enrich_aircraft_projectile_metadata.py`：產生的24項舊航空目錄補充已由ROOT套入；原始TNT當量不變。
- `patch_primary_projectile_fillers.py`／`primary_projectile_fillers.js`：三項75 mm材料與實際boot解析資料後覆蓋已套入；profile exporter在派生彈藥前執行同一覆蓋。原始壓縮assetprefix不變。
- 尚未逐發完成51項質量、引信延遲及解保厚度的原始文獻考證；50／88 mm變型、蘇聯彈與美軍M61／M62實裝／惰性批次不可混合。
- 尚無校準航空蒙皮毫米厚度，也沒有跨段APHE續程引信；以上限制會由結果欄位明示，不拿零件倍率冒充厚度。
- 本地app、原生程式與資料由ROOT統一接入／編譯；上述研究與自動化測試不能替代完整瀏覽器、Linux增量包或線上發布驗收。
