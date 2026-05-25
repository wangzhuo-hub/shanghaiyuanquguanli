---
name: kdpark
description: 金蝶园区统一助手。安装 MCP 插件后提示用户登录看板账号，即可按权限查 KPI/租户/收款、录合同、核销、报修等。无需配置 Token 或 PocketBase 地址。
---

# 金蝶园区助手

## 给用户（零配置）

1. 在 Cursor / Claude 里添加 MCP 插件「kdpark」（见下方安装块）。
2. 在对话里说：**「登录园区系统」** — Agent 会问邮箱和密码。
3. 登录后直接说业务需求，例如：
   - 「查一下今年 KPI 和出租率」
   - 「帮某某公司登记一笔 3 月租金收款」
   - 「录入一份新租约，租户是…」
   - 「1 号楼 5 楼空调不制冷，报修人张三」

**不需要**了解 MCP、project_id、Integration Token。

## 给 Agent

- 连接后若未登录，**必须先** `kdpark_login`。
- 查询用 `kdpark_query`，办理用 `kdpark_submit`（见 MCP instructions）。
- 与用户只用中文；写入前先 query 给选项。

## 安装（Cursor mcp.json）

```json
{
  "mcpServers": {
    "kdpark": {
      "command": "npx",
      "args": ["tsx", "packages/kdpark-plugin/src/mcp.ts"],
      "cwd": "/path/to/金蝶招商管理看板（标准版20260402）"
    }
  }
}
```

发布后改为：

```json
{
  "mcpServers": {
    "kdpark": {
      "command": "npx",
      "args": ["-y", "@kdpark/agent-plugin"]
    }
  }
}
```

本地开发时运维设置 `KDPARK_LOCAL=1` 并在 env 覆盖 PB URL（用户无感）。
