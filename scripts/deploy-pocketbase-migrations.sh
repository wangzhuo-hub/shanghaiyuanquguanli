#!/usr/bin/env bash
# 同步 PocketBase 迁移与 Hooks 到生产，并重启服务以执行未应用的 migration。
#
# 用法: ./scripts/deploy-pocketbase-migrations.sh
# 可覆盖: SERVER=root@47.92.35.188 REMOTE_DIR=/opt/kingdee-park

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVER="${SERVER:-root@47.92.35.188}"
REMOTE_DIR="${REMOTE_DIR:-/opt/kingdee-park}"

cd "${ROOT_DIR}"

echo "[pb-migrate] rsync pb_migrations + pb_hooks"
# 生产机 PocketBase 工作目录为 ${REMOTE_DIR}（pb_migrations 与 pocketbase 二进制同级）
rsync -az \
  "${ROOT_DIR}/pocketbase/pb_migrations/" \
  "${SERVER}:${REMOTE_DIR}/pb_migrations/"

rsync -az \
  "${ROOT_DIR}/pocketbase/pb_hooks/" \
  "${SERVER}:${REMOTE_DIR}/pb_hooks/"

echo "[pb-migrate] restart kingdee-park (migrations run on startup)"
ssh -o BatchMode=yes -o ConnectTimeout=20 "${SERVER}" "set -euo pipefail
systemctl restart kingdee-park
sleep 3
systemctl is-active kingdee-park
"

echo "[pb-migrate] done"
