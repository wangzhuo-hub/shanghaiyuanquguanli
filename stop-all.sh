#!/bin/bash

# 停止所有服务的脚本

echo "🛑 停止上海商机及渠道管理系统所有服务..."
echo "================================================"

# 停止PocketBase 8091
if lsof -ti:8091 > /dev/null 2>&1; then
    echo "   停止PocketBase (8091端口)..."
    kill -9 $(lsof -ti:8091) 2>/dev/null
    echo "   ✅ 已停止"
fi

# 停止Vite开发服务器 (3000-3010端口)
for port in {3000..3010}; do
    if lsof -ti:$port > /dev/null 2>&1; then
        echo "   停止Vite (${port}端口)..."
        kill -9 $(lsof -ti:$port) 2>/dev/null
        echo "   ✅ 已停止"
    fi
done

echo ""
echo "✅ 所有服务已停止"
