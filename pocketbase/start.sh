#!/bin/bash
# 进程时区：中国（UTC+8），日志与部分时间行为与北京时间一致
export TZ=Asia/Shanghai

echo "启动 PocketBase... (TZ=$TZ)"
echo "Admin UI: http://127.0.0.1:8001/_/"
echo "API: http://127.0.0.1:8001/api/"
echo ""
echo "按 Ctrl+C 停止服务器"
echo ""
./pocketbase serve --http=0.0.0.0:8001
