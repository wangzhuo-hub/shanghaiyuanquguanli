#!/usr/bin/env bash
# 部署 Application API 到生产 integration-gateway。
#
# 流程：
#   1. 本地构建与测试
#   2. 生产备份
#   3. 上传服务端相关源码
#   4. 重启 integration-gateway
#   5. 验证健康检查与新 App API
#
# 默认部署后 App API 正式写入仍关闭；如需开启灰度写入：
#   APP_API_WRITE_ENABLED=1 APP_API_PAYMENT_WRITE_ENABLED=1 bash scripts/deploy-app-api-gateway.sh
#   APP_API_WRITE_ENABLED=1 APP_API_TENANT_WRITE_ENABLED=1 bash scripts/deploy-app-api-gateway.sh
#
# 可覆盖：
#   SERVER=root@47.92.35.188 REMOTE_DIR=/opt/kingdee-park bash scripts/deploy-app-api-gateway.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVER="${SERVER:-root@47.92.35.188}"
REMOTE_DIR="${REMOTE_DIR:-/opt/kingdee-park}"
SERVICE_NAME="${SERVICE_NAME:-integration-gateway}"

APP_API_WRITE_ENABLED="${APP_API_WRITE_ENABLED:-0}"
APP_API_PAYMENT_WRITE_ENABLED="${APP_API_PAYMENT_WRITE_ENABLED:-0}"
APP_API_TENANT_WRITE_ENABLED="${APP_API_TENANT_WRITE_ENABLED:-0}"
COMPUTE_DASHBOARD_CACHE_TTL_MS="${COMPUTE_DASHBOARD_CACHE_TTL_MS:-1800000}"
COMPUTE_BILLING_CACHE_TTL_MS="${COMPUTE_BILLING_CACHE_TTL_MS:-1800000}"
COMPUTE_VERSION_CACHE_TTL_MS="${COMPUTE_VERSION_CACHE_TTL_MS:-2000}"
COMPUTE_PREWARM_ENABLED="${COMPUTE_PREWARM_ENABLED:-1}"
COMPUTE_PREWARM_INTERVAL_MS="${COMPUTE_PREWARM_INTERVAL_MS:-900000}"
COMPUTE_PREWARM_STARTUP_DELAY_MS="${COMPUTE_PREWARM_STARTUP_DELAY_MS:-15000}"
COMPUTE_PREWARM_PROJECTS="${COMPUTE_PREWARM_PROJECTS:-shanghai_park,beijing_park,shenzhen_park}"
GATEWAY_SCHEDULER_ENABLED="${GATEWAY_SCHEDULER_ENABLED:-1}"
DEPLOY_FRONTEND="${DEPLOY_FRONTEND:-1}"

cd "${ROOT_DIR}"

echo "[deploy] local build"
npm run build

echo "[deploy] focused tests"
npx vitest run \
  scripts/__tests__/computeEngineBillingCache.test.ts \
  scripts/__tests__/integrationGatewayPocketbaseClient.test.ts \
  services/__tests__/paymentApiAuth.test.ts \
  services/__tests__/dataDiff.test.ts \
  services/__tests__/incrementalSaveDetails.test.ts \
  services/__tests__/incrementalCreateDuplicate.test.ts \
  services/__tests__/pocketbaseBackupFetch.test.ts \
  services/__tests__/metricsWorkerClient.test.ts

echo "[deploy] production backup"
SERVER="${SERVER}" REMOTE_DIR="${REMOTE_DIR}" bash scripts/backup-production-before-app-api.sh

if [ "${DEPLOY_FRONTEND}" = "1" ]; then
  echo "[deploy] upload frontend dist"
  ssh -o BatchMode=yes -o ConnectTimeout=15 "${SERVER}" "mkdir -p '${REMOTE_DIR}/pb_public'"
  rsync -az --delete dist/ "${SERVER}:${REMOTE_DIR}/pb_public/"
else
  echo "[deploy] skip frontend dist upload (DEPLOY_FRONTEND=0)"
fi

echo "[deploy] upload server-side source"
rsync -az \
  package.json package-lock.json tsconfig.json vite.config.ts types.ts \
  scripts services \
  "${SERVER}:${REMOTE_DIR}/"

echo "[deploy] install dependencies if needed"
ssh -o BatchMode=yes -o ConnectTimeout=15 "${SERVER}" "cd '${REMOTE_DIR}' && npm install"

echo "[deploy] configure gateway runtime flags"
ssh -o BatchMode=yes -o ConnectTimeout=15 "${SERVER}" "set -euo pipefail
mkdir -p '${REMOTE_DIR}/secrets'
cat > '${REMOTE_DIR}/secrets/gateway-runtime.env' <<EOF
APP_API_WRITE_ENABLED=${APP_API_WRITE_ENABLED}
APP_API_PAYMENT_WRITE_ENABLED=${APP_API_PAYMENT_WRITE_ENABLED}
APP_API_TENANT_WRITE_ENABLED=${APP_API_TENANT_WRITE_ENABLED}
COMPUTE_DASHBOARD_CACHE_TTL_MS=${COMPUTE_DASHBOARD_CACHE_TTL_MS}
COMPUTE_BILLING_CACHE_TTL_MS=${COMPUTE_BILLING_CACHE_TTL_MS}
COMPUTE_VERSION_CACHE_TTL_MS=${COMPUTE_VERSION_CACHE_TTL_MS}
COMPUTE_PREWARM_ENABLED=${COMPUTE_PREWARM_ENABLED}
COMPUTE_PREWARM_INTERVAL_MS=${COMPUTE_PREWARM_INTERVAL_MS}
COMPUTE_PREWARM_STARTUP_DELAY_MS=${COMPUTE_PREWARM_STARTUP_DELAY_MS}
COMPUTE_PREWARM_PROJECTS=${COMPUTE_PREWARM_PROJECTS}
GATEWAY_SCHEDULER_ENABLED=${GATEWAY_SCHEDULER_ENABLED}
EOF
chmod 600 '${REMOTE_DIR}/secrets/gateway-runtime.env'
"

echo "[deploy] configure systemd drop-in for gateway runtime flags if gateway service exists"
ssh -o BatchMode=yes -o ConnectTimeout=15 "${SERVER}" "set -euo pipefail
if systemctl cat '${SERVICE_NAME}' >/dev/null 2>&1; then
  mkdir -p '/etc/systemd/system/${SERVICE_NAME}.service.d'
  cat > '/etc/systemd/system/${SERVICE_NAME}.service.d/20-app-api-flags.conf' <<EOF
[Service]
EnvironmentFile=-${REMOTE_DIR}/secrets/gateway-runtime.env
EOF
  systemctl daemon-reload
else
  echo '[remote] WARN: ${SERVICE_NAME}.service not found; skip drop-in'
fi
"

echo "[deploy] restart gateway service"
ssh -o BatchMode=yes -o ConnectTimeout=15 "${SERVER}" "set -euo pipefail
if systemctl cat '${SERVICE_NAME}' >/dev/null 2>&1; then
  systemctl restart '${SERVICE_NAME}'
else
  echo '[remote] WARN: ${SERVICE_NAME}.service not found; trying kingdee-park restart'
  systemctl restart kingdee-park
fi
"

echo "[deploy] verify public endpoints"
curl --max-time 15 -s -f "https://kdpark.fun/health" >/dev/null 2>&1 || true
CODE="000"
for i in 1 2 3 4 5 6 7 8; do
  CODE=$(curl --max-time 15 -s -o /dev/null -w "%{http_code}" "https://kdpark.fun/api/integration/app/auth/me" || echo "000")
  echo "[deploy] /api/integration/app/auth/me try=${i} HTTP ${CODE}"
  if [ "${CODE}" = "401" ]; then
    break
  fi
  sleep 2
done
if [ "${CODE}" != "401" ]; then
  echo "[deploy] ERROR: expected 401 for unauthenticated /api/integration/app/auth/me, got ${CODE}" >&2
  exit 1
fi

echo "[deploy] complete. write flags: global=${APP_API_WRITE_ENABLED}, payment=${APP_API_PAYMENT_WRITE_ENABLED}, tenant=${APP_API_TENANT_WRITE_ENABLED}; cache ttl dashboard=${COMPUTE_DASHBOARD_CACHE_TTL_MS}, billing=${COMPUTE_BILLING_CACHE_TTL_MS}; prewarm=${COMPUTE_PREWARM_ENABLED}; scheduler=${GATEWAY_SCHEDULER_ENABLED}; frontend=${DEPLOY_FRONTEND}"
