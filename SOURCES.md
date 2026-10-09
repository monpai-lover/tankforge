# 歷史戰車資料來源與可信度

`data/vehicles/` 同時包含程序幾何與直接導入的模型。程序幾何由 `tools/gen_vehicles.py` 依公開尺寸建立
(稜柱、平面擠出、方塊、圓柱)；直接導入的車輛、乘員與其他第三方素材及修改紀錄見後文，不應將整份車庫統稱為原創程序幾何。炮彈穿深由 De Marre 公式依彈重、
初速、口徑估算,不取自任何遊戲。

## 已對照來源的數值

| 車輛 | 已對照 | 來源 |
|---|---|---|
| Tiger I (Ausf. E) | 車體長 6.316 m、含炮 8.45 m、寬 3.56 m、高 3.00 m、離地 0.47 m、57 t、700 PS、履帶寬 725 mm、接地長 3.605 m、路輪徑 800 mm、車體裝甲 100/80/60/25 mm、炮塔 100/80 mm、炮盾 120 mm、TZF 9b 2.5×（視野 23°）、8 前進檔(最低 2.8、最高 45.4 km/h)、Pzgr. 39 10.2 kg / 773 m/s | Wikipedia「Tiger I」「8.8 cm KwK 36」;alanhamby.com 技術資料;Tank Encyclopedia |
| T-34-85 | 寬 3.00 m、含炮 8.15 m、32 t、500 hp、離地 0.4 m、車體 45 mm@60°、炮塔 90/75/52 mm、俯仰 −5°/+20°、TSh-16 4×/16°、履帶寬約 0.5 m、每側 5 路輪、85 mm 9.2 kg / 792 m/s | Wikipedia「T-34」「85 mm air defense gun M1939」;Tank Encyclopedia |
| M4A3(76)W HVSS | 車長 247 in、寬 118 in、高 117 in、離地 17 in、74,200 lb、500 hp(gross)@2600、各檔齒比 7.56/3.11/1.78/1.11/0.73、末傳 2.84、主動輪節徑 25.038 in、23 in 履帶、裝甲各板厚度與角度、360° 迴轉 15 s、俯仰 −10°/+25°、M71D 5×/13°、M62 7.0 kg / 790 m/s | theshermantank.com 規格表與射控文章;Wikipedia「M4 Sherman」「76 mm gun M1」 |
| Cromwell Mk IV | 長 6.35 m、寬 2.908 m、高 2.49 m、離地 0.41 m、28 t、Meteor 600 hp、64 km/h、車體正面 64 mm、炮塔正面 76 mm、履帶 14/15.5 in、5 檔 Merritt-Brown、每側 5 路輪、75 mm 6.8 kg / 610 m/s | Wikipedia「Cromwell tank」「Ordnance QF 75 mm」 |

| M10 GMC | 65,200 lb(29.6 t)、車體長 5.97 m、含炮 6.83 m、寬 3.05 m、GM 6046 375 hp@2100、5 前 1 倒同步變速箱、VVSS、公路 40–48 km/h、首上 38 mm、車體側後 19 mm、炮塔側後 25 mm、炮盾 57 mm、3 吋 M7、車頂 M2HB、手搖迴轉一圈約 80 秒、乘員 5 | Wikipedia「M10 tank destroyer」 |
| M4A3(75)W | 75 mm M3:40 倍徑(3 m)、M61 6.63 kg / 618 m/s;Ford GAA、5 前 1 倒、VVSS、寬 2.62 m、炮塔正面 76 mm、車體側 38 mm;M2HB 與 M1919A4 | Wikipedia「M4 Sherman」「75 mm gun M2–M6」;車體與炮塔輪廓見「外形圖面」 |
| Pz.Kpfw. IV Ausf. H | 25.0 t、車體長 5.92 m、含炮 7.02 m、寬 2.88 m、高 2.68 m、車體正面 80 / 側 30 / 後 20 mm、炮塔正面 50 / 側後 30 mm、側裙 5–8 mm、KwK 40 L/48、2× MG 34、HL 120 TRM 300 PS、6 前 1 倒、板簧懸吊、38–42 km/h | Wikipedia「Panzer IV」 |
| Pz.Kpfw. III Ausf. J | 寬約 2.9 m、高 2.5 m、乘員 5、Ausf. J 起 50 mm 裝甲、5 cm KwK 39、HL 120 TRM 300 PS、扭力桿每側 6 輪、公路 40 km/h | Wikipedia「Panzer III」 |
| Panther Ausf. G | 44.8 t、車體長 6.87 m、含炮 8.66 m、寬 3.27 m(含側裙 3.42)、高 2.99 m、首上 80 mm@55°、側 40–50 mm、炮盾 100 mm、KwK 42 L/70、2× MG 34、HL 230 P30 700 PS@3000、AK 7-200(7 前 1 倒)、55 km/h(後期限速 46)、乘員 5 | Wikipedia「Panther tank」 |
| IS-2 (1944) | 46 t、含炮 9.90 m、寬 3.09 m、高 2.73 m、乘員 4、首上 100 mm@60°、首下 100 mm@30°、車體側 90 mm 起、炮塔正面 100 / 炮盾 120 / 側 90 mm@20°、D-25T、射速 2–3 發/分、DShK + DT、V-2-IS 520 PS、扭力桿、37 km/h | Wikipedia「IS-2」 |
| T-54 (1951) | 36 t、含炮 9.00 m、高 2.40 m、離地 0.425 m、乘員 4、首上 100 mm@60°(1949 年後)、車體側 79 mm、炮塔正面 205 / 側 130 / 後 60 mm、D-10T、SGMT 同軸、DShK、5 前 1 倒、約 50 km/h | Wikipedia「T-54/T-55」(該頁資訊框以 T-55 為主) |

## 估計值(未找到可靠來源,或為了模型而推算)

- 所有車輛:車內模組與乘員位置、車體/炮塔的簡化外形、炮耳軸與炮塔環中心位置、扭矩曲線形狀、炮塔俯仰速率。
- Tiger I:炮塔環直徑;中間各檔車速為記憶值(僅最低/最高檔對照過),齒比由各檔車速反推;炮塔迴轉取 9°/s(史料為 360° 需 25–60 秒,依引擎轉速)。
- T-34-85:車體長 6.10 m(常見引用值,查到的來源彼此不一致)、齒比(依極速反推)、炮塔迴轉速率、車體高度。
- M4A3(76)W HVSS:含炮全長 7.54 m(記憶值);`final_drive_ratio` 10.03 = 錐齒輪 3.53 × 末傳 2.84(3.53 為記憶值,未對照);車內佈置。
- Cromwell Mk IV:車體側/後、炮塔側/後裝甲,炮塔迴轉速率,瞄準鏡型號與倍率,齒比。
- 新增七台車共同的估計項目:車體高度與各板的折點位置、炮塔平面形狀、炮耳軸位置、路輪/主動輪/誘導輪的座標(M4 系列除外,那是描圖)、履帶節距與厚度、
  懸吊行程、扭矩曲線、俯仰與(多數)迴轉速率、瞄準鏡視野、車內模組與乘員位置。這些是憑記憶中的常見數值與比例填的,**沒有逐項對照來源**。
- 各車另外要注意:
  - M10:炮的俯仰極限(−10°/+30°)、`final_drive_ratio`(依 48 km/h 反推)、炮塔壁內收角度。
  - M4A3(75)W:戰鬥全重 31.6 t、接地長、M70F 倍率與視野、炮塔側後 51 mm 是記憶值。
  - Pz.III J:車體長 5.52 m(Wikipedia 的 5.56 m 未指明型號)、全重 21.5 t、含炮全長 6.28 m、Pzgr. 39 2.06 kg / 835 m/s、手搖迴轉速率、齒比(依極速反推)。
  - Pz.IV H:KwK 40 L/48 初速 790 m/s、電動迴轉 14°/s、俯仰 −8°/+20°、齒比(依極速反推)、行走機構座標。
  - Panther G:AK 7-200 各檔齒比(記憶值,未對照)、`final_drive_ratio`(含轉向機,依 55 km/h 反推)、Pzgr. 39/42 935 m/s、迴轉取 15°/s(史料隨引擎轉速 19–36°/s)、
    TZF 12a 兩段倍率與視野;車體側面只用一塊 50 mm@30° 代表(下側 40 mm 垂直板未建)。
  - IS-2:車體長 6.77 m、BR-471 取 795 m/s(Wikipedia 寫 800)、齒比、迴轉/俯仰速率、TSh-17 倍率;炮塔各板是平板近似。
  - T-54:車寬用 3.27 m(Wikipedia 資訊框是 T-55 的 3.37 m)、車體長 6.04 m、V-54 520 hp、BR-412B 15.88 kg / 895 m/s、各檔齒比、TSh-2-22（T-54-3 即 1951 年型：3.5×/7×）、俯仰 −5°/+18°;炮塔是平板近似圓頂。
- 炮彈穿深:De Marre 估算(每種彈各有一個係數,落在已發表射表數值的範圍內),空氣阻力係數統一取 0.4。

每台車的 `vehicle.json` → `meta.notes` 也記了該車的估計項目。要修正任何數值,改 `tools/gen_vehicles.py` 的規格後重跑即可。

## 瞄準鏡

倍率與視野取自歷史光學(戰爭雷霆同樣以歷史瞄準鏡為準);刻度配置參考戰爭雷霆瞄準鏡的**功能**:
橫向千分位(密位)刻度,加上依所裝炮彈彈道計算的距離刻度(每 200 m 一格,數字以百公尺為單位)。
刻度的畫法與外觀是自行設計的。

## 地面力學與懸吊

- Bekker 壓力—沉陷與壓實阻力、Janosi–Hanamoto 剪切位移公式:M. G. Bekker, *Theory of Land Locomotion* (1956);J. Y. Wong, *Theory of Ground Vehicles*(第 2 章)。
- `terrains.json` 的 `soil` 數值取自 Wong 書中常被引用的土壤參數表(乾沙、砂質壤土、黏質土、雪)。**這些是憑記憶填入的典型值,尚未逐項對照原書**,用途是讓不同接地壓力的車有合理的相對差異,不是地質資料。
- 懸吊固有頻率(1.35 Hz)與阻尼比(0.34)是估計值。

## 渲染

- 大氣散射:Nishita et al., "Display of the Earth Taking into Account Atmospheric Scattering" (SIGGRAPH 1993);Bruneton & Neyret, "Precomputed Atmospheric Scattering" (2008) 的常數(Rayleigh 5.5/13.0/22.4 ×10⁻⁶ m⁻¹、Mie 21×10⁻⁶ m⁻¹、標高 8 km / 1.2 km)。實作是自己寫的單次散射步進。
- 體積雲:Schneider & Vos, "The Real-time Volumetric Cloudscapes of Horizon Zero Dawn" (SIGGRAPH 2015 course) 的做法(Perlin-Worley 噪聲、高度剖面、往光源步進、Beer 衰減)。噪聲與著色器是自己寫的。
- 色調曲線:Stephen Hill 的 ACES 擬合(BakingLab,MIT 授權)。
- 無 UV 凹凸貼圖:Mikkelsen, "Bump Mapping Unparametrized Surfaces on the GPU" (2010)。

## 音效

- 遊戲內建的是合成音。`client/web/assets/sfx/` 放入同名檔案即可換成錄音(槽位與建議來源見該資料夾的 README;建議用 CC0 素材,例如 Freesound 的 CC0 條目、Kenney 的音效包)。開發環境無法下載外部檔案,所以沒有附任何錄音。

## 機槍

- 已對照:MG 34 循環射速 800–900 發/分、初速 765 m/s(表內用 755,重尖彈)、操典限制連續射擊 250 發(對應 `heat_rounds`);M2HB 450–600 發/分、890 m/s、
  穿甲彈 100 碼穿 22.2 mm(Wikipedia「MG 34」「M2 Browning」)。
- 記憶值、未對照:DT(600 發/分、840 m/s、63 發彈盤)、SGMT、DShK、M1919A4、Besa 的射速/初速/彈頭重/彈鏈長度,所有型號的換彈時間、散布、阻力係數、100 m 穿深(M2HB 除外)。
- `cool_s`(槍管冷卻時間)是估計值;`tracer_every` 比實際彈鏈密(步機槍口徑每 3 發、重機槍每 2 發一發曳光),為的是看得清彈道;曳光顏色只為了辨識。

## 外形圖面

- 虎式(`de_tiger_e`)的外形是照使用者提供的四視線圖量取比例後重描的:以全長 8.45 m、車體長 6.316 m、輪軸間距約 0.516 m、火線高 2.195 m 校正比例。圖面本身沒有收進專案,只用了量出來的尺寸。
- M4A3(75)W(`us_m4a3_75w`)照使用者提供的兩張 M4A3(75 mm)四視圖重描:側視圖以圖上的英尺比例尺換算為 90.35 px/m,量出首上與車首鑄件的折點、
  機艙蓋斜度、六個路輪與三組台車的位置、主動輪/誘導輪/托帶輪的中心、炮塔座圈與炮耳軸高度、炮管長度;炮塔平面照俯視圖量半寬(依正視圖的 2.2 m 總寬修正)。
  M4A3(76)W HVSS 與 M10 共用這個下車體。(上一輪曾把這兩張圖誤認為 M36 與 M10,實際量測後確認都是 M4A3。)
- 開發環境拿不到網路上的圖片像素(搜尋只會把圖顯示給使用者),其他車輛要照圖重建時需要把圖檔上傳。

## 穩定器與懸吊

- M4A3(75)W 與 M4A3(76)W 裝有 Westinghouse 垂直陀螺穩定器(只穩俯仰),其餘歷史車輛都沒有火炮穩定器(Wikipedia「M4 Sherman」「Gun stabilizer」)。
  T-54 的 STP-1 垂直穩定器要到 T-54A(1955)才有,資料中的 1951 年型沒有。
- 懸吊型式:Tiger I / Panther 交錯負重輪扭桿、Pz.III / IS-2 / T-54 扭桿、Pz.IV 板簧台車、T-34-85 / Cromwell 克里斯蒂、M4A3(75)W / M10 VVSS、M4A3(76)W HVSS。
- `physics.suspension.stiffness` / `damping` 是**每個負重輪站**的彈簧率與阻尼,為估計值;換算出的車體自然頻率約 1.4–2.0 Hz、阻尼比 0.33–0.44,落在履帶車輛常見範圍。
  回彈行程取 `min(靜態壓縮量, 0.45 × 行程)`;履帶跨越角、誘導輪段接觸剛度、阻尼功率換算成阻力等都是遊戲模型的近似。
- 炮手手動修正的反應時間(0.4–0.45 s)與穩定器伺服速率(垂直 30°/s、雙向 40°/s)是估計值。

## 第三方素材

- **乘員人形**(`client/web/assets/crew_model.json`):由 *CesiumMan* 轉製 —— © 2017 Cesium,
  [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/),
  取自 KhronosGroup/glTF-Sample-Assets(`Models/CesiumMan/glTF-Binary/CesiumMan.glb`)。
  變更:以 `client/web/tools/crew-prep.py` 在 CPU 上做蒙皮擺姿(坐姿、裝填手站姿)、頭部縮到正常比例、移除原貼圖(含 Cesium 標誌)、
  依部位重新上色(制服顏色依角色,對照使用者提供的車組佈置藍圖)。Cesium 商標不隨本專案授權。
- **彈種圖示**(`client/web/assets/ui/shell_icons.png`):從使用者提供的「主炮系統藍圖」中的炮彈類型圖裁切、去背。
- **炮閂與搖架模型**(`gfx/interior.js` 的 `breechGeometry`):依同一張藍圖的炮閂結構剖面圖與側視圖原創建模(未使用圖檔本身)。

## 本輪補充

- **瞄準鏡倍率**(全部依歷史裝備):Tiger I TZF 9b 雙筒 2.5×、視野 23°(後期 TZF 9c 才有 2.5×/5×);Panther G TZF 12a 2.5×/5×(28°/14°);
  Pz.III J TZF 5e、Pz.IV H TZF 5f 2.5×/25°;T-34-85 TSh-16、IS-2 TSh-17 4×/16°;T-54 1951 年型(T-54-3)TSh-2-22 3.5×/7×(18°/9°);
  M4A3(75)W M70F、M10 M70G 3×/12°20′;M4A3(76)W HVSS M71D 5×/13°;Cromwell IV No. 50 ×3 L。來源:panzerworld.com German Armor Optics、
  tigertank181.com、Tank Encyclopedia、Tankograd(T-54)、Wikipedia「T-54/T-55」。
- **彈種與攜彈量**(`tools/gen_vehicles.py: SHELLS / AMMO`):各炮的穿甲彈、高爆彈、鎢芯彈(APCR/HVAP)與早期 HEAT,
  彈重、初速、炸藥量用公開的服役數據;動能彈的 0 m 穿深取射表值,再以 De Marre 公式與空氣阻力算出各距離的穿深;HE 穿深 ≈ 14 mm × √(炸藥 kg)。
  攜彈量為各車的總攜彈數,AP/HE 比例依當時配發(約各半,鎢芯彈少量)。
- **海岸河口地圖**:使用者手繪的 10 × 10 方格地圖(`data/maps/coast/drawing.png`),由 `tools/map-prep.py` 轉成地面類型、高度與出發點。
- **使用者上傳的 GLB 模型**(英國炮兵軍官、法國炮手乘員,義大利 Pz.IV G、M56 Scorpion):Sketchfab 上由 KojfDiscord 以 CC-BY-4.0 標示發布,
  標題註明是《戰爭雷霆》的模型。本版**沒有放進遊戲**(見 ARCHITECTURE §25.9);若之後使用,需保留作者署名,且其原始著作權可能屬於 Gaijin,不宜公開散布。

## 參考模型量測(本輪)

- 使用者上傳的參考模型(《戰爭雷霆》Sketchfab 轉檔:T-54 1951、T-34-85、T-10M、M4A2、M4A1(76)W、Flakpanzer 38、Panzerjäger I、
  Jagdpanzer 38(t) Hetzer;Enlisted 的 DShK;M8 Greyhound)**只用來量尺寸,沒有放進遊戲**:以 scratchpad 的切片工具
  沿 x/y/z 平面切開,讀出車體高度、首上與尾板角度、輪位,以及鑄造炮塔每 10° 一點的半徑(六到九個高度),
  再由 `tools/gen_vehicles.py` 的 `polar_ring()` / `loft()` 以我們自己的參數化幾何重建
  (`T54_POLAR`、`T3485_POLAR`、`T10M_POLAR`、`M4_75_POLAR`、`M4_T23_POLAR`)。
- T-34-85 的車體原本取自 BMPT-34 模組(其首上航向機槍位置被改成艙蓋、觀瞄設備懸空),本輪改為依參考模型量測重建的程序化車體,
  帶回 DT 航向機槍球座;`model.json` 不再使用。
- 2 cm FlaK 38(`flak38_parts()`)、DShK 與 M2HB(`client/web/src/gfx/mgmodel.js`)依參考模型量出的比例原創建模,
  同一武器在所有車上共用。
- 35 mm 試驗車的炮只保留 Gepard 模型(Scout,CC-BY-4.0)的炮管與炮罩前端(`tools/glb_parts.py` 的 `keep_above`),置於炮塔正前方。
- 新車:CMP 6 磅炮 portee(以 C60L 158 吋軸距定比例)、RSO 2 cm FlaK 38 與 RSO PaK 40(圖上 3 m 比例尺,362 px/m)、
  Aufklärungspanzer Panther(Panther 車體 + 依圖比例的小炮塔與 5 cm KwK 39/1)。6 磅炮彈:Shot Mk.7 AP 2.86 kg 853 m/s、
  Mk.9T APCBC 3.23 kg 831 m/s、Mk.10T HE;0 m 穿深取約 103/100 mm(估計)。

## 本輪補充(二)

- **使用者自製的模型,直接使用、不改幾何**(只依檔內 glTF 材質參數修正粗糙度/金屬度):`VK1602_Leopard_v1_1.glb`、
  `flak38t-urban-gray.glb`、`flak38t-reconstruction-v2.glb`(3 cm 追獵者防空的迷彩塗裝)、`BMP_K_64.glb` 與 `BMP_K_64_ATGM.glb`
  (兩個版本;`41334067-BMP_K_64_ATGM.glb` 做成改裝件的 9M133 發射架套件)、`AT_T_M46_130mm_PhotoReplica.glb`(AT-T 拖拉機與 M-46 130 mm 炮)。
  以 `client/web/tools/glb-vehicle.py` 只切出會動的部件(炮塔、炮、炮管、車輪)。
- **機槍模型**:DShK、M2HB、KPVT 依使用者明確同意,由其提供的參考模型減面後直接使用(`client/web/assets/mg_models.json`,
  `tools/mg_asset.py`);上一節「原創建模」的 DShK / M2HB 已由這些取代。
- **依參考模型新增的車**(參考模型只用來量斷面與站位,遊戲內幾何全為 `tools/gen_vehicles.py` 的參數化重建):
  - T-34 (1940):焊接炮塔八個斷面、炮塔座圈中心(z 0.68,使炮塔後懸能越過升高的引擎甲板)、L-11 炮盾與駐退機護套;車體沿用 T-34-85 的量測車體。
    L-11:76.2 mm L/30.5,BR-350A 6.3 kg、612 m/s(0 m 穿深取約 70 mm,估計)、OF-350 6.2 kg。車長兼炮手(crew.json `also`)。
  - M4A1(76)W:鑄造上車體十三個斷面(超橢圓圓角,`M4A1_CAST`)、T23 炮塔(與 HVSS 共用 `t23_turret()`)、VVSS;
    Continental R975-C4 星型 400 hp。炮口位置依參考量得 z 3.94。
  - M4A2:焊接車體本來就是依 M4A2 參考量測;加上參考上的首上與側面備用履帶、後部排氣導流板;GM 6046 雙柴油 410 hp。
  - Flakpanzer Gepard:見下節(改為依使用者要求一比一直接使用該模型)。
    MTU MB 838 CaM-500 830 hp、47.3 t;兩門 KDA 35 mm 各 550 發/分,每門 HEI 320 + APDS 20(主炮 + `extra_guns`)。雷達只顯示不模擬。
- **浮空/穿模檢查**(`client/web/tools/fitcheck.mjs`):以遊戲自己的 `addPart` 產生三角面,檢查每組(車體、各炮塔)的連通性,
  並讓炮塔與炮在全迴轉、水平與最大俯角下掃過車體;匯入模型的表面只作為「可以靠上去的面」,不檢查作者自己的模型。
  炮在車尾方向碰到引擎甲板的車,依掃描結果寫入逐方位俯角表(`depression_by_bearing_deg`,每 10°)。
- **本地化**(`client/web/src/i18n.js`、`src/i18n/en.json`):依瀏覽器語言切換;英文詞表為本專案自行翻譯。
- **引擎排氣煙**(`src/game/exhaust.js`)、**乘員裝填/射擊動作**(`src/game/crewanim.js`,裝填週期等於實際裝填時間、彎腰幅度隨口徑,
  100 mm 以上分裝彈兩次取彈)、**改裝系統**(`src/game/mods.js`,同底盤車輛以改裝切換)皆為原創程式。

## 本輪補充(三)

- **Flakpanzer Gepard 外形**:**"Flakpanzer Gepard | High-Quality model" by Scout**(https://sketchfab.com/scout.),
  授權 [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/),來源
  https://sketchfab.com/3d-models/flakpanzer-gepard-high-quality-model-43746c9ec4a64f8d9a30db81b82843bd 。
  依使用者要求一比一使用其幾何:單位乘 0.024 換算到公開車寬 3.27 m;原檔材質只有佔位用的粉紫色,
  改為 RAL 6014 Gelboliv(炮略深、網罩深灰);右側負重輪與托帶輪(扭桿交錯)移到左右對稱的站位;履帶改用遊戲自己的。
  遊戲內數值(引擎、裝甲、炮)同上節。
- **使用者自製模型(直接使用、不改幾何)**:
  - `Oplot_MO_Vehicle_Module.glb`:T-10M 的奧普洛特-MO 模組(固定座、迴轉環與托架、俯仰的機匣與彈箱與感測器、旋轉的六管槍管);
    原本的程序化模組已移除。
  - `Hetzer_Flak_Interior_Refined.glb`:**只取內裝**(機匣閂與供彈、方向機齒輪箱與連桿、可調座椅與踏板、兩部無線電、
    彈架扣具與滅火器),加到 3 cm MK 103 追獵者(城市灰與三色迷彩兩款)上;車體外形仍是原本的 `flak38t-urban-gray.glb` /
    `flak38t-reconstruction-v2.glb`。
  - `Sdkfz1401_Material_Refined.glb`:新車 Sd.Kfz. 140/1 Aufklärungspanzer 38(t)(Hängelafette 38:2 cm KwK 38 + MG 42),
    含其內裝與材質;約 9.75 t、Praga AC 160 hp、42 km/h。
- **MG 34**:由使用者提供的追獵者參考模型減面(`client/web/assets/mg_models.json` 的 `mg34`),作為所有車頂 MG 34 的共用模型;
  追獵者的遙控機槍防盾改為隨機槍轉動。
- **DShK 修正**:參考模型中歪斜的彈箱扶正(繞槍管軸 13°,由主成分分析量得),環形防空瞄具改用較細的減面格以保留形狀。
- **BMP-K-64**:依使用者說明為 T-64 底盤改裝,車體裝甲改為 T-64A 的數值(首上 80 鋼 + 105 玻璃鋼 + 20 鋼、68°;側 80;後 45),
  動力 5TDF 700 hp,公路最高時速 60 km/h。

## 本輪補充(四):參考 Claude-of-Tanks(MIT 部分)升級畫面、載入與聯機

參考 **Claude of Tanks**(Copyright © 2026 Kevin B. Liu,MIT License;SOURCE-IMPORT.zip 即其 MIT 子集)的**做法**,
用本專案自己的架構重寫,沒有複製程式碼,也沒有使用其保留內容(`src/vehicles/**`、`src/world/**` 等專有內容不在參考範圍):

| 本專案 | 參考的 MIT 檔案(想法) |
|---|---|
| 軟粒子(讀場景深度,碰到地面/車體淡出)、煙的假法線受光與背光邊緣、火焰每張卡的柔和亮度上限 → `client/web/src/gfx/shaders.js: fxSoftFS`、`game/fx.js` | `src/fx/particles.ts` |
| 動態解析度(先降解析度、到底才降畫質檔;升回時越常反彈等越久)→ `client/web/src/gfx/renderscale.js` | `src/engine/renderScalePolicy.ts`、`adaptiveQualityPolicy.ts` |
| WebGL 裝置遺失可恢復、只有使用者按才重新載入 → `gfx/renderer.js: _restore`、`main.js` 的提示層 | `src/engine/contextRecovery.ts` |
| 延遲補償:依射手回報的往返時間與客戶端內插延遲回溯目標位置驗證命中 → `crates/server/src/lobby.rs: hit_plausible` | `server/match/lagCompensation.ts` |
| 關注分級:遠的玩家較少送 → `lobby.rs: interest` | `server/match/interestTiers.ts` |
| 斷線保留座位、以權杖重連 → `lobby.rs: resume / drop_link / sweep`、`game/net.js: _reconnect` | `server/match/seatToken.ts` |

MIT 授權條款要求保留版權聲明:

> Copyright (c) 2026 Kevin B. Liu — Permission is hereby granted, free of charge, to any person obtaining a copy of this
> software and associated documentation files (the "Software"), to deal in the Software without restriction … THE SOFTWARE IS
> PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.(全文見其 `LICENSE`)

## 2026-10-09 模型與火控修復的來源

- 新增 Hetzer · Sd.Kfz.140/1 炮塔為使用者核准的假想改裝，保留既有車型。來源 GLB 及原作者／CC-BY 等聲明見 `data/vehicles/de_hetzer_sdkfz1401/source/README.md`；沒有將整份模型改標為 MIT 或原創。主炮 25° 展示姿勢以實測铰軸歸零，槍口、輪組與新增首上裝甲按源網格校準。改裝重量、內裝及底盤性能仍為估計。
- BMP-K-64 共同底盤／Konkurs 原模型從使用者 HTML 的純文字 gzip/base64 內容恢復，GLB 原檔與雜湊保留在 `data/vehicles/xp_bmp_k64/source/`；未執行查看器腳本。KPVT 和 Kornet 的獨立原始 GLB 尚缺，其完整幾何取自工具鎖定的原 Git packed 模型。胎紋改按真正 Wheel 節點綁定；KPVT／Konkurs 實際展示仰角各為 15°／10°；舱蓋按原铰軸閉合。三款防護共用 T-64A 參數；205 mm 通用複合材料為近似，未實作逐層 80／105／20 mm 材料計算。
- 程序式 Hetzer 炮座法蘭及後格柵依本模型甲板面修復；防空車座椅按現有乘員胸部原點校正。FlakPz 38(t) 短尾管是對既有消音器的程序裝配補全，其朝向沒有實車照片量測認證。Hetzer、Hetzer Flak、FlakPz 38(t) 與新改裝版排氣點均有對應模型管口；其它使用引擎位置推算的出口仍屬近似，不能視為全車隊已實車核准。
- 雙管發射位置取自 M901 程序模型及 BMP 原管口，兩枚待發彈與同時導引為明確火控狀態。機關炮側向噴流與後座、HUD 縮放、機槍獨立選擇、數字鍵彈種選擇及漸接合傳動是本專案修復，未匯入 Claude of Tanks 專有素材。
- AT-T／M46 原始 Cab_Cut_Down 高護板與四塊床欄共六組來源鉸鏈，完整移動6,680個原三角面；原前铲具、架與鏈條2,636個三角面整體移至右前側水平收納。來源壓縮GLB、雜湊、實測射界與65階段避讓紀錄保留在 `tools/sources/` 和該車 `folding-source.json`。MK103兩塗裝同樣保留七組來源護板；沒有據這些自訂折板宣稱為歷史量產配置。

完整研究見 `docs/claude-of-tanks-research.md`；修復驗收、折板來源及已知限制見 `docs/vehicle-fixes-2026-10-09.md` 與各車的 `folding-source.json`。

