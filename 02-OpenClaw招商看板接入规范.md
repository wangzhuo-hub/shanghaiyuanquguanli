# OpenClaw 接入规范（结构化数据面版）

适用场景：企业微信 / IM → OpenClaw → 招商管理看板（PocketBase，多园区 `project_id` 隔离）。

本文与当前代码一致：**业务数据的读、写、算应以 PocketBase `pb_*` 结构化集合为准**。标准迁移会删除 `park_backups`；不要依赖整包 JSON 文件作为运行时数据源，也不要假设库内仍存在 `park_backups`。

---

## 1. 结论：数据从哪来、往哪写

| 层级 | 说明 |
|------|------|
| **主数据面** | 各 `pb_*` 集合，查询时**必须**带 `project_id` 过滤（与前端 `CloudConfig.projectId` 一致，常见默认 `park_data_main`）。 |
| **应用内聚合形态** | `types.ts` 中的 `DashboardData`：由多表行映射而成，参考 `services/pocketbaseService.ts` 的 `fetchPocketBaseBackup`。 |
| **只读全量集成快照（推荐用于日报 / 全量查询）** | `pb_integration_snapshots` 中 `snapshot_kind = "full_dashboard_v1"` 的 **`payload`** JSON：由前端按看板同源口径生成并防抖写入（§3.5.2）。内含 **`dashboard`**、**`full_year_monthly_trends`** 及 **`kpi`**（原 KPI 快照结构）。经营简报可只解析 **`payload.kpi`**，**无需**在网关重跑 `calculateDashboardMetrics`。 |
| **只读 KPI 年快照（轻量）** | **`pb_kpi_snapshots`**：按 **`project_id` + `year`** 唯一；字段 **`summary_json`**（与界面 KPI 卡片同源结构）、**`monthly_trends_json`**（可选）、**`data_version`**。保存成功或指标重算后由前端 upsert；适合仅需年度/月度汇总、不需整板 `payload` 的对接（§3.5.3）。 |
| **`park_backups`（已移除）** | 迁移 `1772000000_drop_park_backups.js` 会从库中删除该集合。OpenClaw **不得**依赖；未跑该迁移的旧库可能仍存在，但**与当前前端主链路无关**。整包恢复请用 JSON + `scripts/migrate-json-to-pb.mjs` 写入 `pb_*`。 |
| **JSON 文件** | 仅用于运维脚本（如 `scripts/migrate-json-to-pb.mjs`）一次性导入，**不是** OpenClaw 运行时接口。 |

OpenClaw 侧推荐：通过 **PocketBase REST API**（或经业务网关代理）对 `pb_*` 做列表/过滤/创建/更新；**经营指标或整板同源数据**优先拉 §3.5 **`pb_integration_snapshots`**；其余复杂统计再在网关或 OpenClaw 内存中基于 `payload` 或结构化结果计算。

---

## 2. PocketBase 调用通则

- **Base URL**：与前端一致，例如部署默认见 `config/deploymentDefaults.ts` 的 `VITE_POCKETBASE_URL`（常见内网端口以实际为准）。**多园区不等于多套 API 地址**：仍为 **同一套** `/api/collections/<name>/records`，靠 **认证身份 + Rules** 限制可见数据。
- **鉴权**：按现有 **API Rules**（集合 `listRule` / `viewRule` / `createRule` / `updateRule` / `deleteRule`）。`users` 记录常见字段：**`project_id`**（默认园区）、**`allowed_project_ids`**（可访问的多个 `project_id` JSON 数组）、**`role`**（如 `park_user`、`park_admin`、`group_admin`、`platform_admin`）。自动化写入通常使用 **业务用户 Token** 或经网关换票（生产**禁止**向模型上下文暴露管理员密钥）。
- **分园区 / 分对接方的读写边界**：  
  - **推荐**：为每个外部系统（或每个只允许访问单一园区的机器人）在 PocketBase 创建 **独立 `users` 账号**，仅将对应 **`project_id` 写入 `allowed_project_ids`**（或单园区时 `project_id` 与数据一致）。  
  - **只读对接**：在相关集合上收紧 **`createRule` / `updateRule` / `deleteRule`**（例如仅 `platform_admin` 可写），只放开 **`listRule` / `viewRule`**。  
  - **不推荐**：为「三个园区」部署三套 PocketBase 实例；运维成本与备份复杂度成倍增加。若必须对外暴露多个网关域名，应在 **网关层** 鉴权后再用对应用户 Token 调同一 PocketBase。  
  - 详见 **`docs/04-多园区登录与Tailscale部署.md`** 与 **`01-招商看板架构梳理.md`** §5。
- **过滤项目**：几乎所有业务查询都应包含：  
  `filter=project_id="<你的 projectId>"`  
  多条件时用 `&&` 连接。若账号 **`allowed_project_ids`** 已含多园区，仍需在查询中显式过滤目标 **`project_id`**，避免误扫全库（Rules 仍会兜底拒绝越权行）。
- **字段命名**：库内为 **snake_case**（如 `original_id`、`tenant_id`、`lease_start`）；应用类型为 **camelCase**。下表给出常用映射。

实现参考（读路径聚合）：`services/pocketbaseService.ts` 中 `fetchPocketBaseBackup`。  
实现参考（写路径拆分）：同文件 `saveToPocketBase`。

---

## 3. 结构化集合与 REST 形态

下列路径均为 PocketBase 标准 CRUD（示例为列表）：

`GET /api/collections/<集合名>/records?filter=...&perPage=500`

### 3.1 楼宇 / 单元

| 集合 | 关键字段 | 说明 |
|------|----------|------|
| `pb_buildings` | `original_id`, `name`, `type`, `project_id` | `original_id` ↔ 应用 `Building.id` |
| `pb_units` | `original_id`, `building_id`, `name`, `area`, `status`, `floor`, `is_self_use`, `project_id` | `building_id` 存应用侧楼宇 `id`（与 `pb_buildings.original_id` 一致） |

### 3.2 租户（合同）

| 集合 | 关键字段 | 说明 |
|------|----------|------|
| `pb_tenants` | `original_id`, `root_id`, `name`, `building_id`, `unit_ids` (JSON), `lease_start`, `lease_end`, `move_in_date`, `payment_cycle`, `payment_terms` (JSON), `payment_cycle_months`, `first_payment_date`, `first_payment_months`, `free_rent_handling`, `monthly_rent`, `unit_price`, … | 索引含 `name`、`building_id`、`status`，便于按名或楼栋筛选 |

按租户名模糊查询示例（需 PocketBase 过滤语法支持）：  
`filter=project_id="park_data_main" && name~"关键词"`

### 3.3 收款 / 发票

| 集合 | 关键字段 | 说明 |
|------|----------|------|
| `pb_payments` | `original_id`, `tenant_id`, `tenant_name`, `amount`, `type`, `date`, `status`, `invoice_status`, `period`, `remarks`, `project_id` | `type` 含 `Rent`、`DepositToRent` 等；租金核销见 §5 |
| `pb_invoices` | `original_id`, `tenant_id`, `bill_date`, `target_invoice_date`, `amount`, `status`, `invoiced_at`, `defer_reason`, `project_id` | |

### 3.4 目标值 / 初始化 / 预算

| 集合 | 关键字段 |
|------|----------|
| `pb_yearly_targets` | `year`, `revenue`, `occupancy`, `project_id` |
| `pb_monthly_init_data` | `year`, `month`, `revenue_target`, `revenue_collected`, `occupancy_rate`, `accumulated_arrears`, `project_id` |
| `pb_budget_assumptions` | `original_id`, `target_type`, `target_id`, `strategy`, 各类 `projected_*`, `project_id` |
| `pb_budget_adjustments` | `original_id`, `tenant_id`, `original_year/month`, `adjusted_year/month`, `amount`, `reason`, `adjustment_kind`（`period_shift` 或 `amount_delta`）, `project_id` |
| `pb_budget_scenarios` | `original_id`, `name`, `budget_year`, `is_active`, `assumptions`/`adjustments`/`base_data_snapshot` (JSON), `project_id` |

### 3.5 账期备注、保存历史、云端版本与全量集成快照

#### 3.5.1 `pb_billing_period_notes`（每条记录 `original_id` + `project_id` 唯一）

- `original_id = "billing_period_notes"`：`notes_json` 为整板账期备注（键格式与前端 `billingPeriodNotes` 一致）。其中可含 **`__budget_table_<YYYY>__`** 键（字符串值 JSON）：存放 **`BudgetTableSnapshot`**（Excel 导入的预算表明细 + **`monthlyTotals`** 每月合计，单位元），用于工作台「预算执行」月度 **`revenueTarget`** 的**最高优先级**口径（见 §3.6）；实现见 `services/budgetTableImport.ts` → `importedBudgetTableKey` / `readImportedBudgetTable`。
- `original_id = "last_save_note"`：`notes_json` 可含 `note`、`saved_at`，供「最近一次保存」展示（对应 `getPocketBaseHistory`）。
- `original_id = "dashboard_data_version"`：`notes_json` 形如 `{ "version": <非负整数> }`。前端加载时写入 `DashboardData.cloudSaveVersion`；`saveToPocketBase` 在写入前比对服务端版本，一致则成功后 `version + 1`。**经 PocketBase REST 的单条 PATCH/POST（如网关增量写收款）不会自动递增该字段**。
- **（已弃用写入）** `original_id = "openclaw_kpi_snapshot"`：旧版将 KPI 存在 `notes_json`。当前前端已改为写入 **`pb_integration_snapshots`**；老库若仍有该条可读作回落，新对接请用 §3.5.2。

#### 3.5.2 `pb_integration_snapshots`（`project_id` + `snapshot_kind` 唯一）

集合字段：`project_id`、`snapshot_kind`、`payload`（JSON，最大约 15MB，见迁移 `1772100000`）。

- **`snapshot_kind = "full_dashboard_v1"`**：由前端在每次 `recalculateMetrics` 后**防抖写入**（约 1.6s，`scheduleUpsertIntegrationFullSnapshot`）。**`payload`** 为 `IntegrationFullSnapshotV1`（见 `services/integrationSnapshot.ts`），包含：
  - **`schema_version`**：`1`
  - **`generated_at`**、**`project_id`**、**`source_cloud_save_version`**（与 `dashboard_data_version` 对齐）、**`stats_year`**
  - **`kpi`**：与旧版 `openclaw_kpi_snapshot.notes_json` 同结构的 **`OpenClawKpiSnapshot`**（算法见 `services/openclawKpiSnapshot.ts`）；月度序列与 **`calculateTrends(..., quarter='All')`** 一致
  - **`dashboard`**：与界面重算后的 **`DashboardData`** 同构 JSON
  - **`full_year_monthly_trends`**：`MonthlyTrend[]`，全年 12 月

**不递增** `dashboard_data_version`。

**写入前提**：PocketBase 已初始化且 API Rules 允许创建/更新该集合。未配置应用内 `project_id` 时前端不会调度写入。

**新鲜度**：快照随前端指标重算更新；长期无人打开看板时 `updated` 可能偏旧。

**年度营收目标与月度预算合计（理解 `payload.kpi` 必备）**

- **`annual_revenue_goal_yuan`**：优先来自 **`pb_yearly_targets`**（手工年度指标）。  
- **`annual_budget_revenue_sum_yuan`**：来自 **12 个月度 `revenueTarget` 之和**（与「预算执行」表同源）。各月 `revenueTarget` 若存在 §3.6 所述 **已导入预算表**，则逐月取自导入快照的 **`monthlyTotals`**；否则为计费引擎滚动应收（生效方案上下文下的 **`amountDue` 汇总**）。  
- 若某年仅维护了月度预算、**未**维护年度指标行，前端汇总卡片会使用 **`buildKpiSummaryFromProcessedData`** 将 **展示用年度目标回退为月度合计**，与 **`annual_budget_revenue_sum_yuan`** 对齐；OpenClaw 解析原始结构化数据时应对照两字段，避免误以为「年度目标恒等于 `pb_yearly_targets`」。

**工作台展示格式（仅 UI）**

- 首页 **所有园区经营汇总**（管理员）、**预算执行表**、**年度经营指标对比** 中，万元与百分比在界面上 **取整显示**；API 与 JSON 内仍为数值精度，其它模块（如财务报表）默认 **两位小数**。对接系统若需与截图一致可做同样取整。

**拉取示例（推荐）**

`GET /api/collections/pb_integration_snapshots/records?filter=project_id="park_data_main"&&snapshot_kind="full_dashboard_v1"&fields=payload,updated`

**仅 KPI 时**：取响应 `payload.kpi`，其字段与下表一致（`payload.kpi.schema_version === 1`）。

**`payload.kpi` 顶层字段（`schema_version === 1`）**

| 字段 | 说明 |
|------|------|
| `schema_version` | 固定 `1`，便于网关做兼容解析 |
| `generated_at` | ISO 8601 生成时间 |
| `project_id` | 与过滤用 `project_id` 一致 |
| `stats_year` | 看板当前统计年度 |
| `calendar_year` / `calendar_month` | 生成时刻公历年、月（1–12） |
| `annual_revenue_goal_yuan` | 年度营收目标（元），来自 `yearlyTargets` / `pb_yearly_targets` |
| `annual_occupancy_goal_pct` | 年度出租率目标（%） |
| `annual_budget_revenue_sum_yuan` | 12 个月度预算收入之和（元） |
| `annual_revenue_collected_yuan` | 全年实收合计（元） |
| `annual_goal_completion_rate_pct` | 相对年度目标完成率（%），同右栏「营收达成」 |
| `annual_budget_completion_rate_pct` | 相对月度预算合计完成率（%） |
| `ytd_budget_revenue_yuan` / `ytd_revenue_collected_yuan` / `ytd_completion_rate_pct` | 截至公历当月（含）在 `stats_year` 内的 YTD；历史统计年为全年 |
| `current_month_index` | 公历当月（1–12），仅当 `stats_year === calendar_year` 时有值 |
| `current_month_budget_yuan` / `current_month_collected_yuan` / `current_month_collection_rate_pct` | 当月预算、实收、收缴率（无实收数据时后两者可为 `null`） |
| `occupancy_rate_current_pct` | 当前出租率（实时快照口径，与看板一致） |
| `accumulated_arrears_yuan` | 累计欠款（元） |
| `cloud_save_version` | 写入时的 `dashboard_data_version`，便于对照并发版本 |
| `monthly` | 长度 12；每项含 `month_index`、`month_label`、`revenue_target_yuan`、`revenue_collected_yuan`、`monthly_completion_rate_pct`、`cumulative_collected_yuan`、`cumulative_budget_yuan`、`cumulative_completion_rate_pct`（累计算法与 `components/StatsCards.tsx` 中 `monthlyBreakdown` 一致） |

### 3.5.3 `pb_kpi_snapshots`（按年 KPI，轻量）

集合：**`pb_kpi_snapshots`**；唯一索引：**`(project_id, year)`**（迁移 `1773100000_created_pb_kpi_snapshots.js`）。

| 字段 | 说明 |
|------|------|
| `project_id` | 园区 ID，与业务数据一致 |
| `year` | 统计年（整数） |
| `summary_json` | **`KpiSnapshotSummary`**：含 `annualRevenueTarget`、`annualRevenueCollected`、`annualBudgetTarget`、`annualGoalCompletion`、`annualBudgetCompletion`、`occupancyRate`、`annualOccupancyTarget`、`tenantCount`、`totalArea` 等（与 `services/dashboardMetrics.ts` → **`buildKpiSummaryFromProcessedData`** 输出一致；年度目标缺省时已对月度rollup做回退，见 §3.5.2 说明） |
| `monthly_trends_json` | 可选；`MonthlyTrend[]`，便于对齐「预算执行」逐月列 |
| `data_version` | 可与 `cloudSaveVersion` 对照 |
| `calculated_at` | ISO 时间字符串 |

**拉取示例**

`GET /api/collections/pb_kpi_snapshots/records?filter=project_id="park_data_main"&&year=2026`

**与 §3.5.2 的选择**：需 **整板合同 + 楼宇 + 应收明细** 时用 **`pb_integration_snapshots`**；仅需 **年度 KPI + 可选 12 月趋势** 时用 **`pb_kpi_snapshots`**，体积更小。

### 3.6 预算执行表「预算收入」与月度应收目标（`revenueTarget`）

首页「预算执行 (Budget vs Actual)」中 **「预算收入（万元）」** 对应前端 `monthlyTrends[].revenueTarget`：库内单位为 **元**，界面展示为万元（工作台该区域 **取整**，见 §3.5.2）。**没有单独集合按月存这一列**；除 **§3.5.1 中 `__budget_table_<年>__` 存档** 外，须按与看板相同的规则计算。

**计算逻辑（与 `services/dashboardMetrics.ts` → `calculateDashboardMetrics` / `calculateTrends` 一致）**

1. **已导入预算表（最高优先级）**：若 `billingPeriodNotes`（§3.5.1 整包 JSON）中存在 **`__budget_table_<year>__`**，解析为 `BudgetTableSnapshot`，则该统计年 **每月** `revenueTarget` **严格等于** **`monthlyTotals[monthIndex]`**（元，长度 12）。**不再**执行当月 **`amountDue` 求和**，也 **不因** 存在 **`is_active` 生效方案** 而改用计费引擎结果；与 `components/BudgetManager.tsx` 中「导入后写入月度合计」的说明一致。OpenClaw 若需与界面逐月一致，可直接读取该键（或拉 §3.5.2 快照中已由同逻辑写出的 `full_year_monthly_trends` / `kpi.monthly`）。
2. **无导入表时 — 主路径**：对统计年 `year` 的每个月，将当月所有租户应收行的 **`amountDue` 求和**（与租户级应收使用同一套计费内核：`getBillingDetailsForPeriodInternal`，内部依赖 `generateBudgetedBills` 等，见 `services/billingService.ts`）。
3. **租户 / 楼宇 / 假设 / 调整从哪来**：优先使用 **当年「生效预算方案」** 的上下文（`getActiveScenarioForBudgetYear`）：  
   - 在 `pb_budget_scenarios` 中取：`project_id` 匹配且 **`is_active = true`** 且 **年份匹配统计年 `year`** 的一条。年份匹配规则与前端一致：`(budgetYear || 当年系统年) === year`（见下项 **`budget_year = 0` / 空值**）。  
   - 使用该记录的 **`base_data_snapshot`** 中的 `tenants` / `buildings`，以及方案上的 **`assumptions`、`adjustments`**（JSON 数组）。快照若缺楼宇结构，需回退或与当前 **`pb_buildings`/`pb_units`** 拼树对齐。  
   - **快照租户若缺计费字段**（如 `monthly_rent` / `monthlyRent` 为空）：前端 `calculateTrends` **仍用快照里的租户对象**参与计费；引擎内可用 `unit_price`×`total_area` 等**补算月租**。OpenClaw **不得**为此改用 **`pb_invoices`**。工程上推荐：按租户 `id` / `original_id` **用当前 `pb_tenants` 与快照租户合并补齐**租金、租期、付款周期等字段后，再跑与前端相同的 **`amountDue` 汇总**。  
   - **`assumptions` 在计费侧仅使用 `target_type = "Existing"` 的条目**（与 `buildBillingDetailsForPeriod` 过滤一致）。
4. **无导入表且无生效方案时**：`calculateTrends` 传入的 `budgetContext` 为空，则使用 **当前** `tenants` / `buildings` / `assumptions` / `adjustments`（即全量 `DashboardData` 中的合同与预算表）计算上述 `amountDue` 之和。
5. **初始化表覆盖（仅当既无导入表、又无 `budgetContext`）**：若该月在 **`pb_monthly_init_data`** 中有行（`year`、`month`、`project_id`），且当年 **没有** 生效方案上下文、**也没有** `__budget_table_<year>__`，则 **`revenue_target` 可覆盖** 当月 `revenueTarget`。**一旦存在已导入预算表**，初始化表中的 **`revenue_target` 不会** 覆盖该年「预算执行」列（导入表优先）。

**与「财务应收工作台」方案的区别**

- **预算执行表**用 **`getActiveScenarioForBudgetYear`**（`is_active` + `budget_year`）。  
- 财务里按租户展开的应收可能优先 **应收专用方案**（`getReceivableScenarioForYear`，如 `invoice_dedicated_*` / `isReceivableActive` 等）。  
- OpenClaw 若要对齐 **预算执行截图**，必须按 **生效预算方案 + `getActiveScenarioForBudgetYear`**，不要混用应收专用方案。

**OpenClaw 落地建议**

- **最简（日报 / 完成率问答）**：直接 `GET` §3.5.2 **`pb_integration_snapshots`**（`snapshot_kind=full_dashboard_v1`），使用 **`payload.kpi`** 中汇总与 `monthly` 数组，无需自算 `revenueTarget`。注意 `stats_year` 与界面一致及记录 `updated` 新鲜度。  
- **推荐（自定义年份或快照缺失时）**：网关提供只读接口（如按 `projectId` + `year` 返回 12 个月的 `revenueTarget` 元/万元），服务端复用或移植 `calculateTrends` 中与 `revenueTarget` 相关段落，避免重复实现偏差。  
- **自建**：先读 `pb_billing_period_notes` 中 **`billing_period_notes`** 是否含 **`__budget_table_<year>__`**；有则 **`monthlyTotals` 即当月预算收入**。无则拉取 `pb_budget_scenarios`（生效条）+ 必要时 `pb_tenants` / `pb_buildings` / `pb_units` / `pb_budget_assumptions` / `pb_budget_adjustments` / `pb_monthly_init_data`，在应用层拼装与 `fetchPocketBaseBackup` 同构的子集后，复刻 `calculateTrends` 的 `targetCtx` 与按月 `amountDue` 汇总。

**实现索引**：`services/budgetTableImport.ts` → `readImportedBudgetTable`、`importedBudgetTableKey`；`services/dashboardMetrics.ts` → `calculateDashboardMetrics`、`calculateTrends`、`getActiveScenarioForBudgetYear`；`App.tsx` → `recalculateMetrics`；租户级明细 → `buildBillingDetailsForPeriod` / `getBillingDetailsForPeriodInternal`。

**禁止使用的「伪口径」**

- **`pb_invoices` 按月汇总 ≠ 预算执行表「预算收入」**。`calculateTrends` 中 **`revenueTarget` 从不读取发票集合**；发票面向开票/账务状态，与按合同+计费引擎算出的当月 **`amountDue` 合计** 不是同一指标。用 `bill_date` 累加发票金额会导致与看板系统性偏差（例如与前端 **202万** 对不上 **218万** 这类差异）。
- **合法回落路径不包含「发票按月累加」**。无 **`__budget_table_<year>__`** 时：生效方案在库中筛不到，仍须用 **当前 `pb_tenants` + `pb_buildings`/`pb_units` + `pb_budget_assumptions`（Existing）+ `pb_budget_adjustments`** 复刻当月 **`amountDue` 汇总**；仅在 **无导入表、无 `budgetContext` 且** `pb_monthly_init_data` 存在对应 `year`/`month` 行时，才允许用 **`revenue_target` 覆盖**当月预算收入。

**常见误判与排查（生效方案筛选与快照）**

- **界面文案**：`components/StatsCards.tsx` 中「数据源：生效预算方案（月度应收）」概括**月度预算收入**口径；若当年存在 **`__budget_table_<year>__`** 导入存档，则该列**严格**取导入表的 **`monthlyTotals`**，不再用生效方案计费求和。无导入表时仍按 §3.6 第 2–4 条（生效方案 → 当前合同与假设 → 初始化覆盖）回退。
- **`budget_year = 0`（重要）**：前端 `getActiveScenarioForBudgetYear` 使用 **`(s.budgetYear || fallbackYear) === year`**。在 JavaScript 中 **`0` 为假值**，故库中 **`budget_year = 0`** 时，运行时等价于 **`fallbackYear`（当前系统年）** 参与匹配（例如系统年为 2026 则与统计年 2026 一致）。若 OpenClaw 仅写 **`budget_year = 2026`** 的过滤，会**漏掉** **`budget_year = 0`** 的方案；应在应用层拉取 `is_active=true` 且 `project_id` 匹配的方案列表后，按与前端相同的 **`(budgetYear || 系统年) === year`** 判断。
- **`budget_year` 空值 / `null`**：与上同理，**空值**会退化为 **当年系统年**；仅用 `budget_year = 2026` 的 REST 过滤可能漏行，需列表 + 应用层匹配。
- **过滤条件**：必须带 **`project_id`**；布尔字段在 PocketBase 中按实际 schema 写过滤（如 `is_active = true`）；`budget_year` 类型需与库中 number 一致。
- **`pb_budget_assumptions` 字段名**：表结构为 `projected_unit_price`、`projected_rent_free_months`、`billing_cycle_shift_months` 等，**没有 `projected_rent`**。Existing 类假设多表示**账期/偏移**，当月应收金额主要来自 **`pb_tenants` 租金与租期** 在 `calculateBudgetedReceivableInPeriod` 中的推演；**不能**因假设表里若干数值为 0 就推断「应收只能改走发票累加」。

---

## 4. OpenClaw 数据调用逻辑（推荐）

### 4.1 只读：整板视图

1. 对 §3 各集合分别 `getFullList`（或分页拉全）并 `filter=project_id="..."`。  
2. 按 `fetchPocketBaseBackup` 的拼装规则合并为一块 `DashboardData`（楼宇下挂单元、字典类字段还原等）。  
3. 在内存中做应收、统计、问答；**不要**先拼 JSON 文件再解析。

**轻量替代（经营 KPI）**：若仅需年度/月度目标、实收、完成率、收缴率等，优先 **§3.5.2** 单条 **`pb_integration_snapshots`**，解析 **`payload.kpi`**，避免整板多表拉取与重复计算。

### 4.2 只读：单域查询

- **全量集成快照（推荐）**：`pb_integration_snapshots`，`filter=project_id="..." && snapshot_kind="full_dashboard_v1"`，取 **`payload`**（含 `kpi`、`dashboard`）。详见 **§3.5.2**。  
- 查某租户下收款：`pb_payments`，`filter=project_id="..." && tenant_id="..."`。  
- 查某月相关记录：对 `period` 或 `date` 加条件（口径与业务一致即可）。  
- 查发票、预算：对对应集合加 `project_id` 与业务字段过滤。  
- **按月预算收入（与预算执行表一致）**：优先检查 §3.5.1 中 **`__budget_table_<year>__`** 的 **`monthlyTotals`**；否则无单表直读；除 §3.5.2 快照（`payload.full_year_monthly_trends` / `payload.kpi.monthly`，与前端同逻辑生成）外见 **§3.6**。

### 4.3 写入：增量（OpenClaw 常见）

- **新建收款**：`POST /api/collections/pb_payments/records`，body 需包含 `project_id`、`original_id`（建议稳定唯一，如 UUID）、`tenant_id`、`amount`、`type`、`date`、`period`（建议 `YYYY-MM`）等。  
- **更新单条**：`PATCH .../records/<pbRecordId>` 或对 `original_id`+`project_id` 先查询再 `update`。  
- **租户 / 楼宇 / 发票**：同理写入对应 `pb_*`，字段与 `saveToPocketBase` 中映射保持一致。

### 4.4 写入：与前端「保存」的关系（重要）

当前前端 **主路径**为 **`saveIncrementalToPocketBase`**：按 **DirtyPayload** 增量 PATCH/POST 各 `pb_*` 行，并与服务端 **`recordMeta`（PocketBase `updated`）** 比对；冲突时用户需在界面处理。**`dashboard_data_version`** 等与 `pb_billing_period_notes` 协同；运维脚本仍可能存在 **`saveToPocketBase`** 全量替换路径（非日常 UI）。

因此：

- OpenClaw 写入的数据**会**出现在下次前端「从云端加载」的结果中。  
- 若用户**未重新加载**即在浏览器里点保存，内存状态可能不含 OpenClaw 新行；网关增量写入若**未**同步 bump 版本或合并基准，仍可能与浏览器乐观锁冲突，存在**覆盖丢失**风险。  

**建议**：网关写入后通知用户刷新看板；或读-改-写前拉取最新 `pb_*` 与 `recordMeta` 再合并。排查时可读取 `pb_billing_period_notes` 中 **`original_id = "dashboard_data_version"`** 的当前 `version`。

### 4.5 不推荐做法

- 不要假设存在 `park_backups` 或将其当作读写接口（标准库已删）。  
- 不要让模型直接读写本地 JSON 文件替代 PocketBase。  
- 不要使用「只 PATCH 半份 `DashboardData`」的假接口；没有此类官方端点。

---

## 5. 业务规则对齐（必须）

- `project_id` 全链路一致。  
- 租金应收口径对齐 `services/receivableListHelpers.ts`：  
  - `paymentMatchesRentBillingPeriod()`  
  - `paymentTenantMatchesBillingTenant()`  
- `PaymentRecord.type` 中，租金核销常关注 `Rent` 与 `DepositToRent`。  
- `period` 建议明确为 `YYYY-MM`，避免仅从 `date` 推断账期产生偏差。

---

## 6. 网关信封与意图（建议）

仍可采用统一信封，但 **intent 应面向结构化操作**，而非「整包快照」：

```json
{
  "externalId": "wecom:msgid:xxxx",
  "projectId": "park_data_main",
  "intent": "query_kpi_snapshot | query_payments | create_payment | query_tenants | upsert_tenant | query_receivables_context",
  "payload": {},
  "raw": {
    "channel": "wecom",
    "msgId": "xxxx",
    "originalText": "用户原文"
  }
}
```

- **`query_kpi_snapshot`**：网关对 PocketBase 拉取 §3.5.2 **`pb_integration_snapshots`**（`snapshot_kind=full_dashboard_v1`），将记录上的 **`payload`**（可仅截取 `payload.kpi`）填入模型上下文；请求体 `payload` 可预留 `fields`（可选）。与历史「整包 `park_backups` 快照」无关。

### 6.1 示例：`create_payment`（payload 示意）

```json
{
  "externalId": "wecom:msgid:def",
  "projectId": "park_data_main",
  "intent": "create_payment",
  "payload": {
    "original_id": "pay_openclaw_uuid_1",
    "tenant_id": "t_xxx",
    "tenant_name": "某某科技",
    "amount": 128000.5,
    "type": "Rent",
    "date": "2026-03-26",
    "period": "2026-03",
    "status": "Received",
    "invoice_status": "Pending",
    "remarks": "3月租金"
  }
}
```

网关将 payload 映射为 `pb_payments` 记录字段（snake_case）并 `POST`/`PATCH`。

### 6.2 已废弃作为主路径的意图

- `query_snapshot` / `snapshot_upsert` 面向整包快照（历史上与 `park_backups` 同类）：**与当前前端主链路不一致**；`park_backups` 已在迁移中删除。若旧网关仍保留兼容意图，仅用于对接未升级的遗留环境，不得替代 `pb_*`。

---

## 7. 幂等、错误和回包

### 7.1 幂等

- 建议使用 `externalId`（如企微 `msgId`）在网关侧映射到已创建的 `original_id` 或 PocketBase `record id`，重复请求返回首次结果。  
- `pb_*` 表本身对 `(original_id, project_id)` 有唯一索引的集合，重复 `original_id` 会触发冲突，适合作为最后一道防线。

### 7.2 回包示例

成功：

```json
{
  "ok": true,
  "intent": "create_payment",
  "collection": "pb_payments",
  "recordId": "xxxxxxxx",
  "original_id": "pay_openclaw_uuid_1",
  "message": "created"
}
```

失败：

```json
{
  "ok": false,
  "code": "TENANT_AMBIGUOUS",
  "message": "名称匹配多个租户，请补充 tenant_id"
}
```

---

## 8. 最小测试清单（结构化）

1. **按项目列出** `pb_tenants` / `pb_payments`，`filter=project_id="..."` 结果非空且字段正确。  
2. **创建**一条 `pb_payments` 后，用看板「从云端加载」可见（或 API 再次列表可见）。  
3. **并发**：模拟用户未刷新即保存，确认是否接受风险或已有网关合并策略。  
4. **幂等**：同一 `externalId` 重放不产生重复收款行。  
5. **空项目导入**：某 `project_id` 下无业务数据时，用 `scripts/migrate-json-to-pb.mjs` 从 JSON 备份灌入 `pb_*` 后，看板加载应与非空一致（可选验证）。  
6. **集成全量快照**：看板完成一次指标重算且 PB 可写后，存在 `pb_integration_snapshots` 中 `snapshot_kind="full_dashboard_v1"` 的记录；`GET` 后 `payload.schema_version === 1`，且 `payload.kpi.stats_year`、`payload.kpi.monthly.length` 等与 §3.5.2 一致；无人打开看板时允许 `updated` 较旧（见 §3.5.2 新鲜度说明）。  
7. **KPI 年快照（可选）**：保存成功后存在 `pb_kpi_snapshots` 中对应 `project_id` + `year` 的记录，`summary_json` 含年度目标/实收等字段（见 §3.5.3）。

---

## 9. 安全要求

- 生产环境不向模型上下文暴露 PocketBase 管理员账号与密钥。  
- 对外优先暴露**业务网关**，由网关完成鉴权、审计与字段校验。  
- 收紧各 `pb_*` 集合的 API Rules，按角色限制 list/create/update/delete。

---

## 10. 实现索引（便于对照代码）

| 主题 | 文件与符号 |
|------|------------|
| 结构化读聚合 | `services/pocketbaseService.ts` → `fetchPocketBaseBackup` |
| 结构化写拆分 | `services/pocketbaseService.ts` → `saveToPocketBase` |
| 云端入口 | `services/cloudService.ts` |
| 类型定义 | `types.ts` |
| 应收口径 | `services/receivableListHelpers.ts` |
| 默认 `projectId` / URL | `config/deploymentDefaults.ts` |
| 预算执行月度预算收入 `revenueTarget` | `services/budgetTableImport.ts` → `readImportedBudgetTable`（`__budget_table_<年>__`）；`services/dashboardMetrics.ts` → `calculateDashboardMetrics`、`calculateTrends`、`getActiveScenarioForBudgetYear`；§3.6 |
| 集成全量快照（含 KPI） | `services/integrationSnapshot.ts` → `buildIntegrationFullSnapshotV1`；`openclawKpiSnapshot.ts` 生成内嵌 `kpi`；`pocketbaseService` → `upsertIntegrationFullSnapshot` / `scheduleUpsertIntegrationFullSnapshot`；`App.tsx` → `recalculateMetrics` 末尾调度；§3.5.2 |
| KPI 年快照 | `pocketbaseService` → `fetchKpiSnapshot`、`upsertKpiSnapshot`；集合 **`pb_kpi_snapshots`**；§3.5.3 |
| 多园区与 Rules | `pocketbase/pb_migrations/1773000000_multi_park_auth_isolation.js`；**`docs/04-多园区登录与Tailscale部署.md`**；§2 |
