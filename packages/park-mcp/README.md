# @kdpark/mcp

金蝶园区 **MCP Server**（v0.3）：stdio 本地 + HTTP 远程、Bearer 登录、审计日志、三子系统读写。

## 运行模式

| 模式 | 命令 | 用途 |
|------|------|------|
| **stdio** | `npm run park-mcp` | Cursor / Claude Desktop 子进程 |
| **HTTP** | `npm run park-mcp:serve` | 远程 Agent，`POST /auth/login` 换 token |

HTTP 默认：`http://127.0.0.1:3099`

## HTTP 认证流程

```bash
# 1. 登录（可同时登录看板 + 设备 + 物业）
curl -s -X POST http://127.0.0.1:3099/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@kdpark.fun","password":"***","systems":["dashboard","facility","property"]}'

# 返回 { "token": "...", "expires_at": "..." }

# 2. MCP 客户端连接 /mcp，Header:
#    Authorization: Bearer <token>
```

端点：

- `GET /health`
- `POST /auth/login` · `GET /auth/me` · `POST /auth/logout`
- `POST /mcp` · `GET /mcp`（Streamable HTTP + SSE）

## 工具（v0.3 新增）

| 工具 | 说明 |
|------|------|
| `park_facility_repair_update` | 报修状态流转（不可跳步） |
| `park_property_utility_update` | 水电费 status/读数/备注 |
| `park_property_fee_update` | 物业费 status/金额 |

写入类工具会追加审计到 `packages/park-mcp/logs/audit.jsonl`（可用 `MCP_AUDIT_LOG` 覆盖路径）。

## Cursor：远程 MCP 示例

```json
{
  "mcpServers": {
    "kdpark-remote": {
      "url": "http://127.0.0.1:3099/mcp",
      "headers": {
        "Authorization": "Bearer <从 /auth/login 获取>"
      }
    }
  }
}
```

本地 stdio 配置见 `.cursor/mcp.json.example`。

## 环境变量

| 变量 | 说明 |
|------|------|
| `MCP_HTTP_HOST` / `MCP_HTTP_PORT` | HTTP 绑定，默认 `127.0.0.1:3099` |
| `MCP_HTTP_ALLOWED_HOSTS` | 绑定 `0.0.0.0` 时的 Host 白名单（逗号分隔） |
| `MCP_TOKEN_TTL_MS` | Bearer 有效期，默认 8h |
| `MCP_AUDIT_LOG` | 审计日志路径 |
| `PARK_PB_URL` / `PARK_FACILITY_PB_URL` / `PARK_PROPERTY_PB_URL` | 三系统 PB 地址 |
| `PARK_EMAIL` / `PARK_PASSWORD` | stdio 自动登录 |
| `PB_ADMIN_*` | KPI/应收计算（仅服务端） |

## 子系统工具一览

见 v0.2 文档：`park_login`、`park_kpi_get`、`park_payment_create`、`park_dashboard_write` 等。

完整规则 Resources：`park://rules/data`、`park://rules/facility`、`park://rules/property`。
