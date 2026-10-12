# ElevenLabs 本機音效製作配置

ElevenLabs 用於離線製作 TankForge 音效。遊戲載入產出的音訊檔，密鑰不進入網頁、公開倉庫或遊戲建置。

## 建立與輸入密鑰

1. 在 [ElevenLabs Developers → API Keys](https://elevenlabs.io/app/developers/api-keys) 建立名為 `TankForge Audio` 的密鑰。
2. 啟用 **Sound Effects** 權限，以及用於唯讀驗證的 **User Read** 權限。其他權限依後續製作需求開啟；可在 ElevenLabs 設定此密鑰的生成額度上限。
3. 在專案根目錄執行以下指令，在本機的隱藏輸入視窗貼上密鑰。密鑰不作為命令列參數傳入。

```powershell
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\tools\audio\elevenlabs-local.ps1 -Action Configure
```

無桌面視窗時可加 `-Console`，使用 PowerShell 的 `Read-Host -AsSecureString` 隱藏輸入。不要把密鑰貼到聊天、寫到腳本或使用 `VITE_` 等前端環境變數。

只有 `GET https://api.elevenlabs.io/v1/user/subscription` 驗證成功才儲存新密鑰。無效密鑰、權限不足或網路失敗會保留原來的已存密鑰。本工具沒有任何生成 API 呼叫；帳戶驗證也不代表已驗證 Sound Effects 生成權限。

## 儲存與驗證

密鑰使用 Windows DPAPI 加密，儲存在 `%LOCALAPPDATA%\TankForge\credentials\elevenlabs-key.dpapi`，限定目前 Windows 帳戶讀寫。這個加密檔依賴原 Windows 帳戶與電腦，不作跨機器配置。相同帳戶下的程式仍可解密，所以不要將加密檔分享或加入倉庫。

重新驗證不需要再次輸入：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\audio\elevenlabs-local.ps1 -Action Check
```

只檢查是否有儲存檔，完全不連網：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\audio\elevenlabs-local.ps1 -Action Status
```

輸出只包含是否已存、驗證結果與 HTTP 狀態，沒有密鑰、部分密鑰、密鑰雜湊或帳戶明細。`elevenlabs-status.json` 保留最近一次驗證結果；它不代表未來的密鑰有效期或額度。

後續製作工具應在本機解密並直接送出 API 請求，僅把音訊與無密鑰的製作紀錄存入專案。現有音效槽位在 `client/web/src/game/audio.js`，音訊檔放入 `client/web/assets/sfx/` 後由建置工具嵌入遊戲。

官方參考：[API authentication](https://elevenlabs.io/docs/api-reference/authentication)、[API keys](https://elevenlabs.io/docs/overview/administration/workspaces/api-keys)、[唯讀帳戶驗證](https://elevenlabs.io/docs/api-reference/user/subscription/get)、[Sound Effects](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert)。
