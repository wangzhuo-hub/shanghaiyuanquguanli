# 部署清单（PocketBase 后台设置 + 服务端开关）

本轮"全部修复"中，部分能力是 PocketBase 后台设置或环境变量，**无法仅靠仓库代码生效**，需按本清单在部署侧操作。代码侧改动已在仓库内，迁移文件随 PB 启动自动执行。

> 顺序建议：先跑迁移（①）→ 启网关定时任务（②）→ 回填封账（③）→ 再按需开启 batch（④）和 CAS（⑤）。

## ① 数据库迁移（自动）

新增迁移会在 PocketBase 启动时自动执行，无需手动操作，只需确认已部署最新 `pocketbase/pb_migrations/`：

- `1787000000_created_pb_sealed_months.js` —— 新集合 `pb_sealed_months`（每月封账快照）。
- `1788000000_add_payment_composite_indexes.js` —— `pb_payments` 复合索引
  `(project_id, date)`、`(project_id, tenant_id, period)`（幂等，已存在不重复建）。

确认：PB Admin → Collections 出现 `pb_sealed_months`；`pb_payments` 的 Indexes 含上述两条复合索引。

## ② 网关定时任务（默认关闭，需显式开启）

`integration-gateway` 的定时任务（每日封"上月"账 + 清理 180 天前审计日志）**默认关闭**——
部署网关本身零行为变化，手动 `/compute/seal` 端点始终可用。确认要启用后：

```
GATEWAY_SCHEDULER_ENABLED=1   # 开启定时封账+审计清理（默认关）
PB_URL=...                    # 已有
PB_ADMIN_EMAIL=...            # 已有（封账/清理需 admin）
PB_ADMIN_PASSWORD=...         # 已有
SEAL_PROJECTS=shanghai_park,beijing_park,shenzhen_park   # 可选，默认即此三园区
AUDIT_RETENTION_DAYS=180      # 可选，审计日志留存天数（首次清理会删更早的）
```

设置后**重启网关**。启动日志应出现：`定时任务已启动：封账(...) + 审计清理(180d)`；
未启用时显示：`定时任务未启用（GATEWAY_SCHEDULER_ENABLED=1 开启…）`。

⚠️ 启用封账后，已封月欠款**冻结**（对已封月的补缴不再回头减欠款）——会计关账的正确语义，请知会财务。
单实例运行，勿起多个网关进程（否则重复封账）。

## ③ 封账回填（一次性，按需）

定时任务只封"上月"。历史月需手动回填后，前端"按年窗口加载"（⑥）才安全：

```
POST /api/integration/compute/seal
Body: { "project_id": "shanghai_park", "year": 2026, "month": 1 }   # month 为自然月 1-12
```

对每个园区、每个历史月各调一次（不带 year/month 时默认封上月）。可写脚本循环。
封账语义为"关账"：封后该月欠款定格，后续对该月的补录不再改变其封账值；如需修正可对同月重复调用本接口覆盖。

## ④ Batch API（PB Admin UI）

前端保存已优先走 `/api/batch` 单事务，但 PB 默认关闭：

1. PB Admin → Settings → Application → Batch API：
   - `Enable` = 开
   - `Max requests` = **200~500**（前端按 `BATCH_MAX_REQUESTS=200` 分片，务必 ≥ 200）
   - `Timeout` = **10s**（大事务）
2. 开启后验证：保存若干改动，浏览器 Network 出现 `POST /api/batch` 且 200；改动 >200 条时应看到多个 batch 顺序提交，而非回退串行。

未开启时前端会被 403/404 拒绝并**本会话记忆、自动回退串行**（功能正常，只是较慢）。

## ⑤ 服务端乐观锁 CAS（环境变量，默认关闭）

`pocketbase/pb_hooks/optimistic_lock.pb.js` 已部署但**默认 INERT**，需显式开启：

```
PB_CAS_ENABLED=1   # PocketBase 进程环境变量
```

⚠️ **开启前必须验证 updated 格式一致**，否则会把正常更新误判冲突而全部拒绝：

1. 先在测试环境设 `PB_CAS_ENABLED=1`。
2. 验证①：正常单端改一条收款/租户 → 保存成功（不被 409 拒）。
3. 验证②：两个客户端先后改同一行（后者基线过期）→ 后写者得到 409，前端弹出冲突对话框。
4. 两项都通过后再到生产开启。若验证①失败（正常更新被拒），说明客户端 `recordMeta.updated`
   与服务端 `originalCopy().get('updated')` 字符串格式不一致，**保持关闭**并反馈格式差异。

客户端已在 PATCH（串行 + batch 子请求）携带 `X-PB-Expected-Updated` 头，409 自动并入既有冲突流程。

## ⑥ 前端按年窗口加载（构建环境变量，默认关闭）

```
VITE_YEAR_WINDOW_LOAD=1   # 构建时注入
```

开启后前端只加载"当年+上一年"的收款/发票，历史欠款走 ② / ③ 的封账快照。
**前置条件：必须先完成 ③ 历史月封账回填**，否则窗口外月份欠款会缺失（计算偏小）。
默认关闭时为全量加载，行为与历史一致。

## ⑦ 复核既有线上设置（第三轮发现）

历史实测线上 batch 配置为 `{enabled:false, maxRequests:50, timeout:3}`，按 ④ 调整。
