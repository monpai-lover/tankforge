# TankForge

```
cargo test --workspace                                  # 全部 Rust 單元測試
cargo run -p tg-tools --bin validate -- data            # 驗證 data/ 下所有材料、炮彈、機槍、地形、車輛
cargo run -p tg-tools --bin validate -- data --strict   # 警告也算失敗(CI 用)
cargo run -p tg-sim-slice 2024                          # 一發炮彈的完整 ShotEvent / capabilities / 回放時間軸
cargo run -p tg-tools --bin design -- check my_tank.json  # 伺服器端重算並驗證一台設計局的車(--json 看完整報告)
cargo run -p tg-tools --bin design -- serve --port 8787   # POST /api/designs/validate

python3 tools/gen_vehicles.py                           # 由規格重新產生歷史戰車資料夾、炮彈(含各車彈種與攜彈量)與機槍表
python3 tools/map-prep.py data/maps/coast/drawing.png data/maps/coast/map.json   # 由手繪地圖產生戰場(需 numpy、pillow、scipy)

cargo run --release -p tg-server                        # 聯機伺服器:http://<本機IP>:8787/ 給遊戲頁面,/ws 大廳(--port、--bind、--data、--page)

cd client/web
npm install                                             # esbuild、playwright(只有建置與測試需要)
npm test                                                # 模擬數值測試(JS 對照版,含戰車物理驗收)
node tools/tank-lockstep.mjs                            # 重產 JS↔Rust 戰車物理同步比對資料(crates/physics/src/tank/lockstep.json)
npm run build                                           # 產生 dist/tankforge-range.html(單檔,可直接開)
npm run test:browser                                    # 無頭瀏覽器實測 + 截圖
node test/bureau.mjs                                    # 設計局、試射靶場、X 光回放、試駕
node test/online.mjs                                    # 兩個瀏覽器經 tg-server 建房、加入、開戰、互射(先 npm run build、cargo build -p tg-server)
```

- 設計:ARCHITECTURE.md。歷史戰車資料來源與估計值:SOURCES.md。
- 座標系:+Z 前、+X 右、+Y 上(左手系),原點在車體中心的地面。
- 可玩原型:`client/web/dist/tankforge-range.html`。
  - **車庫**(開場畫面):下方是每台車的配圖卡片(用同一個渲染器現場拍的),上方依國別篩選,右側是規格表;拖曳環視、滾輪遠近、← → 換車、
    O 內構透視、「改裝工坊」改自訂戰車。按「開始戰鬥」(或 Enter)才進靶場;換車只能在車庫換,戰鬥中按 Tab 回車庫。
  - **戰鬥**:W/S/A/D 行駛,滑鼠瞄準,左鍵主炮,**滑鼠中鍵或 N 射機槍**,右鍵按住拉近,Shift 炮手瞄準鏡,按住 C 自由視角,
    **滾輪調表尺(±50 m,數值顯示在準星旁)**、**Z 放大倍率(最高倍率再按一次縮回;第三人稱是拉近/還原)**、Ctrl+滾輪鏡頭距離,
    F 測距(自動裝表)、E/Q/X 調表尺、B 自動裝表開關、G 換瞄準用炮塔,O 車內透視,T 時間、L 畫質、P 像素風格(可選),R 回起點,H 操作說明,
    **1–4 選彈種**(下一發裝填的彈種;連按兩下立即退彈換裝)、**= / − 巡航定速**(倒車／停止／一～三段／極速,按 W/S 改回手動),**F3 物理除錯**。
    畫面(仿戰爭雷霆佈局):左下車況圈(俯視車形、炮塔方向、乘員與受損模組)與檔位/轉速/巡航/速度,下方中央彈種格(圖示、按鍵、剩餘彈數、已裝填/下一發)與武器列,
    右下小地圖(戰場時是整張地圖加 A–J／1–10 方格)、上方方位帶。
  - **地圖**(車庫右上「地圖」按鈕):靶場,或由手繪圖產生的**海岸河口**戰場(2 × 2 km、10 × 10 方格,每格 200 m):海、河口與湖、沙灘、草地、森林(約 6,600 棵樹,開車撞上會倒)、
    泥土路與過河堤道;藍方在 D2/G3 出發,紅方出發點各停一輛敵車。敵車用自己的裝甲板資料判定:命中的板、入射角、跳彈、該距離的穿深 → 擊穿／未擊穿／跳彈／擊毀。
    水深超過 1.3 m 引擎進水熄火(R 回出發點)。
  - **聯機**(車庫右上「聯機大廳」):先在專案根目錄 `cargo run --release -p tg-server`(要先 `npm run build`),自己和朋友用瀏覽器開 `http://<這台電腦的IP>:8787/`,
    在大廳填名字連線 → 建立房間(房名、地圖、人數)或從列表加入 → 在下方卡片選車、可換邊、準備 → 房主按「開始戰鬥」。
    戰鬥中別人的車照他們的快照移動,炮彈打到敵車由伺服器扣血、擊毀與計分;被擊毀 5 秒後按 R 重生(活著連按兩下 R 棄車)、Enter 聊天、Tab 離開房間、房主可結束戰鬥。
    只有一般車輛能聯機(自訂與設計局的車只在本機)。細節與限制見 ARCHITECTURE.md §26。
  - **碰撞**:履帶外緣(下支段、繞主動輪/誘導輪的弧、上支段)與車體箱都是實體,撞牆會停、擦牆會被帶轉,不會穿過棚廠或其他車輛。
  - 瞄準鏡與第三人稱是同一套瞄準:畫面跟著滑鼠立刻轉,火炮以資料中的迴轉/俯仰速率追上;鏡內刻度跟著火炮,追上後回到畫面中央。
  - **穩定器**:沒有穩定器的車(大多數二戰車),火炮與瞄準鏡跟著車身俯仰、轉向一起晃,炮手約半秒後才手動修回,行進間很難打準;
    M4A3(75)W/(76)W 有垂直穩定器(俯仰穩住,轉向仍會帶偏);設計局可選垂直或雙向穩定器。規格表會標示。
  - **行走機構**:每台車用自己資料裡的彈簧與阻尼;扭桿/克里斯蒂是獨立輪,渦形彈簧/HVSS/板簧是兩輪一組的台車;
    輪子卸載時掛在回彈止擋上、壓到底撞緩衝塊;履帶會跨過比輪距窄的坑;車首的履帶斜段碰到障礙會先把車頭抬起;
    主動輪、誘導輪、托帶輪跟著車體起伏。崎嶇地面讓懸吊阻尼吃掉功率(車速變慢),一側履帶離地就失去抓地力。開炮的後座以實際衝量搖動車體。
  - 道路右側有懸吊測試道(半圓凸起);再往前右側(z 300–540 m)是**越野場**:起伏地形、反戰車壕、土埂與彈坑。
  - **設計局**(車庫右上「設計局」):從空白底盤或範本開始,自由編輯車體/炮塔外形(參數+點/邊/面的移動、旋轉、縮放、擠出、內縮、倒角)、
    逐面裝甲(變厚度、分割、多層、附加裝甲)、炮塔環與火炮安裝(含炮閂/後座空間檢查)、內部模組與乘員、引擎傳動、懸掛履帶、火炮、穩定器與彈藥;
    右下即時顯示重量、功重比、極速、接地壓力、前中後懸掛負荷與驗證結果。可進**試射靶場**(任何彈種、X 光命中回放)或直接**試駕**。
    存檔格式見 `schemas/vehicle_design.schema.json`;伺服器只收設計選擇,重量、防護、機動等一律重算。
- 戰車物理(`crates/physics/src/tank`,JS 對照 `client/web/src/sim/tank`):車體是 6 自由度剛體(質量、質心、慣性張量),每個負重輪站是獨立的彈簧阻尼,
  履帶接地點以摩擦力與滑轉推動車體,左右履帶分開驅動,引擎→變速箱→終傳→履帶;俯仰、側傾、重量轉移都是力的結果。履帶會在軟地壓出車轍、在硬地留下痕跡。
- 載具(`data/vehicles/`):Pz.III J、Pz.IV H、Tiger I、Panther G、T-34-85、IS-2、T-54、M10(開放式炮塔)、M4A3(75)W、M4A3(76)W HVSS、Cromwell IV、原創 Prototype A,
  加上工坊自訂車。`vehicle.json` 的 `meta.outline` 標明外形是照圖面描的(`traced`)還是依公開尺寸建的(`dimensions`)。
- Rust 工作區可用 `cargo test --workspace` 編譯與測試(含 `tg-design` 設計局核心、`tg-server` 聯機伺服器);設計局核心另編成 WASM(`crates/design-wasm`,`npm run build` 時若有 wasm32 目標會自動重編,否則用 `client/web/assets/tg_design.wasm`)。
  車輛數值行為另有 `client/web/src/sim/*.js`(同公式的對照版)與 `npm test` 驗證。
- 第三方素材:車內透視的乘員人形由 CesiumMan(© 2017 Cesium,CC BY 4.0,KhronosGroup glTF-Sample-Assets)重新擺姿、改比例與改色而成(`client/web/tools/crew-prep.py`);
  彈種圖示取自使用者提供的主炮系統藍圖。詳見 SOURCES.md。
