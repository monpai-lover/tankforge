#!/bin/sh
# TankForge VPS 一鍵安裝：遊戲頁面 + 聯機伺服器（tg-server，只聽本機）。
# 預設和 Claude of Tanks 一樣把 Cloudflare 放在最前面：玩家連 https://tank.monpai.site，
# Cloudflare 負責 HTTPS 與 WebSocket，再經 Cloudflare Tunnel 轉到這台的 tg-server，
# 伺服器不用開任何對外連接埠，也不用自己申請憑證。
#   sudo ./install.sh                                  -> 已有 cloudflared（Tunnel）時
#   sudo TUNNEL_TOKEN=eyJ... ./install.sh              -> 新主機：順便安裝 cloudflared 並接上 Tunnel
#   sudo MODE=caddy EMAIL=you@x.com ./install.sh       -> 不用 Cloudflare：Caddy 直接對外並自動申請憑證
#   DOMAIN=tank.monpai.site  PORT=8788                 -> 預設值
# 重跑一次就是更新（頁面與伺服器都換成這個包裡的版本）。
set -e
DOMAIN=${DOMAIN:-tank.monpai.site}
PORT=${PORT:-8788}
MODE=${MODE:-tunnel}
EMAIL=${EMAIL:-}
TUNNEL_TOKEN=${TUNNEL_TOKEN:-}
DEST=/opt/tankforge-vps
SERVICE=tankforge-vps
HERE=$(cd "$(dirname "$0")" && pwd)

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\n錯誤：%s\n' "$*" >&2; exit 1; }
listening() { ss -ltnH "sport = :$1" 2>/dev/null | grep -q .; }
owner() { ss -ltnpH "sport = :$1" 2>/dev/null | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | head -1; }
pkg_install() {
  if command -v apt-get >/dev/null; then DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
  elif command -v dnf >/dev/null; then dnf install -y "$@"
  elif command -v yum >/dev/null; then yum install -y "$@"
  else die "找不到套件管理器（apt/dnf/yum），請手動安裝：$*"; fi
}
wait_https() {
  say "等待 https://$DOMAIN 上線（最多 $1 秒）"
  i=0
  until [ "$(curl -s --max-time 5 "https://$DOMAIN/health")" = ok ]; do
    i=$((i + 5)); [ $i -ge "$1" ] && return 1
    sleep 5
  done
}

[ "$(id -u)" = 0 ] || die "請用 root 執行：sudo ./install.sh"
[ "$(uname -m)" = x86_64 ] || die "這個包只支援 x86_64（目前是 $(uname -m)）"
command -v systemctl >/dev/null || die "需要 systemd"
case "$MODE" in tunnel|caddy) ;; *) die "MODE 只能是 tunnel 或 caddy" ;; esac
[ -x "$HERE/server/tg-server" ] && [ -f "$HERE/www/index.html.gz" ] || die "包不完整：找不到 server/tg-server 或 www/index.html.gz"
command -v curl >/dev/null || pkg_install curl

say "檢查連接埠 $PORT"
if listening "$PORT" && ! systemctl is-active -q "$SERVICE"; then
  die "連接埠 $PORT 已被 $(owner "$PORT") 使用。換一個：sudo PORT=8789 ./install.sh"
fi

say "安裝檔案到 $DEST"
id tankforge >/dev/null 2>&1 || useradd --system --no-create-home --shell /bin/false tankforge
systemctl stop "$SERVICE" 2>/dev/null || true
mkdir -p "$DEST"
rm -rf "$DEST/server" "$DEST/www.new"
cp -r "$HERE/server" "$DEST/server"
mkdir -p "$DEST/www.new"
cp "$HERE/www/index.html.gz" "$DEST/www.new/"
gzip -dc "$DEST/www.new/index.html.gz" > "$DEST/www.new/index.html"   # 給不收 gzip 的瀏覽器
touch -r "$DEST/www.new/index.html.gz" "$DEST/www.new/index.html"
rm -rf "$DEST/www" && mv "$DEST/www.new" "$DEST/www"
chmod -R a+rX "$DEST"
chmod 755 "$DEST/server/tg-server"

say "設定聯機伺服器（systemd：$SERVICE，只聽 127.0.0.1:$PORT）"
sed -e "s|@DEST@|$DEST|g" -e "s|@PORT@|$PORT|g" "$HERE/tankforge-vps.service" > "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl enable -q "$SERVICE"
systemctl restart "$SERVICE"
sleep 1
systemctl is-active -q "$SERVICE" || { journalctl -u "$SERVICE" -n 30 --no-pager; die "聯機伺服器沒有啟動"; }
[ "$(curl -s "http://127.0.0.1:$PORT/health")" = ok ] || die "聯機伺服器沒有回應 http://127.0.0.1:$PORT/health"
echo "聯機伺服器運作中：http://127.0.0.1:$PORT/（遊戲頁面、/ws 聯機、/rooms 房間列表）"

if [ "$MODE" = tunnel ]; then
  if ! systemctl is-active -q cloudflared; then
    [ -n "$TUNNEL_TOKEN" ] || die "這台還沒有 Cloudflare Tunnel。到 Cloudflare 後台 Zero Trust → Networks → Tunnels 建一條 Tunnel，複製它的 token 後執行：sudo TUNNEL_TOKEN=<token> ./install.sh（伺服器本身已經裝好在跑了）"
    if ! command -v cloudflared >/dev/null; then
      say "安裝 cloudflared"
      if command -v apt-get >/dev/null; then
        mkdir -p --mode=0755 /usr/share/keyrings
        curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg > /usr/share/keyrings/cloudflare-main.gpg
        echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" > /etc/apt/sources.list.d/cloudflared.list
        apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y cloudflared
      elif command -v dnf >/dev/null || command -v yum >/dev/null; then
        curl -fsSL https://pkg.cloudflare.com/cloudflared-ascii.repo > /etc/yum.repos.d/cloudflared.repo
        pkg_install cloudflared
      else
        die "無法自動安裝 cloudflared，請參考 Cloudflare 文件手動安裝後重跑"
      fi
    fi
    say "接上 Cloudflare Tunnel"
    cloudflared service install "$TUNNEL_TOKEN"
  fi
  echo "Cloudflare Tunnel（cloudflared）運作中"
  if wait_https 15; then
    echo; echo "完成！玩家打開  https://$DOMAIN  就能玩，按「聯機」直接進大廳。"
  else
    cat <<EOF

伺服器已經裝好。最後一步在 Cloudflare 後台把網域接到這台（只要做一次）：
  Zero Trust → Networks → Tunnels → 這台的 Tunnel → Public hostname → Add a public hostname
    Subdomain: ${DOMAIN%%.*}      Domain: ${DOMAIN#*.}
    Service:   HTTP   localhost:$PORT
儲存後等幾秒，玩家打開 https://$DOMAIN 就能玩。
（Cloudflare 會自動加上 DNS 記錄和 HTTPS；WebSocket 預設就是開的。）
EOF
  fi
else
  WEB=$(owner 443); [ -n "$WEB" ] || WEB=$(owner 80)
  if [ -n "$WEB" ] && [ "$WEB" != caddy ]; then
    die "80/443 埠被 $WEB 佔用。請改用預設的 Cloudflare Tunnel 模式，或讓 $WEB 把 $DOMAIN 反向代理到 127.0.0.1:$PORT（nginx 可參考 nginx-site.conf）"
  fi
  if ! command -v caddy >/dev/null; then
    say "安裝 Caddy（自動 HTTPS）"
    if command -v apt-get >/dev/null; then
      DEBIAN_FRONTEND=noninteractive apt-get install -y debian-keyring debian-archive-keyring apt-transport-https gnupg
      curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
      apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y caddy
    elif command -v dnf >/dev/null; then
      dnf install -y 'dnf-command(copr)' && dnf copr enable -y @caddy/caddy && dnf install -y caddy
    else
      die "無法自動安裝 Caddy，請參考 https://caddyserver.com/docs/install 手動安裝後重跑"
    fi
  fi
  say "設定 Caddy 站台 $DOMAIN"
  SITE=/etc/caddy/tankforge-$DOMAIN.caddy
  sed -e "s|@DOMAIN@|$DOMAIN|g" -e "s|@PORT@|$PORT|g" "$HERE/Caddyfile.site" > "$SITE"
  MAIN=/etc/caddy/Caddyfile
  if [ -f "$MAIN" ] && grep -q 'root \* /usr/share/caddy' "$MAIN"; then
    cp "$MAIN" "$MAIN.bak.$(date +%Y%m%d%H%M%S)"      # 安裝 Caddy 時附的範例頁，換掉
    : > "$MAIN"
  fi
  if [ -n "$EMAIL" ] && ! grep -q '^{' "$MAIN" 2>/dev/null; then
    printf '{\n\temail %s\n}\n\n%s\n' "$EMAIL" "$(cat "$MAIN" 2>/dev/null)" > "$MAIN"
  fi
  grep -qF "import $SITE" "$MAIN" 2>/dev/null || echo "import $SITE" >> "$MAIN"
  caddy validate --adapter caddyfile --config "$MAIN" >/dev/null || die "Caddy 設定檢查失敗：$MAIN"
  systemctl enable -q caddy
  systemctl reload caddy 2>/dev/null || systemctl restart caddy
  if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
    ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  elif command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
    firewall-cmd -q --permanent --add-service=http --add-service=https && firewall-cmd -q --reload
  fi
  if wait_https 90; then
    echo; echo "完成！玩家打開  https://$DOMAIN  就能玩，按「聯機」直接進大廳。"
  else
    echo "還連不上 https://$DOMAIN：請確認 DNS A 記錄指向這台、雲端安全組開了 80/443。Caddy 會自己重試申請憑證。"
    echo "查看紀錄：journalctl -u caddy -n 50"
  fi
fi
echo "紀錄：journalctl -u $SERVICE -f"
