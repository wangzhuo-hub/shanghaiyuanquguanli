# 金蝶园区招商 MCP — 使用守则

## 登录

1. 调用 `park_login`，使用**看板 users 账号**（与 kdpark.fun 相同），不要使用园区 Integration Token。
2. 或在 MCP 配置的环境变量中设置 `PARK_EMAIL`、`PARK_PASSWORD` 实现自动登录。

## 权限

- 数据访问范围由账号的 `project_id`、`allowed_project_ids`、`role` 决定。
- 物业人员默认只能查看物业费收款与物业费应收。
- 跨园区 `project_id` 会被拒绝。

## 读写原则

- **读**：KPI、租户、收款、应收、楼宇/单元、物业水电、设备报修均可通过对应工具查询。
- **写**：`park_payment_create`、`park_dashboard_write`（预算类需 `confirm_risky`）、`park_facility_repair_create`；复杂租约/批量导入仍优先引导看板前端。
- 详细字段规范：`park://rules/data`；报修：`park://rules/facility`；物业：`park://rules/property`。

## 环境变量（MCP 服务端）

| 变量 | 说明 |
|------|------|
| `PARK_PB_URL` / `PB_URL` | PocketBase 地址，默认 `http://127.0.0.1:1002` |
| `PARK_EMAIL` / `PARK_PASSWORD` | 可选自动登录 |
| `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD` | 仅服务端：KPI 快照缺失时实时计算、应收明细 |

勿在客户端配置 Admin 密码或 Integration Token。
