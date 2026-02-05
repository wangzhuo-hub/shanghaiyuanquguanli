#!/bin/bash
echo "启动 PocketBase..."
echo "Admin UI: http://192.168.0.11:9009/_/"
echo "API: http://192.168.0.11:9009/api/"
echo ""
echo "按 Ctrl+C 停止服务器"
echo ""
./pocketbase serve --http=0.0.0.0:9009
