# 金蝶地产——招商管理系统

园区招商管理系统：楼宇与单元、合同与财务、预算与报表；云端后端推荐 **PocketBase**（本地/内网部署），AI 能力通过 **千问（DashScope）** 代理调用。

## 标准交付：Docker Compose（推荐）

**前置条件：** 已安装 [Docker](https://docs.docker.com/get-docker/) 与 Docker Compose v2。

1. 复制环境变量并填写千问 Key：

   ```bash
   cp .env.example .env
   # 编辑 .env，设置 QWEN_API_KEY=你的_DashScope_Key
   ```

2. 构建并启动（前端 **1001**、PocketBase **1002**、AI 代理 **3010**）：

   ```bash
   docker compose up -d --build
   ```

3. 访问：

   - 看板前端：<http://localhost:1001>
   - PocketBase 管理（首次需创建管理员）：<http://localhost:1002/_/>
   - AI 代理健康检查：向 `http://localhost:3010` 发 `POST /api/chat`（需 Key 已配置）

前端在容器内通过 **同源** 路径访问后端：

- PocketBase：`/api/pb/` → 由 Nginx 反代到 PocketBase
- 千问代理：`/api/chat` → `ai-proxy`

数据持久化在 Docker 卷 `pb_data`（勿把 `pocketbase/pb_data/` 提交到 Git）。多园区登录、飞书/OpenClaw 来源映射和 Tailscale 异地访问见 [多园区登录与 Tailscale 部署](docs/04-多园区登录与Tailscale部署.md)。深圳园区物业费收款、工作台 KPI 租金/物业费分项及权限见 [06-深圳物业费收款与权限方案](docs/06-深圳物业费收款与权限方案.md)。

### PocketBase 空库初始化说明

- **Schema**：随镜像/仓库中的 `pocketbase/pb_migrations/` 在 PocketBase **首次启动时自动执行**，创建 `pb_*` 结构化集合。
- **管理员**：首次访问 <http://localhost:1002/_/> 在界面中创建管理员账号（空库无示例业务数据）。
- **多园区初始化**：创建 `users` auth collection 后，可运行 `npm run init:multi-park` 写入上海、深圳、北京园区及外部来源映射。
- **可选**：若需用脚本补建集合（一般与 migrations 二选一即可），见 `scripts/setup-pb-collections.mjs` 与 `POCKETBASE_SETUP.md`。

### 镜像内 PocketBase 版本

`docker/pocketbase/Dockerfile` 通过 `PB_VERSION` 从 GitHub 下载 **Linux** 二进制（仓库根目录下的 `pocketbase/pocketbase` 为 macOS 可执行文件，仅用于本机开发，不会打入镜像）。

## 本地开发（不使用 Docker）

**前置条件：** Node.js ≥ 18（推荐 20）、本机已启动 PocketBase（默认 **1002**）与 `ai-proxy`（默认 **3010**）。

```bash
npm install
cp .env.example .env.local
# 配置 QWEN_API_KEY；按需配置 VITE_POCKETBASE_* 
npm run dev
```

- 开发服务器默认端口 **1001**（可用 `VITE_DEV_PORT` 覆盖）。
- Vite 将 `/api/pb` 代理到 PocketBase、`/api/chat` 代理到 AI 代理，与生产环境路径一致。

### 本地启动脚本

| 脚本 | 用途 |
|------|------|
| `./start.sh` | 本地一键启动（PocketBase :1002 + Vite :1001 + AI代理 :3010） |
| `./prod-start.sh` | 本地生产模式启动（PocketBase 直接服务静态文件 :1001） |

## 生产部署

**线上地址：** `https://kdpark.fun`  
**服务器：** 阿里云轻量服务器（Ubuntu 24.04）  
**架构：** Caddy (:443) → PocketBase (:1001)

### 部署流程

首次部署：
```bash
./deploy.sh    # 构建 + 部署到本地 pb_public
# 然后上传到服务器（目前手动或通过 update.sh）
```

日常更新：
```bash
./update.sh    # 构建 + 上传到服务器 + 验证
```

### GitHub Actions 自动部署（可选）

推送 `main` / `master` 或手动触发 **Deploy** 工作流后，会自动：`npm test` → 构建 → rsync 到服务器 `pb_public`（与 `update.sh` 相同）。

在仓库 **Settings → Secrets and variables → Actions** 配置：

| Secret | 说明 | 示例 |
|--------|------|------|
| `DEPLOY_HOST` | 服务器 IP 或域名 | `47.92.35.188` |
| `DEPLOY_SSH_KEY` | 部署用 SSH 私钥（完整 PEM） | 与服务器 `authorized_keys` 配对 |
| `DEPLOY_USER` | 可选，默认 `root` | `root` |
| `DEPLOY_PATH` | 可选，默认 `/opt/kingdee-park` | `/opt/kingdee-park` |
| `DEPLOY_URL` | 可选，部署后健康检查 URL | `https://kdpark.fun/` |

建议在 **Settings → Environments → production** 中勾选 **Required reviewers**，避免误触自动上线。首次使用前在 Actions 页手动运行一次 **Deploy** 验证密钥是否正确。

### 服务器配置

| 组件 | 端口 | 说明 |
|------|------|------|
| Caddy | 80/443 | 自动 HTTPS，反向代理 |
| PocketBase | 1001 | 后端 API + 前端静态文件 |
| AI 代理 | 3010 | 千问 API（需 QWEN_API_KEY） |

- 部署目录：`/opt/kingdee-park/`
- PocketBase 数据：`/opt/kingdee-park/pb_data/`
- 前端文件：`/opt/kingdee-park/pb_public/`
- 服务管理：`systemctl start/stop/restart kingdee-park`
- Caddy 配置：`/etc/caddy/Caddyfile`

### 后续部署新应用

在 DNS 添加子域名 A 记录指向 `47.92.35.188`，然后在 `/etc/caddy/Caddyfile` 添加：

```caddyfile
# 示例
assets.kdpark.fun {
    reverse_proxy 127.0.0.1:2000
}
```

`systemctl reload caddy` 生效，HTTPS 证书自动签发。

## 代码备份

```bash
git add -A && git commit -m "描述" && git push
```

仓库：`https://github.com/wangzhuo-hub/shanghaiyuanquguanli`

## 环境变量说明

详见 [.env.example](.env.example)。常用项：

| 变量 | 说明 |
|------|------|
| `QWEN_API_KEY` | DashScope / 千问 API Key（`ai-proxy` 使用） |
| `VITE_POCKETBASE_URL` | 可选；不设置时浏览器默认使用同源 `/api/pb` |
| `VITE_QWEN_PROXY_URL` | 可选；不设置时 AI 请求使用同源 `/api/chat` |
| `VITE_DEV_PORT` / `VITE_PB_DEV_PORT` / `VITE_AI_PROXY_PORT` | 本地开发端口覆盖 |
| `PB_URL` / `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD` | 初始化多园区和 integration-gateway 访问 PocketBase 使用 |
| `INTEGRATION_GATEWAY_PORT` | OpenClaw / 飞书写入网关端口，默认 `8787` |

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
