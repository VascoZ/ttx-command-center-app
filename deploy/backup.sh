#!/bin/sh
# Backup otomatis: dump PostgreSQL + arsip lampiran, berkala, dengan rotasi.
# Variabel: BACKUP_INTERVAL_HOURS (default 24), BACKUP_KEEP_DAYS (default 14)
set -u
INTERVAL_H="${BACKUP_INTERVAL_HOURS:-24}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
mkdir -p /backups

until pg_isready -q; do
  echo "[backup] menunggu database..."
  sleep 5
done

while true; do
  TS="$(date +%Y%m%d-%H%M%S)"
  if pg_dump -Fc -f "/backups/ttx-$TS.dump.tmp"; then
    mv "/backups/ttx-$TS.dump.tmp" "/backups/ttx-$TS.dump"
    echo "[backup] database -> ttx-$TS.dump"
  else
    rm -f "/backups/ttx-$TS.dump.tmp"
    echo "[backup] GAGAL membuat dump database"
  fi
  if [ -d /uploads ]; then
    tar czf "/backups/uploads-$TS.tar.gz" -C /uploads . && echo "[backup] lampiran -> uploads-$TS.tar.gz"
  fi
  find /backups -maxdepth 1 -type f \( -name 'ttx-*.dump' -o -name 'uploads-*.tar.gz' \) -mtime +"$KEEP_DAYS" -print -delete
  sleep $((INTERVAL_H * 3600))
done
