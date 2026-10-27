# TankForge VPS 部署包（tank.monpai.site）

這個包裝好之後，玩家只要打開 **https://tank.monpai.site** 就能玩。按「聯機」會直接進大廳，透過這台伺服器對戰，畫面上不顯示任何網址。

部署方式參考 Claude of Tanks：把 **Cloudflare 放在最前面**，玩家只連 Cloudflare，Cloudflare 再透過 **Cloudflare Tunnel** 轉到 VPS。這樣做有三個好處：

- VPS 不用開任何對外連接埠；
- 不用自己申請、續期憑證；
- 真實 IP 不會暴露。

和 Claude of Tanks 不同的地方是，戰鬥裁定不交給房主的瀏覽器，而是由這台伺服器上的 `tg-server` 權威判定，玩家不能自己改傷害。

```
玩家瀏覽器 ──https/wss──▶ Cloudflare（HTTPS、WebSocket）──Tunnel──▶ cloudflared（VPS）
                                                                  └─▶ tg-server 127.0.0.1:8788
                                                                       ├─ /       遊戲頁面（送壓縮檔約 60 MB，回訪只回 304）
                                                                       ├─ /ws     聯機大廳與對戰
                                                                       └─ /rooms  房間列表
```

頁面會自動連回它所在的網域（`wss://tank.monpai.site/ws`），不需要另外設定伺服器位址。

## 包裡有什麼

- `server/`：聯機伺服器 `tg-server`（Linux x86_64，glibc 2.17 以上），以及它讀取的車輛、彈藥、地圖資料。
- `www/index.html.gz`：完整的遊戲頁面，壓縮後約 60 MB，解壓後約 280 MB。
- `install.sh`：一鍵安裝腳本。
- `tankforge-vps.service`：systemd 設定範本，安裝腳本會自動填好。
- `Caddyfile.site`、`nginx-site.conf`：不用 Cloudflare 時的替代設定。
- `SHA256SUMS`：檔案校驗。

## 部署（Cloudflare Tunnel，預設）

1. 把包傳到 VPS 並解開：

   ```sh
   scp tankforge-vps.tar.gz root@你的VPS:/root/
   ssh root@你的VPS
   tar xzf tankforge-vps.tar.gz && cd tankforge-vps
   ```

2. 執行安裝。依 VPS 上有沒有 cloudflared 分兩種情況：
   - **已經有在跑的 cloudflared（Tunnel）**：直接執行 `sudo ./install.sh`。
   - **新主機**：先到 Cloudflare 後台 **Zero Trust → Networks → Tunnels → Create a tunnel**（類型選 Cloudflared），複製 token，然後執行：

     ```sh
     sudo TUNNEL_TOKEN=<token> ./install.sh
     ```

   安裝腳本會：
   - 把檔案放到 `/opt/tankforge-vps`；
   - 建立系統帳號 `tankforge`；
   - 註冊 systemd 服務 `tankforge-vps`，只聽 `127.0.0.1:8788`，開機自動啟動，當掉自動重啟；
   - 必要時安裝 cloudflared 並接上 Tunnel。

3. **把網域接到這台**（只要做一次）。在 Cloudflare 後台的 Tunnel 頁面 → **Public hostname → Add a public hostname**，填：

   | 欄位 | 值 |
   |---|---|
   | Subdomain | `tank` |
   | Domain | `monpai.site` |
   | Service | `HTTP` `localhost:8788` |

   儲存後，Cloudflare 會自動加上 DNS 記錄和 HTTPS，WebSocket 預設就是開啟的。玩家打開 https://tank.monpai.site 就能玩。

   如果這一步已經設定過，安裝腳本最後會直接驗證 `https://tank.monpai.site/health`，並顯示「完成！」。

可以調整的選項：

```sh
sudo PORT=8789 ./install.sh                 # 8788 被佔用時換一個內部埠（Cloudflare 的 Service 也要跟著改）
sudo DOMAIN=other.example.com ./install.sh  # 換網域（只影響最後的驗證和提示文字）
```

### Cloudflare 建議設定

在 monpai.site 的 Cloudflare 設定中：

- **Speed → Optimization**：Rocket Loader 要**關閉**，它會改寫頁面裡的腳本。
- **Network**：WebSockets 要開啟（預設就是開啟）。
- **Security → Bots**：如果開了 Bot Fight Mode，玩家偶爾會被挑戰頁擋住，可以視情況關閉。

## 不用 Cloudflare：Caddy 直接對外

```sh
sudo MODE=caddy EMAIL=you@example.com ./install.sh
```

使用前要先做兩件事：

- 在 DNS 加一筆 A 記錄：`tank` → VPS 公網 IP。如果 DNS 在 Cloudflare，雲朵要設成灰色（DNS only）。
- 在雲端安全組開放 TCP 80 和 443。

安裝腳本會安裝 Caddy，並自動申請 Let's Encrypt 憑證。如果 80／443 已經被其他網頁伺服器（例如寶塔的 nginx）佔用，腳本會停下來，不會改動它。這種情況請改用 Tunnel 模式，或參考 `nginx-site.conf` 把 `tank.monpai.site` 反向代理到 `127.0.0.1:8788`。

## 更新已經在跑的舊部署（例如 /opt/tankforge）

若只更新遊戲頁面與內嵌飛行 WASM，使用 `update-page.sh`。這次實際主機是
`/opt/tankforge`、服務 `tankforge`、埠 `8787`，與上方新安裝預設值不同：

```sh
sh update-page.sh --dry-run /path/to/index.html.gz
sh update-page.sh /path/to/index.html.gz
```

來源旁有 `index.html.gz.sha256` 時會先核對 SHA-256。腳本備份舊 HTML／gzip，
替換頁面後重啟，若 `/health` 檢查失敗則自動恢復。伺服器執行檔、戰鬥資料與 nginx
設定保留；這適合前端更新，避免使用舊完整包覆蓋主機上較新的伺服器。
可透過 `TARGET`、`SERVICE`、`PORT` 覆寫目標。

如果 tank.monpai.site 已經在跑舊版 TankForge，例如 `/opt/tankforge` 加上 systemd 服務 `tankforge`、前面接 nginx，可以直接就地更新。這樣不用重設網域、nginx 或服務：

```sh
cd tankforge-vps
URL=https://tank.monpai.site ./update-existing.sh
```

用擁有 `/opt/tankforge` 的帳號執行即可。重啟服務時會詢問 sudo 密碼；沒有 sudo 時，腳本會結束舊程序，由 systemd 自動用新版本重新啟動。

腳本會依序：

1. 把伺服器程式、資料和遊戲頁面換成這個包裡的版本，新增壓縮頁 `tankforge-range.html.gz`；
2. 舊版備份成 `*.bak-時間`；
3. 產生還原腳本 `/opt/tankforge/rollback-時間.sh`；
4. 重啟服務並檢查。

要還原時，執行它印出的 rollback 腳本即可。

如果不是預設路徑，可以這樣指定：`TARGET=/opt/tankforge SERVICE=tankforge PORT=8787 ./update-existing.sh`。

## 日常維護

```sh
systemctl status tankforge-vps          # 伺服器狀態
journalctl -u tankforge-vps -f          # 即時紀錄
sudo systemctl restart tankforge-vps    # 重啟
curl https://tank.monpai.site/rooms     # 目前房間列表
```

- **更新**：上傳新的 `tankforge-vps.tar.gz`，解開後再執行一次 `sudo ./install.sh`。重啟時，正在對戰的房間會中斷。
- **移除**：

  ```sh
  sudo systemctl disable --now tankforge-vps && sudo rm -rf /opt/tankforge-vps /etc/systemd/system/tankforge-vps.service
  ```

  再到 Cloudflare 後台刪除 `tank` 這個 Public hostname。

## 疑難排解

- **打開網址出現 Cloudflare 502／1033 錯誤**：
  - 確認 `systemctl status tankforge-vps cloudflared` 兩個服務都在跑；
  - 確認 `curl http://127.0.0.1:8788/health` 回 `ok`；
  - 確認 Public hostname 的 Service 是 `HTTP localhost:8788`。
- **頁面能開，但聯機連不上**：
  - 確認 Cloudflare 的 WebSockets 有開；
  - 用 `journalctl -u tankforge-vps -n 50` 看伺服器紀錄。
- **第一次載入很慢**：頁面壓縮後約 60 MB，第一次一定要完整下載；之後再開會先確認版本，沒有更新就不會重新下載。
- **同時上線人數**：伺服器最多同時接受 256 條連線。

## 重新打包（開發者）

```sh
handoff/server/package.sh       # 重新編譯 tg-server（glibc 2.17）
handoff/server/package-vps.sh   # 產生 handoff/server/dist/tankforge-vps.tar.gz
```
