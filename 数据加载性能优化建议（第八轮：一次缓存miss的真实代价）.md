# 数据加载性能优化建议（第八轮：一次缓存 miss 的真实代价）

> 第七轮确认了"缓存 miss 频繁（60s TTL）"。本轮回答**一次 miss 到底有多贵、贵在哪、为什么会越来越贵**——逐行精读 `services/dashboardMetrics.ts`（核心算法）、`services/pocketbaseService.ts:1714` 的 `fetchPocketBaseBackup`（取数）、`services/metricsWorkerClient.ts`（Worker 传输）。
>
> 一句话结论：**一次 miss = 取数（全列拉取）+ 计算（欠款循环逐月全量重算）；其中欠款循环只在工作台触发、且会随月份累积越来越慢——这正是"工作台越用越卡"的根因。** 所有结论带 `文件:行` 锚点。

---

## 一、一次 cache miss 的成本分解

服务端命中失败时（compute-engine 走到 `fetchPocketBaseBackup + calculateDashboardMetrics`），代价由两段构成：

```
miss 成本 = 取数(fetchPocketBaseBackup) + 计算(calculateDashboardMetrics)
          ≈ Σ(13 集合 getFullList)      + Σ(趋势 24 月 + 欠款 N 月) × 全租户 × 账单生成
```

下面分别拆解，并指出**为什么 N 会随时间增长**。

---

## 二、计算侧（CPU 大头）

### 2.1【最高价值·会随时间恶化】欠款累计循环：未封账月逐月全量重算
`calculateDashboardMetrics` 的欠款累计（dashboardMetrics.ts:1255-1294）：

```ts
for (let arrearsYear = 2026; arrearsYear <= nowYear; arrearsYear++) {
    for (let month = 0; month <= endMonth; month++) {
        const sealed = sealedArrearsByKey.get(`${arrearsYear}-${month + 1}`);
        if (sealed !== undefined) { accumulatedArrears += sealed; continue; }   // 封账月：短路
        const billingDetails = buildBillingDetailsForPeriod(arrearsYear, month, ctx, cache); // 未封账月：全量账单
        ...
    }
}
```

- **封账月**（`pb_sealed_months` 有记录）：直接取 `arrearsIncrement`，跳过账单生成；
- **未封账月**：对**全部租户**跑一遍 `buildBillingDetailsForPeriod`。

把这个事实和第七轮的发现接起来：**`GATEWAY_SCHEDULER_ENABLED` 默认 0（compose.yaml:45），封账任务没在跑，`sealedMonths` 基本为空** → 从 **2026-01 到当月，每一个月每一次重算都要全量生成账单**，而**月份数随时间单调增长**：

| 时间 | 未封账月数 | 欠款循环相对成本 |
|---|---|---|
| 2026 年中 | ~5–6 | ×1 |
| 2026 年底 | ~11 | ×2 |
| 2027 年底 | ~23 | ×4 |

→ "同样的园区、同样的数据量，越往后打开工作台越慢"。**且此循环仅在 `quickMode=false`（即工作台 tab）时执行**（dashboardMetrics.ts:1256），与"切到财务/合同不卡、唯独工作台卡"的体感完全吻合。

**这是本轮最重要的发现**：它既是单次 miss 变贵的主因，又会随运营时间持续恶化。

### 2.2【中价值】去年趋势在工作台首屏被同步计算
`prevYearMonthlyTrends = quickMode ? [] : calculateTrends(去年, ...)`（dashboardMetrics.ts:1213）。去年 12 个月趋势**只供同比对比表**，却在工作台首屏（quickMode=false）与当年趋势一起同步算掉。`calculateTrends` 是"12 个月 × 全租户"的双层循环（dashboardMetrics.ts:933-955），等于白白多算一年。

### 2.3 账单缓存在单次计算内已共享（已是好实现，勿动）
`createBillingCache` 在 `calculateDashboardMetrics` 入口建一次（dashboardMetrics.ts:1092），趋势/欠款/当月所有 `buildBillingDetailsForPeriod` 复用同一 `cache`；模块级还有 `getOrCreateBillingCacheFor` 按 `data` 引用 WeakMap 缓存（dashboardMetrics.ts:201-205）。单次计算内不重复建缓存，这点已经做对。

---

## 三、取数侧（网络 / DB）

### 3.1【高价值】13 集合并行拉取，但大表无字段裁剪
`fetchPocketBaseBackup`（pocketbaseService.ts:1714-1791）用一个 `Promise.all` 并行拉 13 个集合（并行，已是好实现）。但 `mapList`（1725-1733）只设了 `filter`，**没有 `fields` 字段裁剪**：

```ts
return client.collection(collection).getFullList({ filter, ...noAutoCancel });
```

- `pb_payments / pb_tenants / pb_invoices / pb_buildings / pb_units` 都是**整行全列**拉取；
- `getFullList` 内部按 **500/页串行翻页**，大表（如几千条 payments）= 多次串行往返；
- 已做的好事：payments/invoices 按 `year`/`sinceYear` 窗口过滤（1739-1748），只是 tenants/buildings/units/assumptions 仍全量。

→ 大园区一次 miss 的取数既费带宽（全列）又费往返（串行翻页）。

### 3.2 版本号被读了两次
缓存检查前 `readCloudSaveVersion`（compute-engine.ts:407/603）已读一次版本；`fetchPocketBaseBackup` 内的 `versionRows`（pocketbaseService.ts:1780）又读同一条记录。一次 miss 多一趟无谓往返（与第七轮 P0-2 同源）。

---

## 四、Worker 侧（仅本地/降级路径）

- **修正《运算后移》2.1**：`computeMetricsInWorker` **已加 30s 超时 + pending 回收**（metricsWorkerClient.ts:11、69-72），message 丢失不再永挂。该项已闭环。
- 但每次 `w.postMessage({ reqId, data, options })`（metricsWorkerClient.ts:75）会对**整个 DashboardData 做 structuredClone** 传入 worker，大园区有可观的主线程克隆开销。仅在 `serverComputeEnabled=false`/降级时走此路，优先级低于服务端侧。

---

## 五、优化建议（按投入产出排序）

### P0-1 启用封账，让欠款循环短路历史月 — 对应 2.1（**最高杠杆**）
- 生产置 `GATEWAY_SCHEDULER_ENABLED=1`，使 `sealPreviousMonthAllProjects` 真正运行；
- 对历史月做**一次性回填封账**（把 2026-01 至上月的 `arrearsIncrement` 算好写入 `pb_sealed_months`），让存量月份立刻短路；
- 效果：欠款循环成本从"未封账月数 × 全租户账单"塌缩为"几次 Map 取值"，**直接消除"工作台越用越慢"**，且是单次 miss CPU 的最大头。
- 与第七轮 P0-3 是同一动作、双重收益（封账 + 缓存预热）。

### P0-2 给 fetchPocketBaseBackup 加字段裁剪 + 调大批量 — 对应 3.1
- `mapList` 增加 `fields:`，每个集合只取计算实际用到的列（id/original_id/金额/日期/面积/状态/关联 id 等），剔除大文本/冗余列；
- 大表 `getFullList({ batch: 1000 ... })` 减少翻页往返；
- 效果：一次 miss 的取数带宽与往返同步下降；改动局部、风险低。

### P0-3 去年趋势懒算 — 对应 2.2
- `prevYearMonthlyTrends` 改为"同比对比表进入视口/展开时再算"，不进工作台首屏同步路径；或随 KPI 先出后，在 idle 补算。
- 效果：工作台首屏计算量直接砍掉"一整年趋势"。

### P1-1 版本号读合并 — 对应 3.2（同第七轮 P0-2）
- compute-engine 内对 `readCloudSaveVersion` 加 1–3s micro-cache；`fetchPocketBaseBackup` 复用已读版本，避免一次 miss 读两次版本。

### P1-2 欠款增量持久化（封账之外的兜底）— 对应 2.1
- 即便不开调度器，也可在每次成功写入后，把"上月及更早"的欠款增量落到 `pb_sealed_months`（写时封账），后续读取直接短路；把"逐月重算"摊薄到写入时一次。

### P1-3 Worker 传输瘦身 — 对应四
- 走本地 worker 时，只传计算所需集合（已窗口化的 payments/必要 tenants 等），减少 structuredClone 体积；或用可转移对象/预先精简。仅本地/降级路径，按需做。

---

## 六、为什么这一轮和前两轮能叠加见效

| 维度 | 第七轮 | 第八轮 | 叠加效果 |
|---|---|---|---|
| miss 频率 | P0-1 调大 TTL → miss 变少 | — | 少触发昂贵计算 |
| 单次 miss CPU | — | P0-1 封账 + P0-3 趋势懒算 → 单次变便宜 | 即便 miss 也快 |
| 单次 miss 取数 | — | P0-2 字段裁剪 + 批量 → 取数变快 | 即便 miss 也快 |
| 往返次数 | P0-2 版本读合并 | P1-1 同源 | 每次开/切少 1–2 趟 |

→ **TTL 调大降低 miss 频率，封账 + 字段裁剪降低单次 miss 成本**，两轮正交叠加。其中**"启用封账"同时出现在两轮的 P0**，是性价比最高、且能止住"越用越慢"的单一动作，建议最先做。

---

## 七、先量化（用现成日志）

1. **单次 miss 的计算耗时**：看 compute-engine 的 `[compute-cache] ... miss` 之后该请求的总耗时；前端 `[metrics] recalculate XXXms`（App.tsx:5158）在走本地时也能看。
2. **欠款循环占比**：在 `calculateDashboardMetrics` 欠款循环前后各打一个 `performance.now()`，确认它在工作台计算里的占比（预计随月份增长）。
3. **取数耗时与体积**：Network 看 `getFullList` 分页请求数与响应大小；payments 通常最大。
4. **封账覆盖**：查 `pb_sealed_months` 是否有 2026-01 至上月的记录——为空即印证 2.1 在持续全量重算。

---

## 八、优先级总表

| 顺序 | 事项 | 预期效果 | 工作量 | 对应 |
|---|---|---|---|---|
| 1 | P0-1 启用封账 + 历史月回填 | 止住"工作台越用越慢"，砍单次 miss 最大 CPU 头 | 半天-1天 | 2.1 |
| 2 | P0-2 取数字段裁剪 + 批量 | 单次 miss 取数带宽/往返下降 | 半天 | 3.1 |
| 3 | P0-3 去年趋势懒算 | 工作台首屏少算一整年 | 半天 | 2.2 |
| 4 | P1-1 版本号读合并 | 每次开/切少一趟版本读 | 半天 | 3.2 |
| 5 | P1-2 写时封账兜底 | 不依赖调度器也能短路历史月 | 半天 | 2.1 |
| 6 | P1-3 Worker 传输瘦身 | 本地/降级路径主线程克隆减负 | 半天 | 四 |

---

## 九、结论与局限

- 一次 cache miss 的成本被拆清：**取数（全列拉取）+ 计算（欠款循环逐月全量）**；后者只在工作台触发、且随月份累积**越来越贵**，是"工作台越用越慢"的根因。
- **最高杠杆是"启用/回填封账"**：既塌缩单次 miss 的 CPU 大头，又与第七轮"调缓存 TTL"正交叠加；二者都把"启用封账"列为 P0，应优先落地。
- 取数字段裁剪、去年趋势懒算为低风险的局部优化，可并行推进。
- 建议落地前先按第七节量化欠款循环占比与封账覆盖，用数据确认收益再改。验证：`npx tsc --noEmit`、`npm test`、`npm run build`、`npm run check:pb`。
