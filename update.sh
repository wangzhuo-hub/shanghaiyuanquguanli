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
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║       招商看板 — 远程更新                                ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# 1. 构建（从服务器读取 integration token，注入前端 bundle）
echo -e "${YELLOW}[1/3] 构建前端...${NC}"
INTEGRATION_TOKEN=""
if INTEGRATION_TOKEN="$(ssh "${SERVER}" "cat ${REMOTE_DIR}/secrets/integration-internal-token 2>/dev/null" | tr -d '\r\n')"; then
    if [ -n "${INTEGRATION_TOKEN}" ]; then
        echo -e "${GREEN}  已读取 integration-internal-token${NC}"
    else
        echo -e "${RED}  警告: 服务器未配置 ${REMOTE_DIR}/secrets/integration-internal-token，保存后不会触发网关 KPI 重算${NC}"
    fi
else
    echo -e "${RED}  警告: 无法读取 integration token${NC}"
fi
VITE_POCKETBASE_URL=/ VITE_INTEGRATION_INTERNAL_TOKEN="${INTEGRATION_TOKEN}" npm run build
echo -e "${GREEN}  构建完成${NC}"

# 2. PocketBase 迁移（新字段须先落库，否则保存报 Something went wrong）
if [ "${SKIP_PB_MIGRATE:-0}" != "1" ]; then
    echo -e "${YELLOW}[2/4] 同步 PocketBase 迁移...${NC}"
    if bash "${SCRIPT_DIR}/scripts/deploy-pocketbase-migrations.sh"; then
        echo -e "${GREEN}  迁移同步完成${NC}"
    else
        echo -e "${RED}  警告: PocketBase 迁移同步失败；若保存仍报错请手动执行 scripts/deploy-pocketbase-migrations.sh${NC}"
    fi
else
    echo -e "${YELLOW}[2/4] 跳过 PocketBase 迁移 (SKIP_PB_MIGRATE=1)${NC}"
fi

# 3. 上传前端
echo -e "${YELLOW}[3/4] 上传前端文件...${NC}"
ssh "${SERVER}" "rm -rf ${REMOTE_DIR}/pb_public/*"
rsync -az --delete "${SCRIPT_DIR}/dist/" "${SERVER}:${REMOTE_DIR}/pb_public/"
echo -e "${GREEN}  上传完成${NC}"

# 4. 检查服务
echo -e "${YELLOW}[4/4] 验证服务...${NC}"
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
