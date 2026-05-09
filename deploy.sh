#!/bin/bash
# ============================================================
#  金蝶招商管理看板 — 生产部署脚本
#  只需运行一次：./deploy.sh
#  之后每次修改代码后重新运行即可
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║       金蝶招商管理看板 — 生产环境部署                    ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Step 1: 安装依赖（首次需要）
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}[1/3] 安装项目依赖...${NC}"
    npm install
else
    echo -e "${GREEN}[1/3] 依赖已安装，跳过${NC}"
fi

# Step 2: 构建前端（生产模式）
echo -e "${YELLOW}[2/3] 构建前端（生产模式）...${NC}"
VITE_POCKETBASE_URL=/ npm run build
echo -e "${GREEN}  构建完成 → dist/${NC}"

# Step 3: 部署到 PocketBase 静态目录
echo -e "${YELLOW}[3/3] 部署到 PocketBase...${NC}"
rm -rf pocketbase/pb_public
cp -r dist pocketbase/pb_public
echo -e "${GREEN}  已部署 → pocketbase/pb_public/${NC}"

echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║              部署成功！                                  ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}现在可以启动生产服务：${NC}"
echo -e "  ${CYAN}./prod-start.sh${NC}"
echo ""
