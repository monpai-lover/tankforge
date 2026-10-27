#!/bin/sh
# Update the embedded client/WASM only. Keep the running server binary, battle data and nginx intact.
#   sh update-page.sh [--dry-run] /path/to/index.html.gz
# Existing deployment: /opt/tankforge, service tankforge, 127.0.0.1:8787.
set -eu
TF_UPDATE_DRY=0
if [ "${1:-}" = --dry-run ]; then TF_UPDATE_DRY=1; shift; fi
[ "$#" = 1 ] || { echo 'usage: update-page.sh [--dry-run] PAGE.html.gz' >&2; exit 2; }
TF_UPDATE_SOURCE=$(realpath "$1")
TARGET=${TARGET:-/opt/tankforge}
SERVICE=${SERVICE:-tankforge}
PORT=${PORT:-8787}
TF_UPDATE_PAGE=$TARGET/client/web/dist/tankforge-range.html
TF_UPDATE_STAMP=$(date +%Y%m%d%H%M%S)-$$
TF_UPDATE_NEW=$TF_UPDATE_PAGE.new-$TF_UPDATE_STAMP
TF_UPDATE_BACKUP=$TF_UPDATE_PAGE.bak-$TF_UPDATE_STAMP
TF_UPDATE_SWITCHED=0
TF_UPDATE_SUCCESS=0
TF_UPDATE_HAD_GZIP=0
fail() { echo "更新失敗：$*" >&2; exit 1; }
[ -f "$TF_UPDATE_SOURCE" ] || fail '找不到來源頁面'
[ -f "$TF_UPDATE_PAGE" ] || fail "找不到現有頁面：$TF_UPDATE_PAGE"
gzip -t "$TF_UPDATE_SOURCE" || fail '來源 gzip 損壞'
if [ -f "$TF_UPDATE_SOURCE.sha256" ]; then
  (cd "$(dirname "$TF_UPDATE_SOURCE")" && sha256sum -c "$(basename "$TF_UPDATE_SOURCE").sha256") || fail '來源 SHA-256 不符'
fi
printf '來源：%s\n目標：%s\n服務：%s，port %s\n' "$TF_UPDATE_SOURCE" "$TF_UPDATE_PAGE" "$SERVICE" "$PORT"
if [ "$TF_UPDATE_DRY" = 1 ]; then
  echo '檢查通過；尚未寫入部署目錄或重啟服務。'
  exit 0
fi
restart() {
  if systemctl restart "$SERVICE" 2>/dev/null; then return 0; fi
  if command -v sudo >/dev/null && sudo -n systemctl restart "$SERVICE" 2>/dev/null; then return 0; fi
  # The existing unit is Restart=always and runs as the owning user.
  pkill -u "$(id -u)" -f "^$TARGET/target/release/tg-server( |\$)"
}
cleanup() {
  TF_UPDATE_EXIT=$?
  trap - EXIT HUP INT TERM
  if [ "$TF_UPDATE_SWITCHED" = 1 ] && [ "$TF_UPDATE_SUCCESS" != 1 ]; then
    if ! { cp -p "$TF_UPDATE_BACKUP" "$TF_UPDATE_NEW" && mv "$TF_UPDATE_NEW" "$TF_UPDATE_PAGE"; }; then
      echo "恢復舊頁面失敗；請從備份還原：$TF_UPDATE_BACKUP" >&2
      exit 1
    fi
    if [ "$TF_UPDATE_HAD_GZIP" = 1 ]; then
      if ! { cp -p "$TF_UPDATE_BACKUP.gz" "$TF_UPDATE_NEW.gz" && mv "$TF_UPDATE_NEW.gz" "$TF_UPDATE_PAGE.gz"; }; then
        echo "恢復舊壓縮頁面失敗；請從備份還原：$TF_UPDATE_BACKUP.gz" >&2
        exit 1
      fi
    else
      rm -f "$TF_UPDATE_PAGE.gz"
    fi
    restart || true
    echo "已自動恢復舊頁面；備份保留：$TF_UPDATE_BACKUP" >&2
  fi
  rm -f "$TF_UPDATE_NEW" "$TF_UPDATE_NEW.gz"
  exit "$TF_UPDATE_EXIT"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM
# This write is intentionally before backups, switching files or touching the running process.
# A restricted execution environment fails here with the deployment unchanged.
gzip -dc "$TF_UPDATE_SOURCE" > "$TF_UPDATE_NEW" || fail '不能建立部署暫存檔（檢查目錄權限）'
cp "$TF_UPDATE_SOURCE" "$TF_UPDATE_NEW.gz"
touch -r "$TF_UPDATE_SOURCE" "$TF_UPDATE_NEW" "$TF_UPDATE_NEW.gz"
cp -p "$TF_UPDATE_PAGE" "$TF_UPDATE_BACKUP"
if [ -f "$TF_UPDATE_PAGE.gz" ]; then
  cp -p "$TF_UPDATE_PAGE.gz" "$TF_UPDATE_BACKUP.gz"; TF_UPDATE_HAD_GZIP=1
fi
# Each rename is atomic; the old process is left running until both files are ready.
TF_UPDATE_SWITCHED=1
mv "$TF_UPDATE_NEW" "$TF_UPDATE_PAGE"
mv "$TF_UPDATE_NEW.gz" "$TF_UPDATE_PAGE.gz"
restart || fail '無法重啟服務'
TF_UPDATE_TRIES=0
until [ "$(curl -fsS --max-time 3 "http://127.0.0.1:$PORT/health" 2>/dev/null || true)" = ok ]; do
  TF_UPDATE_TRIES=$((TF_UPDATE_TRIES + 1))
  [ "$TF_UPDATE_TRIES" -lt 20 ] || fail '新服務健康檢查失敗'
  sleep 1
done
TF_UPDATE_SUCCESS=1
echo "頁面已更新，服務健康檢查通過。舊頁面：$TF_UPDATE_BACKUP"
echo '伺服器程式、戰鬥資料與 nginx 設定均保留。'
