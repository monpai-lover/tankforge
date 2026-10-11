# 車輛真實轉向方式：研究與修正方案

2026-10-11。TankForge 基線 `4057976`；研究分支
`codex/historical-track-steering`。本文件記錄已完成的來源核對、實際錯誤重現
及待確認的修正設計，**尚未修改或驗收新的轉向運行邏輯**。

使用者要求：不具雙履帶反向原地轉向能力的坦克須按真實傳動設定；支援單側制動
的車，緊轉時應一側履帶停止、另一側行駛。休閒與歷史玩法均遵守機械能力。

## 必須區分的三種動作

1. **雙履帶反轉／中性轉向**：左右履帶等速反向，理想無滑移下車體中心不前進。
2. **單履帶制動緊轉**：內側履帶停止，外側行駛；車體中心仍有位移，繞停止側轉彎。
3. **固定半徑差速轉向**：內側減速、外側加速或維持速度，兩側同向；不能一概
   當作能停住一側，更不能當作雙履帶反轉。

對實際兩履帶中心距 `b`，理想無滑移的單履帶制動轉彎為：內側速度0、外側速度v，
車體中心速度v/2、中心轉彎半徑b/2、角速度v/b。地面滑移會改變實際路徑。
手冊中的外履帶半徑、車體外緣半徑及實測數字不能直接填入「車體中心半徑」。

## 現有問題已重現

`sim/physics.js::makeParams` 和 Rust `VehicleParams::from_vehicle` 把
`min_turn_radius_m=0` 當作中性轉向。完整履帶模型的 `driveStep` 再生成一正一負
的左右履帶目標；獨立的差速力馬達能主動維持兩側反向。

從實際資料建立驅動器，輸入 `throttle=0, steer=1, brake=0`，並在平地先停穩1秒、
再轉向1.5秒，得到以下實際結果。速度單位m/s；左右欄是目標速度。

| 車輛 | 左目標 | 右目標 | 左／右轉向制動力 | 問題 |
|---|---:|---:|---:|---|
| Hetzer | +0.5571 | −0.5571 | 0／0 | 實際兩履帶反向；不符合制動緊轉 |
| T-54 | +0.6573 | −0.6573 | 0／0 | 實際兩履帶反向；不符合PMP停止側輸出 |
| IS-2 | +0.4259 | −0.4259 | 0／0 | 把行星減速／停止側輸出當成反轉 |
| T-10M | +0.5376 | −0.5376 | 0／0 | 回收制動轉矩不代表履帶可反向旋轉 |
| M901 | +0.7536 | −0.7536 | 0／0 | TX100底盤的緊轉應制動一側 |
| T-34-85 | +2.6545 | +1.3455 | 0／0 | 雖未反轉，滿轉向也沒有停止內側履帶 |
| M4A3(75)W | +2.2327 | +1.7673 | 0／0 | 兩側同向符合機構類型；應保留此例外 |
| Tiger I | +0.4948 | −0.4948 | 0／0 | 有真實反轉能力，應保留 |

這是實際JS驅動及接地物理的結果，不是只比對描述欄，也不是畫面驗收。

## 全車分類

目前43款中有35款履帶車、8款輪式車。下表涵蓋所有履帶ID。
建議修正21款可單履帶制動的車；保留5款有中性轉向依據的車及5款M4/M10差速車。
3款資料不足的設計／車型列未確認並保留原配置；原創Prototype A保留作者設定。

| 類別 | ID／家族 | 結論與證據範圍 |
|---|---|---|
| 單側制動 | `de_pz3_j`, `de_pz4_h`, `de_pzjg1` | 政府資料描述離合／制動或行星離合制動；停止單侧的結論含機械推論 |
| 單側制動 | `de_flakpz38t`, `de_hetzer`, `de_hetzer_flak`, `de_hetzer_mk103`, `de_hetzer_mk103_camo`, `de_sdkfz140_1`, `de_hetzer_sdkfz1401` | 38(t)／Hetzer機構；改裝與偵察／防空型從底盤繼承，未宣稱逐改裝型有駕駛手冊 |
| 單側制動 | `de_rso_flak`, `de_rso_pak40` | RSO液壓制動與後差速器；炮組改裝不改底盤機構 |
| 單側制動 | `su_t34_1940`, `su_t34_85`, `su_bmpt34` | T-34手冊：離合分離及制動，緊轉用一檔 |
| 單側制動 | `su_is2` | 兩階PMP；第一階1.35减速，第二階停止內側 |
| 單側制動 | `su_t54` | 兩階PMP；第一階1.42減速，第二階停止內側 |
| 單側制動 | `su_t10m`, `su_t10m_oplot23` | ZK回收式差速／倍增機構另有停止制動；無中心反轉。低檔緊轉限制見下文 |
| 單側制動 | `su_att_m46` | AT-T兩階1.42減速／停止側輸出；M-46改裝繼承底盤 |
| 單側制動 | `us_m901_itv` | 本項目TX100原／A1/A2類底盤另有pivot brake，不能套M113A3資料 |
| 雙履帶反轉 | `de_tiger_e` | 中性檔仍有獨立轉向動力；英軍實測報告 |
| 雙履帶反轉 | `de_panther_g`, `de_panther_f` | Panther時期報告；F按同型傳動推定，不宣稱完成實裝測試 |
| 雙履帶反轉 | `uk_cromwell_iv` | War Office操作說明明載空檔、離合接合時可轉向 |
| 雙履帶反轉 | `de_gepard` | 現代Leopard 1底盤；製造商4HP250資料與政府Leopard同族中性轉向資料，屬共同傳動推定 |
| 固定半徑差速 | `us_m10`, `us_m4a2`, `us_m4a3_75w`, `us_m4a1_76w`, `us_m4a3_76w_hvss` | Cletrac控制差速器的制動鼓停止不等於履帶停止；兩側仍同向 |
| 未確認、保留 | `us_m56` | 確認CD-150-4，但未取得足以判定反轉／單側制動的原始操作段落 |
| 未確認、保留 | `de_vk1602`, `de_aufkl_panther` | 未確認設計專屬傳動；不能僅憑Panther外形宣稱能力 |
| 原創設定 | `proto_a` | 虛構作者設計，保留既有中性轉向設定 |

輪式Puma、M8、兩款輪式試驗車、CMP及三款BMP-K64不套履帶能力。BMP-K64的
裝甲來源與T-64底盤關聯，不代表目前八輪模型可以按履帶反轉規則驅動。

## 原始資料與操作限制

T-34手冊要求停止側緊轉用一檔；IS-2准許低速範圍四檔、加速範圍第一檔及倒檔。
T-10M緊轉限一／二檔；三檔大角度緊轉僅限硬地，停止制動的行進轉向限一至四檔。
初版採可證明的保守檔位範圍，不把缺少地表確認的三檔特例當成普遍許可。
T-54與AT-T未核實完整檔位限制，不臆造額外歷史數字。

建議保留遊戲既有自動駕駛：停車只按A/D時，自動用低檔及小油門驅動外側履帶；
支援制動緊轉的車會走短弧，車體中心有位移。W/S+A/D也保留；倒車時交換停止側，
仍讓D控制向右的車體轉向。這是遊戲操作映射，不是要求玩家手動操縱歷史離合器。

## 建議接入

採用獨立、JS與Rust共用的轉向能力配置，不能再由最小半徑單獨推定能否反轉。
車身、原始發動機／裝甲／武器與GLB／packed模型保持原字節。工坊自訂車透過
明確、可驗證的底盤轉向欄位繼承能力，換炮塔不能恢復錯誤的中性轉向。

制動緊轉必須改驅動／接地求解：對停止側解除主動驅動、施加有上限的制動；
外側使用原發動機扭矩、功率及離合接合上限。差速／行星耦合使用被動約束，
不能繼續用獨立動力差速馬達替不支援的車提供反向推進。履帶速度和行程由求解器
產生，畫面跟隨實際行程；不能直接修改車體角度或每步把履帶速度硬設為0。

三種方案比較：只改能力標記最快，但解決不了真實停止側驅動；推薦的分型傳動與
有限制動修正能處理本次問題；完整逐齒輪／選檔／制動熱模型成本大，留作後續。
詳細邊界与驗收見[設計文件](superpowers/specs/2026-10-11-historical-track-steering-design.md)。

## 來源

- Hetzer修復車駕駛者／手冊比對：[Richard Gruetzner駕駛實錄](https://www.pzfahrer.net/driving.html)。
- 38(t)捕獲車檢查報告轉錄：[British Marder III steering report](https://www.thearmorylife.com/german-marder-iii-tank-destroyer/)。
- Pz.III：[Chief of Ordnance原始目錄轉錄](https://www.lonesentry.com/ordnance/2010/09/12/pz-kpfw-iii-aus-j-k-sd-kfz-141-medium-tanks/)；Pz.IV：[TM-E 30-451 Chapter VII](https://www.ibiblio.org/hyperwar/Germany/HB/HB-7.html)。
- PzJg I：[政府目錄轉錄](https://www.lonesentry.com/ordnance/2010/08/29/panzerjager-i/)；RSO：[同目錄Steyr RSO/01](https://www.lonesentry.com/ordnance/2010/03/14/raupenschlepper-ost-steyr-typ-rso01-full-track-light-prime-mover/)。
- T-34：[1944手冊轉向操作](https://wio.ru/tank/manual/t34manual9-5.htm)、[側離合與制動](https://wio.ru/tank/manual/t34manual5-3.htm)。
- IS-2：[1944重型坦克手冊，pp.237–240、395–398](https://ru.djvu.online/file/lZLK4DGcaEjWT)。
- T-54：[1962結構與操作手冊，pp.245、258–262](https://djvu.online/file/Sv97oUruImEyM)。
- T-10M：[1960手冊，pp.282–287、500–501](https://ru.djvu.online/file/GFgGvD6vJZszC)。
- AT-T：[國防部1967批准／1968出版手冊，pp.8、153、155](https://www.military-references.com/wp-content/uploads/books/tracked_vehicles/ussr/at-t/%D0%90%D0%A2-%D0%A2_%D0%A0%D1%83%D0%BA%D0%BE%D0%B2%D0%BE%D0%B4%D1%81%D1%82%D0%B2%D0%BE_%D0%BF%D0%BE_%D1%8D%D0%BA%D1%81%D0%BF%D0%BB%D1%83%D0%B0%D1%82%D0%B0%D1%86%D0%B8%D0%B8_1967.pdf)。完整PDF過大，核對的是索引取得的原始手冊OCR段落。
- M4：[TM9-1750 §5d,p.6](https://www.theshermantank.com/wp-content/uploads/2015/12/TM_9-1750_Power_Train_Unit_Three-Piece_Differential_Case_for_Medium_Tanks_M3_M4_and_Modifications_1942.pdf)；M10A1：[TM9-731G §120,pp.177–178](https://radionerds.com/images/1/18/TM_9-731G_M10A1.pdf)。
- M113A2／M901A1：[TM9-2350-261-10 WP0003,操作原理頁97](https://www.nsnlookup.com/equipment-intelligence/land/m113/technical-manual/tm-9-2350-261-10/97)。研究者取得該頁內容；Root另行打開時回403，不聲稱再次完整取得。
- Tiger：[英軍S.T.T. Preliminary Report19](https://www.military-references.com/wp-content/uploads/books/tanks/germany/panzer_vi_tiger_ausf_h1/Preliminary_Report_No_19_Pz_Kw_VI_Tiger_1943.pdf)。
- Panther：[含1945美軍／1946英軍原始報告摘錄的重刊](https://pdfcoffee.com/panther-panzer-tanks-pdf-free.html)，原報告未獨立完整取得。
- Cromwell：[War Office／Tank Museum操作手冊重刊](https://www.scribd.com/document/335915287/Cromwell-Tank)、[Tank Museum](https://tankmuseum.org/tank-nuts/tank-collection/cromwell/)。
- Gepard／Leopard傳動：[MTU製造商資料](https://www.mtu-solutions.com/lasa/en/pressreleases/2024/rolls-royce-and-ffg-are-working-on-a-concept-for-the-repowering-of-wisent-1-and-the-leopard-1-vehicle-family.html)、[加拿大國防部The Maple Leaf,2007-01-31,p.10](https://publications.gc.ca/collections/Collection/D12-7-10-4.pdf)。
- M56未確認項：[引用手冊的CD-150-4硬體紀錄](https://afvdatabase.com/usa/pics/m56spat/m56spat.html)。
