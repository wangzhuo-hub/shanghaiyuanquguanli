@echo off
REM PocketBase 快速配置脚本 (Windows)
REM 用于自动下载、安装和配置 PocketBase

echo =========================================
echo PocketBase 快速配置工具 (Windows)
echo =========================================
echo.

REM 检测架构
if "%PROCESSOR_ARCHITECTURE%"=="AMD64" (
    set ARCH_TYPE=amd64
) else if "%PROCESSOR_ARCHITECTURE%"=="ARM64" (
    set ARCH_TYPE=arm64
) else (
    echo ❌ 不支持的架构: %PROCESSOR_ARCHITECTURE%
    pause
    exit /b 1
)

REM PocketBase 版本
set VERSION=0.22.0
set DOWNLOAD_URL=https://github.com/pocketbase/pocketbase/releases/download/v%VERSION%/pocketbase_%VERSION%_windows_%ARCH_TYPE%.zip

echo 检测到系统: Windows %ARCH_TYPE%
echo.

REM 检查 pocketbase 目录
if exist "pocketbase" (
    echo ⚠️  pocketbase 目录已存在
    set /p confirm="是否删除并重新安装? (y/n): "
    if /i "%confirm%"=="y" (
        rmdir /s /q pocketbase
        echo ✓ 已删除旧目录
    ) else (
        echo ❌ 已取消安装
        pause
        exit /b 0
    )
)

mkdir pocketbase
cd pocketbase

echo 步骤 1: 下载 PocketBase v%VERSION%...
echo 请稍候...

REM 使用 PowerShell 下载
powershell -Command "& {Invoke-WebRequest -Uri '%DOWNLOAD_URL%' -OutFile 'pocketbase.zip'}"

if not exist "pocketbase.zip" (
    echo ❌ 下载失败，请检查网络连接
    pause
    exit /b 1
)

echo ✓ 下载完成
echo.

echo 步骤 2: 解压文件...
powershell -Command "& {Expand-Archive -Path 'pocketbase.zip' -DestinationPath '.' -Force}"
del pocketbase.zip
echo ✓ 解压完成
echo.

echo 步骤 3: 创建启动脚本...
(
echo @echo off
echo echo 启动 PocketBase...
echo echo Admin UI: http://127.0.0.1:8090/_/
echo echo API: http://127.0.0.1:8090/api/
echo echo.
echo echo 按 Ctrl+C 停止服务器
echo echo.
echo pocketbase.exe serve
echo pause
) > start.bat

echo ✓ 启动脚本创建完成
echo.

echo 步骤 4: 创建 schema 文件...
(
echo {
echo   "name": "park_backups",
echo   "type": "base",
echo   "system": false,
echo   "schema": [
echo     {
echo       "id": "project_id",
echo       "name": "project_id",
echo       "type": "text",
echo       "required": true,
echo       "options": {
echo         "min": null,
echo         "max": null,
echo         "pattern": ""
echo       }
echo     },
echo     {
echo       "id": "data",
echo       "name": "data",
echo       "type": "json",
echo       "required": true,
echo       "options": {}
echo     },
echo     {
echo       "id": "note",
echo       "name": "note",
echo       "type": "text",
echo       "required": false,
echo       "options": {
echo         "min": null,
echo         "max": null,
echo         "pattern": ""
echo       }
echo     }
echo   ],
echo   "indexes": [
echo     "CREATE INDEX idx_project_id ON park_backups (project_id)"
echo   ],
echo   "listRule": "@request.auth.id != \"\"",
echo   "viewRule": "@request.auth.id != \"\"",
echo   "createRule": "@request.auth.id != \"\"",
echo   "updateRule": "@request.auth.id != \"\"",
echo   "deleteRule": "@request.auth.id != \"\" && @request.auth.admin = true",
echo   "options": {}
echo }
) > schema.json

echo ✓ Schema 文件创建完成
echo.

echo =========================================
echo ✅ PocketBase 安装完成！
echo =========================================
echo.
echo 下一步操作：
echo.
echo 1. 启动 PocketBase：
echo    cd pocketbase
echo    start.bat
echo.
echo 2. 访问 Admin UI:
echo    http://127.0.0.1:8090/_/
echo.
echo 3. 创建管理员账号（首次访问时）
echo.
echo 4. 导入 Collection:
echo    - 在 Admin UI 中点击 'Collections'
echo    - 点击 'Import collections'
echo    - 选择 pocketbase\schema.json
echo    - 点击 'Review' 然后 'Confirm'
echo.
echo 5. 在应用设置中配置 PocketBase:
echo    - 后端提供商: PocketBase（推荐）
echo    - URL: http://127.0.0.1:8090
echo    - 输入管理员邮箱和密码
echo    - 保存配置
echo.
echo 详细文档: POCKETBASE_SETUP.md
echo.
pause
