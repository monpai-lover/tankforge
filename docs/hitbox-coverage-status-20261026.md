# 命中體覆蓋與未完成項 · 2026-10-26

目前不能宣稱「全車庫按完整外觀模型判傷」。本增量候選修復兩款折疊車體的精確幾何接觸與姿態／工程資料身分；聯機原生前線仍主要使用舊裝甲板和模組盒。這份清單描述彈道接觸與抗性，不代表車輛和地圖的剛體碰撞。

## 數量與來源

原站下載 HTML 的 SHA-256 是 `36bb12d62609f3f9ad2be9a0015786500c1de374623a11a0a60301e29967e63f`。其中有 **46** 份車輛資料；啟動程式另從 M901 建立離線 `ad_chaparral`，因此實際內建可選 ID 是 **47**，合併家族後有 **32 張預設車庫卡、9 個家族、15 個非預設變體**。18 款含導入模型或導入部件，不等於整車都來自 GLB。

原站有 **24** 個 `surfaceCatalog` 包；本次候選新增 `de_flakpz38t`、`de_rso_pak40` 後為 **26**。另有 Pantsir 的舊三角裝甲；其餘 **20** 個內建 ID 仍沒有這套註冊三角面接觸。資料夾的 47 份原生車輛則是另一個集合：含 `fun_hexa` 工坊範例，不含離線 Chaparral 別名。原生前線還有履帶／非導彈主炮／彈種／年代准入，不能把資料夾數當成實際出擊清單。

`data/hit-meshes/index.json` 的 44 款幾何捕捉及工坊範例是編寫／診斷資料。存在 manifest 或檢視器三角面，並不代表已接上實戰判傷。

## 三角接觸不等於抗性資料已完整

現有瀏覽器會執行 `normalizeSurfacePacket → declareUnauditedSurfaces → plateBinder`。它保留位置 payload、索引和網格頂點數，但把未審核面按附近舊裝甲板推定為裝甲，或改為無裝甲裝飾；再重算 manifest／catalog 雜湊。附近判定包含 12 cm 平面距離、25 cm 輪廓外延及法線／面積門檻。這是原站既有相容政策，不能稱為已逐面考證的真實裝甲。

這個重寫還會停用原資料中的物理炮管斷裂變體，因為變體的受信任父雜湊指向原包。源資料仍保留，並不代表執行時已啟用。新兩款沿用同一相容政策；本次沒有擴大或另造最近平面的配對規則。

原始 24 包共有 1,960,208 個物理三角形，167,471 個未分類三角形；這是**原包語義**數字，不是幾何空洞。只有保留原始 `unsupported` 政策的核心才會明確回報 `unsupported_surface_resistance`，不能把它當成目前預設重寫後的全局行為。獨立審計使用原站內嵌資料，24 款原包及重寫包都成功註冊；各以 144 條前／側面 APCBC 射線測試，原包有 68 條明確回報未知抗性停止，重寫後為 0，兩路均無協議例外。每條射線使用獨立 target／actor 生命，沒有重複舊初始狀態。這是六條固定射線／車的樣本差異，並非全部彈種或所有表面的完成認證。詳細限制見 [獨立審計](provenance-recovery-20261026/runtime-surface-normalization-independent-audit.md)。

## 本次兩款具體修復

- `de_flakpz38t`：原包 100,835 個三角形，4,752 個未分類三角形、198 個 `unsupported` 宣告。仍未逐面審核的包括上擋板、戰鬥室內壁／轉角、車首／尾封口、炮盾與配件。
- `de_rso_pak40`：原包 60,947 個三角形，3,536 個未分類三角形、89 個 `unsupported` 宣告。仍未逐面審核的包括駕駛室網格／頂板、雙層炮盾、木製車斗材質配對及艙蓋邊界。

候選在初次註冊前恢復不可變的原始工程資料，因此保存為半開／全開的擋板也能註冊。之後擋板只通過實際網格姿態移動；`_definition`、重新 prepare／fresh 不會再把舊平面位移寫入這份工程身分。離開精確場景後，以及工坊複製的來源，仍按原來方式折疊舊裝甲板。

10 項實際 WASM 測試通過：收起／半開／全開出生、兩側擋板接觸與舊位置空隙、同車型兩個不同折疊姿態、既有健康／彈藥／回放掛鉤保留、prepare／fresh、退役後舊路徑、幾何不匹配拒絕、補丁冪等；另覆蓋每車六方向與兩條行走部射線，共 16 次典型接觸。原始與重寫後的每個網格頂點／三角數、位置 payload 雜湊相同。這些是接觸與狀態測試，不是 GPU 畫面、幀率或歷史裝甲認證。

## 逐車清單

「T*」是具備註冊三角包的離線接觸，抗性仍經上述既有相容重寫；每個實際 actor 還須成功註冊。「L」是舊三角裝甲批次，並非全模型；「P」是舊板／抽象盒。「原生」欄只說明該資料若被原生前線准入時的命中途徑。新增兩列是本候選接入結果，不代表已部署至遠端網站。

| ID | 顯示名稱 | 車庫入口 | 外觀來源 | 離線 | 原生 |
|---|---|---|---|---|---|
| `de_pz3_j` | Pz.Kpfw. III Ausf. J (L/60) | 預設卡 | 程序模型 | T* | P |
| `de_pz4_h` | Pz.Kpfw. IV Ausf. H | 預設卡 | 程序模型 | T* | P |
| `de_tiger_e` | Tiger I (Pz.Kpfw. VI Ausf. E) | 預設卡 | 程序模型 | T* | P |
| `de_panther_g` | Panther Ausf. G | 預設卡 | 程序模型 | T* | P |
| `de_panther_f` | Panther Ausf. F | 家族變體 | 程序模型 | T* | P |
| `de_vk3002_db` | VK 30.02 (DB) | 預設卡 | 含導入件 | P | P |
| `de_sdkfz234_2` | Sd.Kfz. 234/2 Puma | 預設卡 | 程序模型 | T* | P |
| `su_t34_1940` | T-34 (1940) | 家族變體 | 程序模型 | T* | P |
| `su_t34_85` | T-34-85 | 預設卡 | 程序模型 | T* | P |
| `su_is2` | IS-2 (1944) | 預設卡 | 程序模型 | T* | P |
| `su_t10m` | T-10M (Oplot-MO) | 預設卡 | 含導入件 | P | P |
| `su_t10m_oplot23` | T-10M (Oplot23 · hypothetical custom) | 家族變體 | 含導入件 | P | P |
| `su_bmpt34` | BMPT-34 (1943) | 家族變體 | 含導入件 | P | P |
| `su_t54` | T-54 (1951) | 預設卡 | 程序模型 | T* | P |
| `su_t72a` | T-72A (1979) | 預設卡 | 程序模型 | T* | P |
| `us_m8` | M8 Greyhound | 預設卡 | 程序模型 | T* | P |
| `us_m10` | M10 GMC | 預設卡 | 程序模型 | T* | P |
| `us_m4a2` | M4A2 | 預設卡 | 程序模型 | T* | P |
| `us_m4a3_75w` | M4A3(75)W | 預設卡 | 程序模型 | T* | P |
| `us_m4a1_76w` | M4A1(76)W | 預設卡 | 程序模型 | T* | P |
| `us_m4a3_76w_hvss` | M4A3(76)W HVSS | 家族變體 | 程序模型 | T* | P |
| `us_m56` | M56 Scorpion | 預設卡 | 含導入件 | P | P |
| `us_m901_itv` | M901 ITV（M113 TOW） | 預設卡 | 程序模型 | P | P |
| `ad_chaparral` | MIM-72A 小檞樹（M901 車體） | 離線別名 | 程序模型 | P | 無原生資料 |
| `uk_cromwell_iv` | Cromwell Mk IV | 預設卡 | 程序模型 | T* | P |
| `xp_kda35` | 35 mm 輪式試驗車 | 預設卡 | 含導入件 | P | P |
| `xp_w78` | 78 mm 輪式試驗車 | 家族變體 | 程序模型 | T* | P |
| `de_pzjg1` | Panzerjäger I | 預設卡 | 程序模型 | T* | P |
| `de_flakpz38t` | Flakpanzer 38(t) | 預設卡 | 程序模型 | T*（本次） | P |
| `de_hetzer` | Jagdpanzer 38(t) Hetzer | 預設卡 | 程序模型 | T* | P |
| `de_hetzer_flak` | Hetzer 2 cm FlaK | 家族變體 | 程序模型 | T* | P |
| `de_rso_flak` | RSO 2 cm FlaK 38 | 預設卡 | 程序模型 | T* | P |
| `de_rso_pak40` | RSO PaK 40 | 家族變體 | 程序模型 | T*（本次） | P |
| `de_gepard` | Flakpanzer Gepard | 預設卡 | 含導入件 | P | P |
| `uk_cmp_portee` | CMP 6-pdr Portee | 預設卡 | 程序模型 | T* | P |
| `de_aufkl_panther` | Aufklärungspanzer Panther | 家族變體 | 含導入件 | P | P |
| `de_vk1602` | VK 16.02 Leopard | 預設卡 | 含導入件 | P | P |
| `de_hetzer_mk103` | Hetzer 3 cm MK 103 | 家族變體 | 含導入件 | P | P |
| `de_hetzer_mk103_camo` | Hetzer 3 cm MK 103（三色迷彩） | 家族變體 | 含導入件 | P | P |
| `de_sdkfz140_1` | Sd.Kfz. 140/1 Aufklärungspanzer 38(t) | 預設卡 | 含導入件 | P | P |
| `de_hetzer_sdkfz1401` | Hetzer · Sd.Kfz.140/1 炮塔（假想改裝） | 家族變體 | 含導入件 | P | P |
| `xp_bmp_k64` | BMP-K-64 | 預設卡 | 含導入件 | P | P |
| `ru_pantsir_sm_sv` | Pantsir-S1（SM-SV） | 預設卡 | 含導入件 | L | L |
| `xp_bmp_k64_atgm` | BMP-K-64 ATGM（9M113） | 家族變體 | 含導入件 | P | P |
| `xp_bmp_k64_kornet` | BMP-K-64 ATGM 套件（9M133） | 家族變體 | 含導入件 | P | P |
| `su_att_m46` | AT-T 130 mm 自走炮（M-46） | 預設卡 | 含導入件 | P | P |
| `proto_a` | Prototype A (original design) | 預設卡 | 程序模型 | P | P |

## 仍未完成的明確項

`us_m901_itv` 的診斷 manifest 有 74,115 個三角形，全部仍是 `audit_pending`，沒有 reviewed binding index／constructor policy，也沒有受 accepted anatomy／targetRegistrationHash 約束的逐面裝甲宣告。現有 `track_l`、`track_r` 等模組存在，不能據此自動補出外殼抗性。`ad_chaparral` 直接沿用這個底盤，沒有獨立精確包，也不是 M730 車體。

`proto_a` 的 70,583 個診斷三角形也全部是 `audit_pending`。來源明列 `incomplete_unadmitted`、faceRules 為空；手填裝甲和假想車體／炮塔沒有受審核的對應，且缺 `track_l`／`track_r` 解剖模組，wheelIds 是 `[null,null]`。本次沒有拿最近平面或統一厚度填補。

GLB／導入件車型、工坊 `custom`、保存的 `design:<id>`、Pantsir 以外的原生車輛，以及飛機仍不能一概稱為模型完全貼合。飛機原生命中是已准入的蒙皮／部件盒；26 款模型升級不會自動把權威碰撞改成可見三角面，裝甲倍率也不是毫米厚度。

Pantsir 恢復的是原站 11 個裝甲批次、22,206 個三角形。其厚度來源本來就標為暫定遊戲估算；模組／乘員仍不是本次新增的完整網格權威。完整逐列數據、原包／候選雜湊、未分類宣告和來源見同名 JSON 及 `docs/provenance-recovery-20261026/`。
