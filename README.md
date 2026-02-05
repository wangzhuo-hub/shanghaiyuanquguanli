<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# 上海园区招商管理看板

一个功能完善的园区招商管理系统，支持楼宇资产管理、合同跟踪、财务分析和预算管理。

View your app in AI Studio: https://ai.studio/apps/drive/1GL7anAqBFNlOxbhxHolpZE9IjYFF1jfb

## 功能特性

- 🏢 **楼宇资产管理** - 多楼宇、多单元的灵活管理
- 📝 **合同中心** - 客户合同全生命周期管理
- 📊 **财务报表** - 实时收款跟踪和分析
- 💰 **预算管理** - 多场景预算模拟
- ☁️ **云端同步** - 支持 Supabase 和 PocketBase 后端

## 本地运行

**前置条件:** Node.js >= 16

1. 安装依赖：
   ```bash
   npm install
   ```

2. 配置环境变量：
   - 复制 `.env.local` 文件
   - 设置 `API_KEY` 为你的 Gemini API Key

3. 启动应用：
   ```bash
   npm run dev
   ```

4. 访问：http://localhost:5173

## 云端后端配置

系统支持两种云端后端：

### PocketBase（推荐）

PocketBase 是一个轻量级的开源后端，支持本地部署，无需依赖第三方服务。

**安装步骤：**

1. 下载 PocketBase：
   - 访问 https://pocketbase.io/docs/
   - 下载适合你系统的版本

2. 启动 PocketBase 服务器：
   ```bash
   ./pocketbase serve
   ```

3. 访问 Admin UI：
   - 打开 http://127.0.0.1:8090/_/
   - 创建管理员账号

4. 创建 Collection：
   - 在 Admin UI 中导入 `pocketbase_schema.json`
   - 或手动创建 `park_backups` collection，包含以下字段：
     - `project_id` (text, required, indexed)
     - `data` (json, required)
     - `note` (text, optional)

5. 在应用设置中配置：
   - 选择 "PocketBase（推荐）"
   - PocketBase URL: `http://127.0.0.1:8090`
   - 输入管理员邮箱和密码
   - 保存配置

### Supabase（兼容）

仍然支持 Supabase 作为云端后端，配置方式保持不变。

在应用设置中选择 "Supabase（当前使用）" 即可。

## 数据迁移

如果你现在使用 Supabase，可以轻松迁移到 PocketBase：

1. 确保 PocketBase 服务器正在运行

2. 修改迁移脚本配置：
   - 打开 `scripts/migrate-to-pocketbase.ts`
   - 修改 `POCKETBASE_EMAIL` 和 `POCKETBASE_PASSWORD`

3. 运行迁移脚本：
   ```bash
   npx tsx scripts/migrate-to-pocketbase.ts
   ```

4. 迁移完成后，在应用设置中切换到 PocketBase

## 技术栈

- **前端：** React 18 + TypeScript + Tailwind CSS
- **图表：** Recharts
- **后端（可选）：**
  - PocketBase - 推荐，本地部署
  - Supabase - 云端服务
- **AI：** Google Gemini API

## 项目结构

```
.
├── src/
│   ├── components/       # React 组件
│   ├── services/         # 业务逻辑
│   │   ├── cloudService.ts        # 云服务适配层
│   │   ├── supabaseService.ts     # Supabase 服务
│   │   ├── pocketbaseService.ts   # PocketBase 服务
│   │   ├── billingService.ts      # 财务服务
│   │   └── geminiService.ts       # AI 服务
│   └── types.ts          # TypeScript 类型
├── scripts/
│   └── migrate-to-pocketbase.ts  # 数据迁移脚本
├── pocketbase_schema.json    # PocketBase 数据库结构
└── .env.local                # 环境变量配置
```

## 常见问题

**Q: 为什么推荐使用 PocketBase？**

A: PocketBase 提供以下优势：
- 单文件部署，无需复杂配置
- 本地优先，数据完全可控
- 内置实时订阅和文件管理
- 更轻量，适合中小型项目

**Q: 我可以同时使用两个后端吗？**

A: 可以，系统支持随时切换后端，数据可以通过迁移脚本轻松同步。

**Q: PocketBase 需要的系统资源？**

A: 非常轻量，在普通笔记本上即可顺畅运行，内存占用不到 50MB。

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT License
