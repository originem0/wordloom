#!/usr/bin/env bash
# Daily SQLite backup for WordLoom.
#
# Uses sqlite3's online .backup (a consistent snapshot even while the server is
# writing in WAL mode — a plain `cp` of app.db can capture a torn state), then
# verifies the copy before keeping it. Only after a verified backup exists are
# old ones pruned, so a failing run can never eat the last good copy.
#
# Install (crontab -e):
#   17 4 * * * /home/ubuntu/wordloom/tools/backup-db.sh >> /home/ubuntu/wordloom/backups/backup.log 2>&1
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="${WORDLOOM_DB:-$ROOT/data/app.db}"
DEST="${WORDLOOM_BACKUP_DIR:-$ROOT/backups}"
KEEP_DAYS="${WORDLOOM_BACKUP_KEEP_DAYS:-14}"

[ -f "$DB" ] || { echo "$(date -Is) ERROR database not found: $DB" >&2; exit 1; }
mkdir -p "$DEST"

stamp="$(date +%Y%m%d-%H%M%S)"
tmp="$(mktemp "$DEST/.app.db.XXXXXX")"
archive="$(mktemp "$DEST/.app.gz.XXXXXX")"
out="$DEST/app.db.$stamp.gz"
trap 'rm -f "$tmp" "$archive"' EXIT

sqlite3 "$DB" ".timeout 10000" ".backup '$tmp'"

check="$(sqlite3 "$tmp" 'PRAGMA integrity_check;')"
if [ "$check" != "ok" ]; then
  echo "$(date -Is) ERROR integrity_check failed: $check" >&2
  exit 1
fi

gzip -c "$tmp" > "$archive"
gzip -t "$archive"
# A hard link publishes the complete archive without replacing a concurrent backup.
ln "$archive" "$out"
echo "$(date -Is) OK $out ($(du -h "$out" | cut -f1))"

# Prune only this script's own rotating files; hand-made snapshots are left alone.
find "$DEST" -maxdepth 1 -name 'app.db.????????-??????.gz' -mtime "+$KEEP_DAYS" -print -delete
