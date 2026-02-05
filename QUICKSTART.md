# 🚀 快速启动指南

## 一次性配置（首次运行必须完成）

### 步骤1：配置PocketBase Collection

1. 确保PocketBase正在运行：
```bash
./pocketbase serve --http=127.0.0.1:8091
```

2. 打开浏览器访问：http://127.0.0.1:8091/_/

3. 创建管理员账号（首次启动会提示）

4. 创建Collection **`park_leasing_backups`**：
   - 点击 "New collection"
   - Collection name: `park_leasing_backups`
   - Collection type: Base
   
5. 添加字段（点击 "Add field"）：
   
   **字段1：name**
   - Type: Text
   - Required: ✅
   
   **字段2：data**  
   - Type: JSON
   - Required: ✅

6. 设置API Rules（点击 "API Rules" 标签）：
   - 所有规则（List/View/Create/Update/Delete）保持空白
   - 这样允许无认证访问

7. 点击 "Save changes" 保存

✅ **配置完成！**

---

## 日常启动流程

### 方式一：完整启动（推荐）

```bash
# 终端1：启动招商管理PocketBase（房源数据源）
cd ~/Desktop/上海园区招商管理看板（团队使用云端正式版v6.0）
./pocketbase serve --http=127.0.0.1:8090

# 终端2：启动本地PocketBase（备份数据库）
cd ~/Desktop/上海商机及渠道管理系统（v5.0）
./pocketbase serve --http=127.0.0.1:8091

# 终端3：启动应用
npm run dev
```

应用地址：http://localhost:3000

### 方式二：仅启动应用（如果PocketBase已在后台运行）

```bash
npm run dev
```

---

## 数据迁移（可选）

如需导入现有Supabase数据：

```bash
# 1. 导出Supabase数据
npx tsx scripts/export-supabase-data.ts

# 2. 手动导入（通过PocketBase管理后台）
# 访问 http://127.0.0.1:8091/_/
# 进入 park_leasing_backups collection
# 点击 "Import" 导入 supabase-backup-export.json
```

---

## 验证功能

启动后测试以下功能：

- [ ] 登录系统
- [ ] 查看Dashboard
- [ ] 资产页面点击"立即同步主库"（同步房源数据）
- [ ] 手动保存备份（点击云图标）
- [ ] 新增/编辑房源
- [ ] 所有模块正常运行

---

## 常见问题

**Q: 启动应用时报错"Failed to fetch"？**  
A: 检查PocketBase是否在8091端口运行：`curl http://127.0.0.1:8091/api/health`

**Q: 房源同步失败？**  
A: 确保招商管理PocketBase在8090端口运行，并且有 `park_data_main` 项目数据

**Q: 登录时无法加载用户？**  
A: 首次使用需要保存一次数据到PocketBase，或导入Supabase备份

**Q: Collection创建失败？**  
A: 确保字段类型正确，name用Text，data用JSON

---

## 端口占用检查

```bash
# 检查端口是否被占用
lsof -i :3000  # 前端应用
lsof -i :8090  # 招商管理PocketBase
lsof -i :8091  # 本地PocketBase

# 杀死占用进程（如需要）
kill -9 <PID>
```

---

## 后台运行PocketBase

如需后台运行（重启后自动启动）：

```bash
# 使用nohup
nohup ./pocketbase serve --http=127.0.0.1:8091 > pocketbase.log 2>&1 &

# 查看日志
tail -f pocketbase.log

# 停止服务
pkill pocketbase
```

---

## 技术支持

- 完整迁移说明：[MIGRATION_SUMMARY.md](MIGRATION_SUMMARY.md)
- PocketBase文档：https://pocketbase.io/docs/
- 招商管理API文档：`~/Desktop/上海园区招商管理看板（团队使用云端正式版v6.0）/API_DOCUMENTATION.md`

---

**享受使用！🎉**
