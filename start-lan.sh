#!/bin/bash

# 局域网运行启动脚本
# 此脚本会启动所有必需的服务，支持局域网访问

echo "🚀 启动上海商机及渠道管理系统（局域网模式）"
echo "================================================"

# 获取本机局域网IP
LOCAL_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
echo "📍 本机IP地址: $LOCAL_IP"
echo ""

# 1. 检查并停止旧的PocketBase进程
echo "🔄 检查现有PocketBase进程..."
if lsof -ti:9008 > /dev/null 2>&1; then
    echo "   停止9008端口的PocketBase..."
    kill -9 $(lsof -ti:9008) 2>/dev/null
fi
sleep 1

# 2. 启动本系统的PocketBase (9008端口)
echo "📦 启动本系统PocketBase (端口9008)..."
if [ -f "./pocketbase" ]; then
    ./pocketbase serve --http="0.0.0.0:9008" > /tmp/pb_9008.log 2>&1 &
    echo "   ✅ 启动成功"
else
    echo "   ❌ 未找到pocketbase可执行文件"
    exit 1
fi

sleep 2

# 3. 启动Vite开发服务器
echo "🌐 启动前端开发服务器..."
npm run dev &
VITE_PID=$!

sleep 5

# 检测Vite实际运行的端口
VITE_PORT=$(lsof -ti:3004,3005,3006,3007,3008,3009,3010 | head -1 | xargs -I {} lsof -Pan -p {} -i | grep LISTEN | sed 's/.*:\([0-9]*\).*/\1/' | head -1)
if [ -z "$VITE_PORT" ]; then
    VITE_PORT="3004"  # 默认值
fi

# 4. 显示访问信息
echo ""
echo "================================================"
echo "✅ 所有服务启动完成！"
echo ""
echo "📱 访问方式："
echo "   本地访问:     http://localhost:$VITE_PORT"
echo "   局域网访问:   http://$LOCAL_IP:$VITE_PORT"
echo ""
echo "🗄️  数据库服务："
echo "   PocketBase 9008: http://$LOCAL_IP:9008/_/ (本系统)"
echo "   PocketBase 9009: http://$LOCAL_IP:9009/_/ (招商管理 - 需单独启动)"

echo "🔐 默认登录账号："
echo "   用户名: admin"
echo "   密码:   123"

echo "⚠️  注意事项："
echo "   1. 确保招商管理系统的PocketBase已在 http://192.168.0.11:9009 运行"
echo "   2. 确保防火墙允许$VITE_PORT、9008、9009端口访问"
echo "   3. 局域网内其他设备使用上述IP地址访问"
echo "   4. 按 Ctrl+C 停止所有服务"
echo ""
echo "================================================"

# 等待Vite进程
wait $VITE_PID
