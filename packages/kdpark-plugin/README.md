# 金蝶园区 Agent 插件

**一个插件、一次登录、按权限办事** — 设计给非技术人员，像 Skill 一样轻。

## 用户怎么用

1. 安装 MCP（见 `mcp.json.example`）
2. 打开 Agent，说「登录园区系统」
3. 输入**现有看板邮箱密码**
4. 用自然语言查数据、录合同、核销收款、报修

## 只有 5 个工具

| 工具 | 作用 |
|------|------|
| `kdpark_login` | 登录（首次必做） |
| `kdpark_whoami` | 看谁、什么权限 |
| `kdpark_query` | 所有查询 |
| `kdpark_submit` | 所有办理/写入 |
| `kdpark_logout` | 退出 |

Agent 侧行为写在 MCP **instructions** 里，用户无需培训。

## 安装

```bash
npm run kdpark-plugin:install
```

`.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "kdpark": {
      "command": "npx",
      "args": ["tsx", "packages/kdpark-plugin/src/mcp.ts"],
      "cwd": "/Users/wangzhuo/Desktop/金蝶招商管理看板（标准版20260402）"
    }
  }
}
```

**不要**给终端用户填 `PARK_EMAIL`、Admin 密码等 — 登录在对话里完成。

## 运维（可选，用户无感）

仅部署人员可设：

| 变量 | 说明 |
|------|------|
| `KDPARK_PB_URL` | 看板 PB 地址，默认 `https://kdpark.fun/api/pb` |
| `KDPARK_FACILITY_URL` | 设备，默认 wyxj |
| `KDPARK_PROPERTY_URL` | 物业，默认 sdsf |
| `KDPARK_LOCAL=1` | 本地隧道开发 |
| `PB_ADMIN_*` | 应收/KPI 计算（仅服务端） |

## 与 park-mcp 的关系

| | kdpark-plugin | park-mcp |
|--|---------------|----------|
| 面向 | **所有人** | 运维/开发者 |
| 工具数 | 5 | 20+ |
| 登录 | 对话里 login | env 或 HTTP token |
| 配置 | 几乎零 | 多 env |

完整 HTTP 托管见 `packages/park-mcp`。
