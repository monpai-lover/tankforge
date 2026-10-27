# 美國 M61／M62 原始文獻補充核實

此補充接在 `aphe-projectile-audit-20261026.md` 的固定盤點快照之後；不修改遊戲彈藥數值。

來源為美國 Office Chief of Ordnance 的 [Standard Ordnance Items Catalog, Second Edition, 1944, Volume III](https://www.90thidpg.us/Reference/Manuals/Standard%20Ordnance%20Items%20Catalog%2C%201944%2C%20Vol%203.pdf)。已下載原掃描，223 頁，SHA-256 為 `f928cec1bd9bcb1a22595a9f635bd1e2a4001e25b42ff4c09d857aaca829670d`。以下 PDF 頁碼採 1-based，文字抽取及頁面圖均已交叉看過；圖中表格為準，不採用 OCR 錯字。

| 遊戲 ID | 精確文獻位置及識別 | 已核實內容 | 尚未核實／處理 |
|---|---|---|---|
| `apcbc_75_m61` | PDF 71–72；紙本 515–516；75 mm M61，M1897A4、M1916、M1917、M2、M3 坦克炮及 M4 航空炮 | 主裝藥 Explosive D，0.144 lb；B.D. M66A1 | 延遲 2.4 ms 與 15 mm 靈敏度未由這份表確認；保留現值 |
| `apcbc_75_m61_m3` | 同上表明列 M3／M4 欄 | 同一枚 M61 主裝藥 Explosive D，0.144 lb；不同火炮不改每枚主裝藥 | 同上；不把發射藥質量當彈體裝藥 |
| `apcbc_76_m62` | PDF 80、83；3 inch M62A1；PDF 83 明列 76 mm M1、M1A1、M1A2 適用，同一枚彈丸、不同藥筒 | M62A1 的主裝藥 Explosive D，0.144 lb；B.D. M66A1；表中穿甲比較欄也簡寫 M62 | 遊戲名稱省略 A1；引信延遲／靈敏度及早期惰性裝填批次仍須分開查核，不把所有稱為 M62 的彈一概認證 |

0.144 lb 換算為 65.31730128 g；以原文精度及整克遊戲顯示，現有 **65 g** 合理，沒有理由把 UI 改成多位小數，也不需要提高威力。三筆既有 `explosive_type: explosive_d` 與約 65 g 原始質量均得到上述實裝變型支持。

美國陸軍 Picatinny 的[原機構文章](https://www.army.mil/article/205041/picatinny_history_detectives_discover_answer_to_museums_mystery_item)另證實 M62A1 的底部裝有引信及 Explosive D。它沒有給裝藥質量，不能獨立拿來證明 65 g。

此處是美軍標準有裝藥彈；惰性／英軍實心使用型、練習彈及其他批次不能套用這個結論。當前 51 項中的其他待核項也沒有因這三筆證據變成「全部已核實」。
