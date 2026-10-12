# ElevenLabs 離線音效製作

這個工具只負責製作候選音效，不會修改遊戲、建置網頁或安裝音效。密鑰沿用 [本機配置](elevenlabs-local-setup.md) 的 Windows DPAPI 檔案；只有明確加上 `-Generate` 才讀取密鑰並呼叫生成 API。沒有帳戶、額度查詢或自動重試。

## 先查看批次

在專案根目錄執行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\audio\elevenlabs-sfx.ps1
```

預設為 **dry-run**。輸出顯示 11 個槽位、各 1 take，共 24 秒；`generationRequests` 為 0。它不讀取密鑰、不連網、不建立輸出目錄。只計算請求數及音訊秒數；`estimatedPrice` 為 `null`，實際收費依當時 ElevenLabs 方案及額度規則確認。

提示與驗收重點集中在 [sfx-manifest.json](../tools/audio/sfx-manifest.json)，順序對應 `client/web/src/game/audio.js` 的 `SFX_SLOTS`：

| 槽位 | 秒數 | Loop | 製作重點 |
|---|---:|---|---|
| engine_loop | 6 | 是 | 穩定柴油引擎，不含啟停或履帶聲 |
| track_loop | 6 | 是 | 等速鋼履帶，不含引擎聲 |
| shot_light | 2 | 否 | 單發 45 mm 火炮 |
| shot_medium | 2 | 否 | 單發 88 mm 火炮；首批試作 |
| shot_heavy | 3 | 否 | 單發 152 mm 火炮 |
| mg_light | 0.5 | 否 | 單發 7.62 mm，遊戲會快速重播 |
| mg_heavy | 0.5 | 否 | 單發 12.7 mm，避免整段連射 |
| impact_ground | 1.5 | 否 | 一次土石撞擊 |
| impact_metal | 1.5 | 否 | 一次厚鋼裝甲撞擊 |
| reload_done | 0.5 | 否 | 一次砲閂鎖定提示 |
| rangefinder | 0.5 | 否 | 一次簡短確認音 |

使用 `eleven_text_to_sound_v2`、`prompt_influence=0.3`，固定輸出 `mp3_44100_128`。官方 API 允許 0.5–30 秒；本工具刻意限制每 take 0.5–6 秒、每槽最多 4 個編號。只有引擎和履帶使用 `loop=true`。

## 建議首批：一個 2 秒 take

先用相同參數 dry-run 檢查：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\audio\elevenlabs-sfx.ps1 -BatchId pilot-20261012 -Slots shot_medium -TakeNumbers 1
```

首批具體範圍是 `shot_medium / take 1 / 2 秒 / 1 次請求`。以下命令會生成音訊及使用 ElevenLabs 額度，應在這個批次已獲授權後執行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\audio\elevenlabs-sfx.ps1 -BatchId pilot-20261012 -Slots shot_medium -TakeNumbers 1 -MaxRequests 1 -MaxDurationSeconds 2 -Generate
```

預設上限就是 1 次請求和 2 秒。較大批次必須明確提高兩個上限；不符合限制時，會在讀取密鑰前回傳 `batch-limit-exceeded`。上限最多 11 次請求、60 秒。以 PowerShell 直接呼叫脚本時可傳陣列選取多槽位：

```powershell
& .\tools\audio\elevenlabs-sfx.ps1 -BatchId review-next -Slots @('shot_light', 'shot_heavy') -TakeNumbers @(1)
```

此命令仍為 dry-run，顯示 2 次請求、5 秒，不會生成。

## 輸出與失敗處理

輸出目的地固定在 `artifacts/audio/elevenlabs/<batchId>/`；候選檔名包含 take 編號，例如 `shot_medium-take-01.mp3` 和 `shot_medium-take-01.receipt.json`。這個目錄已被 Git 忽略。工具拒絕相連的檔案／目錄、路徑穿越、未知槽位以及已存在的音訊或 receipt；沒有覆蓋開關。

每次請求前，工具先以 `CreateNew` 建立並 flush 一份 `request-started` receipt。成功後只接受 `HTTP 200`、`audio/mpeg` 和完整的 44.1 kHz / 128 kbps MP3 frame 結構，再透過同目錄暫存檔原子發布音訊。這是容器／frame 結構檢查，不代表已完成解碼、試聽或音質驗收。

receipt 記錄供應商來源、提示、模型、時長、loop、UTC 時間、結果、HTTP 狀態、格式合法的 request ID，以及成功音訊的 SHA-256。它不記錄密鑰、部分密鑰、密鑰雜湊、完整 headers、HTTP 錯誤內容或原始 exception。HTTP redirects 被停用；密鑰只會在本機程序內送到固定 `https://api.elevenlabs.io/v1/sound-generation` 端點。

`generationRequests` 表示已嘗試的生成呼叫次數，不能證明供應商是否扣款。遇到 `transport-unknown`、程序中止或 `request-started` 殘留時，先查看 ElevenLabs 的生成紀錄；不可直接刪 receipt 重跑。即使 response 無法使用，也不會自動重試。確認結果後，若需要另一次付費試作，使用新批次 ID 並取得該批次的明確授權。

錯誤只回傳粗粒度代碼：`manifest-invalid`、`selection-invalid`、`destination-invalid`、`destination-exists`、`batch-limit-exceeded`、`credential-unavailable`、`transport-unknown`、`response-rejected`、`output-write-failed` 或 `receipt-write-failed`。失敗後即停止批次；已成功的前序 takes 保留。

## 試聽與遊戲安裝

首批檢查單發次數、起音延遲、尾音、削波，以及是否混入語音、音樂或環境底噪。引擎及履帶需要連續重播檢查接縫；機槍需要短間隔重播確認它是單發。依 manifest 的 `acceptance` 判斷是否保留，並在安裝前修剪空白、控制音量與比較同類音效。

本階段沒有自動 mastering 或複製流程。確認音質和使用條款後，人工選取及處理的最終音效才能放到 `client/web/assets/sfx/<slot>.mp3`；既有 `build.mjs` 會嵌入該資料夾的音訊，所以 review takes 保持在 authoring 目錄。

生成來源標記為 `provider-generated`。這個標记沒有將音效宣稱為 MIT，也沒有代替 ElevenLabs 當時的商用及再散布條款。發布前應依購買方案核對 [官方使用條款](https://elevenlabs.io/terms-of-use)，並保留製作紀錄。

## 離線測試

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\audio\elevenlabs-sfx.test.ps1
```

測試使用 synthetic SecureString 和假 transport；沒有真實 credential 讀取或 HTTP 呼叫，也不需要新增套件。涵蓋 dry-run、批次上限、manifest、路徑穿越及 junction、原子檔案發布、不覆蓋、MP3 結構、非音訊錯誤、未知結果的 durable receipt，以及錯誤輸出不洩漏 synthetic secret。它不驗證 Sound Effects 權限或實際音訊品質；首個授權 pilot 才驗證真實生成路徑。

官方參考：[Sound Effects convert](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert)、[API authentication](https://elevenlabs.io/docs/api-reference/authentication)、[Terms of Use](https://elevenlabs.io/terms-of-use)。API 參數於 2026-10-12 以官方文件核對。

## 首個 pilot 紀錄（2026-10-12）

已按使用者的音效製作要求執行 `pilot-20261012 / shot_medium / take 1`：1 次生成請求、請求時長 2 秒，HTTP 200。候選位於忽略目錄 `artifacts/audio/elevenlabs/pilot-20261012/`；未複製到遊戲音效槽位。

原始 MP3 為 33,062 bytes，SHA-256 `4821610c2612a19544fe7626681f97f2eb85bc2995051bf242478b96bdba7057`。獨立 miniaudio 解碼為 2.0 秒、44100 Hz、原始雙聲道；保留雙聲道的峰值為 -10.93 dBFS，沒有到達 full scale 的 sample。另做單聲道分析：峰值 -15.13 dBFS、RMS -38.78 dBFS，第一個超過 -45 dBFS 的訊號位於 0 秒，最後位於約 0.623 秒。這些只確認解碼、時長與訊號狀態；主觀試聽、修剪與遊戲混音仍待完成。

產生紀錄保存於該 take 的 `.receipt.json`。這個批次已執行，不能用相同批次／take 命令重跑。實際扣除的 credits 未由本工具查得，不用音訊秒數猜測收費。
