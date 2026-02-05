#!/bin/bash

# PocketBase 快速配置脚本
# 用于自动下载、安装和配置 PocketBase

set -e

echo "========================================="
echo "PocketBase 快速配置工具"
echo "========================================="
echo ""

# 检测操作系统
OS="$(uname -s)"
case "${OS}" in
    Linux*)     PLATFORM=linux;;
    Darwin*)    PLATFORM=darwin;;
    *)          echo "❌ 不支持的操作系统: ${OS}"; exit 1;;
esac

# 检测架构
ARCH="$(uname -m)"
case "${ARCH}" in
    x86_64)     ARCH_TYPE=amd64;;
    arm64)      ARCH_TYPE=arm64;;
    aarch64)    ARCH_TYPE=arm64;;
    *)          echo "❌ 不支持的架构: ${ARCH}"; exit 1;;
esac

# PocketBase 版本
VERSION="0.22.0"
DOWNLOAD_URL="https://github.com/pocketbase/pocketbase/releases/download/v${VERSION}/pocketbase_${VERSION}_${PLATFORM}_${ARCH_TYPE}.zip"

echo "检测到系统: ${PLATFORM} ${ARCH_TYPE}"
echo ""

# 创建目录
PB_DIR="./pocketbase"
if [ -d "$PB_DIR" ]; then
    echo "⚠️  pocketbase 目录已存在"
    read -p "是否删除并重新安装? (y/n): " confirm
    if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
        rm -rf "$PB_DIR"
        echo "✓ 已删除旧目录"
    else
        echo "❌ 已取消安装"
        exit 0
    fi
fi

mkdir -p "$PB_DIR"
cd "$PB_DIR"

echo "步骤 1: 下载 PocketBase v${VERSION}..."
if command -v curl &> /dev/null; then
    curl -L "$DOWNLOAD_URL" -o pocketbase.zip
elif command -v wget &> /dev/null; then
    wget "$DOWNLOAD_URL" -O pocketbase.zip
else
    echo "❌ 未找到 curl 或 wget，请手动下载"
    exit 1
fi

echo "✓ 下载完成"
echo ""

echo "步骤 2: 解压文件..."
unzip -q pocketbase.zip
rm pocketbase.zip
chmod +x pocketbase
echo "✓ 解压完成"
echo ""

echo "步骤 3: 创建启动脚本..."
cat > start.sh << 'EOF'
#!/bin/bash
echo "启动 PocketBase..."
echo "Admin UI: http://127.0.0.1:8090/_/"
echo "API: http://127.0.0.1:8090/api/"
echo ""
echo "按 Ctrl+C 停止服务器"
echo ""
./pocketbase serve
EOF

chmod +x start.sh
echo "✓ 启动脚本创建完成"
echo ""

echo "步骤 4: 创建 schema 文件..."
cat > schema.json << 'EOF'
{
  "name": "park_backups",
  "type": "base",
  "system": false,
  "schema": [
    {
      "id": "project_id",
      "name": "project_id",
      "type": "text",
      "required": true,
      "options": {
        "min": null,
        "max": null,
        "pattern": ""
      }
    },
    {
      "id": "data",
      "name": "data",
      "type": "json",
      "required": true,
      "options": {}
    },
    {
      "id": "note",
      "name": "note",
      "type": "text",
      "required": false,
      "options": {
        "min": null,
        "max": null,
        "pattern": ""
      }
    }
  ],
  "indexes": [
    "CREATE INDEX idx_project_id ON park_backups (project_id)"
  ],
  "listRule": "@request.auth.id != \"\"",
  "viewRule": "@request.auth.id != \"\"",
  "createRule": "@request.auth.id != \"\"",
  "updateRule": "@request.auth.id != \"\"",
  "deleteRule": "@request.auth.id != \"\" && @request.auth.admin = true",
  "options": {}
}
EOF

echo "✓ Schema 文件创建完成"
echo ""

echo "========================================="
echo "✅ PocketBase 安装完成！"
echo "========================================="
echo ""
echo "下一步操作："
echo ""
echo "1. 启动 PocketBase："
echo "   cd pocketbase"
echo "   ./start.sh"
echo ""
echo "2. 访问 Admin UI:"
echo "   http://127.0.0.1:8090/_/"
echo ""
echo "3. 创建管理员账号（首次访问时）"
echo ""
echo "4. 导入 Collection:"
echo "   - 在 Admin UI 中点击 'Collections'"
echo "   - 点击 'Import collections'"
echo "   - 选择 pocketbase/schema.json"
echo "   - 点击 'Review' 然后 'Confirm'"
echo ""
echo "5. 在应用设置中配置 PocketBase:"
echo "   - 后端提供商: PocketBase（推荐）"
echo "   - URL: http://127.0.0.1:8090"
echo "   - 输入管理员邮箱和密码"
echo "   - 保存配置"
echo ""
echo "详细文档: POCKETBASE_SETUP.md"
echo ""
