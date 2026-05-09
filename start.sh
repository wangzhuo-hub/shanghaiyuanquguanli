#!/bin/bash
# ============================================================
#  金蝶招商管理看板 — 一键启动脚本
#  前端: :1001  后端(PocketBase): :1002
#  AI代理: :3010  集成网关: :8787
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---- 端口配置 ----
FE_PORT=1001
BE_PORT=1002
AI_PROXY_PORT=3010
GW_PORT=8787
ALL_PORTS="${FE_PORT} ${BE_PORT} ${AI_PROXY_PORT} ${GW_PORT}"

# ---- 颜色 ----
CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

# ---- 全局 PIDs ----
PIDS=()

# ---- 获取局域网 IP ----
detect_ip() {
  local ip
  ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
  echo "${ip:-127.0.0.1}"
}
LAN_IP=$(detect_ip)

# ---- 加载 .env ----
load_env() {
  if [ -f "${SCRIPT_DIR}/.env.local" ]; then
    set -a; source "${SCRIPT_DIR}/.env.local"; set +a
  elif [ -f "${SCRIPT_DIR}/.env" ]; then
    set -a; source "${SCRIPT_DIR}/.env"; set +a
  fi
}
load_env

# ---- 清理: 按 Ctrl+C 停止所有服务 ----
cleanup() {
  echo ""
  echo -e "${YELLOW}正在停止所有服务...${NC}"
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  for port in ${ALL_PORTS}; do
    lsof -ti tcp:"${port}" | xargs kill -9 2>/dev/null || true
  done
  echo -e "${GREEN}所有服务已停止。${NC}"
  exit 0
}
trap cleanup SIGINT SIGTERM

# ---- 工具: 端口是否被占用 ----
port_in_use() { lsof -ti tcp:"$1" >/dev/null 2>&1; }

# ---- 等待端口就绪 ----
wait_for_port() {
  local port=$1 label=$2 max=${3:-30}
  local n=0
  while [ $n -lt "$max" ]; do
    if port_in_use "$port"; then
      echo -e "   ${GREEN}✓${NC} ${label} 已就绪 (端口 ${port})"
      return 0
    fi
    sleep 1; n=$((n + 1))
  done
  echo -e "   ${RED}✗${NC} ${label} 超时未就绪 (端口 ${port})"
  return 1
}

# ---- 清理残留端口 ----
clear_ports() {
  for port in ${ALL_PORTS}; do
    lsof -ti tcp:"${port}" | xargs kill -9 2>/dev/null || true
  done
  sleep 1
}

# ---- 自检: 前后端连通性 ----
health_check() {
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 "http://127.0.0.1:${FE_PORT}/" 2>/dev/null || echo "000")
  local fe_ok=0; [[ "$code" =~ ^[23] ]] && fe_ok=1

  code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 3 "http://127.0.0.1:${BE_PORT}/api/health" 2>/dev/null || echo "000")
  local be_ok=0; [[ "$code" =~ ^[23] ]] && be_ok=1

  if [ "$fe_ok" -eq 1 ] && [ "$be_ok" -eq 1 ]; then
    echo -e "  ${GREEN}✓${NC} 前端(:${FE_PORT}) ↔ 后端(:${BE_PORT}) 连接正常"
    return 0
  else
    echo -e "  ${RED}✗${NC} 前端=$([ "$fe_ok" -eq 1 ] && echo 'OK' || echo 'FAIL') 后端=$([ "$be_ok" -eq 1 ] && echo 'OK' || echo 'FAIL')"
    return 1
  fi
}

# ============================================================
# 启动横幅
# ============================================================
echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║         金蝶招商管理看板 — 服务启动程序                 ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}服务端口:${NC}"
echo -e "    前端 (Vite)        → ${CYAN}${FE_PORT}${NC}"
echo -e "    后端 (PocketBase)  → ${CYAN}${BE_PORT}${NC}"
echo -e "    AI 代理 (千问)     → ${CYAN}${AI_PROXY_PORT}${NC}"
echo -e "    集成网关 (OpenClaw)→ ${CYAN}${GW_PORT}${NC}"
echo ""

# ============================================================
# Step 1: 清理端口
# ============================================================
echo -e "${YELLOW}[1/4] 清理残留端口...${NC}"
clear_ports
echo -e "${GREEN}  所有端口已清空。${NC}"
echo ""

# ============================================================
# Step 2: 启动 PocketBase 后端
# ============================================================
echo -e "${GREEN}[2/4] 启动 PocketBase 后端...${NC}"
PB_BIN="${SCRIPT_DIR}/pocketbase/pocketbase"
PB_DIR="${SCRIPT_DIR}/pocketbase/pb_data"

"${PB_BIN}" serve \
  --http="0.0.0.0:${BE_PORT}" \
  --dir="${PB_DIR}" \
  > /tmp/pb_${BE_PORT}.log 2>&1 &
local_bg_pid=$!
PIDS+=(${local_bg_pid})
echo -e "   后端 → http://${LAN_IP}:${BE_PORT}  (PID: ${local_bg_pid})"
wait_for_port "${BE_PORT}" "PocketBase 后端" || true
echo ""

# ============================================================
# Step 3: 启动 AI 代理 (ai-proxy.mjs)
# ============================================================
echo -e "${GREEN}[3/4] 启动 AI 代理...${NC}"

QWEN_KEY="${QWEN_API_KEY:-${DASHSCOPE_API_KEY:-}}"
if [ -z "${QWEN_KEY}" ]; then
  echo -e "   ${YELLOW}⚠ 未设置 QWEN_API_KEY，AI 代理将跳过启动${NC}"
  echo -e "   ${YELLOW}  export QWEN_API_KEY=\"your_key\" 后重新运行本脚本${NC}"
else
  QWEN_API_KEY="${QWEN_KEY}" node "${SCRIPT_DIR}/ai-proxy.mjs" \
    > /tmp/ai_proxy_${AI_PROXY_PORT}.log 2>&1 &
  local_bg_pid=$!
  PIDS+=(${local_bg_pid})
  echo -e "   AI 代理 → http://${LAN_IP}:${AI_PROXY_PORT}  (PID: ${local_bg_pid})"
  wait_for_port "${AI_PROXY_PORT}" "AI 代理" || true
fi
echo ""

# ============================================================
# Step 4: 启动集成网关 (Optional)
# ============================================================
echo -e "${GREEN}[可选] 启动集成网关...${NC}"

GW_PB_EMAIL="${PB_ADMIN_EMAIL:-wangzhuo@kingdee.com}"
GW_PB_PASSWORD="${PB_ADMIN_PASSWORD:-}"
if [ -z "${GW_PB_PASSWORD}" ] && [ -f "${SCRIPT_DIR}/.env.local" ]; then
  GW_PB_PASSWORD=$(grep -E '^VITE_POCKETBASE_PASSWORD=' "${SCRIPT_DIR}/.env.local" | cut -d'=' -f2- | tr -d '"' | tr -d "'" || echo "")
fi

if [ -z "${GW_PB_PASSWORD}" ]; then
  echo -e "   ${YELLOW}⚠ 未配置 PocketBase 管理员密码，集成网关跳过启动${NC}"
else
  (cd "${SCRIPT_DIR}" && \
    PB_URL="http://127.0.0.1:${BE_PORT}" \
    PB_ADMIN_EMAIL="${GW_PB_EMAIL}" \
    PB_ADMIN_PASSWORD="${GW_PB_PASSWORD}" \
    npx tsx scripts/integration-gateway.ts) \
    > /tmp/gateway_${GW_PORT}.log 2>&1 &
  local_bg_pid=$!
  PIDS+=(${local_bg_pid})
  echo -e "   集成网关 → http://${LAN_IP}:${GW_PORT}  (PID: ${local_bg_pid})"
  wait_for_port "${GW_PORT}" "集成网关" 10 || true
fi
echo ""

# ============================================================
# Step 5: 启动 Vite 前端
# ============================================================
echo -e "${GREEN}[启动] 启动 Vite 前端开发服务器...${NC}"
(cd "${SCRIPT_DIR}" && npm run dev) \
  > /tmp/fe_${FE_PORT}.log 2>&1 &
local_bg_pid=$!
PIDS+=(${local_bg_pid})
echo -e "   前端 → http://${LAN_IP}:${FE_PORT}  (PID: ${local_bg_pid})"
wait_for_port "${FE_PORT}" "Vite 前端" || true
echo ""

# ============================================================
# 自检
# ============================================================
echo -e "${BOLD}${YELLOW}自检前后端连接...${NC}"
sleep 2
health_check
echo ""

# ============================================================
# 启动完成
# ============================================================
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║               所有服务启动完成 ✓                        ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}访问地址 (本局域网 IP: ${LAN_IP}):${NC}"
echo -e "    前端页面:   ${CYAN}http://${LAN_IP}:${FE_PORT}${NC}"
echo -e "    后端管理:   ${CYAN}http://${LAN_IP}:${BE_PORT}/_/${NC}"
if [ -n "${QWEN_KEY:-}" ]; then
  echo -e "    AI 代理:    ${CYAN}http://${LAN_IP}:${AI_PROXY_PORT}${NC}"
fi
if [ -n "${GW_PB_PASSWORD:-}" ]; then
  echo -e "    集成网关:   ${CYAN}http://${LAN_IP}:${GW_PORT}${NC}"
fi
echo ""
echo -e "${YELLOW}  按 Ctrl+C 可一键停止所有服务${NC}"
echo -e "${YELLOW}  日志: /tmp/pb_${BE_PORT}.log /tmp/fe_${FE_PORT}.log${NC}"
echo ""

wait
