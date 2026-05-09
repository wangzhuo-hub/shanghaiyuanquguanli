#!/usr/bin/env node
/**
 * OpenClaw / 飞书受控写入网关。
 *
 * 环境变量：
 *   PB_URL=http://127.0.0.1:8090
 *   PB_ADMIN_EMAIL=admin@example.com
 *   PB_ADMIN_PASSWORD=xxx
 *   INTEGRATION_GATEWAY_PORT=8787
 *
 * POST /api/integration/write
 * Headers:
 *   x-integration-source-type: feishu_group | feishu_form | openclaw_agent | webhook
 *   x-integration-source-key:  来源唯一标识
 *   x-integration-token:      可选，若 pb_integration_sources.secret_hash 有值则校验 sha256
 * Body:
 *   {
 *     "collection": "pb_payments",
 *     "action": "upsert",
 *     "original_id": "payment_xxx",
 *     "project_id": "可选；若与来源绑定不一致会拒绝",
 *     "data": { "...": "业务字段，不需要 project_id" }
 *   }
 */

import crypto from 'node:crypto';
import express from 'express';
import PocketBase from 'pocketbase';

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090';
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || '';
const PORT = Number(process.env.INTEGRATION_GATEWAY_PORT || 8787);

const WRITABLE_COLLECTIONS = new Set([
  'pb_buildings',
  'pb_units',
  'pb_tenants',
  'pb_payments',
  'pb_invoices',
  'pb_yearly_targets',
  'pb_monthly_init_data',
  'pb_budget_assumptions',
  'pb_budget_adjustments',
  'pb_budget_scenarios',
  'pb_billing_period_notes',
]);

const pb = new PocketBase(PB_URL);

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function escapeFilter(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function auth() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD is required');
  try {
    await pb.collection('_superusers').authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
  } catch (_) {
    await pb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
  }
}

async function audit(entry) {
  try {
    await pb.collection('pb_integration_audit_logs').create(entry);
  } catch (e) {
    console.warn('[audit] failed:', e?.message || e);
  }
}

async function resolveSource(req) {
  const sourceType = String(req.headers['x-integration-source-type'] || req.body?.source_type || '').trim();
  const sourceKey = String(req.headers['x-integration-source-key'] || req.body?.source_key || '').trim();
  if (!sourceType || !sourceKey) {
    return { ok: false, status: 400, message: '缺少来源标识 source_type/source_key', sourceType, sourceKey };
  }

  const filter = `source_type="${escapeFilter(sourceType)}" && source_key="${escapeFilter(sourceKey)}"`;
  let source;
  try {
    source = await pb.collection('pb_integration_sources').getFirstListItem(filter);
  } catch (e) {
    if (e?.status === 404) return { ok: false, status: 403, message: '来源未注册', sourceType, sourceKey };
    throw e;
  }
  if (source.enabled === false) return { ok: false, status: 403, message: '来源已禁用', sourceType, sourceKey };
  if (!source.project_id) return { ok: false, status: 403, message: '来源未绑定园区', sourceType, sourceKey };

  if (source.secret_hash) {
    const token = String(req.headers['x-integration-token'] || '').trim();
    if (!token || sha256(token) !== source.secret_hash) {
      return { ok: false, status: 401, message: '来源签名校验失败', sourceType, sourceKey, projectId: source.project_id };
    }
  }

  return { ok: true, sourceType, sourceKey, projectId: source.project_id };
}

function buildOriginalIdFilter(collection, body, projectId) {
  if (collection === 'pb_yearly_targets') return `project_id="${escapeFilter(projectId)}" && year=${Number(body.data?.year)}`;
  if (collection === 'pb_monthly_init_data') {
    return `project_id="${escapeFilter(projectId)}" && year=${Number(body.data?.year)} && month=${Number(body.data?.month)}`;
  }
  const originalId = String(body.original_id || body.data?.original_id || '').trim();
  if (!originalId) throw new Error('缺少 original_id');
  return `project_id="${escapeFilter(projectId)}" && original_id="${escapeFilter(originalId)}"`;
}

async function writeBusinessRecord(body, projectId) {
  const collection = String(body.collection || '').trim();
  const action = String(body.action || 'upsert').trim();
  if (!WRITABLE_COLLECTIONS.has(collection)) throw new Error(`不允许写入集合 ${collection}`);
  if (!['create', 'update', 'upsert', 'delete'].includes(action)) throw new Error(`不支持的 action: ${action}`);

  const requestedProject = String(body.project_id || body.data?.project_id || '').trim();
  if (requestedProject && requestedProject !== projectId) {
    throw new Error(`禁止跨园区写入：来源绑定 ${projectId}，请求目标 ${requestedProject}`);
  }

  const payload = { ...(body.data || {}), project_id: projectId };
  const filter = buildOriginalIdFilter(collection, body, projectId);
  const existing = await pb.collection(collection).getList(1, 1, { filter, fields: 'id' });
  const current = existing.items[0];

  if (action === 'delete') {
    if (current) await pb.collection(collection).delete(current.id);
    return { collection, action, id: current?.id || null };
  }
  if (action === 'create') {
    const created = await pb.collection(collection).create(payload);
    return { collection, action, id: created.id };
  }
  if (current) {
    const updated = await pb.collection(collection).update(current.id, payload);
    return { collection, action: 'update', id: updated.id };
  }
  const created = await pb.collection(collection).create(payload);
  return { collection, action: 'create', id: created.id };
}

// ── 只读端点：计算口径（与前端 billingService / dashboardMetrics 一致） ──

/** 解析来源（只读端点，secret_hash 可选） */
async function resolveReadSource(req) {
  return resolveSource(req);
}

/** GET /api/integration/kpi?project_id=X&year=Y */
async function handleKpiQuery(req, res) {
  try {
    const projectId = String(req.query.project_id || req.body?.project_id || '').trim();
    const year = Number(req.query.year || req.body?.year || new Date().getFullYear());
    if (!projectId) return res.status(400).json({ ok: false, message: '缺少 project_id' });

    // 1) 优先读 pb_kpi_snapshots（轻量，按年）
    let snapshot = null;
    try {
      const list = await pb.collection('pb_kpi_snapshots').getList(1, 1, {
        filter: `project_id="${escapeFilter(projectId)}" && year=${year}`,
        sort: '-calculated_at',
      });
      snapshot = list.items[0] || null;
    } catch (_) { /* 集合可能不存在 */ }

    if (snapshot) {
      return res.json({
        ok: true,
        source: 'pb_kpi_snapshots',
        project_id: projectId,
        year,
        summary: snapshot.summary_json,
        monthlyTrends: snapshot.monthly_trends_json || null,
        calculated_at: snapshot.calculated_at,
        data_version: snapshot.data_version,
      });
    }

    // 2) 回落：pb_integration_snapshots → payload.kpi
    try {
      const list = await pb.collection('pb_integration_snapshots').getList(1, 1, {
        filter: `project_id="${escapeFilter(projectId)}" && snapshot_kind="full_dashboard_v1"`,
      });
      const full = list.items[0];
      if (full?.payload?.kpi) {
        const kpi = full.payload.kpi;
        if (kpi.stats_year === year || !year) {
          return res.json({
            ok: true,
            source: 'pb_integration_snapshots',
            project_id: projectId,
            year: kpi.stats_year,
            kpi,
            generated_at: full.payload.generated_at,
            updated: full.updated,
            hint: '无人打开看板时快照可能偏旧，建议打开前端触发最新重算',
          });
        }
      }
    } catch (_) { /* 无快照 */ }

    return res.json({
      ok: false,
      message: `未找到 project_id=${projectId} year=${year} 的 KPI 数据。请先在前端保存或重算指标。`,
    });
  } catch (e) {
    console.error('[kpi] error:', e?.message || e);
    return res.status(500).json({ ok: false, message: e?.message || '内部错误' });
  }
}

/** GET /api/integration/dashboard?project_id=X */
async function handleDashboardQuery(req, res) {
  try {
    const projectId = String(req.query.project_id || req.body?.project_id || '').trim();
    if (!projectId) return res.status(400).json({ ok: false, message: '缺少 project_id' });

    const list = await pb.collection('pb_integration_snapshots').getList(1, 1, {
      filter: `project_id="${escapeFilter(projectId)}" && snapshot_kind="full_dashboard_v1"`,
    });
    const full = list.items[0];
    if (!full?.payload) {
      return res.json({ ok: false, message: '未找到全量快照' });
    }
    return res.json({
      ok: true,
      project_id: projectId,
      generated_at: full.payload.generated_at,
      source_cloud_save_version: full.payload.source_cloud_save_version,
      kpi: full.payload.kpi,
      dashboard: full.payload.dashboard,
      full_year_monthly_trends: full.payload.full_year_monthly_trends,
    });
  } catch (e) {
    console.error('[dashboard] error:', e?.message || e);
    return res.status(500).json({ ok: false, message: e?.message || '内部错误' });
  }
}

/** GET /api/integration/tenants?project_id=X&name=关键词 */
async function handleTenantsQuery(req, res) {
  try {
    const projectId = String(req.query.project_id || '').trim();
    const name = String(req.query.name || '').trim();
    if (!projectId) return res.status(400).json({ ok: false, message: '缺少 project_id' });

    let filter = `project_id="${escapeFilter(projectId)}"`;
    if (name) filter += ` && name~"${escapeFilter(name)}"`;
    const list = await pb.collection('pb_tenants').getFullList({ filter, sort: 'name' });
    return res.json({ ok: true, project_id: projectId, count: list.length, tenants: list });
  } catch (e) {
    console.error('[tenants] error:', e?.message || e);
    return res.status(500).json({ ok: false, message: e?.message || '内部错误' });
  }
}

/** GET /api/integration/payments?project_id=X&tenant_id=Y&period=YYYY-MM */
async function handlePaymentsQuery(req, res) {
  try {
    const projectId = String(req.query.project_id || '').trim();
    const tenantId = String(req.query.tenant_id || '').trim();
    const period = String(req.query.period || '').trim();
    if (!projectId) return res.status(400).json({ ok: false, message: '缺少 project_id' });

    let filter = `project_id="${escapeFilter(projectId)}"`;
    if (tenantId) filter += ` && tenant_id="${escapeFilter(tenantId)}"`;
    if (period && /^\d{4}-\d{2}$/.test(period)) filter += ` && period="${escapeFilter(period)}"`;
    const list = await pb.collection('pb_payments').getFullList({ filter, sort: '-date' });
    return res.json({ ok: true, project_id: projectId, count: list.length, payments: list });
  } catch (e) {
    console.error('[payments] error:', e?.message || e);
    return res.status(500).json({ ok: false, message: e?.message || '内部错误' });
  }
}

/** GET /api/integration/billing-summary?project_id=X&year=Y&month=M */
async function handleBillingSummaryQuery(req, res) {
  try {
    const projectId = String(req.query.project_id || '').trim();
    const year = Number(req.query.year);
    const month = Number(req.query.month); // 1-12
    if (!projectId || !Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      return res.status(400).json({ ok: false, message: '缺少 project_id / year / month (1-12)' });
    }

    // 从 pb_tenants 拉取当月有效租户，汇总应收金额
    const tenants = await pb.collection('pb_tenants').getFullList({
      filter: `project_id="${escapeFilter(projectId)}"`,
    });

    // 按合同状态过滤活跃租户，构建摘要
    const activeTenants = tenants.filter((t) => t.status !== 'Terminated');
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0);

    const summary = activeTenants.map((t) => ({
      tenant_id: t.original_id,
      tenant_name: t.name,
      unit_ids: Array.isArray(t.unit_ids) ? t.unit_ids : [],
      monthly_rent: t.monthly_rent || 0,
      lease_start: t.lease_start,
      lease_end: t.lease_end,
      status: t.status,
      is_special_business: t.is_special_business || false,
    }));

    // 汇总当月预算应收（简化口径：月租金求和；精确口径需跑计费引擎，见前端 billingService）
    const totalMonthlyRent = summary.reduce((s, t) => s + (t.monthly_rent || 0), 0);

    // 汇总当月实收
    const periodStr = `${year}-${String(month).padStart(2, '0')}`;
    let payments = [];
    try {
      payments = await pb.collection('pb_payments').getFullList({
        filter: `project_id="${escapeFilter(projectId)}" && period="${escapeFilter(periodStr)}"`,
      });
    } catch (_) { /* 集合可能为空 */ }
    const totalCollected = payments.reduce((s, p) => s + (p.amount || 0), 0);

    return res.json({
      ok: true,
      project_id: projectId,
      year,
      month,
      tenant_count: summary.length,
      active_tenant_count: summary.filter((t) => t.status === 'Active').length,
      total_monthly_rent: Math.round(totalMonthlyRent * 100) / 100,
      total_collected: Math.round(totalCollected * 100) / 100,
      tenants: summary,
      payments_count: payments.length,
      note: '按月租金简化汇总；如需精确应收口径（含免租/调价/顺延），请使用前端 pb_integration_snapshots 中的 billing 明细',
    });
  } catch (e) {
    console.error('[billing-summary] error:', e?.message || e);
    return res.status(500).json({ ok: false, message: e?.message || '内部错误' });
  }
}

// ── 主程序 ──

async function main() {
  await auth();
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, pb: PB_URL }));

  // ── 只读查询端点（OpenClaw 调用）──
  app.get('/api/integration/kpi', handleKpiQuery);
  app.get('/api/integration/dashboard', handleDashboardQuery);
  app.get('/api/integration/tenants', handleTenantsQuery);
  app.get('/api/integration/payments', handlePaymentsQuery);
  app.get('/api/integration/billing-summary', handleBillingSummaryQuery);

  // ── 写入端点 ──
  app.post('/api/integration/write', async (req, res) => {
    const source = await resolveSource(req);
    if (!source.ok) {
      await audit({
        source_type: source.sourceType || 'unknown',
        source_key: source.sourceKey || '',
        project_id: source.projectId || 'unknown',
        status: 'rejected',
        message: source.message,
        payload_summary: { collection: req.body?.collection, action: req.body?.action },
      });
      return res.status(source.status).json({ success: false, message: source.message });
    }

    try {
      const result = await writeBusinessRecord(req.body, source.projectId);
      await audit({
        source_type: source.sourceType,
        source_key: source.sourceKey,
        project_id: source.projectId,
        target_collection: result.collection,
        target_original_id: req.body?.original_id || req.body?.data?.original_id || '',
        action: result.action,
        status: 'success',
        message: '写入成功',
        payload_summary: { collection: result.collection, action: result.action, record_id: result.id },
      });
      const affectedHints = [];
      if (result.collection === 'pb_payments') affectedHints.push('kpi', 'billing-summary');
      else if (result.collection === 'pb_tenants') affectedHints.push('kpi', 'tenants', 'billing-summary', 'dashboard');
      else if (result.collection === 'pb_budget_scenarios' || result.collection === 'pb_budget_assumptions') affectedHints.push('kpi', 'dashboard');

      return res.json({
        success: true,
        project_id: source.projectId,
        result,
        affected_metrics: affectedHints.length ? affectedHints : undefined,
        read_endpoints: {
          kpi: `/api/integration/kpi?project_id=${encodeURIComponent(source.projectId)}&year=2026`,
          dashboard: `/api/integration/dashboard?project_id=${encodeURIComponent(source.projectId)}`,
          tenants: `/api/integration/tenants?project_id=${encodeURIComponent(source.projectId)}`,
          payments: `/api/integration/payments?project_id=${encodeURIComponent(source.projectId)}`,
          billing_summary: `/api/integration/billing-summary?project_id=${encodeURIComponent(source.projectId)}&year=2026&month=5`,
        },
      });
    } catch (e) {
      const message = e?.data?.message || e?.message || String(e);
      await audit({
        source_type: source.sourceType,
        source_key: source.sourceKey,
        project_id: source.projectId,
        target_collection: req.body?.collection || '',
        target_original_id: req.body?.original_id || req.body?.data?.original_id || '',
        action: req.body?.action || 'upsert',
        status: 'error',
        message,
        payload_summary: { collection: req.body?.collection, action: req.body?.action },
      });
      return res.status(400).json({ success: false, message });
    }
  });

  app.listen(PORT, () => {
    console.log(`[integration-gateway] listening on http://127.0.0.1:${PORT}`);
    console.log(`[integration-gateway] PocketBase: ${PB_URL}`);
  });
}

main().catch((err) => {
  console.error('[integration-gateway] failed:', err?.data || err);
  process.exit(1);
});
