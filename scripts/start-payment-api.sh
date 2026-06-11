#!/bin/bash
# 单独启动收款核销 API（供 WorkBuddy / 外部 Agent 调用）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

if [ -f .env.local ]; then
  set -a; source .env.local; set +a
elif [ -f .env ]; then
  set -a; source .env; set +a
fi

export PB_URL="${PB_URL:-http://127.0.0.1:1002}"
export PB_ADMIN_EMAIL="${PB_ADMIN_EMAIL:-${VITE_POCKETBASE_EMAIL:-}}"
export PB_ADMIN_PASSWORD="${PB_ADMIN_PASSWORD:-${VITE_POCKETBASE_PASSWORD:-}}"
export PAYMENT_API_PORT="${PAYMENT_API_PORT:-18788}"

if [ -z "$PB_ADMIN_EMAIL" ] || [ -z "$PB_ADMIN_PASSWORD" ]; then
  echo "❌ 缺少 Admin 凭证。请在 .env.local 中设置："
  echo "   PB_ADMIN_EMAIL=..."
  echo "   PB_ADMIN_PASSWORD=..."
  echo "   （或 VITE_POCKETBASE_EMAIL / VITE_POCKETBASE_PASSWORD）"
  exit 1
fi

if ! curl -sf --connect-timeout 2 "${PB_URL}/api/health" >/dev/null; then
  echo "❌ PocketBase 未运行: ${PB_URL}"
  echo "   请先启动 PocketBase（例如 ./start-all.sh 或 pocketbase serve --http=0.0.0.0:1002）"
  exit 1
fi

echo "▶ 启动 payment-api → http://0.0.0.0:${PAYMENT_API_PORT}"
echo "  PocketBase: ${PB_URL}"
echo "  日志: ${SCRIPT_DIR}/payment-api.log"
nohup npm run payment-api > "${SCRIPT_DIR}/payment-api.log" 2>&1 &
sleep 2

if curl -sf "http://127.0.0.1:${PAYMENT_API_PORT}/health" >/dev/null; then
  echo "✓ payment-api 已就绪"
  curl -s "http://127.0.0.1:${PAYMENT_API_PORT}/health"
  echo ""
else
  echo "❌ 启动失败，查看日志:"
  tail -30 "${SCRIPT_DIR}/payment-api.log"
  exit 1
fi
