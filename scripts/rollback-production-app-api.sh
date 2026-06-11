#!/usr/bin/env bash
# 从 pre-app-api 备份回退生产版本。
#
# 默认只恢复代码/前端/配置并重启服务，不恢复 pb_data。
# 如确认需要恢复数据：
#   RESTORE_DATA=1 BACKUP_DIR=/opt/kingdee-park/backups/pre-app-api-xxx bash scripts/rollback-production-app-api.sh
#
# 用法：
#   BACKUP_DIR=/opt/kingdee-park/backups/pre-app-api-20260527_091057 bash scripts/rollback-production-app-api.sh

set -euo pipefail

SERVER="${SERVER:-root@47.92.35.188}"
REMOTE_DIR="${REMOTE_DIR:-/opt/kingdee-park}"
BACKUP_DIR="${BACKUP_DIR:-}"
SERVICE_NAME="${SERVICE_NAME:-integration-gateway}"
RESTORE_DATA="${RESTORE_DATA:-0}"

if [ -z "${BACKUP_DIR}" ]; then
  echo "ERROR: 请设置 BACKUP_DIR，例如：BACKUP_DIR=/opt/kingdee-park/backups/pre-app-api-xxx" >&2
  exit 1
fi

echo "[rollback] server=${SERVER}"
echo "[rollback] remote_dir=${REMOTE_DIR}"
echo "[rollback] backup_dir=${BACKUP_DIR}"
echo "[rollback] restore_data=${RESTORE_DATA}"

ssh -o BatchMode=yes -o ConnectTimeout=15 "${SERVER}" "REMOTE_DIR='${REMOTE_DIR}' BACKUP_DIR='${BACKUP_DIR}' SERVICE_NAME='${SERVICE_NAME}' RESTORE_DATA='${RESTORE_DATA}' bash -s" <<'REMOTE'
set -euo pipefail

if [ ! -d "${BACKUP_DIR}" ]; then
  echo "ERROR: backup dir not found: ${BACKUP_DIR}" >&2
  exit 1
fi

echo "[remote] rollback from ${BACKUP_DIR}"
date '+[remote] time=%Y-%m-%d %H:%M:%S'

if [ -f "${BACKUP_DIR}/app-metadata.tar.gz" ]; then
  echo "[remote] restore app metadata"
  tar -C "${REMOTE_DIR}" -xzf "${BACKUP_DIR}/app-metadata.tar.gz"
fi

if [ -f "${BACKUP_DIR}/pb_public.tar.gz" ]; then
  echo "[remote] restore pb_public"
  rm -rf "${REMOTE_DIR}/pb_public"
  tar -C "${REMOTE_DIR}" -xzf "${BACKUP_DIR}/pb_public.tar.gz"
fi

if [ -f "${BACKUP_DIR}/system/Caddyfile" ]; then
  echo "[remote] restore Caddyfile"
  cp -a "${BACKUP_DIR}/system/Caddyfile" /etc/caddy/Caddyfile
  systemctl reload caddy || systemctl restart caddy || true
fi

if [ "${RESTORE_DATA}" = "1" ]; then
  echo "[remote] restore pb_data requested"
  if [ -f "${BACKUP_DIR}/pb_data.sqlite-backup.tar.gz" ]; then
    systemctl stop kingdee-park || true
    mkdir -p "${REMOTE_DIR}/pb_data.rollback-before"
    cp -a "${REMOTE_DIR}/pb_data/." "${REMOTE_DIR}/pb_data.rollback-before/" 2>/dev/null || true
    rm -rf "${REMOTE_DIR}/pb_data"
    mkdir -p "${REMOTE_DIR}/pb_data"
    tar -C "${BACKUP_DIR}" -xzf "${BACKUP_DIR}/pb_data.sqlite-backup.tar.gz"
    cp -a "${BACKUP_DIR}/pb_data/." "${REMOTE_DIR}/pb_data/"
    systemctl start kingdee-park || true
  else
    echo "ERROR: no sqlite pb_data backup found" >&2
    exit 1
  fi
fi

echo "[remote] restart services"
if systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service"; then
  systemctl restart "${SERVICE_NAME}" || true
fi
systemctl restart kingdee-park || true

echo "[remote] rollback complete"
REMOTE

echo "[rollback] complete"
