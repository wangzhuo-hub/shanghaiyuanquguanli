# PocketBase 配置检查清单

使用这个清单确保 PocketBase 配置正确完成。

## ✅ 快速开始

### 方式 1: 使用自动化脚本（推荐）

**macOS / Linux:**
```bash
bash setup-pocketbase.sh
```

**Windows:**
```cmd
setup-pocketbase.bat
```

### 方式 2: 手动配置

参考 [POCKETBASE_SETUP.md](POCKETBASE_SETUP.md) 文档。

---

## 📋 配置步骤检查清单

### 第一阶段：安装 PocketBase

- [ ] **下载 PocketBase**
  - macOS/Linux: 已下载对应平台的二进制文件
  - Windows: 已下载 pocketbase.exe

- [ ] **解压并放置**
  - 文件解压到 `./pocketbase/` 目录
  - 可执行文件有执行权限

- [ ] **测试运行**
  - 运行 `./pocketbase serve` (或 `pocketbase.exe serve`)
  - 能访问 http://127.0.0.1:8090/_/

### 第二阶段：初始化 PocketBase

- [ ] **创建管理员账号**
  - 访问 http://127.0.0.1:8090/_/
  - 创建管理员账号
  - 记录邮箱：`____________________`
  - 记录密码：`____________________` (妥善保管)

- [ ] **创建 Collection**
  - 选项 A: 导入 `pocketbase_schema.json` 或 `pocketbase/schema.json`
  - 选项 B: 手动创建（参考 POCKETBASE_SETUP.md）

- [ ] **验证 Collection**
  - Collection 名称为 `park_backups`
  - 包含字段：`project_id`, `data`, `note`
  - `project_id` 已添加索引
  - API Rules 已配置

### 第三阶段：应用配置

- [ ] **安装项目依赖**
  ```bash
  npm install
  ```

- [ ] **配置环境变量**
  - `.env.local` 文件已更新
  - 包含 PocketBase 配置项

- [ ] **启动应用**
  ```bash
  npm run dev
  ```

- [ ] **在应用中配置 PocketBase**
  - 访问 http://localhost:5173
  - 点击左侧 "⚙️ 系统设置"
  - 在 "云端数据库配置" 中：
    - 后端提供商: 选择 "PocketBase（推荐）" ✓
    - PocketBase URL: `http://127.0.0.1:8090` ✓
    - 邮箱: 输入管理员邮箱 ✓
    - 密码: 输入管理员密码 ✓
    - 项目标识: `park_data_main` (或自定义) ✓
  - 点击 "保存配置" ✓

- [ ] **验证连接**
  - 连接状态显示：✓ 已连接至 PocketBase 数据库

### 第四阶段：功能测试

- [ ] **测试备份功能**
  - 在应用中做一些修改（添加楼宇或合同）
  - 点击 "新建备份"
  - 输入操作人员和备注
  - 点击 "确认保存"
  - 确认显示 "备份成功"

- [ ] **验证备份记录**
  - 在应用的 "云端备份历史" 中看到新备份
  - 在 PocketBase Admin UI 的 `park_backups` collection 中看到记录

- [ ] **测试恢复功能**
  - 在应用中做一些新的修改
  - 点击之前备份的 "恢复" 按钮
  - 确认数据恢复到备份时的状态

- [ ] **测试下载功能**
  - 点击备份的 "下载" 按钮
  - 确认 JSON 文件下载成功

### 第五阶段：数据迁移（如果从 Supabase 迁移）

- [ ] **准备迁移**
  - PocketBase 服务器正在运行
  - 已在 PocketBase 中创建管理员账号和 collection

- [ ] **配置迁移脚本**
  - 打开 `scripts/migrate-to-pocketbase.ts`
  - 修改 `POCKETBASE_EMAIL`
  - 修改 `POCKETBASE_PASSWORD`

- [ ] **执行迁移**
  ```bash
  npx tsx scripts/migrate-to-pocketbase.ts
  ```

- [ ] **验证迁移结果**
  - 查看迁移统计信息
  - 在 PocketBase Admin UI 中检查数据
  - 在应用中测试恢复历史备份

---

## 🔍 故障排查

### 问题：无法连接 PocketBase

**检查项：**
- [ ] PocketBase 服务器是否正在运行？
- [ ] URL 是否正确？(http://127.0.0.1:8090)
- [ ] 防火墙是否阻止了 8090 端口？
- [ ] 能否在浏览器中访问 http://127.0.0.1:8090/_/

**解决方案：**
```bash
# 重启 PocketBase
cd pocketbase
./pocketbase serve
```

### 问题：认证失败

**检查项：**
- [ ] 邮箱是否正确？
- [ ] 密码是否正确？
- [ ] 管理员账号是否已创建？

**解决方案：**
1. 在 PocketBase Admin UI 中尝试登录
2. 如果忘记密码，删除 `pocketbase/pb_data` 重新初始化

### 问题：Collection 不存在

**检查项：**
- [ ] 在 Admin UI 中能否看到 `park_backups` collection？
- [ ] Collection 名称是否正确？

**解决方案：**
1. 重新导入 schema.json
2. 或手动创建 collection（参考 POCKETBASE_SETUP.md）

### 问题：权限错误

**检查项：**
- [ ] API Rules 是否配置正确？
- [ ] 是否已登录（认证通过）？

**解决方案：**
1. 在 Admin UI 中检查 collection 的 API Rules
2. 确保所有规则都设置为 `@request.auth.id != ""`

---

## 🎯 完成标志

所有以下项都应该能正常工作：

- [x] PocketBase 服务器运行正常
- [x] 能访问 Admin UI
- [x] 应用显示 "已连接至 PocketBase 数据库"
- [x] 能成功创建备份
- [x] 能看到备份历史
- [x] 能恢复备份
- [x] 能下载备份文件

---

## 📚 相关文档

- [POCKETBASE_SETUP.md](POCKETBASE_SETUP.md) - 详细配置指南
- [README.md](README.md) - 项目整体文档
- [PocketBase 官方文档](https://pocketbase.io/docs/) - 官方参考

---

## 💡 下一步

配置完成后，你可以：

1. **邀请团队成员**
   - 在 PocketBase Admin UI 中创建新用户
   - 分享应用地址和 PocketBase 配置

2. **设置自动备份**
   - 配置定时任务自动创建备份
   - 使用 cron 或系统计划任务

3. **部署到生产环境**
   - 将 PocketBase 部署到服务器
   - 配置域名和 HTTPS
   - 更新应用中的 PocketBase URL

4. **探索 PocketBase 特性**
   - 实时订阅（Realtime）
   - 文件上传管理
   - 更多 API 功能

---

**🎉 配置完成！**

如有问题，请参考故障排查部分或查看详细文档。
