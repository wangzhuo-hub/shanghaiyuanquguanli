#!/usr/bin/env bash
# 生产部署前备份：创建当前版本包 + PocketBase 数据包。
#
# 默认只做备份，不停止服务、不重启服务、不删除文件。
# 用法：
#   bash scripts/backup-production-before-app-api.sh
#
# 可覆盖：
#   SERVER=root@47.92.35.188 REMOTE_DIR=/opt/kingdee-park bash scripts/backup-production-before-app-api.sh

set -euo pipefail

SERVER="${SERVER:-root@47.92.35.188}"
REMOTE_DIR="${REMOTE_DIR:-/opt/kingdee-park}"
TS="${TS:-$(date +%Y%m%d_%H%M%S)}"
REMOTE_BACKUP_DIR="${REMOTE_DIR}/backups/pre-app-api-${TS}"

echo "[backup] server=${SERVER}"
echo "[backup] remote_dir=${REMOTE_DIR}"
echo "[backup] backup_dir=${REMOTE_BACKUP_DIR}"

ssh -o BatchMode=yes -o ConnectTimeout=15 "${SERVER}" "REMOTE_DIR='${REMOTE_DIR}' BACKUP_DIR='${REMOTE_BACKUP_DIR}' bash -s" <<'REMOTE'
set -euo pipefail

mkdir -p "${BACKUP_DIR}"

echo "[remote] hostname=$(hostname)"
date '+[remote] time=%Y-%m-%d %H:%M:%S'

if [ ! -d "${REMOTE_DIR}" ]; then
  echo "[remote] ERROR: REMOTE_DIR not found: ${REMOTE_DIR}" >&2
  exit 1
fi

echo "[remote] capture service status"
{
  systemctl status kingdee-park --no-pager || true
  systemctl status caddy --no-pager || true
  systemctl status integration-gateway --no-pager || true
} > "${BACKUP_DIR}/service-status.txt" 2>&1

echo "[remote] backup system configs if present"
mkdir -p "${BACKUP_DIR}/system"
cp -a /etc/caddy/Caddyfile "${BACKUP_DIR}/system/Caddyfile" 2>/dev/null || true
cp -a /etc/systemd/system/kingdee-park.service "${BACKUP_DIR}/system/" 2>/dev/null || true
cp -a /etc/systemd/system/integration-gateway.service "${BACKUP_DIR}/system/" 2>/dev/null || true

echo "[remote] backup current frontend public files"
if [ -d "${REMOTE_DIR}/pb_public" ]; then
  tar -C "${REMOTE_DIR}" -czf "${BACKUP_DIR}/pb_public.tar.gz" pb_public
fi

echo "[remote] backup app scripts/config metadata"
tar -C "${REMOTE_DIR}" -czf "${BACKUP_DIR}/app-metadata.tar.gz" \
  --ignore-failed-read \
  package.json package-lock.json scripts services config docker compose.yaml .env .env.local 2>/dev/null || true

echo "[remote] backup PocketBase data"
if [ -d "${REMOTE_DIR}/pb_data" ]; then
  mkdir -p "${BACKUP_DIR}/pb_data"
  if command -v sqlite3 >/dev/null 2>&1 && [ -f "${REMOTE_DIR}/pb_data/data.db" ]; then
    sqlite3 "${REMOTE_DIR}/pb_data/data.db" ".backup '${BACKUP_DIR}/pb_data/data.db'"
    cp -a "${REMOTE_DIR}/pb_data"/*.json "${BACKUP_DIR}/pb_data/" 2>/dev/null || true
    tar -C "${BACKUP_DIR}" -czf "${BACKUP_DIR}/pb_data.sqlite-backup.tar.gz" pb_data
  else
    tar -C "${REMOTE_DIR}" -czf "${BACKUP_DIR}/pb_data.live-copy.tar.gz" pb_data
    echo "[remote] WARN: sqlite3 not found or data.db missing; used live tar copy" > "${BACKUP_DIR}/pb_data-backup-warning.txt"
  fi
fi

echo "[remote] write manifest"
{
  echo "backup_dir=${BACKUP_DIR}"
  echo "remote_dir=${REMOTE_DIR}"
  echo "created_at=$(date -Iseconds)"
  echo "host=$(hostname)"
  echo "git_or_files=remote_current_state"
  find "${BACKUP_DIR}" -maxdepth 2 -type f -printf '%P %s bytes\n' 2>/dev/null || true
} > "${BACKUP_DIR}/MANIFEST.txt"

echo "[remote] backup complete: ${BACKUP_DIR}"
REMOTE

echo "[backup] complete: ${SERVER}:${REMOTE_BACKUP_DIR}"
