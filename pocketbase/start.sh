#!/bin/bash
# 进程时区：中国（UTC+8），日志与部分时间行为与北京时间一致
export TZ=Asia/Shanghai

echo "启动 PocketBase... (TZ=$TZ)"
echo "Admin UI: http://192.168.0.11:9002/_/"
echo "API: http://192.168.0.11:9002/api/"
echo ""
echo "按 Ctrl+C 停止服务器"
echo ""
./pocketbase serve --http=0.0.0.0:9002
