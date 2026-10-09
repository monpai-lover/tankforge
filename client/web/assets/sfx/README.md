# 音效素材

把音檔放進這個資料夾並用下列檔名(副檔名 .ogg / .mp3 / .wav 皆可),重新 `npm run build`,
檔案會被嵌入頁面並取代程式合成的聲音。沒放的項目維持合成音。

| 檔名 | 用途 | 備註 |
|---|---|---|
| `engine_loop` | 引擎循環 | 可無縫循環;播放速度隨轉速 0.7×–1.6× |
| `track_loop` | 履帶/行走聲循環 | 播放速度隨車速 |
| `shot_light` | 口徑 < 60 mm 開炮 | |
| `shot_medium` | 60–100 mm 開炮 | 沒有 light/heavy 時也用這個並依口徑變調 |
| `shot_heavy` | > 100 mm 開炮 | |
| `mg_light` | 步機槍口徑機槍,單發(連射時每發播一次) | 很短的單發槍聲 |
| `mg_heavy` | 12.7 mm 機槍,單發 | |
| `impact_ground` | 炮彈落地 | |
| `impact_metal` | 命中靶板/鋼板 | |
| `reload_done` | 裝填完成 | |
| `rangefinder` | 測距完成提示 | |

## 可用的公用授權來源

下載前請逐一確認該檔案頁面標示的授權;同一個站上不同檔案的授權可能不同。

- Freesound(https://freesound.org):搜尋時把授權篩選設為 **Creative Commons 0**。例:qubodup 的「Cannon Shot」。
- Kenney(https://kenney.nl/assets,分類 Audio):全部 CC0。
- OpenGameArt(https://opengameart.org):篩選 CC0;CC-BY 的需要在遊戲內署名。
- Sonniss GDC Game Audio Bundle(https://sonniss.com/gameaudiogdc):免授權金,可商用,條款見其授權頁。

建議:單聲道、44.1 kHz、OGG;循環檔 2–4 秒;開炮聲 1.5–2.5 秒。每個檔案會以 base64 嵌入頁面,
總量盡量控制在 1–2 MB 內。把來源與授權記在本資料夾的 `CREDITS.md`。
