# PocketBase 配置指南

> **当前主线（2025+）**：集合由 `pocketbase/pb_migrations/` 在 PocketBase 启动时自动创建（`pb_*` 结构化集合）。**标准交付**请优先阅读根目录 [README.md](README.md) 中的 **Docker Compose** 与 **空库初始化** 说明。下文中的 `park_backups` / 手动 Import schema 等方式为历史兼容说明，新部署请勿再走整包 JSON 集合路线。

本指南将帮助你快速配置和部署 PocketBase 作为项目的后端数据库。

## 第一步：下载和安装 PocketBase

### macOS / Linux

```bash
# 下载 PocketBase
cd ~/Downloads
wget https://github.com/pocketbase/pocketbase/releases/download/v0.22.0/pocketbase_0.22.0_darwin_amd64.zip

# 解压
unzip pocketbase_0.22.0_darwin_amd64.zip

# 创建项目目录
mkdir -p ~/pocketbase-park-data
mv pocketbase ~/pocketbase-park-data/

# 进入目录
cd ~/pocketbase-park-data

# 启动服务器
./pocketbase serve
```

### Windows

1. 访问 https://github.com/pocketbase/pocketbase/releases
2. 下载 `pocketbase_x.x.x_windows_amd64.zip`
3. 解压到一个文件夹（如 `C:\pocketbase-park-data`）
4. 双击 `pocketbase.exe` 运行，或在命令行中：
   ```cmd
   cd C:\pocketbase-park-data
   pocketbase.exe serve
   ```

## 第二步：初始化 PocketBase

1. **访问 Admin UI**
   - 打开浏览器，访问：http://127.0.0.1:8090/_/
   - 首次访问会提示创建管理员账号

2. **创建管理员账号**
   - Email: `admin@parkdata.com`（示例，可自定义）
   - Password: 设置一个安全的密码
   - 记录这些信息，迁移脚本和应用配置都需要

## 第三步：创建 Collection

### 方法一：使用 Schema 文件（推荐）

1. 在 PocketBase Admin UI 中：
   - 点击左侧 "Collections"
   - 点击右上角 "Import collections"
   - 选择项目根目录的 `pocketbase_schema.json` 文件
   - 点击 "Review" 然后 "Confirm"

### 方法二：手动创建

1. 点击 "New collection"
2. 填写以下信息：
   - **Name**: `park_backups`
   - **Type**: Base collection

3. 添加字段（Fields）：

   **字段 1: project_id**
   - Type: `Text`
   - Name: `project_id`
   - ✅ Required
   - ✅ Add as Index

   **字段 2: data**
   - Type: `JSON`
   - Name: `data`
   - ✅ Required

   **字段 3: note**
   - Type: `Text`
   - Name: `note`
   - ⬜ Required (不勾选)

4. 配置权限规则（API Rules）：
   - **List/Search rule**: `@request.auth.id != ""`
   - **View rule**: `@request.auth.id != ""`
   - **Create rule**: `@request.auth.id != ""`
   - **Update rule**: `@request.auth.id != ""`
   - **Delete rule**: `@request.auth.id != "" && @request.auth.admin = true`

5. 点击 "Create" 保存

## 第四步：配置应用

1. 打开应用，点击左侧边栏的 "⚙️ 系统设置"

2. 在 "云端数据库配置" 部分：
   - **后端提供商**: 选择 "PocketBase（推荐）"
   - **PocketBase URL**: `http://127.0.0.1:8090`
   - **邮箱**: 输入你创建的管理员邮箱（如 `admin@parkdata.com`）
   - **密码**: 输入管理员密码
   - **项目标识**: 保持 `park_data_main` 或自定义

3. 点击 "保存配置"

4. 检查连接状态：
   - 如果显示 "✓ 已连接至 PocketBase 数据库"，说明配置成功！

## 第五步：数据迁移（可选）

如果你之前使用 Supabase 并有历史数据：

1. 确保 PocketBase 服务器正在运行

2. 编辑迁移脚本：
   ```bash
   # 打开迁移脚本
   code scripts/migrate-to-pocketbase.ts
   
   # 修改以下配置：
   const POCKETBASE_EMAIL = 'admin@parkdata.com';  // 改为你的邮箱
   const POCKETBASE_PASSWORD = 'your-password';     // 改为你的密码
   ```

3. 运行迁移：
   ```bash
   npx tsx scripts/migrate-to-pocketbase.ts
   ```

4. 根据提示确认迁移

## 第六步：测试功能

1. **测试备份功能**：
   - 在应用中做一些修改
   - 点击 "云端备份历史" 旁的 "新建备份"
   - 输入操作人员和备注
   - 点击 "确认保存"

2. **验证备份**：
   - 在 PocketBase Admin UI 中，点击 "Collections" > "park_backups"
   - 应该能看到刚才创建的备份记录

3. **测试恢复功能**：
   - 在 "云端备份历史" 中点击某个备份的 "恢复" 按钮
   - 确认数据恢复成功

## PocketBase 高级配置

### 1. 配置持久化存储位置

默认情况下，PocketBase 将数据存储在 `pb_data` 目录。你可以自定义：

```bash
./pocketbase serve --dir=/path/to/custom/data
```

### 2. 更改端口

如果 8090 端口被占用：

```bash
./pocketbase serve --http=127.0.0.1:9000
```

然后在应用中将 URL 改为 `http://127.0.0.1:9000`

### 3. 启用 HTTPS（生产环境）

```bash
./pocketbase serve --https=yourdomain.com:443
```

### 4. 设置为后台服务（Linux/macOS）

创建 systemd 服务文件 `/etc/systemd/system/pocketbase.service`：

```ini
[Unit]
Description=PocketBase Park Data Service
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/home/your-username/pocketbase-park-data
ExecStart=/home/your-username/pocketbase-park-data/pocketbase serve
Restart=always

[Install]
WantedBy=multi-user.target
```

启用服务：
```bash
sudo systemctl enable pocketbase
sudo systemctl start pocketbase
```

## 常见问题排查

### 问题 1: 连接失败

**症状**: 应用显示 "❌ 未连接"

**解决方案**:
1. 确认 PocketBase 服务器正在运行
2. 访问 http://127.0.0.1:8090/_/ 确认能打开 Admin UI
3. 检查应用中的 URL 配置是否正确
4. 检查邮箱和密码是否正确

### 问题 2: 认证失败

**症状**: 提示 "PocketBase auth failed"

**解决方案**:
1. 在 PocketBase Admin UI 中检查用户是否存在
2. 尝试在 Admin UI 中重新登录，确认密码正确
3. 如果忘记密码，删除 `pb_data` 目录重新初始化

### 问题 3: 权限错误

**症状**: 无法创建或读取备份

**解决方案**:
1. 检查 collection 的 API Rules 是否配置正确
2. 确认已登录（邮箱和密码配置正确）

### 问题 4: 迁移失败

**症状**: 迁移脚本报错

**解决方案**:
1. 确认 PocketBase 服务器正在运行
2. 确认已创建 `park_backups` collection
3. 确认迁移脚本中的邮箱和密码正确
4. 检查 Supabase 连接是否正常

## 备份和恢复 PocketBase 数据

### 备份

整个数据库都在 `pb_data` 目录中：

```bash
# 停止 PocketBase
# 备份整个目录
tar -czf pocketbase-backup-$(date +%Y%m%d).tar.gz pb_data/

# 或者只备份数据库文件
cp pb_data/data.db pb_data/data.db.backup
```

### 恢复

```bash
# 停止 PocketBase
# 恢复数据
tar -xzf pocketbase-backup-20260204.tar.gz

# 或者恢复数据库文件
cp pb_data/data.db.backup pb_data/data.db

# 重启 PocketBase
```

## 性能优化建议

1. **定期清理旧备份**：
   - 在 Admin UI 中手动删除不需要的历史备份
   - 或使用 PocketBase 的 Hooks 功能自动清理

2. **启用索引**：
   - `project_id` 字段已添加索引
   - 如果经常按时间查询，可以为 `created` 字段添加索引

3. **监控数据库大小**：
   - 定期检查 `pb_data/data.db` 文件大小
   - 如果过大，考虑归档旧数据

## 下一步

✅ PocketBase 配置完成！

现在你可以：
1. 开始使用云端备份功能
2. 邀请团队成员（在 Admin UI 中创建新用户）
3. 探索 PocketBase 的其他功能（实时订阅、文件上传等）

如有问题，请参考：
- PocketBase 官方文档：https://pocketbase.io/docs/
- 项目 README：README.md
