# 第五轮优化建议：兼顾 OpenClaw API 读写后的修订

前提变化:数据不再是「前端单写」,而是**前端 + OpenClaw(经 Integration Gateway)双写、双读**。这会改变前几轮部分建议的形态和优先级。本轮先讲并发模型结论,再分「前端侧修订」「OpenClaw 链路自身优化」两部分。

## 一、并发模型现状(复核结论)

好消息:OpenClaw 写入走 `/api/integration/app/*` → `mcpIncrementalSave.ts` → 与看板**完全相同**的增量保存链路(同一套 `dashboardDataToPbRecords / diffPbRecords / saveIncrementalToCloud`、同一套行级乐观锁、同一个 original_id 体系),写后 bump `dashboard_data_version` 并触发 `compute/refresh`。两个写入方语义一致,这是对的架构。

坏消息有两个,是本轮的核心:

**① 前端没有任何「外部写入感知」机制。** OpenClaw 写入 PB 后,正在打开的看板不知道:界面数据是旧的、baseline 是旧的、KPI 与 gateway 返回的对不上,直到用户手动刷新/切园区。用户编辑了恰好被 OpenClaw 也改过的行,才会在保存时撞出冲突弹窗——对用户来说莫名其妙。

**② OpenClaw 单笔写入的成本是「全量级」的。** `mcpIncrementalSave.ts` 中每个写入动作(哪怕只录一笔收款)都执行:`fetchPocketBaseBackup` 全集合拉取(105/211/285/331/368/423/467 行,每个动作一次)→ 全量 `dashboardDataToPbRecords` ×2 → 全量 diff → 提交 1 条 → 服务端全量 KPI 重算。Agent 批量录 50 笔收款 = 50 次全量拉取 + 50 次全量重算。北京园区数据规模下,这是 OpenClaw 侧响应慢的主因,也给 PB 制造了不必要的负载。

## 二、前端侧建议修订

### 2.1 新增:外部写入感知(本轮最重要的前端项)

两个方案按成本递进,建议先做轻的:

**轻方案——版本轮询 + updated 增量拉取**(1-2 天):
- `dashboard_data_version` 已经是「任何一方写入成功就 +1」的全局信号。前端每 30~60 秒轮询这一条记录(单行查询,开销忽略不计);
- 版本变了 → 按集合用 `filter: project_id=.. && updated > "<上次同步时间>"` 增量拉取变更行(PB 每行自带 updated),合并进 data + baseline + recordMeta;
- 注意:updated 过滤看不到**删除**——OpenClaw 删收款/删租户时不可见。兜底:版本变化时对各集合做一次 count 比对,数量对不上才全量校准;或长期靠重方案。

**重方案——PocketBase Realtime 订阅**(3-5 天,根治):
- PB 原生支持 SSE 订阅,按 `pb_payments / pb_tenants / pb_billing_period_notes`(OpenClaw 高频写的三个集合)订阅 project_id 过滤的变更事件,create/update/delete 都有;
- 收到事件 → 行级合并进 data + baseline + recordMeta(注意 debounce:Agent 批量写入时合并一批再触发一次重算);
- 这同时让「保存后基线校准」的全量回拉变得多余,冲突率也会显著下降(baseline 始终新鲜)。

### 2.2 修订:KPI 快照写入权威收敛到服务端(删代码,顺带解决第四轮 3.4)

现状是**双写竞争**:前端 `refreshAfterSave` 用浏览器算的结果 `upsertCloudKpiSnapshot` 写 `pb_kpi_snapshots`,gateway 的 `compute/refresh` 也写同一快照。OpenClaw 加入后,浏览器可能用**陈旧本地数据**算出快照,覆盖 gateway 刚写的新值——OpenClaw 调 `GET /kpi` 读到的就是错的。

建议:前端**删除** `upsertCloudKpiSnapshot` 上传路径,保存后只调 `compute/refresh`(本来就在调,现在是冗余双写)。快照唯一作者 = compute-engine。附带收益:第四轮指出的「手动保存时锁内同步全量重算」就是为了造这份快照,删掉后手动保存不再冻结 UI。

### 2.3 维持:切 tab 结果缓存、memo、虚拟表、Worker

第四轮的渲染/计算建议全部维持有效。结果缓存按「数据引用 + 年 + 季度」做 key,远端变更经 2.1 合并后数据引用必然变化,缓存自动失效,与 OpenClaw 不冲突。注意一点:2.1 的远端合并要 debounce 后再触发重算,避免 Agent 批量写入把前端拖进连环重算。

### 2.4 升级:封账快照必须做在服务端

之前建议「欠款历史月封账」可做在前端;现在有两个消费方(看板 + OpenClaw `/kpi`、`/compute/billing`),封账若做在前端就会出现两套口径。应由 compute-engine 以定时任务(每月 1 日)把上月应收/欠款定格写入快照集合,前端与 gateway 都从快照读历史月、只实时算当月。这也是「前端按年窗口加载」的前置——历史年数据前端不再需要持有,查询历史走 `compute/billing`。

## 三、OpenClaw 链路自身优化(新增)

### 3.1 定向写路径替代「全量基线 diff」(OpenClaw 侧最大收益)

`payments/create` 这类动作的语义就是「插入一行」,却复用了为"整页编辑"设计的全量 diff 机制。建议在 `mcpIncrementalSave` 为单对象动作建定向路径:

- **payments/create**:1 次查询验证 tenant 存在 + 权限校验(已有)→ 直接按 original_id 幂等 create。不拉全量、不 diff;
- **payments/update / delete**:按 original_id 查 1 行 → 乐观锁比对该行 updated → PATCH/DELETE;
- **tenants/upsert**:拉目标租户 1 行(+ 其 units)做字段级 diff,而非整个园区;
- 校验所需的上下文(如租户名回填)按需单行查询。

每笔写入从「全集合拉取 + 全量 diff」降为 2~3 次单行操作,Agent 批量场景提速一到两个数量级,PB 负载同步下降。原全量路径保留给真正的整包操作(如预算方案保存)。

### 3.2 compute/refresh 服务端防抖

每笔写入都触发一次全量 KPI 重算。Agent 批量录入 50 笔 = 50 次重算,且并发重算可能互相覆盖。gateway 侧给 compute/refresh 加 per-project 防抖/合并窗口(如 5 秒内多次请求合并为一次,执行中再来请求则排队一次),并在写入响应的 `compute_hint` 里说明「已自动调度刷新」,让 Agent 不必自己再调。

### 3.3 PB 索引核对(双端共用)

OpenClaw 高频查询模式与前端不同,确认以下复合索引存在:`pb_payments(project_id, tenant_id, period)`(写前验证、写后核对都在用)、`pb_payments(project_id, date)`(按年窗口)、各集合 `(project_id, original_id)` 唯一索引(幂等 upsert 与定向路径的根基)。

### 3.4 审计日志与快照集合的增长治理

`pb_integration_audit_logs` 每笔写入一条、`pb_integration_snapshots` 每次刷新一份,OpenClaw 接入后增长会显著加快。加定时清理(如审计留 180 天、快照每项目只留最近 N 份),避免一年后 PB 数据库文件膨胀拖慢所有查询。

## 四、优先级

| 优先级 | 事项 | 端 | 价值 |
|---|---|---|---|
| P0 | 3.1 定向写路径 | Gateway | OpenClaw 写入提速 10-100×,降 PB 负载 |
| P0 | 2.2 KPI 快照单一作者 | 前端(删代码) | 消除双写竞争,OpenClaw 读到错快照的风险归零;顺带消除手动保存冻结 |
| P1 | 2.1 轻方案:版本轮询 + 增量拉取 | 前端 | 外部写入可感知,冲突率下降 |
| P1 | 3.2 compute/refresh 防抖 | Gateway | 批量写入不再风暴式重算 |
| P1 | 3.3 索引核对 | PB | 双端查询稳定 |
| P2 | 2.1 重方案:Realtime 订阅 | 前端 | 根治数据新鲜度,替代保存后全量回拉 |
| P2 | 2.4 服务端封账 + 前端按年窗口 | 双端 | 历史数据成本恒定,双端单一口径 |
| P2 | 3.4 日志/快照清理 | PB | 长期防膨胀 |

第四轮的前端渲染优化(结果缓存、memo、虚拟表、Worker)优先级不变,与本轮正交,可并行推进。
