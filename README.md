# 上海园区招商管理看板

园区招商管理系统：楼宇与单元、合同与财务、预算与报表；云端后端推荐 **PocketBase**（本地/内网部署），AI 能力通过 **千问（DashScope）** 代理调用。

## 标准交付：Docker Compose（推荐）

**前置条件：** 已安装 [Docker](https://docs.docker.com/get-docker/) 与 Docker Compose v2。

1. 复制环境变量并填写千问 Key：

   ```bash
   cp .env.example .env
   # 编辑 .env，设置 QWEN_API_KEY=你的_DashScope_Key
   ```

2. 构建并启动（前端 **1001**、PocketBase **8001**、AI 代理 **3010**）：

   ```bash
   docker compose up -d --build
   ```

3. 访问：

   - 看板前端：<http://localhost:1001>
   - PocketBase 管理（首次需创建管理员）：<http://localhost:8001/_/>
   - AI 代理健康检查：向 `http://localhost:3010` 发 `POST /api/chat`（需 Key 已配置）

前端在容器内通过 **同源** 路径访问后端：

- PocketBase：`/api/pb/` → 由 Nginx 反代到 PocketBase
- 千问代理：`/api/chat` → `ai-proxy`

数据持久化在 Docker 卷 `pb_data`（勿把 `pocketbase/pb_data/` 提交到 Git）。

### PocketBase 空库初始化说明

- **Schema**：随镜像/仓库中的 `pocketbase/pb_migrations/` 在 PocketBase **首次启动时自动执行**，创建 `pb_*` 结构化集合。
- **管理员**：首次访问 <http://localhost:8001/_/> 在界面中创建管理员账号（空库无示例业务数据）。
- **可选**：若需用脚本补建集合（一般与 migrations 二选一即可），见 `scripts/setup-pb-collections.mjs` 与 `POCKETBASE_SETUP.md`。

### 镜像内 PocketBase 版本

`docker/pocketbase/Dockerfile` 通过 `PB_VERSION` 从 GitHub 下载 **Linux** 二进制（仓库根目录下的 `pocketbase/pocketbase` 为 macOS 可执行文件，仅用于本机开发，不会打入镜像）。

## 本地开发（不使用 Docker）

**前置条件：** Node.js ≥ 18（推荐 20）、本机已启动 PocketBase（默认 **8001**）与 `ai-proxy`（默认 **3010**）。

```bash
npm install
cp .env.example .env.local
# 配置 QWEN_API_KEY；按需配置 VITE_POCKETBASE_* 
npm run dev
```

- 开发服务器默认端口 **1001**（可用 `VITE_DEV_PORT` 覆盖）。
- Vite 将 `/api/pb` 代理到 PocketBase、`/api/chat` 代理到 AI 代理，与生产环境路径一致。

一键启动（macOS/Linux，含清理端口与后台日志）：

```bash
export QWEN_API_KEY=你的_key
./start-all.sh
```

## 环境变量说明

详见 [.env.example](.env.example)。常用项：

| 变量 | 说明 |
|------|------|
| `QWEN_API_KEY` | DashScope / 千问 API Key（`ai-proxy` 使用） |
| `VITE_POCKETBASE_URL` | 可选；不设置时浏览器默认使用同源 `/api/pb` |
| `VITE_QWEN_PROXY_URL` | 可选；不设置时 AI 请求使用同源 `/api/chat` |
| `VITE_DEV_PORT` / `VITE_PB_DEV_PORT` / `VITE_AI_PROXY_PORT` | 本地开发端口覆盖 |

## 仓库维护检查

防止误提交 PocketBase 运行时库：

```bash
npm run check:pb
```

CI（`.github/workflows/ci.yml`）会在 push/PR 时执行该检查并执行 `npm run build`。

## 技术栈

- 前端：React 18、TypeScript、Vite、Tailwind、Recharts  
- 后端：PocketBase（`pb_*` 结构化集合 + migrations）  
- AI：千问 OpenAI 兼容接口（经 `ai-proxy.mjs` 或 Vite/Nginx 代理）

## 项目结构（摘要）

```
.
├── components/           # UI 组件
├── services/             # PocketBase / 云端适配
├── config/               # deploymentDefaults、urls（同源 /api/pb、/api/chat）
├── pocketbase/
│   └── pb_migrations/    # 数据库迁移（交付时以此为准）
├── docker/               # Web / Nginx / ai-proxy / PocketBase 镜像
├── ai-proxy.mjs          # 千问代理（读取 QWEN_API_KEY）
├── compose.yaml          # 标准一键编排
└── start-all.sh          # 本地多进程启动
```

## 数据迁移（旧版说明）

历史脚本如 `scripts/migrate-to-pocketbase.ts`（Supabase → 旧 `park_backups`）已过时；当前主线为结构化 `pb_*` 集合与 `pb_migrations`。迁移请以当前文档与 `scripts/` 下说明为准。

---

View your app in AI Studio: https://ai.studio/apps/drive/1GL7anAqBFNlOxbhxHolpZE9IjYFF1jfb
