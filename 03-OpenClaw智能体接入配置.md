# OpenClaw 智能体接入配置（v3）

适用版本：金蝶招商管理看板 2026-05-09+（含服务端计算层）

---

## 1. 架构总览

```
┌──────────────────────────────────────────────────────────┐
│ OpenClaw 智能体                                           │
│  → 企业微信 / IM 触发                                     │
│  → 读写均通过 Gateway API（同一套代码、同一口径）          │
└──────────┬───────────────────────────────────────────────┘
           │ HTTP (内网)
┌──────────▼───────────────────────────────────────────────┐
│ Integration Gateway (scripts/integration-gateway.ts)      │
│  默认端口: 8787  ·  运行方式: npx tsx                     │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ 只读端点（快照查询）                                │ │
│  │ GET  /api/integration/kpi              ← KPI 快照   │ │
│  │ GET  /api/integration/dashboard        ← 全量快照   │ │
│  │ GET  /api/integration/tenants          ← 租户列表   │ │
│  │ GET  /api/integration/payments         ← 收款列表   │ │
│  ├─────────────────────────────────────────────────────┤ │
│  │ 服务端计算端点（★ 与前端同一套代码运行）           │ │
│  │ POST /api/integration/compute/kpi      ← 重算 KPI   │ │
│  │ POST /api/integration/compute/billing  ← 重算应收   │ │
│  │ POST /api/integration/compute/refresh  ← 重算+回写  │ │
│  ├─────────────────────────────────────────────────────┤ │
│  │ 写入端点                                           │ │
│  │ POST /api/integration/write           ← 增删改     │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  计算引擎 (scripts/compute-engine.ts)                     │
│  → import billingService.ts   ← 与前端完全相同的计费逻辑  │
│  → import dashboardMetrics.ts ← 与前端完全相同的指标计算  │
│  → import pocketbaseService.ts ← 与前端完全相同的数据拉取 │
└──────────┬───────────────────────────────────────────────┘
           │ PocketBase SDK
┌──────────▼───────────────────────────────────────────────┐
│ PocketBase (端口 1002/8090)                                │
│  pb_tenants, pb_payments, pb_buildings, pb_units,        │
│  pb_kpi_snapshots, pb_integration_snapshots, ...         │
└──────────────────────────────────────────────────────────┘
```

**核心保证**：

- **服务端计算端点使用与前端完全相同的代码**（`billingService.ts`、`dashboardMetrics.ts`、`pocketbaseService.ts`），不存在口径偏差
- **前端每次保存后自动触发服务端重算**（`triggerServerComputeRefresh`），确保快照与最新数据一致
- **写入端点返回 `compute_hint`**，OpenClaw 可立即调用 compute/refresh 获取最新值

---

## 2. 环境变量

Gateway 启动所需环境变量：

```bash
# 必需
PB_URL=http://127.0.0.1:8090              # PocketBase 地址
PB_ADMIN_EMAIL=admin@example.com           # 管理员邮箱
PB_ADMIN_PASSWORD=your-password            # 管理员密码

# 可选
INTEGRATION_GATEWAY_PORT=8787              # 网关端口，默认 8787
```

---

## 3. 认证与来源注册

### 3.1 请求头

每个请求必须携带：

```
x-integration-source-type: openclaw_agent
x-integration-source-key: <你的来源唯一标识>
x-integration-token: <可选，若来源配置了 secret_hash 则必填>
```

### 3.2 来源注册

在 PocketBase 的 `pb_integration_sources` 集合中为 OpenClaw 创建记录：

| 字段 | 值 |
|------|-----|
| `source_type` | `openclaw_agent` |
| `source_key` | 唯一标识，如 `daily-report-bot` |
| `project_id` | 绑定的园区 ID，如 `park_data_main` |
| `enabled` | `true` |
| `secret_hash` | 可选；若设置，需在请求头传 `x-integration-token`（sha256 校验） |

---

## 4. 只读端点（快照查询）

所有 GET 端点支持 `project_id` 参数作为 Query String。

### 4.1 获取 KPI — `GET /api/integration/kpi`

**用途**：查询年度经营指标（营收、出租率、完成率、月度趋势）

```bash
curl "http://127.0.0.1:8787/api/integration/kpi?project_id=park_data_main&year=2026"
```

**返回结构**：

```json
{
  "ok": true,
  "source": "pb_kpi_snapshots",
  "project_id": "park_data_main",
  "year": 2026,
  "summary": {
    "annualRevenueTarget": 5000000,
    "annualRevenueCollected": 3125000,
    "annualGoalCompletion": 62.5,
    "annualBudgetTarget": 4800000,
    "annualBudgetCompletion": 65.1,
    "occupancyRate": 78.5,
    "annualOccupancyTarget": 85,
    "tenantCount": 42,
    "totalArea": 15000
  },
  "monthlyTrends": [
    { "month": "1月", "revenueTarget": 400000, "revenueCollected": 380000, "collectionRate": 95.0 }
  ],
  "calculated_at": "2026-05-09T10:30:00.000Z",
  "data_version": 42
}
```

**数据来源优先级**：
1. `pb_kpi_snapshots`（前端保存时写入，Gateway compute/refresh 也可写入）
2. `pb_integration_snapshots` → `payload.kpi`（回落）
3. 若无数据，返回 `ok: false`，可调用 `POST /api/integration/compute/kpi` 服务端重算

### 4.2 获取全量看板 — `GET /api/integration/dashboard`

```bash
curl "http://127.0.0.1:8787/api/integration/dashboard?project_id=park_data_main"
```

返回完整 `DashboardData` + KPI + 月度趋势。

### 4.3 查询租户 — `GET /api/integration/tenants`

```bash
# 全部租户
curl "http://127.0.0.1:8787/api/integration/tenants?project_id=park_data_main"

# 按名称模糊搜索
curl "http://127.0.0.1:8787/api/integration/tenants?project_id=park_data_main&name=科技"
```

### 4.4 查询收款 — `GET /api/integration/payments`

```bash
# 某租户的全部收款
curl "http://127.0.0.1:8787/api/integration/payments?project_id=park_data_main&tenant_id=t_xxx"

# 某月全部收款
curl "http://127.0.0.1:8787/api/integration/payments?project_id=park_data_main&period=2026-05"
```

---

## 5. 服务端计算端点（★ 核心）

这些端点从 PocketBase 拉取原始合同数据，运行与前端**完全相同**的 `billingService.ts` + `dashboardMetrics.ts` 代码进行计算。计算结果与前端看板口径**零偏差**。

### 5.1 重算 KPI — `POST /api/integration/compute/kpi`

从原始合同数据出发，跑完整计费引擎，输出与前端 `recalculateMetrics` 完全一致的 KPI。

```bash
curl -X POST "http://127.0.0.1:8787/api/integration/compute/kpi" \
  -H "Content-Type: application/json" \
  -d '{"project_id": "park_data_main", "year": 2026}'
```

**返回**：与 `GET /api/integration/kpi` 结构相同，但 `source` 为 `"compute-engine"`（实时计算）。

**计算链路**：
```
pb_tenants + pb_buildings + pb_units + pb_payments
  → fetchPocketBaseBackup() → DashboardData
  → calculateDashboardMetrics() → 含月度趋势、应收明细
  → buildKpiSummaryFromProcessedData() → KPI 汇总
```

### 5.2 重算应收明细 — `POST /api/integration/compute/billing`

计算指定月份的完整应收明细（含免租期、调价、账期顺延等全部计费逻辑）。

```bash
curl -X POST "http://127.0.0.1:8787/api/integration/compute/billing" \
  -H "Content-Type: application/json" \
  -d '{"project_id": "park_data_main", "year": 2026, "month": 5}'
```

**返回**：

```json
{
  "ok": true,
  "project_id": "park_data_main",
  "year": 2026,
  "month": 4,
  "billingDetails": [
    {
      "tenantId": "t_xxx",
      "tenantName": "某某科技",
      "unitIds": ["u_101"],
      "amountDue": 128000,
      "amountPaid": 128000,
      "status": "Paid"
    }
  ],
  "totalDue": 4500000,
  "totalPaid": 3850000,
  "unpaidCount": 3,
  "computedAt": "2026-05-09T10:30:00.000Z"
}
```

> **注意**：`month` 参数为 1-12（自然月），内部自动转为 0-11。

### 5.3 重算并回写快照 — `POST /api/integration/compute/refresh`

重算 KPI 并**直接写入** `pb_kpi_snapshots`，使后续 `GET /api/integration/kpi` 立即命中最新数据。

```bash
curl -X POST "http://127.0.0.1:8787/api/integration/compute/refresh" \
  -H "Content-Type: application/json" \
  -d '{"project_id": "park_data_main", "year": 2026}'
```

**何时使用**：
- OpenClaw 写入数据后（`POST /api/integration/write` 返回的 `compute_hint` 会提示）
- 需要确保后续 `GET /api/integration/kpi` 读到最新计算值
- 前端保存时自动触发（无需手动调用）

---

## 6. 写入端点（数据修改）

### POST /api/integration/write

**通用信封**：

```json
{
  "collection": "pb_payments",
  "action": "upsert",
  "original_id": "pay_openclaw_20260509_001",
  "project_id": "park_data_main",
  "data": {
    "tenant_id": "t_xxx",
    "tenant_name": "某某科技",
    "amount": 128000,
    "type": "Rent",
    "date": "2026-05-09",
    "period": "2026-05",
    "status": "Received",
    "remarks": "5月租金"
  }
}
```

**支持的操作**：`upsert`（推荐）、`create`、`update`、`delete`

**可写集合**：`pb_tenants`、`pb_payments`、`pb_buildings`、`pb_units`、`pb_budget_assumptions`、`pb_budget_adjustments`、`pb_budget_scenarios`、`pb_invoices`、`pb_yearly_targets`、`pb_monthly_init_data`、`pb_billing_period_notes`

**成功返回**：

```json
{
  "success": true,
  "project_id": "park_data_main",
  "result": { "collection": "pb_payments", "action": "create", "id": "rec_xxx" },
  "affected_metrics": ["kpi", "billing"],
  "compute_hint": "建议调用 POST /api/integration/compute/refresh { project_id: \"park_data_main\" } 刷新 KPI"
}
```

**`compute_hint`**：写入后调用对应的 compute 端点可立即获取与前端一致的指标值。

---

## 7. 典型 OpenClaw 调用流程

### 7.1 查询"本月营收完成情况"

```
1. GET /api/integration/kpi?project_id=X&year=2026
2. 若返回 ok: false（无快照），调用 POST /api/integration/compute/kpi 服务端重算
3. 解析 response.summary 回复用户
```

### 7.2 查询"某某科技 5 月交租了吗"

```
1. GET /api/integration/tenants?project_id=X&name=某某科技 → tenant_id
2. GET /api/integration/payments?project_id=X&tenant_id=t_xxx&period=2026-05
3. 若有收款记录 → 已交；否则 → 未交
```

### 7.3 代客录入收款（写入后自动刷新指标）

```
1. GET /api/integration/tenants?project_id=X&name=XXX → tenant_id
2. POST /api/integration/write → 写入收款
3. 根据返回的 compute_hint：
   POST /api/integration/compute/refresh { project_id, year } → 刷新 KPI
4. GET /api/integration/kpi → 确认最新指标
5. 回复用户
```

### 7.4 查询"本月哪些租户欠租"（精确口径）

```
1. POST /api/integration/compute/billing { project_id, year, month }
   → 返回含免租/调价/顺延的完整应收明细
2. 过滤 status != 'Paid' 的行
3. 回复列表
```

---

## 8. 计算口径一致性（保证）

| 维度 | 说明 |
|------|------|
| **代码** | 服务端计算端点直接 import 前端的 `billingService.ts`、`dashboardMetrics.ts`、`pocketbaseService.ts`，**同一份代码** |
| **数据** | `compute-engine.ts` 调用 `fetchPocketBaseBackup()` 拉取数据，与前端加载路径一致 |
| **预算** | 预算假设（`pb_budget_assumptions`）、调整（`pb_budget_adjustments`）、方案（`pb_budget_scenarios`）完整参与计算 |
| **初始化数据** | `pb_monthly_init_data`（月度初始化）、`pb_yearly_targets`（年度目标）完整参与计算 |
| **免租/调价/顺延** | 全部由 `billingService.generateBudgetedBills()` 处理，与前端 `calculateBudgetedReceivableInPeriod` 逻辑一致 |
| **刷新机制** | 前端每次保存 → `triggerServerComputeRefresh` → Gateway 重算并回写 `pb_kpi_snapshots` |

| 前端数据 | 服务端端点 | 计算方式 |
|---------|-----------|---------|
| 首页 KPI 卡片 | `POST /api/integration/compute/kpi` | 完整计费引擎 → `calculateDashboardMetrics` → `buildKpiSummaryFromProcessedData` |
| 预算执行趋势 | `POST /api/integration/compute/kpi` → `monthlyTrends` | 完整计费引擎含预算方案上下文 |
| 应收核销明细 | `POST /api/integration/compute/billing` | `generateBudgetedBills` → `buildBillingDetailsForPeriod` |
| 租户合同 | `GET /api/integration/tenants` | 直接读 `pb_tenants` |
| 收款记录 | `GET /api/integration/payments` | 直接读 `pb_payments` |

---

## 9. 字段映射速查

PocketBase 使用 `snake_case`，类型定义使用 `camelCase`。常用映射：

| 类型字段 (camelCase) | PocketBase 字段 (snake_case) | 集合 |
|---------------------|---------------------------|------|
| `Tenant.id` | `original_id` | pb_tenants |
| `Tenant.name` | `name` | pb_tenants |
| `Tenant.leaseStart` | `lease_start` | pb_tenants |
| `Tenant.leaseEnd` | `lease_end` | pb_tenants |
| `Tenant.monthlyRent` | `monthly_rent` | pb_tenants |
| `Tenant.status` | `status` | pb_tenants |
| `Tenant.unitIds` | `unit_ids` (JSON) | pb_tenants |
| `Tenant.isSpecialBusiness` | `is_special_business` | pb_tenants |
| `Tenant.freeRentHandling` | `free_rent_handling` | pb_tenants |
| `PaymentRecord.id` | `original_id` | pb_payments |
| `PaymentRecord.tenantId` | `tenant_id` | pb_payments |
| `PaymentRecord.amount` | `amount` | pb_payments |
| `PaymentRecord.type` | `type` | pb_payments |
| `PaymentRecord.date` | `date` | pb_payments |
| `PaymentRecord.period` | `period` | pb_payments |
| `Building.id` | `original_id` | pb_buildings |
| `Unit.id` | `original_id` | pb_units |
| `Unit.buildingId` | `building_id` | pb_units |

---

## 10. 安全要求

1. **生产环境不得向模型暴露** PocketBase 管理员密钥（`PB_ADMIN_PASSWORD`）
2. Gateway 通过 `pb_integration_sources` 的 `secret_hash` 校验写入来源
3. 建议为 OpenClaw 创建**独立的 PocketBase 业务用户**（`role: park_user`），仅授予其绑定园区的权限
4. 收紧 `pb_*` 集合的 API Rules，按 `project_id` + 角色限制可见行
5. 生产部署建议 Gateway 仅监听内网 IP 或通过 Tailscale 组网

---

## 11. 部署与启动

```bash
# 1. 确保 PocketBase 已启动（端口 8090）
# 2. 设置环境变量
export PB_URL=http://127.0.0.1:8090
export PB_ADMIN_EMAIL=admin@example.com
export PB_ADMIN_PASSWORD=your-password

# 3. 启动 Gateway（通过 tsx 运行 TypeScript）
npx tsx scripts/integration-gateway.ts

# 4. 验证
curl http://127.0.0.1:8787/health
# → { "ok": true, "pb": "http://127.0.0.1:8090" }
```

**一键启动**（含前端 + PocketBase + Gateway）：

```bash
bash start-all.sh
```

`start-all.sh` 已集成 Gateway 启动步骤，默认端口 8787。Gateway 启动失败不会阻塞前端——仅 OpenClaw 计算 API 不可用，看板本身正常运行。
