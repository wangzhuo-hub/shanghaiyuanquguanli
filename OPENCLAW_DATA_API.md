# OpenClaw 数据调用接口文档

版本：2026-05-15 | 适用：金蝶招商管理系统

---

## 1. 架构

```
OpenClaw / 外部系统
       │
       ▼
┌─────────────────────────────────────────────┐
│  Caddy HTTPS (kdpark.fun)                    │
│  /api/integration/*  →  gateway :8787        │
│  其他 /api/*          →  PB :1001 (直通)      │
└─────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────┐
│  Integration Gateway (端口 8787)              │
│  读：快照缓存 → miss 自动 compute             │
│  写：来源校验 → 审计 → PB                     │
│  算：与前端同代码（billingService +           │
│       dashboardMetrics）                      │
└─────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────┐
│  PocketBase (端口 1001)                       │
│  pb_tenants, pb_buildings, pb_units,         │
│  pb_payments, pb_invoices, ...               │
│  默认 project_id = shanghai_park             │
└─────────────────────────────────────────────┘
```

**核心原则**：
- 读原始数据 → 直读 PB 集合（经 gateway 或直接 PB API）
- 读计算指标 → gateway 实时计算（与前端口径零偏差）
- 写数据 → gateway `/api/integration/write`（唯一入口，强制审计）
- **不依赖快照作为数据源**（快照仅作缓存加速，miss 时自动实时计算）

---

## 2. 端点总览

所有端点 base URL：`https://kdpark.fun`

### 2.1 只读端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/integration/kpi` | KPI 指标（快照优先，miss 自动算） |
| GET | `/api/integration/dashboard` | 全量看板（快照优先，miss 自动拼装） |
| GET | `/api/integration/tenants` | 租户列表（直读 pb_tenants） |
| GET | `/api/integration/payments` | 收款列表（直读 pb_payments） |
| GET | `/api/integration/buildings` | 楼宇列表（直读 pb_buildings） |
| GET | `/api/integration/units` | 单元列表（直读 pb_units） |

### 2.2 计算端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/integration/compute/kpi` | 重算 KPI（不入库） |
| POST | `/api/integration/compute/billing` | 重算应收明细 |
| POST | `/api/integration/compute/refresh` | 重算 KPI 并回写快照 |

### 2.3 写入端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/integration/write` | 受控写入（需来源注册） |

---

## 3. 认证

### 3.1 写入认证

`POST /api/integration/write` 必须携带请求头：

```
x-integration-source-type: openclaw_agent
x-integration-source-key: primary-agent
```

当前已注册来源：

| 字段 | 值 |
|------|-----|
| source_type | `openclaw_agent` |
| source_key | `primary-agent` |
| project_id | `shanghai_park` |
| enabled | true |
| secret_hash | （未设置，当前仅验证来源身份） |

如需增设 secret_hash，在 `pb_integration_sources` 中更新该记录，请求时加 `x-integration-token` 头。

### 3.2 只读端点

所有 GET 端点无需认证（直接调用即可）。

---

## 4. 只读端点详解

### 4.1 GET /api/integration/kpi

获取年度经营指标。

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| project_id | string | 是 | 园区 ID，默认 `shanghai_park` |
| year | number | 否 | 统计年，默认当年 |

**示例**：

```bash
curl "https://kdpark.fun/api/integration/kpi?project_id=shanghai_park&year=2026"
```

**返回**：

```json
{
  "ok": true,
  "source": "compute-engine",
  "project_id": "shanghai_park",
  "year": 2026,
  "summary": {
    "annualRevenueTarget": 15708963.74,
    "annualRevenueCollected": 4974717.24,
    "annualGoalCompletion": 31.67,
    "annualBudgetTarget": 15708963.74,
    "annualBudgetCompletion": 31.67,
    "annualOccupancyTarget": 95,
    "occupancyRate": 90.53,
    "tenantCount": 47,
    "totalArea": 21406.91
  },
  "monthlyTrends": [...],
  "calculated_at": "2026-05-15T07:11:30.000Z",
  "data_version": 1
}
```

`source` 字段含义：
- `pb_kpi_snapshots`：命中缓存，响应快
- `compute-engine`：快照缺失，实时计算（首次访问时自动触发，后续异步写入缓存）

### 4.2 GET /api/integration/dashboard

获取全量看板数据（KPI + 租户 + 楼宇 + 单元 + 收款）。

```bash
curl "https://kdpark.fun/api/integration/dashboard?project_id=shanghai_park"
```

### 4.3 GET /api/integration/tenants

查询租户列表，支持按名称模糊搜索。

```bash
# 全部租户
curl "https://kdpark.fun/api/integration/tenants?project_id=shanghai_park"

# 按名称搜索
curl "https://kdpark.fun/api/integration/tenants?project_id=shanghai_park&name=科技"
```

**返回**：

```json
{
  "ok": true,
  "project_id": "shanghai_park",
  "count": 47,
  "tenants": [
    {
      "id": "rec_xxx",
      "original_id": "t_001",
      "name": "某某科技",
      "building_id": "b_01",
      "unit_ids": ["u_101"],
      "monthly_rent": 128000,
      "lease_start": "2025-01-01",
      "lease_end": "2027-12-31",
      ...
    }
  ]
}
```

### 4.4 GET /api/integration/payments

查询收款记录。

**参数**：

| 参数 | 说明 | 示例 |
|------|------|------|
| project_id | 园区 ID | `shanghai_park` |
| tenant_id | 租户 original_id | `t_001` |
| period | 账期 YYYY-MM | `2026-05` |

```bash
# 某租户全部收款
curl "https://kdpark.fun/api/integration/payments?project_id=shanghai_park&tenant_id=t_001"

# 某月全部收款
curl "https://kdpark.fun/api/integration/payments?project_id=shanghai_park&period=2026-05"
```

### 4.5 GET /api/integration/buildings

```bash
curl "https://kdpark.fun/api/integration/buildings?project_id=shanghai_park"
```

### 4.6 GET /api/integration/units

```bash
# 全部单元
curl "https://kdpark.fun/api/integration/units?project_id=shanghai_park"

# 按楼宇筛选
curl "https://kdpark.fun/api/integration/units?project_id=shanghai_park&building_id=b_01"
```

---

## 5. 计算端点详解

### 5.1 POST /api/integration/compute/kpi

从原始合同数据出发，运行完整计费引擎，计算与前端完全一致的 KPI。

```bash
curl -X POST "https://kdpark.fun/api/integration/compute/kpi" \
  -H "Content-Type: application/json" \
  -d '{"project_id": "shanghai_park", "year": 2026}'
```

**何时使用**：需要确保口径与前端完全一致、或 GET `/kpi` 返回数据需二次确认时。

### 5.2 POST /api/integration/compute/billing

计算指定月份的完整应收明细（含免租期、调价、账期顺延）。

```bash
curl -X POST "https://kdpark.fun/api/integration/compute/billing" \
  -H "Content-Type: application/json" \
  -d '{"project_id": "shanghai_park", "year": 2026, "month": 5}'
```

`month` 参数为 1-12（自然月）。

**返回**：

```json
{
  "ok": true,
  "project_id": "shanghai_park",
  "year": 2026,
  "month": 5,
  "billingDetails": [
    {
      "tenantId": "t_001",
      "tenantName": "某某科技",
      "amountDue": 128000,
      "amountPaid": 128000,
      "status": "Paid"
    }
  ],
  "totalDue": 4500000,
  "totalPaid": 3850000,
  "unpaidCount": 3
}
```

### 5.3 POST /api/integration/compute/refresh

重算 KPI 并回写 `pb_kpi_snapshots`，使后续 GET `/kpi` 命中缓存。

```bash
curl -X POST "https://kdpark.fun/api/integration/compute/refresh" \
  -H "Content-Type: application/json" \
  -d '{"project_id": "shanghai_park", "year": 2026}'
```

---

## 6. 写入端点

### 6.1 POST /api/integration/write

受控写入口。所有数据修改必须经过此端点。

**请求头**：

```
Content-Type: application/json
x-integration-source-type: openclaw_agent
x-integration-source-key: primary-agent
```

**通用信封**：

```json
{
  "collection": "pb_payments",
  "action": "upsert",
  "original_id": "pay_openclaw_uuid_001",
  "project_id": "shanghai_park",
  "data": {
    "tenant_id": "t_001",
    "tenant_name": "某某科技",
    "amount": 128000,
    "type": "Rent",
    "date": "2026-05-15",
    "period": "2026-05",
    "status": "Received",
    "remarks": "5月租金"
  }
}
```

**支持的操作**：
- `upsert`：推荐，存在则更新，不存在则创建（按 `original_id` + `project_id` 去重）
- `create`：仅创建
- `update`：仅更新
- `delete`：删除

**可写集合**：

| 集合 | 说明 |
|------|------|
| `pb_tenants` | 租户/合同 |
| `pb_payments` | 收款记录 |
| `pb_buildings` | 楼宇 |
| `pb_units` | 单元/房源 |
| `pb_invoices` | 发票 |
| `pb_yearly_targets` | 年度目标 |
| `pb_monthly_init_data` | 月度初始化数据 |
| `pb_budget_assumptions` | 预算假设 |
| `pb_budget_adjustments` | 预算调整 |
| `pb_budget_scenarios` | 预算方案 |
| `pb_billing_period_notes` | 账期备注 |

**安全机制**：
- 来源必须在 `pb_integration_sources` 中注册且 `enabled=true`
- 强制 `project_id` 与来源绑定，禁止跨园区写入
- 所有操作记录到 `pb_integration_audit_logs`
- `secret_hash`（可选）二次签名校验

**成功返回**：

```json
{
  "success": true,
  "project_id": "shanghai_park",
  "result": {
    "collection": "pb_payments",
    "action": "create",
    "id": "rec_xxx"
  },
  "affected_metrics": ["kpi", "billing"],
  "compute_hint": "建议调用 POST /api/integration/compute/refresh { project_id: \"shanghai_park\" } 刷新 KPI"
}
```

**写入租户时的字段约束**：

以下字段语义复杂，由前端弹窗维护，OpenClaw 写入时**严禁触碰**：

| 禁止字段 | 原因 |
|----------|------|
| `payment_period_adjustments` | 存量调优数据，非租金阶梯，填错会导致合同打不开 |
| `payment_cycle_changes` | 付款周期变更历史，由用户操作产生 |
| `name_history` | 改名历史，由变更弹窗写入 |
| `payment_terms` | 多房号差异化条款（单房号应留 null） |
| `key_moments` | 关键节点时间线，由脚本写入 |

---

## 7. 典型调用流程

### 7.1 查询"本月营收完成情况"

```
GET /api/integration/kpi?project_id=shanghai_park&year=2026
→ 解析 summary.annualRevenueCollected / summary.annualGoalCompletion
```

### 7.2 查询"某某科技是否已交5月租金"

```
1. GET /api/integration/tenants?project_id=shanghai_park&name=某某科技
   → 找到 tenant.original_id
2. GET /api/integration/payments?project_id=shanghai_park&tenant_id=t_xxx&period=2026-05
   → 有记录=已交，无=未交
```

### 7.3 代客录入收款

```
1. GET /api/integration/tenants?project_id=shanghai_park&name=某某科技
   → 获取 tenant_id
2. POST /api/integration/write
   → 写入收款
3. POST /api/integration/compute/refresh
   → 刷新 KPI 缓存
4. GET /api/integration/kpi?project_id=shanghai_park
   → 确认最新指标
```

### 7.4 查询"本月哪些租户欠租"

```
POST /api/integration/compute/billing
  { project_id: "shanghai_park", year: 2026, month: 5 }
→ 过滤 billingDetails 中 status != "Paid" 的行
```

### 7.5 查询某楼栋的所有单元

```
GET /api/integration/units?project_id=shanghai_park&building_id=b_01
```

---

## 8. 字段映射速查

PocketBase 使用 `snake_case`，类型定义使用 `camelCase`。

### 租户 (pb_tenants)

| 应用字段 | PB 字段 | 类型 |
|----------|---------|------|
| id | original_id | string |
| name | name | string |
| buildingId | building_id | string |
| unitIds | unit_ids | JSON array |
| monthlyRent | monthly_rent | number |
| unitPrice | unit_price | number |
| leaseStart | lease_start | string (date) |
| leaseEnd | lease_end | string (date) |
| status | status | string |
| paymentCycle | payment_cycle | string |
| freeRentHandling | free_rent_handling | string |
| isSpecialBusiness | is_special_business | boolean |

### 收款 (pb_payments)

| 应用字段 | PB 字段 | 类型 |
|----------|---------|------|
| id | original_id | string |
| tenantId | tenant_id | string |
| tenantName | tenant_name | string |
| amount | amount | number |
| type | type | string (Rent/DepositToRent/...) |
| date | date | string (date) |
| period | period | string (YYYY-MM) |
| status | status | string (Received/Pending) |
| invoiceStatus | invoice_status | string |

### 楼宇 (pb_buildings)

| 应用字段 | PB 字段 |
|----------|---------|
| id | original_id |
| name | name |
| type | type |

### 单元 (pb_units)

| 应用字段 | PB 字段 |
|----------|---------|
| id | original_id |
| buildingId | building_id |
| name | name |
| area | area |
| floor | floor |
| status | status |

---

## 9. 备用：直接 PocketBase API

Gatewa 未封装的查询可直接调用 PB REST API：

```
https://kdpark.fun/api/collections/<集合名>/records?filter=project_id="shanghai_park"
```

常用过滤示例：

```
# 按状态筛选租户
filter=project_id="shanghai_park" && status="active"

# 按日期范围筛选收款
filter=project_id="shanghai_park" && date>="2026-01-01" && date<="2026-12-31"

# 分页
?filter=...&page=1&perPage=100&sort=-date
```

PB 集合列表（完整）：`pb_tenants`, `pb_buildings`, `pb_units`, `pb_payments`, `pb_invoices`, `pb_yearly_targets`, `pb_monthly_init_data`, `pb_budget_assumptions`, `pb_budget_adjustments`, `pb_budget_scenarios`, `pb_billing_period_notes`, `pb_kpi_snapshots`, `pb_integration_snapshots`

---

## 10. 安全要求

1. **生产环境不暴露管理员密钥**：Gateway 认证凭据仅存在于服务器环境变量
2. **写入必须经网关**：不在 OpenClaw 侧直接调用 PB 写 API
3. **来源注册**：新增写入来源需在 `pb_integration_sources` 中创建记录
4. **建议为不同系统创建独立 source_key**：便于审计追踪
5. **project_id 全链路一致**：默认使用 `shanghai_park`
