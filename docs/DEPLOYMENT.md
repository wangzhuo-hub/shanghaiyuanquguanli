## 部署说明（标准化交付）

本项目已整理为“拿到代码即可部署”的标准形态，推荐使用 `compose.yaml` 一键启动：

- **Web 前端**：Nginx 托管静态资源，对外端口 **1001**
- **PocketBase 后端**：对外端口 **1002**（容器内 8090）
- **AI 代理（千问/DashScope）**：对外端口 **3010**

### 架构与访问路径

- 浏览器访问：`http://<服务器IP>:1001`
- Web 会反向代理：
  - `GET/POST /api/pb/*` → PocketBase（同源，避免 CORS）
  - `POST /api/chat` → `ai-proxy`（同源，避免 CORS）

PocketBase 数据会持久化到 Docker 卷 `pb_data`（不会提交到 Git）。

---

## 0. 前置条件

### 方式 A（推荐）：Docker 部署

- 安装 Docker + Docker Compose v2
- 验证：

```bash
docker --version
docker compose version
```

### 方式 B：本机进程方式（开发/临时）

- Node.js ≥ 18（建议 20）
- npm

验证：

```bash
node -v
npm -v
```

---

## 1. Docker 一键部署（推荐）

在项目根目录执行：

### 1.1 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，至少填写：

- `QWEN_API_KEY=...`（千问/DashScope Key）

> 注意：`.env` / `.env.local` 不应提交到仓库。

### 1.2 启动

```bash
docker compose up -d --build
```

### 1.3 访问

- 前端：`http://localhost:1001`
- PocketBase Admin：`http://localhost:1002/_/`

首次打开 PocketBase Admin 会引导创建管理员账号（空库初始化）。

### 1.4 健康检查

```bash
curl http://127.0.0.1:1002/api/health
```

应返回 `API is healthy`。

### 1.5 停止/重启

```bash
docker compose down
docker compose up -d
```

---

## 2. PocketBase 初始化与空库说明

- 本项目使用 `pocketbase/pb_migrations/` 作为**唯一 schema 来源**。
- 新环境启动时会自动执行 migrations，创建 `pb_*` 结构化集合。
- **不内置任何示例业务数据**（楼宇/合同/收款/初始化指标等都为空）。

如果你看到旧数据，通常是因为 **复用了旧的 `pb_data` 卷**。处理方式见“数据与备份”。

---

## 3. 数据与备份（非常重要）

### 3.1 数据在哪里

Docker 部署时，PocketBase 数据在卷里：

- 卷名：`pb_data`
- 由 `compose.yaml` 挂载到容器内 `/pb/pb_data`

### 3.2 清空数据（恢复空库）

⚠️ 会删除所有 PocketBase 数据，不可恢复。

```bash
docker compose down
docker volume rm <项目名>_pb_data
docker compose up -d
```

> `<项目名>_pb_data` 的实际名字可用 `docker volume ls | grep pb_data` 查到。

### 3.3 备份（建议）

PocketBase 支持在 Admin UI 中备份；也可以直接备份卷（按你们运维规范处理）。

---

## 4. 端口与防火墙

默认端口：

- `1001/tcp`：前端
- `1002/tcp`：PocketBase（管理后台也在该端口）
- `3010/tcp`：AI 代理（仅服务端使用，建议限制访问）

建议：

- 只对用户开放 `1001`
- `1002` 只对内网/运维开放（或通过网关鉴权）
- `3010` 建议只允许 `web` 容器/内网访问

---

## 5. 常见问题排查

### 5.1 前端打不开

- 检查端口占用：`lsof -i :1001`
- Docker：`docker compose ps` 看 `web` 是否 running

### 5.2 PocketBase 无法访问 / 不是空库

- 健康检查：`curl http://127.0.0.1:1002/api/health`
- 若不是空库：删除并重建 `pb_data` 卷（见 3.2）

### 5.3 AI 代理启动失败

常见原因：未设置 `QWEN_API_KEY`。确认 `.env` 已填写并重新 `docker compose up -d`。

---

## 6. 非 Docker（本机）启动方式

本机启动使用 `start-all.sh`（会启动 PocketBase/AI 代理/Vite dev server）：

```bash
cp .env.example .env.local
# 编辑 .env.local 填写 QWEN_API_KEY
./start-all.sh
```

访问：

- 前端：`http://<本机IP>:1001`
- PocketBase Admin：`http://<本机IP>:1002/_/`

