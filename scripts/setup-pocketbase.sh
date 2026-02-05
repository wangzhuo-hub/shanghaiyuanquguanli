#!/bin/bash

# PocketBase Collection 初始化脚本
# 此脚本通过PocketBase Admin API创建必要的collection

echo "🔧 正在配置PocketBase collection..."

# 等待PocketBase启动
echo "⏳ 等待PocketBase服务启动..."
sleep 2

# 检查PocketBase是否运行
if ! curl -s http://127.0.0.1:8091/api/health > /dev/null 2>&1; then
    echo "❌ PocketBase未运行在8091端口"
    echo "请先启动: ./pocketbase serve --http=127.0.0.1:8091"
    exit 1
fi

echo "✅ PocketBase服务正在运行"
echo ""
echo "📋 请按照以下步骤手动创建collection:"
echo ""
echo "1. 访问PocketBase管理后台:"
echo "   http://127.0.0.1:8091/_/"
echo ""
echo "2. 创建管理员账号（如果首次启动）"
echo ""
echo "3. 创建新的Collection:"
echo "   - 名称: park_leasing_backups"
echo "   - 类型: Base"
echo ""
echo "4. 添加字段:"
echo "   字段1:"
echo "     - 名称: name"
echo "     - 类型: Text"
echo "     - 必填: 是"
echo ""
echo "   字段2:"
echo "     - 名称: data"
echo "     - 类型: JSON"
echo "     - 必填: 是"
echo ""
echo "5. API Rules设置（允许无认证访问）:"
echo "   - List/Search: 留空（允许所有）"
echo "   - View: 留空（允许所有）"
echo "   - Create: 留空（允许所有）"
echo "   - Update: 留空（允许所有）"
echo "   - Delete: 留空（允许所有）"
echo ""
echo "6. 保存配置"
echo ""
echo "完成后，你可以："
echo "  - 使用应用界面进行数据备份和恢复"
echo "  - 启动应用: npm run dev"
echo "  - 启动局域网模式: ./start-lan.sh"
