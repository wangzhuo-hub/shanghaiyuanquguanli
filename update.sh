#!/bin/bash
# ============================================================
#  招商看板 — 远程更新脚本
#  用法: ./update.sh
#  前提: 首次已跑过 ./deploy.sh，服务器已部署
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER="root@47.92.35.188"
REMOTE_DIR="/opt/kingdee-park"

cd "${SCRIPT_DIR}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║       招商看板 — 远程更新                                ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# 1. 构建
echo -e "${YELLOW}[1/3] 构建前端...${NC}"
VITE_POCKETBASE_URL=/ npm run build
echo -e "${GREEN}  构建完成${NC}"

# 2. 上传前端
echo -e "${YELLOW}[2/3] 上传前端文件...${NC}"
ssh "${SERVER}" "rm -rf ${REMOTE_DIR}/pb_public/*"
rsync -az --delete "${SCRIPT_DIR}/dist/" "${SERVER}:${REMOTE_DIR}/pb_public/"
echo -e "${GREEN}  上传完成${NC}"

# 3. 检查服务
echo -e "${YELLOW}[3/3] 验证服务...${NC}"
sleep 2
CODE=$(curl -s -o /dev/null -w "%{http_code}" https://kdpark.fun/ 2>/dev/null || echo "000")
if [ "$CODE" = "200" ]; then
    echo -e "  ${GREEN}✓ https://kdpark.fun 正常 (${CODE})${NC}"
else
    echo -e "  ${RED}✗ 状态码 ${CODE}，请检查服务器${NC}"
fi

echo ""
echo -e "${BOLD}${GREEN}更新完成${NC}"
echo ""
