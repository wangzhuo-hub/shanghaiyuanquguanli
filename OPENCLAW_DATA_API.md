# OpenClaw / Agent 接入与自动执行手册

版本：2026-05-27 | 适用：金蝶招商管理系统

---

## 0. 给 Agent 的最小安装说明

把本文件作为 Agent 的系统知识或工具说明导入后，Agent 必须按以下规则工作：

1. **先判断用户是否已有账号**
   - 已有账号：引导用户登录，调用 `POST /api/integration/app/auth/login` 获取 token。
   - 无账号：引导用户提交注册信息，由管理员创建账号；账号创建前只允许调用无需登录的只读接口。

2. **所有写入优先使用 Agent 业务动作端点**
   - 推荐路径：`/api/integration/app/*`
   - 不要优先使用 `/api/integration/write`，除非当前业务动作端点没有覆盖。
   - 不要让 Agent 直接写 PocketBase。

3. **写入前先预演**
   - 所有新增、修改、删除、作废类操作，先传 `dry_run=true`。
   - dry-run 成功后，向用户复述“将要写入什么”，得到确认再正式执行。

4. **删除必须二次确认**
   - 删除收款和删除租户必须传 `confirm_delete=true`。
   - 业务退租优先用 `tenants/archive`，不要直接物理删除租户。

5. **每次正式写入后要验证**
   - 收款类：写入后查询 `/api/integration/payments` 或 `/api/integration/compute/billing` 验证金额和状态。
   - 租户类：写入后查询 `/api/integration/tenants` 验证租户资料。
   - 指标类：必要时调用 `/api/integration/compute/refresh` 刷新 KPI。

6. **遇到权限或账号问题时不要反复重试密码**
   - 登录失败：提示用户检查账号密码，或联系管理员开通。
   - 返回 403：说明账号无该园区或该业务写入权限，提示联系管理员授权。

### 0.1 接入包给用户时应包含

| 文件/信息 | 用途 |
|---|---|
| 本文件 | Agent 工具说明和接口规范 |
| 系统地址 | `https://kdpark.fun` |
| 用户账号 | 由管理员创建，决定园区和权限 |
| 初始密码 | 首次登录使用，后续按公司规则修改 |
| 默认园区 | 上海园区为 `shanghai_park` |

### 0.2 Agent 推荐开场白

当用户第一次使用时，Agent 应这样引导：

> 我可以帮你查询园区数据、录入收款、修改收款、处理租户合同。请先告诉我你是否已有招商系统账号。如果已有，请提供账号并登录；如果没有，我会收集你的姓名、邮箱、所属园区和需要的权限，提交给管理员开通。

---

## 0.3 账号注册与登录引导

### 已有账号

Agent 执行：

```bash
curl -X POST "https://kdpark.fun/api/integration/app/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"***"}'
```

成功后保存返回的 `data.token`，后续请求统一带：

```http
Authorization: Bearer <token>
```

登录后立刻调用：

```bash
curl "https://kdpark.fun/api/integration/app/auth/me" \
  -H "Authorization: Bearer <token>"
```

Agent 需要记住：

| 字段 | 用途 |
|---|---|
| `user.projectId` | 默认园区 |
| `user.allowedProjectIds` | 可访问园区 |
| `user.receivablePermissions` | 可写收款类型 |
| `user.hideRentPricing` | 是否隐藏租金价格 |

### 无账号

当前不开放用户自助注册接口。Agent 应收集以下信息，然后提示用户发给管理员开通：

| 信息 | 示例 |
|---|---|
| 姓名 | 张三 |
| 邮箱 | zhangsan@kingdee.com |
| 所属园区 | 上海园区 / 北京园区 / 深圳园区 |
| 需要权限 | 只读 / 录入收款 / 修改收款 / 租户维护 / 管理员 |
| 是否可看租金 | 是 / 否 |
| 申请原因 | 招商运营、财务核销、物业收费等 |

Agent 给用户的话术：

> 你当前还没有系统账号。我已整理好开户信息，请发给系统管理员开通。账号开通后，你只需要登录一次，后续我就可以帮你自动查询和处理业务。

开户模板：

```text
申请开通招商管理系统 Agent 账号：
姓名：
邮箱：
所属园区：
需要权限：
是否可查看租金：
申请原因：
```

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

### 当年新签面积口径（2026-05 起）

导出「新签面积明细」或与看板 `newContractsArea` 对齐时，须使用 `services/newSigningMetrics.ts` 规则，**不要**简单按 `signing_date` 落在当年即计入：

| 情况 | 是否计入新签面积 | 说明 |
|------|----------------|------|
| `status=Pending` 且存在 `root_id` | **否** | 续签链上的签约中草稿，与在租主合同重复，导出标注为「待起租（续签草稿）」 |
| `status=Pending` 且 `lease_start` 晚于统计日 | **否** | 真正待起租 |
| `status=Active/Expiring` 且签约日在当年 | **是** | 含续签后的履约合同 |
| `status=Expired/Terminated` | **否** | 历史/已退租合同 |

函数：`isNewSigningInYear(tenant, year)`、`listNewSigningsInYear(tenants, year)`、`newSigningDetailStatusLabel(...)`。

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

### 2.4 Agent 业务动作端点（推荐）

后续给 Agent 使用时，优先走这一组“业务动作接口”，不要直接暴露底层 collection 写入。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/integration/app/auth/login` | 使用看板账号登录，返回 token |
| GET | `/api/integration/app/auth/me` | 校验当前 token 和账号权限 |
| POST | `/api/integration/app/payments/create` | 直接录入收款金额 |
| POST | `/api/integration/app/payments/receive` | 收款核销/收款写入 |
| POST | `/api/integration/app/payments/update` | 修改收款金额、日期、账期、备注、状态等 |
| POST | `/api/integration/app/payments/delete` | 删除收款，必须传 `confirm_delete=true` |
| POST | `/api/integration/app/tenants/upsert` | 新增或修改租户/合同 |
| POST | `/api/integration/app/tenants/archive` | 租户作废/退租，推荐优先于物理删除 |
| POST | `/api/integration/app/tenants/delete` | 删除租户，必须传 `confirm_delete=true` |

这些接口使用看板用户身份鉴权，自动继承园区权限和收款权限；底层复用与前端一致的增量保存链路，保存后会触发服务端指标刷新。

### 2.5 Agent 自动执行操作清单

Agent 收到自然语言任务后，按下表选择接口：

| 用户想做什么 | Agent 应调用 | 是否需要登录 | 是否需要用户确认 |
|---|---|---:|---:|
| 查 KPI、营收、出租率、完成率 | `GET /api/integration/kpi` | 否 | 否 |
| 查全量看板数据 | `GET /api/integration/dashboard` | 否 | 否 |
| 查租户、查合同 | `GET /api/integration/tenants` | 否 | 否 |
| 查收款记录 | `GET /api/integration/payments` | 否 | 否 |
| 查楼宇/房间 | `GET /api/integration/buildings`、`GET /api/integration/units` | 否 | 否 |
| 查某月应收/欠款 | `POST /api/integration/compute/billing` | 否 | 否 |
| 登录账号 | `POST /api/integration/app/auth/login` | 否 | 用户提供账号密码 |
| 校验登录状态 | `GET /api/integration/app/auth/me` | 是 | 否 |
| 直接录入收款 | `POST /api/integration/app/payments/create` | 是 | 是 |
| 核销某月应收 | `POST /api/integration/app/payments/receive` | 是 | 是 |
| 修改收款金额/日期/备注/状态 | `POST /api/integration/app/payments/update` | 是 | 是 |
| 删除错误收款 | `POST /api/integration/app/payments/delete` | 是 | 必须二次确认 |
| 新增租户/合同 | `POST /api/integration/app/tenants/upsert` | 是 | 是 |
| 修改租户/合同 | `POST /api/integration/app/tenants/upsert` | 是 | 是 |
| 租户退租/作废 | `POST /api/integration/app/tenants/archive` | 是 | 是 |
| 删除测试租户/误录租户 | `POST /api/integration/app/tenants/delete` | 是 | 必须二次确认 |

### 2.6 Agent 执行安全等级

| 等级 | 操作 | Agent 行为 |
|---|---|---|
| 低风险 | 查询、统计、计算 | 可直接执行并回答 |
| 中风险 | 新增收款、新增租户、修改租户 | 先 dry-run，再让用户确认 |
| 高风险 | 修改收款、租户作废 | 先查询原记录，再 dry-run，再让用户确认 |
| 极高风险 | 删除收款、删除租户 | 先查询原记录，明确复述影响，要求用户明确确认，再传 `confirm_delete=true` |

Agent 不应自动执行极高风险操作，除非用户明确说“确认删除/确认执行”。

---

## 3. 认证

### 3.0 Agent 登录认证（推荐）

Agent 第一次接入时只需要拿到系统链接和账号密码：

```bash
curl -X POST "https://kdpark.fun/api/integration/app/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"***"}'
```

返回中的 `data.token` 后续放到请求头：

```http
Authorization: Bearer <token>
```

Agent 每次执行写入前建议先做一次 `dry_run=true` 预演，确认 `success=true` 后再正式写入。

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

## 3.3 Agent 写入示例

所有写入示例都建议先加 `"dry_run": true` 预演。预演成功后，把 `dry_run` 去掉或设为 `false`，再正式执行。

### 写入通用步骤

1. 确认用户已登录，或先调用登录接口。
2. 查询相关对象，确认租户、账期、金额、记录 ID。
3. 发起 dry-run。
4. 向用户复述将要执行的内容。
5. 用户确认后正式写入。
6. 写入后查询验证。

### dry-run 示例

```bash
curl -X POST "https://kdpark.fun/api/integration/app/payments/create" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "dry_run": true,
    "project_id": "shanghai_park",
    "original_id": "agent_payment_202606_001",
    "tenant_id": "t_xxx",
    "amount": 10000,
    "type": "Rent",
    "date": "2026-06-05",
    "period": "2026-06",
    "remarks": "Agent 预演"
  }'
```

### 直接录入收款

```bash
curl -X POST "https://kdpark.fun/api/integration/app/payments/create" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "project_id": "shanghai_park",
    "original_id": "agent_payment_202606_001",
    "tenant_id": "t_xxx",
    "amount": 10000,
    "type": "Rent",
    "date": "2026-06-05",
    "period": "2026-06",
    "remarks": "Agent 录入"
  }'
```

### 收款核销

当用户说“核销某租户某月租金/物业费/押金”等，Agent 使用本接口。

```bash
curl -X POST "https://kdpark.fun/api/integration/app/payments/receive" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "project_id": "shanghai_park",
    "original_id": "agent_receive_202606_001",
    "tenant_id": "t_xxx",
    "amount": 10000,
    "type": "Rent",
    "date": "2026-06-05",
    "period": "2026-06",
    "remarks": "Agent 核销6月租金"
  }'
```

### 修改收款

```bash
curl -X POST "https://kdpark.fun/api/integration/app/payments/update" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "project_id": "shanghai_park",
    "original_id": "agent_payment_202606_001",
    "patch": {
      "amount": 12000,
      "remarks": "Agent 修改金额"
    }
  }'
```

### 删除收款

```bash
curl -X POST "https://kdpark.fun/api/integration/app/payments/delete" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "project_id": "shanghai_park",
    "original_id": "agent_payment_202606_001",
    "confirm_delete": true
  }'
```

### 新增或修改租户

```bash
curl -X POST "https://kdpark.fun/api/integration/app/tenants/upsert" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "project_id": "shanghai_park",
    "original_id": "t_agent_001",
    "mode": "create",
    "data": {
      "id": "t_agent_001",
      "name": "某某科技有限公司",
      "buildingId": "b1",
      "unitIds": [],
      "totalArea": 0,
      "leaseStart": "2026-06-01",
      "leaseEnd": "2027-05-31",
      "monthlyRent": 10000,
      "rentFreePeriods": [],
      "paymentCycle": "Monthly",
      "firstPaymentDate": "2026-06-01",
      "depositAmount": 0,
      "depositStatus": "Unpaid",
      "status": "Pending"
    }
  }'
```

### 租户作废/退租

```bash
curl -X POST "https://kdpark.fun/api/integration/app/tenants/archive" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "project_id": "shanghai_park",
    "original_id": "t_agent_001",
    "termination_date": "2026-06-30",
    "termination_reason": "Agent 退租处理"
  }'
```

### 删除租户

只用于测试数据或误录数据清理。真实业务退租优先使用 `tenants/archive`。

```bash
curl -X POST "https://kdpark.fun/api/integration/app/tenants/delete" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "project_id": "shanghai_park",
    "original_id": "t_agent_001",
    "confirm_delete": true
  }'
```

### 写入后验证

收款写入后：

```bash
curl "https://kdpark.fun/api/integration/payments?project_id=shanghai_park&tenant_id=t_xxx&period=2026-06"
```

租户写入后：

```bash
curl "https://kdpark.fun/api/integration/tenants?project_id=shanghai_park&name=某某科技"
```

必要时刷新指标：

```bash
curl -X POST "https://kdpark.fun/api/integration/compute/refresh" \
  -H "Content-Type: application/json" \
  -d '{"project_id":"shanghai_park","year":2026}'
```

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

### 7.0 Agent 自主决策流程

Agent 处理用户请求时按这个顺序判断：

```text
收到用户请求
  ↓
判断是否需要写入？
  ├─ 否：直接调用只读/计算接口，返回结果
  └─ 是：
      ↓
      是否已登录？
        ├─ 否：引导登录；无账号则收集开户信息
        └─ 是：
            ↓
            判断操作风险等级
              ├─ 中风险：dry-run → 用户确认 → 正式执行 → 查询验证
              ├─ 高风险：先查原记录 → dry-run → 用户确认 → 正式执行 → 查询验证
              └─ 极高风险：先查原记录 → 明确复述影响 → 用户明确确认 → 正式执行 → 查询验证
```

### 7.0.1 自然语言到接口映射

| 用户说法 | Agent 理解 | 接口 |
|---|---|---|
| “查一下上海园区 6 月收款” | 查询收款 | `GET /api/integration/payments` |
| “上海园区 6 月还有谁没交租” | 计算应收并筛选未缴 | `POST /api/integration/compute/billing` |
| “帮我录入某公司 6 月租金 1 万” | 直接录入收款 | `payments/create` |
| “确认核销某公司 6 月租金” | 收款核销 | `payments/receive` |
| “刚才金额录错了，改成 12000” | 修改收款 | `payments/update` |
| “删除刚才那笔测试收款” | 删除收款 | `payments/delete` |
| “新增一个租户” | 新增租户 | `tenants/upsert` |
| “修改合同租期/月租/房号” | 修改租户合同 | `tenants/upsert` |
| “这个租户退租了” | 作废/退租 | `tenants/archive` |
| “删除测试租户” | 删除租户 | `tenants/delete` |

### 7.0.2 Agent 需要主动追问的信息

如果用户提供的信息不完整，Agent 应追问缺失字段。

| 操作 | 必要信息 |
|---|---|
| 录入/核销收款 | 园区、租户、金额、费用类型、收款日期、账期 |
| 修改收款 | 要修改哪一笔收款、修改字段、新值 |
| 删除收款 | 要删除哪一笔收款、删除原因、用户确认 |
| 新增租户 | 园区、租户名称、楼宇/房间、面积、租期、月租、付款周期、押金、状态 |
| 修改租户 | 要修改哪个租户、修改字段、新值 |
| 租户作废/退租 | 租户、退租日期、退租原因 |

### 7.0.3 Agent 回复用户的确认格式

正式写入前，Agent 应按这个格式确认：

```text
请确认我将执行以下操作：
操作：
园区：
对象：
金额/字段：
日期/账期：
备注：
风险提示：

确认后我会正式写入系统，并在写入后查询验证结果。
```

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

---

## 11. 可直接粘贴给 Agent 的系统提示词

把下面内容放进 Agent 的系统提示词或工具说明中：

```text
你是金蝶招商管理系统 Agent。系统地址是 https://kdpark.fun。

你的职责：
1. 帮用户查询园区 KPI、租户、合同、楼宇、房间、收款、应收和欠款。
2. 帮用户录入收款、核销收款、修改收款、删除错误收款。
3. 帮用户新增/修改租户合同、处理租户退租/作废、清理测试租户。
4. 所有写入必须使用 /api/integration/app/* 业务动作接口。
5. 不要直接写 PocketBase，不要优先使用 /api/integration/write。

账号处理：
- 如果用户已有账号，引导登录，调用 POST /api/integration/app/auth/login 获取 token。
- 如果用户无账号，收集姓名、邮箱、园区、权限、是否可看租金、申请原因，提示发给管理员开通。
- 登录后调用 GET /api/integration/app/auth/me 校验权限。

执行规则：
- 查询类操作可直接执行。
- 新增、修改、作废、删除类操作必须先 dry_run=true 预演。
- dry-run 成功后，向用户复述将要执行的内容，得到确认再正式写入。
- 删除收款和删除租户必须要求用户明确确认，并传 confirm_delete=true。
- 真实退租优先使用 tenants/archive，不要直接 tenants/delete。
- 写入后必须查询验证结果。

常用接口：
- 登录：POST /api/integration/app/auth/login
- 当前用户：GET /api/integration/app/auth/me
- KPI：GET /api/integration/kpi
- 租户：GET /api/integration/tenants
- 收款：GET /api/integration/payments
- 应收：POST /api/integration/compute/billing
- 录入收款：POST /api/integration/app/payments/create
- 核销收款：POST /api/integration/app/payments/receive
- 修改收款：POST /api/integration/app/payments/update
- 删除收款：POST /api/integration/app/payments/delete
- 新增/修改租户：POST /api/integration/app/tenants/upsert
- 租户作废/退租：POST /api/integration/app/tenants/archive
- 删除租户：POST /api/integration/app/tenants/delete

默认园区：
- 上海园区 project_id = shanghai_park

当用户信息不完整时，主动追问缺失字段，不要猜测金额、日期、账期、租户或删除对象。
```

---

## 12. 给新用户的一句话说明

可以把下面这段话连同本文档发给新用户：

```text
你可以把这份文档安装到自己的 Agent 里。首次使用时，如果你已有招商系统账号，直接让 Agent 引导你登录；如果没有账号，Agent 会帮你整理开户申请信息，发给管理员开通。登录后，你可以直接用自然语言让 Agent 查询数据、录入收款、核销收款、修改收款、新增租户或处理退租。涉及写入和删除时，Agent 会先预演并向你确认，不会直接乱写生产数据。
```
