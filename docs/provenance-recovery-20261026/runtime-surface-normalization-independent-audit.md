# 原24項表面封包正規化獨立審計（2026-10-26）

原始封包的24項與實際 runtime 正規化後的24項，均可用原live內嵌車輛資料、實際bundle造模及目前真實核心完成註冊。正規化不改頂點payload、實例或rest幾何，但改變宣告、表面／binding及range分組，並把每項1個物理炮管斷裂variant清空；因此幾何貼合不等於裝甲語意及炮管物理替換完整。

`plateBinder`與正規化整段和下載的原始app字節相同，SHA-256 `dd41782150b9f19a9ab145b3bbb55f08bf61dfafdce5ddc5a8a6996b1a513e68`。這是線上原有行為，本輪沒有引入。它對原unsupported range以三角形面積、0.12 m平面距離、法向及板邊界等啟發條件，重新宣告為沿用原工程厚度的armor或無裝甲decoration；部分range再按連續三角形分割。這不構成每個新增binding的真實裝甲認證。

兩路各用144條固定普通APCBC射線：raw有68條回報`unsupported_surface_resistance`並停止，正規化後0條；兩路皆0協議例外。每條射線都使用獨立target／registered actor life，避免炮管核心擁有狀態受前一發影響。這只是前／側面各0.5、1、1.5 m的六條樣本，不是全彈種或全range驗收。

| 車型 | 原unsupported宣告數 | raw停止／6 | 正規化停止／6 |
|---|---:|---:|---:|
| de_pz3_j | 355 | 1 | 0 |
| de_pz4_h | 490 | 3 | 0 |
| de_tiger_e | 425 | 0 | 0 |
| de_panther_g | 77 | 2 | 0 |
| de_panther_f | 77 | 2 | 0 |
| de_sdkfz234_2 | 58 | 1 | 0 |
| su_t34_1940 | 1593 | 3 | 0 |
| su_t34_85 | 2283 | 3 | 0 |
| su_is2 | 76 | 3 | 0 |
| su_t54 | 207 | 5 | 0 |
| su_t72a | 1 | 0 | 0 |
| us_m8 | 172 | 6 | 0 |
| us_m10 | 97 | 4 | 0 |
| us_m4a2 | 225 | 4 | 0 |
| us_m4a3_75w | 182 | 4 | 0 |
| us_m4a1_76w | 138 | 6 | 0 |
| us_m4a3_76w_hvss | 189 | 4 | 0 |
| uk_cromwell_iv | 89 | 2 | 0 |
| xp_w78 | 383 | 3 | 0 |
| de_pzjg1 | 139 | 5 | 0 |
| de_hetzer | 223 | 0 | 0 |
| de_hetzer_flak | 126 | 1 | 0 |
| de_rso_flak | 101 | 3 | 0 |
| uk_cmp_portee | 144 | 3 | 0 |

可確認的是24項raw介面相容及真實註冊；本審計沒有批准任何整車的全面raw繞過。即使Tiger、T72及Hetzer在這六條raw樣本沒有unsupported停止，仍各有未採樣的unknown宣告，不能據此放行全部傷害路徑。實務剩餘工作是逐range確認裝甲／無裝甲角色及binding，並在相應parent hash與信任記錄下恢復物理炮管variants，不應為恢復variants而直接關閉語意保護。

早期使用native磁碟資料混搭原live封包時，PantherF／PzJgI／Hetzer／HetzerFlak／RSOFlak有triangle-count不符；這些資料不同，結論標記為不具決定性，換回原live資料後24項全註冊。另一早期探針反覆使用初始fresh state，觸發炮管repair eligibility協議；已另存並排除，不能將那些錯誤誤稱為unsupported resistance。最終停止數直接取自報告events，沒有混用JavaScript例外。

詳細逐項結果、來源hash與明確限制見`runtime-surface-normalization-independent-audit.json`，SHA-256 `12808bf8a15a704e18dc7039618dbb2c4d886752ca0366dd8e33e2ac39671d32`。審計app快照為`378c7827488345e367fcaa632d632b60d95a64d3ad18b425538f3949112ae6ad`，核心為`d5ca844a7a5d2c19980a6452cbf93ec23ca0022a51b1e466feaa8e2df543ee59`；本檔不宣稱後續新兩項folding接入或原生聯機地面AI已使用這條本地精確表面路徑。
