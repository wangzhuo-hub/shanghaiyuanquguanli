#!/usr/bin/env bash
# 开发前基线备份：Git 标签 + PocketBase pb_data 归档 +（可选）各园区 JSON 导出
#
# 用法：
#   bash scripts/create-dev-baseline-backup.sh
#   bash scripts/create-dev-baseline-backup.sh --skip-json    # 仅代码标签 + pb_data，不连 PB 导出 JSON
#
# 环境变量（JSON 导出时需要）：
#   PB_URL  PB_ADMIN_EMAIL  PB_ADMIN_PASSWORD
# 默认 PB_URL=http://127.0.0.1:1002

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SKIP_JSON=false
for arg in "$@"; do
  case "$arg" in
    --skip-json) SKIP_JSON=true ;;
  esac
done

STAMP="$(date +%Y%m%d-%H%M%S)"
LABEL="pre-mgmt-fee-${STAMP}"
BACKUP_ROOT="${BACKUP_ROOT:-$ROOT/backups}"
BASE_DIR="$BACKUP_ROOT/$LABEL"
GIT_TAG="baseline/$LABEL"

mkdir -p "$BASE_DIR"

echo "==> 备份目录: $BASE_DIR"

# --- 1. Git 基线（当前提交打标签，便于代码回退）---
GIT_SHA="$(git rev-parse HEAD)"
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
{
  echo "git_sha=$GIT_SHA"
  echo "git_branch=$GIT_BRANCH"
  echo "git_tag=$GIT_TAG"
  echo "created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "$BASE_DIR/git-baseline.txt"

if git rev-parse "$GIT_TAG" >/dev/null 2>&1; then
  echo "==> Git 标签已存在，跳过: $GIT_TAG"
else
  git tag -a "$GIT_TAG" -m "开发前基线备份（物业费功能） $STAMP"
  echo "==> Git 标签已创建: $GIT_TAG @ $GIT_SHA"
fi

# --- 2. PocketBase 本地库文件（pb_data）---
PB_DATA="$ROOT/pocketbase/pb_data"
if [[ -d "$PB_DATA" ]]; then
  PB_ARCHIVE="$BASE_DIR/pocketbase-pb_data.tar.gz"
  echo "==> 打包 pb_data → $(basename "$PB_ARCHIVE")"
  tar -czf "$PB_ARCHIVE" -C "$ROOT/pocketbase" pb_data
  du -sh "$PB_ARCHIVE"
else
  echo "==> 警告: 未找到 $PB_DATA，跳过 pb_data 归档（若仅用远程 PB，请用 JSON 导出）"
fi

# --- 3. 迁移文件快照（schema 版本）---
MIG_ARCHIVE="$BASE_DIR/pocketbase-pb_migrations.tar.gz"
tar -czf "$MIG_ARCHIVE" -C "$ROOT/pocketbase" pb_migrations
echo "==> 已归档 pb_migrations"

# --- 4. 各园区 JSON（需 PocketBase 在线 + 管理员账号）---
JSON_DIR="$BASE_DIR/json"
if [[ "$SKIP_JSON" == "true" ]]; then
  echo "==> 跳过 JSON 导出（--skip-json）"
else
  if [[ -f "$ROOT/.env.local" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT/.env.local" 2>/dev/null || true
    set +a
  fi
  export PB_URL="${PB_URL:-http://127.0.0.1:1002}"
  export BACKUP_OUT_DIR="$JSON_DIR"
  if [[ -n "${PB_ADMIN_EMAIL:-}" && -n "${PB_ADMIN_PASSWORD:-}" ]]; then
  echo "==> JSON 导出 PB_URL=$PB_URL → $JSON_DIR"
    if node scripts/export-pb-dashboard-backup.mjs; then
      echo "==> JSON 导出成功"
    else
      echo "==> 警告: JSON 导出失败（PB 未启动或凭据错误）。可稍后执行:"
      echo "       PB_URL=... PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... BACKUP_OUT_DIR=$JSON_DIR node scripts/export-pb-dashboard-backup.mjs"
    fi
  else
    echo "==> 警告: 未设置 PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD，跳过 JSON 导出"
    echo "       请设置环境变量后手动运行 export-pb-dashboard-backup.mjs"
  fi
fi

# --- 5. 清单 ---
MANIFEST="$BASE_DIR/MANIFEST.json"
node -e "
const fs=require('fs');
const p=process.argv[1];
const m={
  label: process.argv[2],
  created_at: new Date().toISOString(),
  git: { tag: process.argv[3], sha: process.argv[4], branch: process.argv[5] },
  artifacts: {
    pb_data_tar: fs.existsSync(p+'/pocketbase-pb_data.tar.gz'),
    migrations_tar: fs.existsSync(p+'/pocketbase-pb_migrations.tar.gz'),
    json_dir: fs.existsSync(p+'/json'),
  },
  rollback_doc: 'docs/07-开发前备份与回退.md',
};
fs.writeFileSync(p+'/MANIFEST.json', JSON.stringify(m,null,2));
" "$BASE_DIR" "$LABEL" "$GIT_TAG" "$GIT_SHA" "$GIT_BRANCH"

echo ""
echo "=============================================="
echo " 基线备份完成"
echo " 目录: $BASE_DIR"
echo " Git 回退代码: git checkout $GIT_TAG"
echo " 说明文档: docs/07-开发前备份与回退.md"
echo "=============================================="
