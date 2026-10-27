#!/bin/sh
# 就地更新已經在跑的 TankForge（例如 /opt/tankforge + systemd 服務 tankforge），不改 nginx 與服務設定：
# 換掉伺服器程式、資料和遊戲頁面，舊版先備份，並產生一鍵還原腳本，最後重啟並檢查。
#   ./update-existing.sh                               -> /opt/tankforge、服務 tankforge、127.0.0.1:8787
#   TARGET=/opt/tankforge SERVICE=tankforge PORT=8787 ./update-existing.sh
# 以擁有 TARGET 的帳號執行即可（重啟服務時會用 sudo；沒有 sudo 時改為結束舊程序讓 systemd 自動重啟）。
set -e
TARGET=${TARGET:-/opt/tankforge}
SERVICE=${SERVICE:-tankforge}
PORT=${PORT:-8787}
URL=${URL:-}
HERE=$(cd "$(dirname "$0")" && pwd)
T=$(date +%Y%m%d%H%M%S)
BIN=$TARGET/target/release/tg-server
DATA=$TARGET/data
PAGE=$TARGET/client/web/dist/tankforge-range.html

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\n錯誤：%s\n' "$*" >&2; exit 1; }

[ -x "$HERE/server/tg-server" ] && [ -d "$HERE/server/data" ] && [ -f "$HERE/www/index.html.gz" ] || die "包不完整：找不到 server/tg-server、server/data 或 www/index.html.gz"
[ -f "$BIN" ] && [ -d "$DATA" ] && [ -f "$PAGE" ] || die "在 $TARGET 找不到現有部署（$BIN、$DATA、$PAGE）"
[ -w "$TARGET" ] && [ -w "$DATA" ] && [ -w "$(dirname "$BIN")" ] && [ -w "$(dirname "$PAGE")" ] || die "目前帳號不能寫入 $TARGET，請用擁有它的帳號執行（ls -ld $TARGET）"

say "準備新版本（先放在旁邊，不影響正在跑的伺服器）"
rm -rf "$DATA.new"
cp "$HERE/server/tg-server" "$BIN.new" && chmod 755 "$BIN.new"
cp -r "$HERE/server/data" "$DATA.new"
gzip -dc "$HERE/www/index.html.gz" > "$PAGE.new"
cp "$HERE/www/index.html.gz" "$PAGE.gz.new"
touch -r "$HERE/www/index.html.gz" "$PAGE.new" "$PAGE.gz.new"

say "備份舊版本（後綴 .bak-$T）"
cp -p "$BIN" "$BIN.bak-$T"
mv "$DATA" "$DATA.bak-$T"
mv "$PAGE" "$PAGE.bak-$T"
[ -f "$PAGE.gz" ] && mv "$PAGE.gz" "$PAGE.gz.bak-$T"

say "換上新版本"
mv "$BIN.new" "$BIN"           # rename：正在跑的舊程式不受影響，重啟後才用新的
mv "$DATA.new" "$DATA"
mv "$PAGE.new" "$PAGE"
mv "$PAGE.gz.new" "$PAGE.gz"

ROLLBACK=$TARGET/rollback-$T.sh
cat > "$ROLLBACK" <<EOF
#!/bin/sh
# 還原 $T 更新前的 TankForge，然後重啟服務。
set -e
mv "$BIN.bak-$T" "$BIN"
rm -rf "$DATA" && mv "$DATA.bak-$T" "$DATA"
mv "$PAGE.bak-$T" "$PAGE"
rm -f "$PAGE.gz"
[ -f "$PAGE.gz.bak-$T" ] && mv "$PAGE.gz.bak-$T" "$PAGE.gz"
sudo systemctl restart $SERVICE 2>/dev/null || pkill -u "\$(id -u)" -f "^$BIN( |\\\$)" || true
echo "已還原到 $T 之前的版本"
EOF
chmod +x "$ROLLBACK"

say "重啟服務 $SERVICE"
if [ "$(id -u)" = 0 ]; then systemctl restart "$SERVICE"
elif command -v sudo >/dev/null && sudo -n true 2>/dev/null; then sudo systemctl restart "$SERVICE"
elif command -v sudo >/dev/null && [ -t 0 ]; then sudo systemctl restart "$SERVICE"
else
  echo "沒有 sudo：結束舊程序，由 systemd（Restart=always）自動以新版本重啟"
  pkill -u "$(id -u)" -f "^$BIN( |\$)" || true
fi

say "檢查"
i=0
until [ "$(curl -s --max-time 3 "http://127.0.0.1:$PORT/health")" = ok ]; do
  i=$((i + 1)); [ $i -ge 20 ] && die "新版本沒有回應 http://127.0.0.1:$PORT/health。看紀錄：journalctl -u $SERVICE -n 50；要還原執行 $ROLLBACK"
  sleep 1
done
curl -s -D - -o /dev/null -H 'Accept-Encoding: gzip' "http://127.0.0.1:$PORT/" | tr -d '\r' | grep -iE '^(HTTP|content-encoding|content-length)'
[ -n "$URL" ] && curl -s -D - -o /dev/null -H 'Accept-Encoding: gzip' "$URL" | tr -d '\r' | grep -iE '^(HTTP|content-encoding|content-length)'
echo
echo "完成：伺服器、資料和遊戲頁面已更新。舊版備份在 *.bak-$T。"
echo "要還原：$ROLLBACK"
