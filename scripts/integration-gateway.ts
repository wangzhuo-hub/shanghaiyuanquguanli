#!/usr/bin/env node
/**
 * OpenClaw / 飞书受控读写网关（含服务端计算层）。
 *
 * 环境变量：
 *   PB_URL=http://127.0.0.1:8090
 *   PB_ADMIN_EMAIL=admin@example.com
 *   PB_ADMIN_PASSWORD=xxx
 *   INTEGRATION_GATEWAY_PORT=8787
 *
 * 端点：
 *   GET  /health
 *   GET  /api/integration/kpi              只读 KPI（快照优先，miss 自动 compute）
 *   GET  /api/integration/dashboard         只读全量看板（快照优先，miss 自动 compute）
 *   GET  /api/integration/tenants           只读租户列表（直读 pb_tenants）
 *   GET  /api/integration/payments          只读收款列表（直读 pb_payments）
 *   GET  /api/integration/buildings         只读楼宇列表（直读 pb_buildings）
 *   GET  /api/integration/units             只读单元列表（直读 pb_units）
 *   POST /api/integration/write             写入
 *   POST /api/integration/compute/kpi       服务端重算 KPI（与前端同口径）
 *   POST /api/integration/compute/billing   服务端重算应收明细
 *   POST /api/integration/compute/refresh   重算并回写 pb_kpi_snapshots
 */

import crypto from 'node:crypto';
import express from 'express';
import PocketBase from 'pocketbase';
import { computeKpi, computeBilling } from './compute-engine.js';

// ── 配置 ──

const PB_URL: string = process.env.PB_URL || 'http://127.0.0.1:8090';
const ADMIN_EMAIL: string = process.env.PB_ADMIN_EMAIL || '';
const ADMIN_PASSWORD: string = process.env.PB_ADMIN_PASSWORD || '';
const PORT: number = Number(process.env.INTEGRATION_GATEWAY_PORT || 8787);

const WRITABLE_COLLECTIONS = new Set([
  'pb_buildings', 'pb_units', 'pb_tenants', 'pb_payments',
  'pb_invoices', 'pb_yearly_targets', 'pb_monthly_init_data',
  'pb_budget_assumptions', 'pb_budget_adjustments',
  'pb_budget_scenarios', 'pb_billing_period_notes',
]);

const pb = new PocketBase(PB_URL);

// ── 工具函数 ──

function sha256(value: string): string {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function escapeFilter(value: string): string {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

interface AuthResult {
  ok: boolean;
  status: number;
  message: string;
  sourceType?: string;
  sourceKey?: string;
  projectId?: string;
}

async function auth(): Promise<void> {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.warn('[integration-gateway] PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD not set, running without admin auth');
    return;
  }
  try {
    await pb.collection('_superusers').authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
  } catch (_) {
    try { await pb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD); } catch { /* non-fatal */ }
  }
}

async function audit(entry: Record<string, unknown>): Promise<void> {
  try {
    await pb.collection('pb_integration_audit_logs').create(entry);
  } catch (e: any) {
    console.warn('[audit] failed:', e?.message || e);
  }
}

async function resolveSource(req: express.Request): Promise<AuthResult> {
  const sourceType = String(req.headers['x-integration-source-type'] || (req.body as any)?.source_type || '').trim();
  const sourceKey = String(req.headers['x-integration-source-key'] || (req.body as any)?.source_key || '').trim();
  if (!sourceType || !sourceKey) {
    return { ok: false, status: 400, message: '缺少来源标识 source_type/source_key', sourceType, sourceKey };
  }

  const filter = `source_type="${escapeFilter(sourceType)}" && source_key="${escapeFilter(sourceKey)}"`;
  let source: any;
  try {
    source = await pb.collection('pb_integration_sources').getFirstListItem(filter);
  } catch (e: any) {
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

  return { ok: true, status: 200, message: '', sourceType, sourceKey, projectId: source.project_id };
}

function buildOriginalIdFilter(collection: string, body: any, projectId: string): string {
  if (collection === 'pb_yearly_targets') return `project_id="${escapeFilter(projectId)}" && year=${Number(body.data?.year)}`;
  if (collection === 'pb_monthly_init_data') {
    return `project_id="${escapeFilter(projectId)}" && year=${Number(body.data?.year)} && month=${Number(body.data?.month)}`;
  }
  const originalId = String(body.original_id || body.data?.original_id || '').trim();
  if (!originalId) throw new Error('缺少 original_id');
  return `project_id="${escapeFilter(projectId)}" && original_id="${escapeFilter(originalId)}"`;
}

async function writeBusinessRecord(body: any, projectId: string) {
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
  const current = existing.items[0] as any;

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

// ── 只读端点 ──

async function handleKpiQuery(req: express.Request, res: express.Response) {
  try {
    const projectId = String((req.query.project_id as string) || (req.body as any)?.project_id || '').trim();
    const year = Number(req.query.year || (req.body as any)?.year || new Date().getFullYear());
    if (!projectId) { res.status(400).json({ ok: false, message: '缺少 project_id' }); return; }

    // 1) 优先读 pb_kpi_snapshots（缓存快查）
    try {
      const list = await pb.collection('pb_kpi_snapshots').getList(1, 1, {
        filter: `project_id="${escapeFilter(projectId)}" && year=${year}`,
        sort: '-calculated_at',
      });
      const snapshot = list.items[0] as any;
      if (snapshot) {
        res.json({
          ok: true, source: 'pb_kpi_snapshots', project_id: projectId, year,
          summary: snapshot.summary_json,
          monthlyTrends: snapshot.monthly_trends_json || null,
          calculated_at: snapshot.calculated_at,
          data_version: snapshot.data_version,
        });
        return;
      }
    } catch (_) { /* 集合可能不存在 */ }

    // 2) 快照缺失 → 自动实时计算
    console.log(`[kpi] snapshot miss for project=${projectId} year=${year}, auto-computing...`);
    const result = await computeKpi(projectId, year);
    if (!result.ok) {
      res.status(500).json(result);
      return;
    }

    // 3) 异步回写快照（下次命中缓存）
    setImmediate(async () => {
      try {
        const existing = await pb.collection('pb_kpi_snapshots').getList(1, 1, {
          filter: `project_id="${escapeFilter(projectId)}" && year=${year}`,
        });
        const record = {
          project_id: projectId, year,
          summary_json: result.summary,
          monthly_trends_json: result.fullYearTrends,
          data_version: result.dataVersion,
          calculated_at: result.computedAt,
        };
        if (existing.items.length > 0) {
          await pb.collection('pb_kpi_snapshots').update((existing.items[0] as any).id, record);
        } else {
          await pb.collection('pb_kpi_snapshots').create(record);
        }
      } catch (_) { /* 回写失败不影响返回 */ }
    });

    res.json({
      ok: true, source: 'compute-engine', project_id: projectId, year,
      summary: result.summary,
      monthlyTrends: result.fullYearTrends,
      calculated_at: result.computedAt,
      data_version: result.dataVersion,
    });
  } catch (e: any) {
    console.error('[kpi] error:', e?.message || e);
    res.status(500).json({ ok: false, message: e?.message || '内部错误' });
  }
}

async function handleDashboardQuery(req: express.Request, res: express.Response) {
  try {
    const projectId = String((req.query.project_id as string) || '').trim();
    if (!projectId) { res.status(400).json({ ok: false, message: '缺少 project_id' }); return; }

    // 1) 优先读 pb_integration_snapshots（缓存快查）
    try {
      const list = await pb.collection('pb_integration_snapshots').getList(1, 1, {
        filter: `project_id="${escapeFilter(projectId)}" && snapshot_kind="full_dashboard_v1"`,
      });
      const full = list.items[0] as any;
      if (full?.payload) {
        res.json({
          ok: true, source: 'pb_integration_snapshots', project_id: projectId,
          generated_at: full.payload.generated_at,
          source_cloud_save_version: full.payload.source_cloud_save_version,
          kpi: full.payload.kpi,
          dashboard: full.payload.dashboard,
          full_year_monthly_trends: full.payload.full_year_monthly_trends,
        });
        return;
      }
    } catch (_) { /* 无快照 */ }

    // 2) 快照缺失 → 自动实时计算 KPI + 拼装看板数据
    console.log(`[dashboard] snapshot miss for project=${projectId}, auto-computing...`);
    const year = Number(req.query.year || new Date().getFullYear());
    const kpiResult = await computeKpi(projectId, year);
    if (!kpiResult.ok) {
      res.status(500).json(kpiResult);
      return;
    }

    // 从 PB 拉取核心业务数据拼装 dashboard
    const [tenants, buildings, units, payments] = await Promise.all([
      pb.collection('pb_tenants').getFullList({ filter: `project_id="${escapeFilter(projectId)}"`, sort: 'name' }),
      pb.collection('pb_buildings').getFullList({ filter: `project_id="${escapeFilter(projectId)}"`, sort: 'name' }),
      pb.collection('pb_units').getFullList({ filter: `project_id="${escapeFilter(projectId)}"`, sort: 'name' }),
      pb.collection('pb_payments').getFullList({ filter: `project_id="${escapeFilter(projectId)}"`, sort: '-date' }),
    ]);

    res.json({
      ok: true, source: 'compute-engine', project_id: projectId,
      kpi: {
        schema_version: 1,
        generated_at: kpiResult.computedAt,
        project_id: projectId,
        stats_year: year,
        calendar_year: new Date().getFullYear(),
        calendar_month: new Date().getMonth() + 1,
        ...kpiResult.summary,
      },
      dashboard: { tenants, buildings, units, payments },
      full_year_monthly_trends: kpiResult.fullYearTrends,
    });
  } catch (e: any) {
    console.error('[dashboard] error:', e?.message || e);
    res.status(500).json({ ok: false, message: e?.message || '内部错误' });
  }
}

async function handleTenantsQuery(req: express.Request, res: express.Response) {
  try {
    const projectId = String((req.query.project_id as string) || '').trim();
    const name = String((req.query.name as string) || '').trim();
    if (!projectId) { res.status(400).json({ ok: false, message: '缺少 project_id' }); return; }
    let filter = `project_id="${escapeFilter(projectId)}"`;
    if (name) filter += ` && name~"${escapeFilter(name)}"`;
    const list = await pb.collection('pb_tenants').getFullList({ filter, sort: 'name' });
    res.json({ ok: true, project_id: projectId, count: list.length, tenants: list });
  } catch (e: any) {
    console.error('[tenants] error:', e?.message || e);
    res.status(500).json({ ok: false, message: e?.message || '内部错误' });
  }
}

async function handlePaymentsQuery(req: express.Request, res: express.Response) {
  try {
    const projectId = String((req.query.project_id as string) || '').trim();
    const tenantId = String((req.query.tenant_id as string) || '').trim();
    const period = String((req.query.period as string) || '').trim();
    if (!projectId) { res.status(400).json({ ok: false, message: '缺少 project_id' }); return; }
    let filter = `project_id="${escapeFilter(projectId)}"`;
    if (tenantId) filter += ` && tenant_id="${escapeFilter(tenantId)}"`;
    if (period && /^\d{4}-\d{2}$/.test(period)) filter += ` && period="${escapeFilter(period)}"`;
    const list = await pb.collection('pb_payments').getFullList({ filter, sort: '-date' });
    res.json({ ok: true, project_id: projectId, count: list.length, payments: list });
  } catch (e: any) {
    console.error('[payments] error:', e?.message || e);
    res.status(500).json({ ok: false, message: e?.message || '内部错误' });
  }
}

async function handleBuildingsQuery(req: express.Request, res: express.Response) {
  try {
    const projectId = String((req.query.project_id as string) || '').trim();
    if (!projectId) { res.status(400).json({ ok: false, message: '缺少 project_id' }); return; }
    const list = await pb.collection('pb_buildings').getFullList({
      filter: `project_id="${escapeFilter(projectId)}"`, sort: 'name',
    });
    res.json({ ok: true, project_id: projectId, count: list.length, buildings: list });
  } catch (e: any) {
    console.error('[buildings] error:', e?.message || e);
    res.status(500).json({ ok: false, message: e?.message || '内部错误' });
  }
}

async function handleUnitsQuery(req: express.Request, res: express.Response) {
  try {
    const projectId = String((req.query.project_id as string) || '').trim();
    const buildingId = String((req.query.building_id as string) || '').trim();
    if (!projectId) { res.status(400).json({ ok: false, message: '缺少 project_id' }); return; }
    let filter = `project_id="${escapeFilter(projectId)}"`;
    if (buildingId) filter += ` && building_id="${escapeFilter(buildingId)}"`;
    const list = await pb.collection('pb_units').getFullList({ filter, sort: 'name' });
    res.json({ ok: true, project_id: projectId, count: list.length, units: list });
  } catch (e: any) {
    console.error('[units] error:', e?.message || e);
    res.status(500).json({ ok: false, message: e?.message || '内部错误' });
  }
}

// ── 服务端计算端点（与前端 billingService / dashboardMetrics 同代码）──

async function handleComputeKpi(req: express.Request, res: express.Response) {
  try {
    const projectId = String((req.body?.project_id || req.query.project_id || '' as string)).trim();
    const year = Number(req.body?.year || req.query.year || new Date().getFullYear());
    if (!projectId) { res.status(400).json({ ok: false, message: '缺少 project_id' }); return; }

    console.log(`[compute] KPI project=${projectId} year=${year}`);
    const result = await computeKpi(projectId, year);
    res.json(result);
  } catch (e: any) {
    console.error('[compute/kpi] error:', e?.message || e);
    res.status(500).json({ ok: false, message: e?.message || '内部错误' });
  }
}

async function handleComputeBilling(req: express.Request, res: express.Response) {
  try {
    const projectId = String((req.body?.project_id || '' as string)).trim();
    const year = Number(req.body?.year);
    const month = Number(req.body?.month) - 1; // 前端传 1-12，内部用 0-11
    if (!projectId || !Number.isFinite(year) || !Number.isFinite(month) || month < 0 || month > 11) {
      res.status(400).json({ ok: false, message: '缺少 project_id / year / month (1-12)' });
      return;
    }

    console.log(`[compute] Billing project=${projectId} year=${year} month=${month + 1}`);
    const result = await computeBilling(projectId, year, month);
    res.json(result);
  } catch (e: any) {
    console.error('[compute/billing] error:', e?.message || e);
    res.status(500).json({ ok: false, message: e?.message || '内部错误' });
  }
}

/** 重算 KPI 并回写到 pb_kpi_snapshots，使后续 GET /api/integration/kpi 直接命中 */
async function handleComputeRefresh(req: express.Request, res: express.Response) {
  try {
    const projectId = String((req.body?.project_id || '' as string)).trim();
    const year = Number(req.body?.year || new Date().getFullYear());
    if (!projectId) { res.status(400).json({ ok: false, message: '缺少 project_id' }); return; }

    console.log(`[compute/refresh] project=${projectId} year=${year}`);
    const result = await computeKpi(projectId, year);
    if (!result.ok) {
      res.status(500).json(result);
      return;
    }

    // 回写到 pb_kpi_snapshots
    try {
      const existing = await pb.collection('pb_kpi_snapshots').getList(1, 1, {
        filter: `project_id="${escapeFilter(projectId)}" && year=${year}`,
      });
      const record = {
        project_id: projectId,
        year,
        summary_json: result.summary,
        monthly_trends_json: result.fullYearTrends,
        data_version: result.dataVersion,
        calculated_at: result.computedAt,
      };
      if (existing.items.length > 0) {
        await pb.collection('pb_kpi_snapshots').update((existing.items[0] as any).id, record);
      } else {
        await pb.collection('pb_kpi_snapshots').create(record);
      }
      console.log(`[compute/refresh] 已回写 pb_kpi_snapshots project=${projectId} year=${year}`);
    } catch (e: any) {
      console.warn('[compute/refresh] 回写 pb_kpi_snapshots 失败:', e?.message || e);
    }

    res.json({ ...result, refreshed: true });
  } catch (e: any) {
    console.error('[compute/refresh] error:', e?.message || e);
    res.status(500).json({ ok: false, message: e?.message || '内部错误' });
  }
}

// ── 主程序 ──

async function main() {
  await auth();
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, pb: PB_URL }));

  // 只读查询
  app.get('/api/integration/kpi', handleKpiQuery);
  app.get('/api/integration/dashboard', handleDashboardQuery);
  app.get('/api/integration/tenants', handleTenantsQuery);
  app.get('/api/integration/payments', handlePaymentsQuery);
  app.get('/api/integration/buildings', handleBuildingsQuery);
  app.get('/api/integration/units', handleUnitsQuery);

  // 服务端计算（核心：与前端同一套 billingService / dashboardMetrics 代码）
  app.post('/api/integration/compute/kpi', handleComputeKpi);
  app.post('/api/integration/compute/billing', handleComputeBilling);
  app.post('/api/integration/compute/refresh', handleComputeRefresh);

  // 写入
  app.post('/api/integration/write', async (req, res) => {
    const source = await resolveSource(req);
    if (!source.ok) {
      await audit({
        source_type: source.sourceType || 'unknown',
        source_key: source.sourceKey || '',
        project_id: source.projectId || 'unknown',
        status: 'rejected', message: source.message,
        payload_summary: { collection: req.body?.collection, action: req.body?.action },
      });
      res.status(source.status).json({ success: false, message: source.message });
      return;
    }

    try {
      const result = await writeBusinessRecord(req.body, source.projectId!);
      await audit({
        source_type: source.sourceType, source_key: source.sourceKey,
        project_id: source.projectId,
        target_collection: result.collection,
        target_original_id: req.body?.original_id || req.body?.data?.original_id || '',
        action: result.action, status: 'success', message: '写入成功',
        payload_summary: { collection: result.collection, action: result.action, record_id: result.id },
      });
      const affectedHints: string[] = [];
      if (result.collection === 'pb_payments') affectedHints.push('kpi', 'billing');
      else if (result.collection === 'pb_tenants') affectedHints.push('kpi', 'tenants', 'billing', 'dashboard');
      else if (result.collection === 'pb_budget_scenarios' || result.collection === 'pb_budget_assumptions') affectedHints.push('kpi', 'dashboard');

      res.json({
        success: true, project_id: source.projectId, result,
        affected_metrics: affectedHints.length ? affectedHints : undefined,
        compute_hint: affectedHints.length
          ? `建议调用 POST /api/integration/compute/refresh { project_id: "${source.projectId}" } 刷新 KPI`
          : undefined,
      });
    } catch (e: any) {
      const message = e?.data?.message || e?.message || String(e);
      await audit({
        source_type: source.sourceType, source_key: source.sourceKey,
        project_id: source.projectId,
        target_collection: req.body?.collection || '',
        target_original_id: req.body?.original_id || req.body?.data?.original_id || '',
        action: req.body?.action || 'upsert', status: 'error', message,
        payload_summary: { collection: req.body?.collection, action: req.body?.action },
      });
      res.status(400).json({ success: false, message });
    }
  });

  app.listen(PORT, () => {
    console.log(`[integration-gateway] listening on http://0.0.0.0:${PORT}`);
    console.log(`[integration-gateway] PocketBase: ${PB_URL}`);
    console.log(`[integration-gateway] Compute endpoints:`);
    console.log(`  POST /api/integration/compute/kpi      — 重算 KPI（与前端同口径）`);
    console.log(`  POST /api/integration/compute/billing  — 重算应收明细`);
    console.log(`  POST /api/integration/compute/refresh  — 重算并回写快照`);
  });
}

main().catch((err) => {
  console.error('[integration-gateway] failed:', err?.data || err);
  process.exit(1);
});
