# TankForge 聯機伺服器（Linux x86_64）

`tg-server` 是本 repo `crates/server` 的發行版（Rust，需要 glibc 2.17 以上，CentOS 7／Ubuntu 14.04 之後的系統都能跑）。它同時提供：

- WebSocket 聯機大廳與對戰（`/ws`）：房間、隊伍、出擊、權威命中判定、彈藥、修理、佔點、重連、回放證據。
- 遊戲頁面（`/`）：把 `handoff/build.sh` 產生的單檔 HTML 放在伺服器旁邊，玩家打開 `http://伺服器:8787/` 就能玩，聯機大廳會自動連回這台伺服器，畫面上不顯示任何連結。

## 部署

```sh
tar xzf tankforge-server-linux-x86_64.tar.gz
cd tankforge-server-linux-x86_64
cp /path/to/tankforge-full-online.html tankforge.html   # 由 handoff/build.sh 產生
./start.sh                                               # 預設 0.0.0.0:8787；PORT=9000 ./start.sh 可改埠
```

長期運行（systemd）：

```sh
sudo cp -r tankforge-server-linux-x86_64 /opt/tankforge-server
sudo cp /opt/tankforge-server/tankforge-server.service /etc/systemd/system/
sudo systemctl enable --now tankforge-server
```

記得在防火牆／雲端安全組開放 TCP 8787。要用 HTTPS，在前面放 nginx／Caddy 反向代理，並讓 `/ws` 支援 WebSocket 升級（`Upgrade` / `Connection` 標頭）。

## 飛機（線上）

- 資料：`data/aircraft/aircraft.json`（由遊戲本身匯出：`python3 tools/export_aircraft/export_aircraft.py ../data/aircraft/aircraft.json`，先跑 `tests/run.sh page`）。沒有這個檔時，線上不能出擊飛機。
- 毀傷由伺服器判定（`crates/server/src/aircraft.rs`）。飛機要花重生點數：擊殺 +120、助攻 +50、佔點 +80；機砲 200、空對空 350（對地掛載下一階段開放）。
- `--start-sp N`：每場開始時每人的重生點數（預設 0；測試或純空戰房用）。

## 單檔 HTML 從本機打開時

若玩家是直接打開下載的 HTML（file://），建置時指定伺服器位址，大廳會自動連過去（不會顯示在介面上）：

```sh
TF_SERVER=wss://你的網域/ws ./build.sh
```

也可以在網址加 `?server=主機:埠` 臨時指定。

## 重新建置

```sh
handoff/server/package.sh     # 產生 dist/tankforge-server-linux-x86_64.tar.gz
```
