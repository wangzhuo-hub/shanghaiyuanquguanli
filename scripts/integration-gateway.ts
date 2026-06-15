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
import {
  AuthError,
  ForbiddenError,
  authenticateRequest,
  loginWithPassword,
  publicUserProfile,
  resolveAuthorizedProjectId,
  assertPaymentWriteAllowed,
} from './paymentApiAuth.js';
import {
  archiveTenantLikeFrontend,
  buildMcpSaveContext,
  deletePaymentLikeFrontend,
  deleteTenantLikeFrontend,
  savePaymentLikeFrontend,
  saveTenantLikeFrontend,
  updatePaymentLikeFrontend,
} from '../services/mcpIncrementalSave.js';

// ── 配置 ──

const PB_URL: string = process.env.PB_URL || 'http://127.0.0.1:8090';
const ADMIN_EMAIL: string = process.env.PB_ADMIN_EMAIL || '';
const ADMIN_PASSWORD: string = process.env.PB_ADMIN_PASSWORD || '';
const PORT: number = Number(process.env.INTEGRATION_GATEWAY_PORT || 8787);
const APP_API_WRITE_ENABLED: boolean = process.env.APP_API_WRITE_ENABLED === '1';
const APP_API_PAYMENT_WRITE_ENABLED: boolean = process.env.APP_API_PAYMENT_WRITE_ENABLED === '1';
const APP_API_TENANT_WRITE_ENABLED: boolean = process.env.APP_API_TENANT_WRITE_ENABLED === '1';

const WRITABLE_COLLECTIONS = new Set([
  'pb_buildings', 'pb_units', 'pb_tenants', 'pb_payments',
  'pb_invoices', 'pb_yearly_targets', 'pb_monthly_init_data',
  'pb_budget_assumptions', 'pb_budget_adjustments',
  'pb_budget_scenarios', 'pb_billing_period_notes',
]);

const pb = new PocketBase(PB_URL);

function envelope(data: Record<string, unknown>, meta?: Record<string, unknown>) {
  return {
    success: data.ok !== false,
    data,
    meta: {
      auditId: `app_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      dryRun: Boolean(meta?.dryRun),
      source: meta?.source || 'app-api',
      ...meta,
    },
  };
}

function sendAppError(res: express.Response, e: unknown, fallback = '内部错误') {
  const err = e as { status?: number; message?: string; data?: { message?: string } };
  const status =
    e instanceof AuthError ? 401
      : e instanceof ForbiddenError ? 403
        : err?.status && err.status >= 400 && err.status < 600 ? err.status
          : 500;
  const code =
    status === 401 ? 'AUTH_UNAUTHORIZED'
      : status === 403 ? 'AUTH_FORBIDDEN'
        : status === 404 ? 'APP_NOT_FOUND'
          : 'APP_ERROR';
  res.status(status).json({
    success: false,
    error: {
      code,
      message: err?.data?.message || err?.message || fallback,
    },
    meta: {
      auditId: `app_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      source: 'app-api',
    },
  });
}

function assertAppWriteFeatureEnabled(res: express.Response, action: string): boolean {
  const actionEnabled =
    action.startsWith('payment.') ? APP_API_PAYMENT_WRITE_ENABLED : APP_API_TENANT_WRITE_ENABLED;
  if (APP_API_WRITE_ENABLED && actionEnabled) return true;
  res.status(403).json({
    success: false,
    error: {
      code: 'APP_WRITE_DISABLED',
      message: `Application API 正式写入未开启：${action}。当前仅允许 dry-run。`,
    },
    meta: {
      dryRun: false,
      source: 'app-api',
      writeEnabled: APP_API_WRITE_ENABLED,
      actionEnabled,
    },
  });
  return false;
}

async function handleAppLogin(req: express.Request, res: express.Response) {
  try {
    const body = (req.body || {}) as { email?: string; password?: string };
    const auth = await loginWithPassword(PB_URL, body.email || '', body.password || '');
    res.json(envelope({
      ok: true,
      token: auth.token,
      user: publicUserProfile(auth.user),
      authHint: '后续请求请携带 Authorization: Bearer <token>',
    }));
  } catch (e) {
    sendAppError(res, e, '登录失败');
  }
}

async function handleAppMe(req: express.Request, res: express.Response) {
  try {
    const auth = await authenticateRequest(req, PB_URL);
    res.json(envelope({ ok: true, user: publicUserProfile(auth.user) }));
  } catch (e) {
    sendAppError(res, e, '读取当前用户失败');
  }
}

async function handleAppPaymentReceive(req: express.Request, res: express.Response) {
  try {
    const auth = await authenticateRequest(req, PB_URL);
    const body = (req.body || {}) as Record<string, unknown>;
    const dryRun = body.dry_run === true || body.dryRun === true;
    const projectId = resolveAuthorizedProjectId(auth.user, body.project_id);
    const type = String(body.type || 'Rent');
    assertPaymentWriteAllowed(auth.user, type);

    const originalId = String(body.original_id || body.idempotency_key || body.idempotencyKey || '').trim();
    if (!dryRun && !originalId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'PAYMENT_IDEMPOTENCY_REQUIRED',
          message: '正式写入必须提供 original_id 或 idempotency_key，避免重复核销',
        },
        meta: { dryRun, source: 'app-api' },
      });
      return;
    }

    const params = {
      project_id: projectId,
      tenant_id: String(body.tenant_id || body.tenantId || ''),
      amount: Number(body.amount),
      type,
      date: String(body.date || ''),
      period: body.period as string | undefined,
      remarks: body.remarks as string | undefined,
      tenant_name: body.tenant_name as string | undefined,
      original_id: originalId || undefined,
      status: body.status as 'Received' | 'Pending' | 'Overdue' | undefined as never,
      invoice_status: body.invoice_status as 'Issued' | 'Pending' | 'NotRequired' | undefined as never,
    };

    if (dryRun) {
      res.json(envelope({
        ok: true,
        action: 'payment.receive',
        project_id: projectId,
        preview: params,
        message: 'dry-run 通过：未写入 PocketBase',
      }, { dryRun }));
      return;
    }

    if (!assertAppWriteFeatureEnabled(res, 'payment.receive')) return;

    const ctx = buildMcpSaveContext(auth.user, auth.userPb, PB_URL, { projectId });
    const result = await savePaymentLikeFrontend(params, ctx);
    res.status(result.ok === false ? 400 : 200).json(envelope(result as Record<string, unknown>, { dryRun }));
  } catch (e) {
    sendAppError(res, e, '收款核销失败');
  }
}

async function handleAppPaymentUpdate(req: express.Request, res: express.Response) {
  try {
    const auth = await authenticateRequest(req, PB_URL);
    const body = (req.body || {}) as Record<string, unknown>;
    const dryRun = body.dry_run === true || body.dryRun === true;
    const projectId = resolveAuthorizedProjectId(auth.user, body.project_id);
    const patchSource = (body.patch && typeof body.patch === 'object' ? body.patch : body) as Record<string, unknown>;
    const patch = {
      tenantId: patchSource.tenant_id as string | undefined,
      tenantName: patchSource.tenant_name as string | undefined,
      amount: patchSource.amount === undefined ? undefined : Number(patchSource.amount),
      type: patchSource.type as never,
      date: patchSource.date as string | undefined,
      period: patchSource.period as string | undefined,
      status: patchSource.status as never,
      invoiceStatus: (patchSource.invoice_status || patchSource.invoiceStatus) as never,
      remarks: patchSource.remarks as string | undefined,
    };
    Object.keys(patch).forEach((key) => {
      if ((patch as Record<string, unknown>)[key] === undefined) delete (patch as Record<string, unknown>)[key];
    });
    const paymentId = String(body.original_id || body.payment_id || body.paymentId || '').trim();

    if (dryRun) {
      res.json(envelope({
        ok: true,
        action: 'payment.update',
        project_id: projectId,
        payment_id: paymentId,
        preview: patch,
        message: 'dry-run 通过：未写入 PocketBase',
      }, { dryRun }));
      return;
    }

    if (!assertAppWriteFeatureEnabled(res, 'payment.update')) return;

    const ctx = buildMcpSaveContext(auth.user, auth.userPb, PB_URL, { projectId });
    const result = await updatePaymentLikeFrontend({
      original_id: paymentId,
      project_id: projectId,
      patch,
    }, ctx);
    res.status(result.ok === false ? 400 : 200).json(envelope(result as Record<string, unknown>, { dryRun }));
  } catch (e) {
    sendAppError(res, e, '修改收款失败');
  }
}

async function handleAppPaymentDelete(req: express.Request, res: express.Response) {
  try {
    const auth = await authenticateRequest(req, PB_URL);
    const body = (req.body || {}) as Record<string, unknown>;
    const dryRun = body.dry_run === true || body.dryRun === true;
    const projectId = resolveAuthorizedProjectId(auth.user, body.project_id);
    const paymentId = String(body.original_id || body.payment_id || body.paymentId || '').trim();

    if (dryRun) {
      res.json(envelope({
        ok: true,
        action: 'payment.delete',
        project_id: projectId,
        payment_id: paymentId,
        message: 'dry-run 通过：未写入 PocketBase',
      }, { dryRun }));
      return;
    }

    if (body.confirm_delete !== true && body.confirmDelete !== true) {
      res.status(400).json({
        success: false,
        error: {
          code: 'PAYMENT_DELETE_CONFIRM_REQUIRED',
          message: '删除收款必须传 confirm_delete=true，建议先 dry_run=true 预演',
        },
        meta: { dryRun, source: 'app-api' },
      });
      return;
    }

    if (!assertAppWriteFeatureEnabled(res, 'payment.delete')) return;

    const ctx = buildMcpSaveContext(auth.user, auth.userPb, PB_URL, { projectId });
    const result = await deletePaymentLikeFrontend({
      original_id: paymentId,
      project_id: projectId,
    }, ctx);
    res.status(result.ok === false ? 400 : 200).json(envelope(result as Record<string, unknown>, { dryRun }));
  } catch (e) {
    sendAppError(res, e, '删除收款失败');
  }
}

async function handleAppTenantUpsert(req: express.Request, res: express.Response) {
  try {
    const auth = await authenticateRequest(req, PB_URL);
    const body = (req.body || {}) as Record<string, unknown>;
    const dryRun = body.dry_run === true || body.dryRun === true;
    const projectId = resolveAuthorizedProjectId(auth.user, body.project_id);
    const data = (body.data && typeof body.data === 'object' ? body.data : body) as Record<string, unknown>;
    const originalId = String(body.original_id || data.original_id || data.id || '').trim();
    if (!originalId) {
      res.status(400).json({
        success: false,
        error: { code: 'TENANT_ORIGINAL_ID_REQUIRED', message: '缺少 original_id / 租户 id' },
        meta: { dryRun, source: 'app-api' },
      });
      return;
    }

    if (dryRun) {
      res.json(envelope({
        ok: true,
        action: 'tenant.upsert',
        project_id: projectId,
        tenant_id: originalId,
        preview: data,
        message: 'dry-run 通过：未写入 PocketBase',
      }, { dryRun }));
      return;
    }

    if (!assertAppWriteFeatureEnabled(res, 'tenant.upsert')) return;

    const ctx = buildMcpSaveContext(auth.user, auth.userPb, PB_URL, { projectId });
    const result = await saveTenantLikeFrontend({
      original_id: originalId,
      mode: String(body.mode || 'upsert') === 'create' ? 'create' : 'update',
      data,
      project_id: projectId,
    }, ctx);
    res.status(result.ok === false ? 400 : 200).json(envelope(result as Record<string, unknown>, { dryRun }));
  } catch (e) {
    sendAppError(res, e, '租户保存失败');
  }
}

async function handleAppTenantArchive(req: express.Request, res: express.Response) {
  try {
    const auth = await authenticateRequest(req, PB_URL);
    const body = (req.body || {}) as Record<string, unknown>;
    const dryRun = body.dry_run === true || body.dryRun === true;
    const projectId = resolveAuthorizedProjectId(auth.user, body.project_id);
    const tenantId = String(body.original_id || body.tenant_id || body.tenantId || '').trim();

    if (dryRun) {
      res.json(envelope({
        ok: true,
        action: 'tenant.archive',
        project_id: projectId,
        tenant_id: tenantId,
        termination_date: body.termination_date,
        termination_reason: body.termination_reason,
        message: 'dry-run 通过：未写入 PocketBase',
      }, { dryRun }));
      return;
    }

    if (!assertAppWriteFeatureEnabled(res, 'tenant.archive')) return;

    const ctx = buildMcpSaveContext(auth.user, auth.userPb, PB_URL, { projectId });
    const result = await archiveTenantLikeFrontend({
      original_id: tenantId,
      project_id: projectId,
      termination_date: body.termination_date as string | undefined,
      termination_reason: body.termination_reason as string | undefined,
    }, ctx);
    res.status(result.ok === false ? 400 : 200).json(envelope(result as Record<string, unknown>, { dryRun }));
  } catch (e) {
    sendAppError(res, e, '作废租户失败');
  }
}

async function handleAppTenantDelete(req: express.Request, res: express.Response) {
  try {
    const auth = await authenticateRequest(req, PB_URL);
    const body = (req.body || {}) as Record<string, unknown>;
    const dryRun = body.dry_run === true || body.dryRun === true;
    const projectId = resolveAuthorizedProjectId(auth.user, body.project_id);
    const tenantId = String(body.original_id || body.tenant_id || body.tenantId || '').trim();

    if (dryRun) {
      res.json(envelope({
        ok: true,
        action: 'tenant.delete',
        project_id: projectId,
        tenant_id: tenantId,
        message: 'dry-run 通过：未写入 PocketBase',
      }, { dryRun }));
      return;
    }

    if (body.confirm_delete !== true && body.confirmDelete !== true) {
      res.status(400).json({
        success: false,
        error: {
          code: 'TENANT_DELETE_CONFIRM_REQUIRED',
          message: '删除租户必须传 confirm_delete=true；业务退租建议使用 tenants/archive',
        },
        meta: { dryRun, source: 'app-api' },
      });
      return;
    }

    if (!assertAppWriteFeatureEnabled(res, 'tenant.delete')) return;

    const ctx = buildMcpSaveContext(auth.user, auth.userPb, PB_URL, { projectId });
    const result = await deleteTenantLikeFrontend({
      original_id: tenantId,
      project_id: projectId,
    }, ctx);
    res.status(result.ok === false ? 400 : 200).json(envelope(result as Record<string, unknown>, { dryRun }));
  } catch (e) {
    sendAppError(res, e, '删除租户失败');
  }
}

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
  receivableScopes?: string[];
}

function scopesFromSource(source: any): string[] {
  const meta = source?.metadata;
  if (meta && Array.isArray(meta.allowed_receivable_scopes)) {
    return meta.allowed_receivable_scopes.filter(
      (x: string) => x === 'rent_receivable' || x === 'mgmt_fee_receivable',
    );
  }
  return ['rent_receivable', 'mgmt_fee_receivable'];
}

function internalTokenOk(req: express.Request): boolean {
  const expected = String(process.env.INTEGRATION_INTERNAL_TOKEN || '').trim();
  if (!expected) return false;
  return String(req.headers['x-integration-internal-token'] || '').trim() === expected;
}

async function requireIntegrationAuth(
  req: express.Request,
  res: express.Response,
): Promise<AuthResult | null> {
  const projectId = String(
    (req.query.project_id as string) || (req.body as any)?.project_id || '',
  ).trim();

  if (internalTokenOk(req)) {
    if (!projectId) {
      res.status(400).json({ ok: false, message: '缺少 project_id' });
      return null;
    }
    return {
      ok: true,
      status: 200,
      message: '',
      projectId,
      receivableScopes: ['rent_receivable', 'mgmt_fee_receivable'],
    };
  }

  const source = await resolveSource(req);
  if (!source.ok) {
    res.status(source.status).json({ ok: false, message: source.message });
    return null;
  }
  if (projectId && source.projectId && projectId !== source.projectId) {
    res.status(403).json({ ok: false, message: '禁止跨园区访问' });
    return null;
  }
  return { ...source, projectId: projectId || source.projectId };
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

  return {
    ok: true,
    status: 200,
    message: '',
    sourceType,
    sourceKey,
    projectId: source.project_id,
    receivableScopes: scopesFromSource(source),
  };
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

async function writeBusinessRecord(body: any, projectId: string, receivableScopes: string[] = ['rent_receivable', 'mgmt_fee_receivable']) {
  const collection = String(body.collection || '').trim();
  const action = String(body.action || 'upsert').trim();
  if (!WRITABLE_COLLECTIONS.has(collection)) throw new Error(`不允许写入集合 ${collection}`);
  if (!['create', 'update', 'upsert', 'delete'].includes(action)) throw new Error(`不支持的 action: ${action}`);

  const requestedProject = String(body.project_id || body.data?.project_id || '').trim();
  if (requestedProject && requestedProject !== projectId) {
    throw new Error(`禁止跨园区写入：来源绑定 ${projectId}，请求目标 ${requestedProject}`);
  }

  if (collection === 'pb_payments' && action !== 'delete') {
    const payType = String(body.data?.type || '');
    const rentTypes = new Set(['Rent', 'DepositToRent', 'Deposit', 'DepositRefund']);
    if (payType === 'ManagementFee' && !receivableScopes.includes('mgmt_fee_receivable')) {
      throw new Error('来源无物业费核销权限');
    }
    if (rentTypes.has(payType) && !receivableScopes.includes('rent_receivable')) {
      throw new Error('来源无租金核销权限');
    }
  }

  if (collection === 'pb_tenants' && action === 'delete' && !receivableScopes.includes('rent_receivable')) {
    throw new Error('来源无租金权限，不可删除租户');
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

// ── 只读端点（均需来源鉴权） ──

async function handleKpiQuery(req: express.Request, res: express.Response) {
  const authCtx = await requireIntegrationAuth(req, res);
  if (!authCtx) return;
  try {
    const projectId = authCtx.projectId!;
    const year = Number(req.query.year || (req.body as any)?.year || new Date().getFullYear());
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
  const authCtx = await requireIntegrationAuth(req, res);
  if (!authCtx) return;
  try {
    const projectId = authCtx.projectId!;

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
    const rentOk = (authCtx.receivableScopes || []).includes('rent_receivable');
    const filteredTenants = rentOk
      ? tenants
      : tenants.map((t: any) => {
          const row = { ...t };
          for (const f of ['unit_price', 'monthly_rent', 'deposit_amount']) delete row[f];
          return row;
        });
    const filteredPayments = rentOk
      ? payments
      : payments.filter((p: any) => p.type === 'ManagementFee');

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
      dashboard: { tenants: filteredTenants, buildings, units, payments: filteredPayments },
      full_year_monthly_trends: kpiResult.fullYearTrends,
    });
  } catch (e: any) {
    console.error('[dashboard] error:', e?.message || e);
    res.status(500).json({ ok: false, message: e?.message || '内部错误' });
  }
}

async function handleTenantsQuery(req: express.Request, res: express.Response) {
  const authCtx = await requireIntegrationAuth(req, res);
  if (!authCtx) return;
  try {
    const projectId = authCtx.projectId!;
    const name = String((req.query.name as string) || '').trim();
    let filter = `project_id="${escapeFilter(projectId)}"`;
    if (name) filter += ` && name~"${escapeFilter(name)}"`;
    const list = await pb.collection('pb_tenants').getFullList({ filter, sort: 'name' });
    const rentOk = (authCtx.receivableScopes || []).includes('rent_receivable');
    const tenants = rentOk
      ? list
      : list.map((t: any) => {
          const row = { ...t };
          for (const f of ['unit_price', 'monthly_rent', 'deposit_amount', 'rent_free_periods']) delete row[f];
          return row;
        });
    res.json({ ok: true, project_id: projectId, count: tenants.length, tenants });
  } catch (e: any) {
    console.error('[tenants] error:', e?.message || e);
    res.status(500).json({ ok: false, message: e?.message || '内部错误' });
  }
}

async function handlePaymentsQuery(req: express.Request, res: express.Response) {
  const authCtx = await requireIntegrationAuth(req, res);
  if (!authCtx) return;
  try {
    const projectId = authCtx.projectId!;
    const tenantId = String((req.query.tenant_id as string) || '').trim();
    const period = String((req.query.period as string) || '').trim();
    let filter = `project_id="${escapeFilter(projectId)}"`;
    if (tenantId) filter += ` && tenant_id="${escapeFilter(tenantId)}"`;
    if (period && /^\d{4}-\d{2}$/.test(period)) filter += ` && period="${escapeFilter(period)}"`;
    let list = await pb.collection('pb_payments').getFullList({ filter, sort: '-date' });
    const rentOk = (authCtx.receivableScopes || []).includes('rent_receivable');
    if (!rentOk) list = list.filter((p: any) => p.type === 'ManagementFee');
    res.json({ ok: true, project_id: projectId, count: list.length, payments: list });
  } catch (e: any) {
    console.error('[payments] error:', e?.message || e);
    res.status(500).json({ ok: false, message: e?.message || '内部错误' });
  }
}

async function handleBuildingsQuery(req: express.Request, res: express.Response) {
  const authCtx = await requireIntegrationAuth(req, res);
  if (!authCtx) return;
  try {
    const projectId = authCtx.projectId!;
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
  const authCtx = await requireIntegrationAuth(req, res);
  if (!authCtx) return;
  try {
    const projectId = authCtx.projectId!;
    const buildingId = String((req.query.building_id as string) || '').trim();
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
  const authCtx = await requireIntegrationAuth(req, res);
  if (!authCtx) return;
  try {
    const projectId = authCtx.projectId!;
    const year = Number(req.body?.year || req.query.year || new Date().getFullYear());

    console.log(`[compute] KPI project=${projectId} year=${year}`);
    const result = await computeKpi(projectId, year);
    res.json(result);
  } catch (e: any) {
    console.error('[compute/kpi] error:', e?.message || e);
    res.status(500).json({ ok: false, message: e?.message || '内部错误' });
  }
}

async function handleComputeBilling(req: express.Request, res: express.Response) {
  const authCtx = await requireIntegrationAuth(req, res);
  if (!authCtx) return;
  try {
    const projectId = authCtx.projectId!;
    const year = Number(req.body?.year);
    const month = Number(req.body?.month) - 1; // 前端传 1-12，内部用 0-11
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 0 || month > 11) {
      res.status(400).json({ ok: false, message: '缺少 year / month (1-12)' });
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

// per-project 防抖：5 秒内同一 project 的多次请求合并为一次
const REFRESH_DEBOUNCE_MS = 5000;
const _refreshJobs = new Map<string, Promise<any>>();

async function handleComputeRefresh(req: express.Request, res: express.Response) {
  const authCtx = await requireIntegrationAuth(req, res);
  if (!authCtx) return;
  try {
    const projectId = authCtx.projectId!;
    const year = Number(req.body?.year || new Date().getFullYear());
    const jobKey = `${projectId}:${year}`;

    // 防抖：已有进行中的重算则复用
    const existing = _refreshJobs.get(jobKey);
    if (existing) {
      console.log(`[compute/refresh] ${jobKey} 合并到已有任务`);
      const result = await existing;
      res.json({ ...result, refreshed: true, debounced: true });
      return;
    }

    const job = (async () => {
      console.log(`[compute/refresh] project=${projectId} year=${year}`);
      const result = await computeKpi(projectId, year);
      if (!result.ok) return result;

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

      return result;
    })();

    _refreshJobs.set(jobKey, job);
    // 防抖窗口结束后清除 job
    setTimeout(() => { _refreshJobs.delete(jobKey); }, REFRESH_DEBOUNCE_MS);

    const result = await job;
    if (!result.ok) {
      res.status(500).json(result);
      return;
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

  // Application API（语义写入入口）：MCP / CLI / 未来 Web 共用。
  // 这里禁止裸 collection 写入，底层复用与前端一致的增量保存路径。
  app.post('/api/v1/app/auth/login', handleAppLogin);
  app.get('/api/v1/app/auth/me', handleAppMe);
  app.post('/api/v1/app/payments/create', handleAppPaymentReceive);
  app.post('/api/v1/app/payments/receive', handleAppPaymentReceive);
  app.post('/api/v1/app/payments/update', handleAppPaymentUpdate);
  app.put('/api/v1/app/payments/:id', (req, res) => {
    req.body = { ...(req.body || {}), original_id: req.params.id };
    return handleAppPaymentUpdate(req, res);
  });
  app.post('/api/v1/app/payments/delete', handleAppPaymentDelete);
  app.delete('/api/v1/app/payments/:id', (req, res) => {
    req.body = { ...(req.body || {}), original_id: req.params.id };
    return handleAppPaymentDelete(req, res);
  });
  app.post('/api/v1/app/tenants/upsert', handleAppTenantUpsert);
  app.post('/api/v1/app/tenants/archive', handleAppTenantArchive);
  app.post('/api/v1/app/tenants/delete', handleAppTenantDelete);
  // 兼容路径：复用现有 Caddy `/api/integration/* -> gateway` 路由，首轮生产灰度不必改 Caddy。
  app.post('/api/integration/app/auth/login', handleAppLogin);
  app.get('/api/integration/app/auth/me', handleAppMe);
  app.post('/api/integration/app/payments/create', handleAppPaymentReceive);
  app.post('/api/integration/app/payments/receive', handleAppPaymentReceive);
  app.post('/api/integration/app/payments/update', handleAppPaymentUpdate);
  app.post('/api/integration/app/payments/delete', handleAppPaymentDelete);
  app.post('/api/integration/app/tenants/upsert', handleAppTenantUpsert);
  app.post('/api/integration/app/tenants/archive', handleAppTenantArchive);
  app.post('/api/integration/app/tenants/delete', handleAppTenantDelete);

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
      const result = await writeBusinessRecord(req.body, source.projectId!, source.receivableScopes || ['rent_receivable', 'mgmt_fee_receivable']);
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
    console.log(`[integration-gateway] App API endpoints:`);
    console.log(`  POST /api/v1/app/auth/login            — 看板用户登录`);
    console.log(`  GET  /api/v1/app/auth/me               — 当前用户`);
    console.log(`  POST /api/v1/app/payments/create       — 直接录入收款`);
    console.log(`  POST /api/v1/app/payments/receive      — 收款核销`);
    console.log(`  POST /api/v1/app/payments/update       — 修改收款`);
    console.log(`  POST /api/v1/app/payments/delete       — 删除收款（需 confirm_delete）`);
    console.log(`  POST /api/v1/app/tenants/upsert        — 租户保存`);
    console.log(`  POST /api/v1/app/tenants/archive       — 租户作废/退租`);
    console.log(`  POST /api/v1/app/tenants/delete        — 删除租户（需 confirm_delete）`);
    console.log(`  /api/integration/app/*                 — 兼容 Caddy 现有 gateway 路由`);
    console.log(`[integration-gateway] App API write flags: global=${APP_API_WRITE_ENABLED} payment=${APP_API_PAYMENT_WRITE_ENABLED} tenant=${APP_API_TENANT_WRITE_ENABLED}`);
  });
}

main().catch((err) => {
  console.error('[integration-gateway] failed:', err?.data || err);
  process.exit(1);
});
