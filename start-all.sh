#!/bin/bash

# ============================================
# 金蝶地产——招商管理系统 - 一键启动脚本
# 前端: http://<本机IP>:1001（见下方 DETECT_IP）
# PocketBase 管理: http://<本机IP>:1002/_/
# ============================================

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 服务配置
FRONTEND_PORT=1001
BACKEND_PORT=1002
GATEWAY_PORT=8787

# 实际 Vite 运行端口（与 vite.config.ts 中 VITE_DEV_PORT / 默认 1001 一致）
VITE_PORT=1001

# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# 用于提示的局域网 IP（macOS / Linux）
if command -v ipconfig >/dev/null 2>&1; then
  DETECT_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "127.0.0.1")"
else
  DETECT_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")"
fi

# 加载本地环境变量（优先 .env.local，其次 .env；供 Vite / 其它工具使用）
if [ -f "${SCRIPT_DIR}/.env.local" ]; then
  set -a
  source "${SCRIPT_DIR}/.env.local"
  set +a
elif [ -f "${SCRIPT_DIR}/.env" ]; then
  set -a
  source "${SCRIPT_DIR}/.env"
  set +a
fi

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║      金蝶地产——招商管理系统 - 服务启动程序                  ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  前端访问: http://${DETECT_IP}:${VITE_PORT}                          ║"
echo "║  后端管理: http://${DETECT_IP}:${BACKEND_PORT}/_/                       ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# 清理端口占用函数
cleanup_port() {
    local port=$1
    local service_name=$2
    
    echo -e "${YELLOW}▶ 检查 ${service_name} 端口 ${port}...${NC}"
    
    # 查找占用端口的进程
    local pid=$(lsof -ti :${port} 2>/dev/null || netstat -vanp tcp 2>/dev/null | grep "${port}" | awk '{print $9}' | head -1)
    
    if [ -n "$pid" ]; then
        echo -e "${YELLOW}  发现端口 ${port} 被进程 ${pid} 占用，正在清理...${NC}"
        kill -9 ${pid} 2>/dev/null
        sleep 1
        
        # 再次检查
        local remaining_pid=$(lsof -ti :${port} 2>/dev/null)
        if [ -n "$remaining_pid" ]; then
            echo -e "${RED}  ✗ 端口 ${port} 清理失败，请手动检查${NC}"
            exit 1
        else
            echo -e "${GREEN}  ✓ 端口 ${port} 已清理${NC}"
        fi
    else
        echo -e "${GREEN}  ✓ 端口 ${port} 可用${NC}"
    fi
}

# 停止所有服务函数
stop_all_services() {
    echo ""
    echo -e "${YELLOW}▶ 正在停止所有服务...${NC}"
    
    # 停止前端服务 (npm run dev)
    local frontend_pids=$(pgrep -f "vite" | xargs)
    if [ -n "$frontend_pids" ]; then
        echo -e "${YELLOW}  停止前端服务...${NC}"
        echo "$frontend_pids" | xargs kill -9 2>/dev/null
    fi
    
    # 停止 PocketBase
    local pb_pids=$(pgrep -f "pocketbase serve" | xargs)
    if [ -n "$pb_pids" ]; then
        echo -e "${YELLOW}  停止 PocketBase 服务...${NC}"
        echo "$pb_pids" | xargs kill -9 2>/dev/null
    fi

    # 停止集成网关
    local gw_pids=$(pgrep -f "integration-gateway" | xargs)
    if [ -n "$gw_pids" ]; then
        echo -e "${YELLOW}  停止集成网关...${NC}"
        echo "$gw_pids" | xargs kill -9 2>/dev/null
    fi

    # 清理端口
    cleanup_port $VITE_PORT "前端"
    cleanup_port $BACKEND_PORT "后端"
    cleanup_port $GATEWAY_PORT "集成网关"
    
    echo -e "${GREEN}✓ 所有服务已停止${NC}"
    exit 0
}

# 设置信号捕获，按 Ctrl+C 时停止所有服务
trap stop_all_services SIGINT SIGTERM

echo -e "${BLUE}▶ 步骤 1/3: 清理端口残留...${NC}"
echo "────────────────────────────────────────"
cleanup_port $BACKEND_PORT "PocketBase后端"
cleanup_port $VITE_PORT "前端开发服务器"
echo ""

echo -e "${BLUE}▶ 步骤 2/3: 启动后端服务...${NC}"
echo "────────────────────────────────────────"

# 启动 PocketBase
echo -e "${YELLOW}▶ 启动 PocketBase (端口 ${BACKEND_PORT})...${NC}"
cd "${SCRIPT_DIR}/pocketbase"
# PocketBase 进程使用北京时间（UTC+8）
TZ=Asia/Shanghai nohup "${SCRIPT_DIR}/pocketbase/pocketbase" serve --http=0.0.0.0:${BACKEND_PORT} > "${SCRIPT_DIR}/pocketbase.log" 2>&1 &
PB_PID=$!
sleep 2

# 检查 PocketBase 是否成功启动
if ! lsof -ti :${BACKEND_PORT} > /dev/null 2>&1; then
    echo -e "${RED}✗ PocketBase 启动失败，请检查日志: ${SCRIPT_DIR}/pocketbase.log${NC}"
    exit 1
fi
echo -e "${GREEN}✓ PocketBase 已启动 (PID: ${PB_PID})${NC}"
echo -e "${CYAN}  管理后台: http://${DETECT_IP}:${BACKEND_PORT}/_/${NC}"
echo ""

echo -e "${BLUE}▶ 步骤 3/4: 启动集成网关...${NC}"
echo "────────────────────────────────────────"
cd "${SCRIPT_DIR}"
echo -e "${YELLOW}▶ 启动 Integration Gateway (端口 ${GATEWAY_PORT})...${NC}"
nohup npx tsx scripts/integration-gateway.ts > "${SCRIPT_DIR}/gateway.log" 2>&1 &
GATEWAY_PID=$!
sleep 2

if ! lsof -ti :${GATEWAY_PORT} > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠ 集成网关启动可能失败，请检查日志: ${SCRIPT_DIR}/gateway.log${NC}"
    echo -e "${YELLOW}  前端仍可正常使用，但 OpenClaw 计算 API 不可用${NC}"
else
    echo -e "${GREEN}✓ 集成网关已启动 (PID: ${GATEWAY_PID})${NC}"
    echo -e "${CYAN}  OpenClaw API: http://${DETECT_IP}:${GATEWAY_PORT}/api/integration/${NC}"
fi
echo ""

echo -e "${BLUE}▶ 步骤 4/4: 启动前端服务...${NC}"
echo "────────────────────────────────────────"
cd "${SCRIPT_DIR}"
echo -e "${YELLOW}▶ 启动 Vite 开发服务器 (端口 ${FRONTEND_PORT})...${NC}"
nohup npm run dev > "${SCRIPT_DIR}/frontend.log" 2>&1 &
FRONTEND_PID=$!
sleep 3

# 检查前端是否成功启动
if ! lsof -ti :${VITE_PORT} > /dev/null 2>&1; then
    echo -e "${RED}✗ 前端服务启动失败，请检查日志: ${SCRIPT_DIR}/frontend.log${NC}"
    kill ${PB_PID} 2>/dev/null
    exit 1
fi
echo -e "${GREEN}✓ 前端服务已启动 (PID: ${FRONTEND_PID})${NC}"
echo -e "${CYAN}  访问地址: http://${DETECT_IP}:${VITE_PORT}${NC}"
echo ""

echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                    所有服务启动成功！                        ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  🌐 前端页面: http://${DETECT_IP}:${VITE_PORT}                       ║${NC}"
echo -e "${GREEN}║  ⚙️  后端管理: http://${DETECT_IP}:${BACKEND_PORT}/_/                    ║${NC}"
echo -e "${GREEN}║  🔗 集成网关: http://${DETECT_IP}:${GATEWAY_PORT}                       ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  提示: 按 Ctrl+C 可一键停止所有服务                          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# 保持脚本运行，等待 Ctrl+C
wait
