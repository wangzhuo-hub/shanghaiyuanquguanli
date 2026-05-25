---
name: park-data-rules
description: 招商管理看板数据读写规则 — 供各园区 Agent 使用。涵盖楼宇/单元/租户/收款/发票/预算/目标/KPI 的完整字段约束和写入规范。
---

# 招商管理看板 — 数据读写规则

> 适用园区：上海 (shanghai_park)、北京 (beijing_park)、深圳 (shenzhen_park)
> 系统端口：1001（PocketBase） / 8787（Integration API）
> 域名：kdpark.fun

---

## ⚠️ 核心警告

**PocketBase 无数据库级外键约束，无服务端字段校验。所有关系完整性由应用层维护。错误写入会直接污染数据，且难以恢复。**

### 五条铁律（最高优先级，任何写入必须逐条遵守）

| # | 铁律 | 说明 |
|---|------|------|
| 1 | **先确认再录入** | 字段不完整时列出缺失项，不猜、不填默认值。绝不凭空假设任何字段的值。 |
| 2 | **枚举值必须对照规范** | 所有 select 字段必须对照本文档列出的允许值，不确认的不写入。 |
| 3 | **外键先查再填** | `building_id`、`unit_ids`、`tenant_id` 等引用字段，必须先查询目标集合确认记录存在，再写入。**unit_ids 必须用 original_id（格式 `{building_id}-{room}`），禁止用 PocketBase 内部 ID。** |
| 4 | **差异必确认** | 新数据与已有数据有出入时（金额不符、日期冲突、状态跳跃），必须先向用户确认，不静默覆盖。 |
| 5 | **先检查后执行** | 收到任何写入请求，先做完整性检查 + 差异检查，确认无误后再执行写入。 |
| 6 | **与用户沟通只用中文名** | 向用户索要信息时必须用前端中文名称（如「起租日期」而非 `lease_start`），用户看不懂英文字段名。下方有对照表。 |
| 7 | **给选项不给问号** | 向用户索要信息时，必须先查系统给出可选项或参考值。给楼宇列表而非问「哪个楼宇」，给状态枚举而非问「什么状态」，给已有租户列表而非问「关联哪个租户」。用户不知道系统里有什么。 |

### 用户交互规范：给选项不给问号

索要信息时先查系统或枚举规范，给出可选项，绝不让用户盲猜。

**6 个典型场景**：

| 询问内容 | 先做什么 | 给出什么 |
|---------|---------|---------|
| 所属楼宇 | 查 `buildings` 列表 | 现有楼宇清单，用户选择或输入新名称 |
| 租赁单元 | 查 `units`（按楼宇+状态筛选） | 空置/可租单元列表（含面积） |
| 付款周期 | 对照枚举规范 | 7 个选项，建议默认季付 |
| 合同状态变更 | 对照状态机 | 当前状态 → 可选的目标状态 |
| 关联租户 | 查 `tenants`（履约中） | 租户列表（含楼宇和单元信息） |
| 所有枚举字段 | 对照本文档 | 全部合法值，禁止让用户盲输 |

### 中英文字段对照（与用户沟通时必须用中文名）

| 前端中文名 | 英文名 | 前端中文名 | 英文名 |
|-----------|--------|-----------|--------|
| 企业名称 | `name` | 所属楼宇 | `building_id` |
| 租赁单元/房号 | `unit_ids` | 签约日期 | `signing_date` |
| 起租日期 | `lease_start` | 结束日期 | `lease_end` |
| 租赁面积 | `total_area` | 付款周期 | `payment_cycle` |
| 押金状态 | `deposit_status` | 押金金额 | `deposit_amount` |
| 免租期 | `rent_free_periods` | 合同状态 | `status` |
| 退租类型 | `termination_type` | 退租日期 | `termination_date` |
| 退租原因 | `termination_reason` | 特殊业态 | `is_special_business` |
| 所属园区 | `project_id` | 收款金额 | `amount` |
| 收款类型 | `type` (payment) | 收款日期 | `date` (payment) |
| 对应账期 | `period` | 关联租户 | `tenant_id` |
| 楼宇名称 | `name` (building) | 单元状态 | `status` (unit) |
| 所在楼层 | `floor` | 是否自用 | `is_self_use` |

### 写入前六步检查流程（强制执行）

```
收到写入请求
  → Step 1: 完整性检查 — 必填字段是否齐全？缺失则列出清单请用户补充
  → Step 2: 枚举值校验 — select 字段值是否在本文档允许范围内？
  → Step 3: 外键验证 — 引用的 ID 是否存在？先查目标集合
  → Step 4: 差异对比 — 与已有数据是否冲突？（金额/日期/状态/重复记录）
  → Step 5: 用户确认 — 有问题报告问题，无问题确认后执行
  → Step 6: 执行写入 — 写入成功 → 提示后续操作（重算 KPI 等）
```

### 写入后必要操作

- 写入收款/租约数据后：需调用 `/api/integration/compute/refresh` 重算 KPI
- 写入租约数据后：需调用 `/api/integration/compute/billing` 重算应收
- 提醒用户：前端仪表盘数据可能不会立即更新

---

---

## 🚫 无理要求拒绝原则

| 无理要求 | 拒绝理由 | 正确方案 |
|---------|-----------|---------|
| 直接修改账期 | 系统有专门的付款周期变更流程，会拆分租期为多段。直接改字段会导致应收错乱。 | 使用前端「付款周期变更」功能 |
| 直接修改已计算的应收/欠款/KPI | 计算字段由源数据生成，直接改结果导致不一致 | 修改源数据后重算 |
| 跳过状态机直接改状态 | 跳过中间态会导致计算逻辑错乱 | 按状态顺序逐级推进 |
| 删除有收款/发票记录的合同 | 系统硬删除，不级联清理，遗留孤儿数据 | 使用 `status='Terminated'` 终止 |

**回复模板**：> "这个操作不符合系统规则：[原因]。正确做法：[方案]。需要我引导你完成吗？"

---

## 操作规范：录入合同

**必填字段**：`name`（企业名）、`building_id`（楼宇，先查确认）、`unit_ids`（original_id 数组，格式 `{building_id}-{room}`，至少 1 个）、`signing_date`、`lease_start`（< lease_end）、`lease_end`（> lease_start）

**默认值**：status=`Active`、payment_cycle=`Quarterly`、deposit_status=`Unpaid`、deposit_amount=`0`、rent_free_periods=`[]`

> 新增合同默认 Active，立刻参与出租率和应收计算。

---

## 操作规范：修改合同

| 操作 | 限制 | 正确流程 |
|------|------|---------|
| 改 `payment_cycle` | **不能直接改字段** | 付款周期变更 → 选生效日期+新周期 → 系统分段 |
| 改 `status` → `Terminated` | 需终止信息 | `terminationDate` + `terminationType` + `terminationReason` |
| 提前退租（Early） | 触发免租金追回 | 系统自动计算 clawback |
| 回退为 Active | 清除终止数据 | 确认后方可执行 |

**终止原因**：`合同到期不续约` / `规模扩张搬迁` / `业务收缩搬迁` / `经营困难结业` / `物业环境/服务问题` / `其他原因`

---

## 操作规范：删除合同

**⚠️ 硬删除，不级联清理。优先级：终止 > 删除。**

删除前检查：关联收款(pb_payments)、关联发票(pb_invoices)、预算调整引用、预算假设引用。

替代方案：合同到期→`Expired`、终止→`Terminated`、录入错误→`Terminated`+备注。

---

## 操作规范：核销收款

**必填**：`tenant_id`（存在）、`amount`（正数，≤待收余额）、`type`（枚举）、`date`

**规则**：超余额拒绝、押金退款自动转负+更新 deposit_status、押金转租金自动设 Deducted、批量逐笔校验

---

## 操作规范：预算调整

**⚠️ 不通过 API 直接操作预算数据。** 预算方案名不能以 `invoice_dedicated_` 开头（系统保留）。调整类型：`period_shift`（平移）、`amount_delta`（纯增减）。租金平移通过 `paymentPeriodShiftMonths`，不直接改 `payment_cycle_changes`。

---

## Integration API（端口 8787）

统一查询/写入代理，自动注入 `project_id` 并验证来源权限。**所有招商看板数据操作走此接口。**

### 认证 Header（必带）

```
X-Integration-Source-Type: openclaw_agent
X-Integration-Source-Key: <园区 sourceKey>
X-Integration-Token: <园区 token>
```

### 查询端点

```bash
# KPI
GET /api/integration/kpi?project_id=<project_id>&year=2026

# 租户列表（支持 &name=关键词 模糊搜索）
GET /api/integration/tenants?project_id=<project_id>

# 收款列表（支持 &tenant_id=xxx &period=2026-05）
GET /api/integration/payments?project_id=<project_id>

# 全量快照（Dashboard + KPI + 月度趋势）
GET /api/integration/dashboard?project_id=<project_id>
```

### 写入端点（必须带认证 Header）

```
POST /api/integration/write
Content-Type: application/json
X-Integration-Source-Type: openclaw_agent
X-Integration-Source-Key: <当前园区 sourceKey>
X-Integration-Token: <当前园区 token>

{
  "collection": "pb_payments",
  "action": "create",       // create | update | upsert | delete
  "original_id": "pay_xxx_001",
  "data": {
    "tenant_id": "t_001",
    "amount": 128000,
    "type": "Rent",
    "date": "2026-05-15",
    "period": "2026-05",
    "status": "Received"
  }
}
```

> **不要**在 body 里传 `project_id`，gateway 自动注入来源绑定的园区。

支持的操作：`create`、`update`、`upsert`（有则更新无则创建）、`delete`

### 重算端点

```bash
# 重算 KPI
POST /api/integration/compute/refresh
{"project_id": "<project_id>", "year": 2026}

# 重算应收
POST /api/integration/compute/billing
{"project_id": "<project_id>", "year": 2026, "month": 5}
```

---

## 集合字段规范

### pb_buildings（楼宇）

| 字段 | 类型 | 必填 | 约束 |
|------|------|:--:|------|
| `original_id` | text | ✅ | 唯一业务 ID，与 project_id 组合唯一索引 |
| `name` | text | ✅ | 楼宇名称 |
| `type` | select | | `Building` / `Site` |
| `project_id` | text | ✅ | 多租户隔离 |

### pb_units（单元/房间）

| 字段 | 类型 | 必填 | 约束 |
|------|------|:--:|------|
| `original_id` | text | ✅ | 唯一业务 ID |
| `building_id` | text | ✅ | **必须先查询确认 building 存在** |
| `name` | text | ✅ | 单元名称/房号 |
| `area` | number | ✅ | `>= 0` |
| `status` | select | | `Vacant` / `Occupied` / `Reserved` |
| `floor` | number | | 整数 |
| `is_self_use` | bool | | 自用标记 |
| `project_id` | text | ✅ | |

> 单元 status 应与租约状态联动：有活跃租约的单元应为 `Occupied`，无租约的为 `Vacant`

### pb_tenants（租户/合同）— 30+ 字段，以下仅列关键字段

| 字段 | 类型 | 必填 | 约束 |
|------|------|:--:|------|
| `original_id` | text | ✅ | 唯一业务 ID |
| `name` | text | ✅ | 租户名称 |
| `building_id` | text | ✅ | 必须引用已存在的 `pb_buildings.original_id` |
| `lease_start` | text | ✅ | 起租日期 |
| `lease_end` | text | ✅ | 租期结束日期 |
| `total_area` | number | | `>= 0` |
| `contract_parking_spaces` | number | | 整数 |
| `actual_parking_spaces` | number | | 整数 |
| `payment_cycle` | select | | `HalfMonthly` / `Monthly` / `BiMonthly` / `Quarterly` / `SemiAnnual` / `Annual` / `Custom` |
| `free_rent_handling` | select | | `Deduct` / `Defer` |
| `deposit_status` | select | | `Unpaid` / `Paid` / `Refunded` / `Deducted` |
| `status` | select | | `Active` / `Expiring` / `Terminated` / `Pending` / `Expired` |
| `termination_type` | select | | `Normal` / `Early` |
| `unit_ids` | json | | ⚠️ **必须用 `original_id`（格式 `{building_id}-{room}`，如 `1号楼-301`）**，禁止用 PocketBase 内部 `id`！内部 ID 在跨环境同步时会变化，导致关联断裂。 |
| `rent_free_periods` | json | | 免租期数组 |
| `key_moments` | json | | 关键节点数组 |
| `name_history` | json | | 名称变更历史 |
| `project_id` | text | ✅ | |

**特别注意**：
- `first_receivable_amount`、`early_termination_fr_clawback_override`、`early_termination_deposit_deduction`、`early_termination_other_adjustment` 等是后加的计算辅助字段，非必填
- `is_special_business` 为特殊业务标记
- 修改已签约租约会影响应收计算和 KPI，需谨慎
- ⚠️ **`unit_ids` 教训**：必须存 `original_id`（业务 ID，格式 `{building_id}-{room}`），绝对不能使用 PocketBase 内部自动生成的 `id`。曾经误用内部 ID 导致跨环境同步后所有租户-单元关联断裂，需逐条修复。

### pb_payments（收款记录）

| 字段 | 类型 | 必填 | 约束 |
|------|------|:--:|------|
| `original_id` | text | ✅ | 唯一业务 ID |
| `tenant_id` | text | ✅ | **必须先查询确认 tenant 存在** |
| `amount` | number | ✅ | 收款金额 |
| `date` | text | ✅ | 收款日期 |
| `type` | select | | `Rent` / `Deposit` / `ManagementFee` / `ParkingFee` / `Other` / `DepositToRent` / `DepositRefund` |
| `status` | select | | `Received` / `Pending` |
| `invoice_status` | select | | `Pending` / `Invoiced` |
| `project_id` | text | ✅ | |

**写入流程**：
1. 先查询 `pb_tenants` 确认 `tenant_id` 存在
2. 确认收款金额和日期正确
3. 写入后重算 KPI

> `type='Rent'` 和 `'DepositToRent'` 的收款会计入月度实际收款汇总

### pb_invoices（发票记录）

| 字段 | 类型 | 必填 | 约束 |
|------|------|:--:|------|
| `original_id` | text | ✅ | 唯一业务 ID |
| `tenant_id` | text | ✅ | 必须引用已存在的租户 |
| `bill_date` | text | ✅ | |
| `amount` | number | ✅ | |
| `status` | select | | `Pending` / `Invoiced` |
| `target_invoice_date` | text | | |
| `defer_reason` | text | | |
| `project_id` | text | ✅ | |

### pb_yearly_targets（年度目标）

| 字段 | 类型 | 必填 | 约束 |
|------|------|:--:|------|
| `year` | number | ✅ | `2020-2050`，整数 |
| `revenue` | number | | 营收目标 |
| `occupancy` | number | | `0-100`（百分比） |
| `initial_budget` | number | | 年初预算 |
| `project_id` | text | ✅ | `(year, project_id)` 组合唯一 |

### pb_monthly_init_data（月度初始化数据）

| 字段 | 类型 | 必填 | 约束 |
|------|------|:--:|------|
| `year` | number | ✅ | `2020-2050`，整数 |
| `month` | number | ✅ | `1-12`，整数 |
| `revenue_target` | number | | |
| `revenue_collected` | number | | |
| `occupancy_rate` | number | | `0-100` |
| `accumulated_arrears` | number | | |
| `initial_budget` | number | | |
| `project_id` | text | ✅ | `(year, month, project_id)` 组合唯一 |

> `revenue_collected` 应与实际 `pb_payments` 记录一致。直接设置不一致的值会导致 KPI 错乱。

---

## ⛔ 禁止直接写入的集合

| 集合 | 原因 |
|------|------|
| `pb_integration_snapshots` | 系统自动生成的全量快照（15MB JSON），由前端 `scheduleUpsertIntegrationFullSnapshot()` 在仪表盘重算后写入。直接写入会导致快照与实际数据不一致。 |
| `pb_kpi_snapshots` | 系统 KPI 快照，由 `buildOpenClawKpiSnapshot()` 计算。直接写入会导致 KPI 数据错乱。 |

---

## 计算字段（禁止直接写入）

以下字段由系统计算引擎生成，直接写入会在下次重算时被覆盖，或导致数据不一致：

| 字段 | 所属集合 | 计算方式 |
|------|---------|---------|
| 出租率 | 派生指标 | `已占用面积 / 可出租总面积`（来自 `dashboardMetrics.ts`） |
| 应收金额 | 派生指标 | `billingService.ts` 根据租约条款 + 免租期 + 付款周期计算 |
| 欠款 | 派生指标 | 每月"应收 - 已收"汇总 |
| 月度趋势 | 派生指标 | 从实际 `pb_payments` 和 `pb_tenants` 汇总 |

---

## 多租户隔离规则

所有业务集合（buildings, units, tenants, payments, invoices, yearly_targets, monthly_init_data, budget_*）通过 `project_id` 实现园区隔离。

### 园区 project_id

| 园区 | project_id |
|------|-----------|
| 上海 | `shanghai_park` |
| 北京 | `beijing_park` |
| 深圳 | `shenzhen_park` |

### 规则

- 每条记录写入时必须带正确的 `project_id`
- `project_id` 错误或缺失 → 数据不可见（不会报错，静默失败）
- 每条记录有 `(original_id, project_id)` 复合唯一索引
- **严禁跨园区写入**：Integration API 会校验 source 绑定的园区与写入目标一致

---

## 关系约束（应用层，非数据库层）

| 来源 | 字段 | 目标 | 说明 |
|------|------|------|------|
| `pb_units` | `building_id` | `pb_buildings.original_id` | 单元必须属于某楼宇 |
| `pb_tenants` | `building_id` | `pb_buildings.original_id` | 租约必须关联楼宇 |
| `pb_tenants` | `unit_ids[]` | `pb_units.original_id` | 租用单元必须存在 |
| `pb_payments` | `tenant_id` | `pb_tenants.original_id` | 收款必须关联租户 |
| `pb_invoices` | `tenant_id` | `pb_tenants.original_id` | 发票必须关联租户 |
| `pb_budget_assumptions` | `target_id` | `pb_tenants.original_id` | 预算假设针对特定租户 |
| `pb_budget_adjustments` | `tenant_id` | `pb_tenants.original_id` | 预算调整针对特定租户 |

> 以上关系均为逻辑约束，数据库层不强制。写入前必须手动验证。

---

## 高风险操作警告

| 操作 | 风险 | 建议 |
|------|------|------|
| 修改已签约租约 | 影响应收、KPI、单元状态 | 使用前端界面操作 |
| 批量导入收款 | 可能产生重复或错误金额 | 逐条确认或使用前端导入 |
| 删除楼宇 | 关联单元/租约/收款可能孤立 | 先检查关联数据 |
| 删除租户 | 关联收款/发票/预算数据可能孤立 | 使用 status=`Terminated` 而非物理删除 |
| 直接修改 KPI 快照 | 快照与源数据不一致 | 重算而非修改 |
| 修改 budget_scenarios | 涉及复杂预算逻辑 | 使用前端预算模块 |
| 写入不带 project_id 的数据 | 数据不可见（静默失败） | 每次写入核对 project_id |

---

## 写入检查清单

执行任何写入前，按此清单逐项确认：

```
□ 1. project_id 是否正确？（shanghai_park / beijing_park / shenzhen_park）
□ 2. original_id 是否唯一？（同 project_id 下不重复）
□ 3. 外键引用是否存在？（先查询目标集合）
□ 4. 枚举值是否在允许范围内？（对照上方字段规范）
□ 5. 金额/面积是否为正数？
□ 6. 日期格式是否正确？
□ 7. 是否误写了计算字段？（对照禁止写入清单）
□ 8. 写入后是否需要重算？（收款→KPI，租约→应收）
```

---

## 新园区 Agent 接入

1. 在服务器 `pb_integration_sources` 集合中注册新的 `source_type` + `source_key`
2. 生成 token 并绑定 `project_id`
3. 将 sourceKey 和 token 配置到 Agent 的 `parks.json` 中
4. Agent 即可通过 Integration API（:8787）查询和写入数据
