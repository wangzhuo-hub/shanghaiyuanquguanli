#!/bin/bash
# 优化验证脚本：在云服务器上运行 compute-engine 并与基线对比
# 用法: bash scripts/verify-optimization.sh
set -e

SERVER="root@47.92.35.188"
SSH_KEY="$HOME/.ssh/id_ed25519"
REMOTE_DIR="/opt/kingdee-park"
BASELINE="scripts/baselines/kpi-baseline-cloud-2026.json"
PROJECT="${1:-shanghai_park}"
YEAR="${2:-2026}"

echo "=== 优化验证 ==="
echo "项目: $PROJECT 年份: $YEAR"
echo "基线: $BASELINE"
echo ""

# 1. 同步代码到云服务器
echo "[1/4] 同步代码到云服务器..."
rsync -avz --exclude 'node_modules' --exclude 'pb_data' --exclude '.git' \
    -e "ssh -i $SSH_KEY" \
    "$(dirname "$0")/../services/" "$SERVER:$REMOTE_DIR/services/" 2>&1 | tail -1
rsync -avz \
    -e "ssh -i $SSH_KEY" \
    "$(dirname "$0")/compute-engine.ts" "$SERVER:$REMOTE_DIR/scripts/compute-engine.ts" 2>&1 | tail -1

# 2. 在云服务器上创建临时 superuser
echo "[2/4] 创建临时凭证..."
ssh -i "$SSH_KEY" "$SERVER" "cd $REMOTE_DIR && ./pocketbase superuser create verify-tmp@kd.com verifytmp123 2>&1 || echo '(already exists)'"

# 3. 运行 compute-engine
echo "[3/4] 运行 compute-engine..."
RESULT=$(ssh -i "$SSH_KEY" "$SERVER" \
    "cd $REMOTE_DIR && PB_URL=http://127.0.0.1:1001 PB_ADMIN_EMAIL=verify-tmp@kd.com PB_ADMIN_PASSWORD=verifytmp123 npx tsx scripts/compute-engine.ts --project $PROJECT --year $YEAR --url http://127.0.0.1:1001" 2>/dev/null)

# 4. 对比结果
TMPFILE=$(mktemp)
echo "$RESULT" > "$TMPFILE"

echo "[4/4] 对比结果..."
npx tsx scripts/compare-kpi-baseline.ts --baseline "$BASELINE" --compare "$TMPFILE" 2>&1
COMPARE_EXIT=$?

rm -f "$TMPFILE"

# 清理
ssh -i "$SSH_KEY" "$SERVER" "cd $REMOTE_DIR && ./pocketbase superuser delete verify-tmp@kd.com 2>&1 || true"

if [ $COMPARE_EXIT -eq 0 ]; then
    echo ""
    echo "验证通过! 优化未改变 KPI 计算结果"
    exit 0
else
    echo ""
    echo "验证失败! KPI 计算结果存在差异"
    exit 1
fi
