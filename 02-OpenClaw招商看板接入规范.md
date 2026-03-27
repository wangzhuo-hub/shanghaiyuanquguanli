# OpenClaw 接入规范（企微等渠道 → OpenClaw → 上海园区招商看板 / PocketBase）

目标：通过企业微信或其他 IM 将**自然语言指令**交给 OpenClaw，使其能够：

1. **读取** PocketBase 中**集合化**的招商/合同/收款数据，做欠费、收缴率、按租户/按账期等**精准提炼与分析**；
2. **写入**标准化记录，支持典型场景：**租金收款核销（带账期）**、**合同/租户录入与更新**（可扩展至房源状态、备注等）。

本系统后端为 **PocketBase（HTTP REST）**，业务数据以 `pb_*` 集合为主；**分析应收请以结构化集合为准**，不要依赖 `park_backups` 单一大 JSON 作为唯一数据源。

---

## 1. 推荐接入架构

### 1.1 方案 A：OpenClaw 直读/直写 PocketBase（最少组件，风险较高）

- **读**：`GET /api/collections/{collection}/records?filter=...`
- **写**：`POST` / `PATCH /api/collections/{collection}/records`（及必要时 `DELETE`）

适用：内网演示、API Rules 已放开或已配置服务账号且仅限内网访问。

**风险**：

- Rules 过宽时存在被篡改风险；
- 无网关时难以统一 **幂等**、**审计**、**复杂核销规则**（续签 rootId 链等）；
- 多表一致（合同与 `pb_units` 状态）需 OpenClaw 自行保证。

### 1.2 方案 B（推荐）：OpenClaw → 轻量「业务网关」→ PocketBase

网关职责：

- 校验 `Authorization: Bearer <TOKEN>` 或 HMAC 签名；
- 固定注入/校验 **`project_id`**；
- 封装 **应收核销**：解析自然语言 → 解析租户（名称模糊查 → 唯一 `original_id`）→ 生成 `pb_payments` 行并设置 `period`；
- 封装 **合同录入**：校验 `building_id`、`unit_ids` 存在 → upsert `pb_tenants` → 可选更新 `pb_units`；
- **幂等**：`externalId`（企微 `msgId` 等）映射到已创建的业务 id；
- 可选：对内调用与前端一致的规则函数（对齐 `billingService.ts`）。

适用：**生产**、企微公网回调、需要审计与去重时。

> 可先按方案 A 跑通只读分析 + 单表写入，再切方案 B。

---

## 2. 系统侧（PocketBase）数据面

### 2.1 必读集合与用途（OpenClaw 分析用）

| Collection | 用途 |
|------------|------|
| `pb_buildings` | 楼宇/场地列表 |
| `pb_units` | 房间面积、状态（Vacant/Occupied/Reserved） |
| `pb_tenants` | 合同/租户主数据（租期、租金、状态、root_id 续签链） |
| `pb_payments` | 收款流水（**租金核销核心**） |
| `pb_invoices` | 开票相关 |
| `pb_yearly_targets` / `pb_monthly_init_data` | 目标与历史初始化指标 |
| `pb_budget_assumptions` / `pb_budget_adjustments` / `pb_budget_scenarios` | 预算与缓缴等 |
| `pb_billing_period_notes` | 账期备注（键：`tenantId###YYYY-MM`） |

**统一过滤条件示例**：

```http
GET {PB_BASE}/api/collections/pb_tenants/records?filter=project_id="park_data_main"&perPage=500
```

（将 `park_data_main` 换成实际 `project_id`。）

### 2.2 典型只读查询模式

- **按租户名模糊查 id**：`filter=project_id="..." && name~"关键词"`（再结合人工消歧）
- **某租户所有收款**：`filter=project_id="..." && tenant_id="租户original_id"`
- **某账期租金流水**：`type` 为 `Rent` 或 `DepositToRent`，且（`period="2026-03"` **或** `date` 以 `2026-03` 开头——与前端 `paymentMatchesRentBillingPeriod` 语义对齐时注意优先 `period`）

### 2.3 写入目标集合摘要

**收款核销（pb_payments）** 关键字段：

- `original_id`（必填，业务 id，建议网关生成 uuid 或 `pay_` 前缀+雪花）
- `tenant_id`（必填，**等于** `pb_tenants.original_id`）
- `tenant_name`（建议冗余，便于列表展示）
- `amount`（必填，元）
- `type`：租金类核销用 `Rent` 或 `DepositToRent`
- `date`（必填，YYYY-MM-DD，**实际收款日**）
- `status`：`Received` / `Pending`
- `period`（**强烈建议**，YYYY-MM，**应收归属账期**）
- `invoice_status`、`remarks`、`project_id`

**合同录入（pb_tenants）**：字段与 `pocketbase/schema.json` 及 `syncToStructuredCollections` 中租户 payload 一致；**必填项以后端规则与前端校验为准**，至少保证：`original_id`、`name`、`building_id`、`lease_start`、`lease_end`、`status`、`project_id` 及租金相关核心字段与前端约定一致。

---

## 3. OpenClaw → 系统 规范（建议统一 JSON）

无论直写还是网关，建议 OpenClaw 先产出**结构化意图 + payload**，并保留 `raw` 渠道信息。

### 3.1 通用信封

```json
{
  "externalId": "wecom:msgid:xxxxxxxx",
  "projectId": "park_data_main",
  "intent": "payment_record | tenant_upsert | query_receivables | ...",
  "payload": {},
  "raw": {
    "channel": "wecom",
    "msgId": "xxxxx",
    "originalText": "用户原文..."
  }
}
```

### 3.2 收款核销（intent = `payment_record`）

```json
{
  "externalId": "wecom:msgid:abc",
  "projectId": "park_data_main",
  "intent": "payment_record",
  "payload": {
    "tenantId": "t_xxx",
    "tenantName": "某某科技",
    "amount": 128000.5,
    "type": "Rent",
    "date": "2026-03-26",
    "period": "2026-03",
    "status": "Received",
    "invoiceStatus": "Pending",
    "remarks": "3月租金，企微确认"
  }
}
```

**字段映射（→ pb_payments）**：

- `tenantId` → `tenant_id`
- `tenantName` → `tenant_name`
- 其余同名字段 → snake_case 写入（`invoiceStatus` → `invoice_status`）
- 生成唯一 `original_id` 写入 `original_id`

**自然语言解析提示**：

- 「收某某 12.8 万 3 月租金」→ `amount` 数值化、`period="2026-03"`（需结合当前年份消歧）
- 若用户只说「今天收到」→ `date` 用处理日；`period` 建议**追问**或默认与 `date` 同月并标注置信度

### 3.3 合同录入/更新（intent = `tenant_upsert`）

```json
{
  "externalId": "wecom:msgid:def",
  "projectId": "park_data_main",
  "intent": "tenant_upsert",
  "payload": {
    "originalId": "t_new_001",
    "name": "新公司全称",
    "buildingId": "b1",
    "unitIds": ["b1-101", "b1-102"],
    "leaseStart": "2026-04-01",
    "leaseEnd": "2029-03-31",
    "monthlyRent": 50000,
    "paymentCycle": "Monthly",
    "firstPaymentDate": "2026-04-10",
    "depositAmount": 100000,
    "depositStatus": "Unpaid",
    "status": "Active",
    "rootId": "",
    "signingDate": "2026-03-20"
  }
}
```

说明：

- **更新**已有合同时使用**已有** `originalId`（即 `pb_tenants.original_id`）。
- **续签**：新业务 id + `rootId` 指向上一份 `original_id`（与前端 `Tenant.rootId` 一致）。
- 复杂 JSON 字段（`rent_free_periods`、`key_moments`）可逐步扩展；网关应对缺失字段采用与前端默认值一致的策略或返回校验错误。

### 3.4 只读分析（intent = `query_*`）

建议由网关提供**只读聚合接口**（避免 OpenClaw 多次分页算错），例如：

- `query_receivables`：参数 `period=YYYY-MM`，返回按租户欠费、已收、状态；
- `query_tenant`：参数 `tenantId` 或 `name`，返回合同摘要 + 近期流水。

若 OpenClaw 直查 PocketBase，须在系统提示词中写明 **`paymentMatchesRentBillingPeriod` / 续签 rootId** 规则，否则应收数字易与看板不一致。

---

## 4. 幂等与重试（必须）

企微/OpenClaw 常见重复投递与重试。

- **幂等键**：`externalId`（优先企微 `msgId`）。
- **实现**：网关维护 `externalId → pb_payments.original_id` 或 `pb_tenants.original_id` 映射；重复请求返回首次结果。
- 当前 **PocketBase 默认 schema 不含 `external_id`**，不建议仅靠 OpenClaw 记忆保证幂等。

---

## 5. 鉴权与安全（必须）

- 生产环境收紧 PocketBase **API Rules**；OpenClaw 使用**专用**管理员或服务账号，且 IP 白名单/VPN。
- 网关对外只暴露 HTTPS + Token/HMAC，**禁止**把 PocketBase 管理密码下发给模型上下文。
- 对外部 URL 下载附件（若有）做 SSRF 防护（本看板核心字段多为纯文本/数字，附件非必需）。

---

## 6. 回包规范（建议）

成功：

```json
{
  "ok": true,
  "businessId": "pay_xxx 或 t_xxx",
  "collection": "pb_payments",
  "created": true,
  "message": "created"
}
```

失败：

```json
{
  "ok": false,
  "code": "TENANT_AMBIGUOUS",
  "message": "名称「科技」匹配到 3 条租户，请指定全称或 tenantId"
}
```

---

## 7. 测试用例（最小闭环）

1. **只读**：按 `project_id` 列出 `pb_tenants` 前 5 条，字段完整。
2. **核销**：写入一条 `Rent`、`period=2026-03`，看板财务/应收视图与之一致（需前端刷新或订阅）。
3. **幂等**：同一 `externalId` 提交 2 次，仅 1 条 `pb_payments`。
4. **合同**：新建 `pb_tenants`，`building_id`/`unit_ids` 合法；故意错误 `building_id` 应返回校验错误。
5. **续签**：新 `original_id` + `root_id` 指向上一份，核销流水挂新 id 时看板仍能按链匹配（与 `billingService` 行为一致）。

---

## 8. 与现有前端文档的关系

- 历史 **`API_DOCUMENTATION.md`** 侧重 `park_backups` 快照接口；**OpenClaw 集合化读写请以本文 + `pocketbase/schema.json` + `services/pocketbaseService.ts` 为准**。
