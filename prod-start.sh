#!/bin/bash
# ============================================================
#  金蝶招商管理看板 — 生产环境启动脚本
#  使用前请先运行: ./deploy.sh
#  启动后访问: http://<本机IP>:1001
#  PocketBase 管理: http://<本机IP>:1001/_/
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

# ---- 端口配置 ----
PORT=1001
AI_PROXY_PORT=3010

# ---- 颜色 ----
CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

PIDS=()

# ---- 获取局域网 IP ----
detect_ip() {
  local ip
  ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
  echo "${ip:-127.0.0.1}"
}
LAN_IP=$(detect_ip)

# ---- 清理 ----
cleanup() {
  echo ""
  echo -e "${YELLOW}正在停止所有服务...${NC}"
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  lsof -ti tcp:"${PORT}" | xargs kill -9 2>/dev/null || true
  lsof -ti tcp:"${AI_PROXY_PORT}" | xargs kill -9 2>/dev/null || true
  echo -e "${GREEN}所有服务已停止。${NC}"
  exit 0
}
trap cleanup SIGINT SIGTERM

# ---- 加载 .env ----
if [ -f "${SCRIPT_DIR}/.env.local" ]; then
  set -a; source "${SCRIPT_DIR}/.env.local"; set +a
elif [ -f "${SCRIPT_DIR}/.env" ]; then
  set -a; source "${SCRIPT_DIR}/.env"; set +a
fi

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║       金蝶招商管理看板 — 生产环境                        ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# ---- 检查部署文件 ----
if [ ! -d "${SCRIPT_DIR}/pocketbase/pb_public" ] || [ -z "$(ls -A "${SCRIPT_DIR}/pocketbase/pb_public" 2>/dev/null)" ]; then
  echo -e "${RED}错误: pb_public 目录为空，请先运行 ./deploy.sh 进行部署${NC}"
  exit 1
fi

# ---- 清理残留端口 ----
echo -e "${YELLOW}清理残留端口...${NC}"
lsof -ti tcp:"${PORT}" | xargs kill -9 2>/dev/null || true
lsof -ti tcp:"${AI_PROXY_PORT}" | xargs kill -9 2>/dev/null || true
sleep 1
echo -e "${GREEN}端口已清空${NC}"

# ---- 启动 PocketBase（同时服务 API + 前端静态文件） ----
echo ""
echo -e "${GREEN}启动 PocketBase（端口 ${PORT}）...${NC}"
"${SCRIPT_DIR}/pocketbase/pocketbase" serve \
  --http="0.0.0.0:${PORT}" \
  --dir="${SCRIPT_DIR}/pocketbase/pb_data" \
  > /tmp/pb_prod_${PORT}.log 2>&1 &
PIDS+=($!)
sleep 2

if lsof -ti tcp:${PORT} > /dev/null 2>&1; then
  echo -e "${GREEN}✓ PocketBase 已启动${NC}"
else
  echo -e "${RED}✗ PocketBase 启动失败，查看: /tmp/pb_prod_${PORT}.log${NC}"
  exit 1
fi

# ---- 启动 AI 代理（可选） ----
QWEN_KEY="${QWEN_API_KEY:-${DASHSCOPE_API_KEY:-}}"
if [ -n "${QWEN_KEY}" ]; then
  echo -e "${GREEN}启动 AI 代理（端口 ${AI_PROXY_PORT}）...${NC}"
  QWEN_API_KEY="${QWEN_KEY}" node "${SCRIPT_DIR}/ai-proxy.mjs" \
    > /tmp/ai_proxy_${AI_PROXY_PORT}.log 2>&1 &
  PIDS+=($!)
  echo -e "${GREEN}✓ AI 代理已启动${NC}"
else
  echo -e "${YELLOW}⚠ 未设置 QWEN_API_KEY，AI 功能不可用${NC}"
fi

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║              生产环境已就绪                              ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}访问地址：${NC}"
echo -e "    本机:        ${CYAN}http://127.0.0.1:${PORT}${NC}"
echo -e "    局域网:      ${CYAN}http://${LAN_IP}:${PORT}${NC}"
echo -e "    后端管理:    ${CYAN}http://${LAN_IP}:${PORT}/_/${NC}"
echo ""
echo -e "  ${YELLOW}按 Ctrl+C 可停止所有服务${NC}"
echo ""

wait
