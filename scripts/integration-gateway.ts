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
 *   POST /api/integration/app/compute/billing-draft  用户草稿应收明细计算（不落库）
 *   POST /api/integration/app/compute/source-agent-metrics  用户草稿来源分析计算（不落库）
 *   POST /api/integration/app/compute/contract-analysis-metrics  用户草稿合同分析计算（不落库）
 *   POST /api/integration/app/compute/tenant-historical-arrears  用户态客户级历史欠费计算（不落库）
 *   POST /api/integration/app/dashboard/compute-draft  用户草稿看板计算（不落库）
 */

import crypto from 'node:crypto';
import express from 'express';
import PocketBase from 'pocketbase';
import {
  computeKpi,
  computeBilling,
  computeBillingDraft,
  computeBudgetedBillsPreview,
  computeBudgetedBillsPreviewBatch,
  computeContractReceivableMonthly,
  computeSourceAgentMetricsPreview,
  computeContractAnalysisMetricsPreview,
  computeTenantHistoricalArrears,
  computeDashboardData,
  computeDashboardDraft,
  buildComputeKpiResultFromDashboardData,
  sealMonth,
  clearComputeCaches,
  readComputeDataVersion,
} from './compute-engine.js';
import {
  AuthError,
  ForbiddenError,
  authenticateRequest,
  canAccessProject,
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
import { applyDashboardDataScope } from '../services/dataScopeFilter.js';
import { applyDirtyPayloadToDashboardData } from '../services/draftDirtyPayload.js';
import {
  buildIntegrationFullSnapshotV1,
  INTEGRATION_FULL_SNAPSHOT_KIND,
} from '../services/integrationSnapshot.js';
import { normalizeReceivablePermissions } from '../services/receivablePermissions.js';
import { buildBigScreenDataFromParkInputs } from '../services/bigScreenMetrics.js';
import type { DirtyPayload } from '../services/dirtyTracker.js';
import { payloadCount } from '../services/dataDiff.js';
import type { GenerateBudgetedBillsOptions } from '../services/billingService.js';
import { generateInitialData } from '../services/mockData.js';
import {
  authenticatePocketBase,
  fetchPocketBaseBackup,
  initPocketBase,
  saveIncrementalToPocketBase,
  type SaveIncrementalResult,
} from '../services/pocketbaseService.js';
import { filterDirtyPayloadForRentMaskedUser } from '../services/tenantRentFieldGuard.js';
import {
  normalizeDashboardCustomFieldIds,
} from '../services/dashboardCustomFields.js';
import type { AuthUser, BudgetAdjustment, BudgetAssumption, BudgetScenario, Building, DashboardData, MonthlyInitData, ParkInfo, PaymentRecord, Tenant } from '../types.js';

// ── 配置 ──

const PB_URL: string = process.env.PB_URL || 'http://127.0.0.1:8090';
const ADMIN_EMAIL: string = process.env.PB_ADMIN_EMAIL || '';
const ADMIN_PASSWORD: string = process.env.PB_ADMIN_PASSWORD || '';
const PORT: number = Number(process.env.INTEGRATION_GATEWAY_PORT || 8787);
const APP_API_WRITE_ENABLED: boolean = process.env.APP_API_WRITE_ENABLED === '1';
const APP_API_PAYMENT_WRITE_ENABLED: boolean = process.env.APP_API_PAYMENT_WRITE_ENABLED === '1';
const APP_API_TENANT_WRITE_ENABLED: boolean = process.env.APP_API_TENANT_WRITE_ENABLED === '1';
const DEFAULT_PROJECTS = 'shanghai_park,beijing_park,shenzhen_park';
// 定时封账 / 清理调度涉及的园区（可用 SEAL_PROJECTS 覆盖）
const SEAL_PROJECTS: string[] = (process.env.SEAL_PROJECTS || DEFAULT_PROJECTS)
  .split(',').map((s) => s.trim()).filter(Boolean);
const COMPUTE_PREWARM_ENABLED: boolean = process.env.COMPUTE_PREWARM_ENABLED === '1';
const COMPUTE_PREWARM_PROJECTS: string[] = (process.env.COMPUTE_PREWARM_PROJECTS || process.env.SEAL_PROJECTS || DEFAULT_PROJECTS)
  .split(',').map((s) => s.trim()).filter(Boolean);
const COMPUTE_PREWARM_INTERVAL_MS = Math.max(60_000, Number(process.env.COMPUTE_PREWARM_INTERVAL_MS || 15 * 60_000));
const COMPUTE_PREWARM_STARTUP_DELAY_MS = Math.max(0, Number(process.env.COMPUTE_PREWARM_STARTUP_DELAY_MS || 15_000));

const WRITABLE_COLLECTIONS = new Set([
  'pb_buildings', 'pb_units', 'pb_tenants', 'pb_payments',
  'pb_invoices', 'pb_yearly_targets', 'pb_monthly_init_data',
  'pb_budget_assumptions', 'pb_budget_adjustments',
  'pb_budget_scenarios', 'pb_billing_period_notes',
]);

const pb = new PocketBase(PB_URL);
// 后端网关会并发刷新多个园区；共享 PocketBase 客户端不能使用浏览器式自动取消，
// 否则同类请求可能互相 cancel，导致 KPI/集成快照回写偶发失败。
pb.autoCancellation(false);

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

function clearComputeCachesAfterSuccessfulWrite(projectId: string, result: unknown): void {
  if ((result as { ok?: boolean })?.ok === false) return;
  clearComputeCaches(projectId);
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
    clearComputeCachesAfterSuccessfulWrite(projectId, result);
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
    clearComputeCachesAfterSuccessfulWrite(projectId, result);
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
    clearComputeCachesAfterSuccessfulWrite(projectId, result);
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
    clearComputeCachesAfterSuccessfulWrite(projectId, result);
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
    clearComputeCachesAfterSuccessfulWrite(projectId, result);
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
    clearComputeCachesAfterSuccessfulWrite(projectId, result);
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

const DASHBOARD_CUSTOM_FIELDS_PREFERENCE_KEY = 'dashboard_custom_fields_v1';

async function findUserPreference(userPb: PocketBase, userId: string, preferenceKey: string): Promise<any | null> {
  try {
    const rows = await userPb.collection('pb_user_preferences').getList(1, 1, {
      filter: `user_id="${escapeFilter(userId)}" && preference_key="${escapeFilter(preferenceKey)}"`,
      fields: 'id,payload,updated_at',
      requestKey: null,
    });
    return rows.items[0] || null;
  } catch (e: unknown) {
    const err = e as { status?: number };
    if (err?.status === 404) return null;
    throw e;
  }
}

async function handleAppDashboardCustomFieldsPreferenceGet(req: express.Request, res: express.Response) {
  try {
    const authCtx = await authenticateRequest(req, PB_URL);
    const row = await findUserPreference(
      authCtx.userPb,
      authCtx.user.id,
      DASHBOARD_CUSTOM_FIELDS_PREFERENCE_KEY,
    );
    if (!row) {
      res.json(envelope({
        ok: true,
        found: false,
        message: '尚未保存关注字段偏好',
      }));
      return;
    }
    const payload = (row.payload || {}) as Record<string, unknown>;
    const fieldIds = normalizeDashboardCustomFieldIds(payload.fieldIds || payload.field_ids);
    res.json(envelope({
      ok: true,
      found: true,
      field_ids: fieldIds,
      updated_at: row.updated_at || row.updated,
      message: '关注字段偏好读取成功',
    }));
  } catch (e) {
    sendAppError(res, e, '读取关注字段偏好失败');
  }
}

async function handleAppDashboardCustomFieldsPreferenceSave(req: express.Request, res: express.Response) {
  try {
    const authCtx = await authenticateRequest(req, PB_URL);
    const body = (req.body || {}) as Record<string, unknown>;
    const fieldIds = normalizeDashboardCustomFieldIds(body.field_ids || body.fieldIds);
    const now = new Date().toISOString();
    const record = {
      user_id: authCtx.user.id,
      preference_key: DASHBOARD_CUSTOM_FIELDS_PREFERENCE_KEY,
      payload: { fieldIds },
      updated_at: now,
    };
    const existing = await findUserPreference(
      authCtx.userPb,
      authCtx.user.id,
      DASHBOARD_CUSTOM_FIELDS_PREFERENCE_KEY,
    );
    if (existing?.id) {
      await authCtx.userPb.collection('pb_user_preferences').update(existing.id, record, { requestKey: null });
    } else {
      await authCtx.userPb.collection('pb_user_preferences').create(record, { requestKey: null });
    }
    res.json(envelope({
      ok: true,
      found: true,
      field_ids: fieldIds,
      updated_at: now,
      message: '关注字段偏好保存成功',
    }));
  } catch (e) {
    sendAppError(res, e, '保存关注字段偏好失败');
  }
}

async function bumpDashboardDataVersion(projectId: string): Promise<number | null> {
  const oid = 'dashboard_data_version';
  try {
    let current = 0;
    try {
      const versionRows = await pb.collection('pb_billing_period_notes').getList(1, 1, {
        filter: `project_id="${escapeFilter(projectId)}" && original_id="${oid}"`,
        fields: 'id,notes_json',
      });
      const row = versionRows.items[0] as any;
      current = Number(row?.notes_json?.version || 0);
    } catch { /* missing row falls back to 0 */ }
    const next = Math.max(0, Math.floor(Number.isFinite(current) ? current : 0)) + 1;
    const existing = await pb.collection('pb_billing_period_notes').getList(1, 1, {
      filter: `project_id="${escapeFilter(projectId)}" && original_id="${oid}"`,
      fields: 'id',
    });
    const record = {
      original_id: oid,
      notes_json: { version: next },
      project_id: projectId,
    };
    if (existing.items.length > 0) {
      await pb.collection('pb_billing_period_notes').update((existing.items[0] as any).id, record);
    } else {
      await pb.collection('pb_billing_period_notes').create(record);
    }
    return next;
  } catch (e: any) {
    console.warn('[gateway] dashboard_data_version 递增失败:', e?.message || e);
    return null;
  }
}

async function readDashboardDataVersion(projectId: string, _client: PocketBase = pb): Promise<number> {
  try {
    const version = await readComputeDataVersion(projectId);
    return version >= 0 ? version : 0;
  } catch {
    return 0;
  }
}

function affectedMetricsForCollection(collection: string): string[] {
  if (collection === 'pb_payments') return ['kpi', 'billing'];
  if (collection === 'pb_tenants') return ['kpi', 'tenants', 'billing', 'dashboard'];
  if (
    collection === 'pb_budget_scenarios' ||
    collection === 'pb_budget_assumptions' ||
    collection === 'pb_budget_adjustments' ||
    collection === 'pb_yearly_targets' ||
    collection === 'pb_monthly_init_data' ||
    collection === 'pb_billing_period_notes'
  ) {
    return ['kpi', 'dashboard'];
  }
  if (collection === 'pb_buildings' || collection === 'pb_units') return ['kpi', 'tenants', 'dashboard'];
  return [];
}

type RefreshStatus =
  | { refresh_status: 'success'; refreshed_at?: string; data_version?: number; debounced?: boolean }
  | { refresh_status: 'failed'; refresh_error: string; data_version?: number }
  | { refresh_status: 'skipped'; data_version?: number };

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
  initPocketBase(PB_URL);
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.warn('[integration-gateway] PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD not set, running without admin auth');
    return;
  }
  try {
    await pb.collection('_superusers').authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
  } catch (_) {
    try { await pb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD); } catch { /* non-fatal */ }
  }
  try {
    await authenticatePocketBase(ADMIN_EMAIL, ADMIN_PASSWORD);
  } catch (e: any) {
    console.warn('[integration-gateway] pocketbaseService admin auth failed:', e?.message || e);
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

function legacyOriginalId(collection: string, body: any, payload: Record<string, unknown>): string {
  if (collection === 'pb_yearly_targets') {
    const year = Number(payload.year ?? body.data?.year);
    if (!Number.isFinite(year)) throw new Error('缺少 year');
    return String(year);
  }
  if (collection === 'pb_monthly_init_data') {
    const year = Number(payload.year ?? body.data?.year);
    const month = Number(payload.month ?? body.data?.month);
    if (!Number.isFinite(year) || !Number.isFinite(month)) throw new Error('缺少 year / month');
    return `${year}_${month}`;
  }
  const originalId = String(body.original_id || payload.original_id || '').trim();
  if (!originalId) throw new Error('缺少 original_id');
  return originalId;
}

function legacyChangedFields(
  collection: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const fields = { ...payload };
  delete fields.id;
  delete fields.project_id;
  if (collection !== 'pb_yearly_targets' && collection !== 'pb_monthly_init_data') {
    delete fields.original_id;
  }
  if (collection === 'pb_yearly_targets') {
    delete fields.year;
  }
  if (collection === 'pb_monthly_init_data') {
    delete fields.year;
    delete fields.month;
  }
  return fields;
}

function legacyPayload(
  collection: string,
  op: 'create' | 'update' | 'delete',
  originalId: string,
  payload: Record<string, unknown>,
  baseUpdated = '',
): DirtyPayload {
  return {
    [collection]: {
      creates: op === 'create' ? [{ originalId, data: payload }] : [],
      updates: op === 'update' ? [{ originalId, changedFields: legacyChangedFields(collection, payload), baseUpdated }] : [],
      deletes: op === 'delete' ? [{ originalId, baseUpdated }] : [],
    },
  };
}

function assertLegacyIncrementalOk(result: SaveIncrementalResult): void {
  if (result.conflicts.length === 0 && result.errors.length === 0) return;
  const conflicts = result.conflicts.map((c) => `${c.collection}/${c.originalId}: 保存冲突`);
  const errors = result.errors.map((e) => `${e.collection}/${e.originalId}: ${e.message}`);
  throw new Error([...conflicts, ...errors].join('；') || result.message || '写入失败');
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
  const originalId = legacyOriginalId(collection, body, payload);
  const filter = buildOriginalIdFilter(collection, body, projectId);
  const existing = await pb.collection(collection).getList(1, 1, { filter, fields: 'id,updated' });
  const current = existing.items[0] as any;
  const baseUpdated = String(current?.updated || '');

  let incremental: SaveIncrementalResult;
  if (action === 'delete') {
    incremental = await saveIncrementalToPocketBase(
      legacyPayload(collection, 'delete', originalId, payload, baseUpdated),
      projectId,
      current ? { [collection]: { [originalId]: baseUpdated } } : undefined,
    );
    assertLegacyIncrementalOk(incremental);
    return { collection, action, id: current?.id || null, save_path: 'legacy_incremental', applied: incremental.applied };
  }
  if (action === 'create') {
    incremental = await saveIncrementalToPocketBase(
      legacyPayload(collection, 'create', originalId, payload),
      projectId,
    );
    assertLegacyIncrementalOk(incremental);
    const created = await pb.collection(collection).getList(1, 1, { filter, fields: 'id' });
    return { collection, action, id: (created.items[0] as any)?.id || null, save_path: 'legacy_incremental', applied: incremental.applied };
  }
  if (current) {
    incremental = await saveIncrementalToPocketBase(
      legacyPayload(collection, 'update', originalId, payload, baseUpdated),
      projectId,
      { [collection]: { [originalId]: baseUpdated } },
    );
    assertLegacyIncrementalOk(incremental);
    return { collection, action: 'update', id: current.id, save_path: 'legacy_incremental', applied: incremental.applied };
  }
  incremental = await saveIncrementalToPocketBase(
    legacyPayload(collection, 'create', originalId, payload),
    projectId,
  );
  assertLegacyIncrementalOk(incremental);
  const created = await pb.collection(collection).getList(1, 1, { filter, fields: 'id' });
  return { collection, action: 'create', id: (created.items[0] as any)?.id || null, save_path: 'legacy_incremental', applied: incremental.applied };
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
    res.json(scopeBillingResultForReceivableScopes(result, authCtx.receivableScopes || ['rent_receivable', 'mgmt_fee_receivable']));
  } catch (e: any) {
    console.error('[compute/billing] error:', e?.message || e);
    res.status(500).json({ ok: false, message: e?.message || '内部错误' });
  }
}

function scopeBillingResultForReceivableScopes<T extends {
  ok?: boolean;
  billingDetails: any[];
  totalDue: number;
  totalPaid: number;
  unpaidCount: number;
  financeSummary?: unknown;
}>(result: T, scopes: string[]): T {
  if (result.ok === false) return result;
  const rentOk = scopes.includes('rent_receivable');
  const mgmtOk = scopes.includes('mgmt_fee_receivable');
  if (rentOk && mgmtOk) return result;
  const billingDetails = result.billingDetails.filter((row: any) => {
    const feeKind = String(row?.feeKind || 'rent');
    if (feeKind === 'management_fee') return mgmtOk;
    return rentOk;
  });
  return {
    ...result,
    billingDetails,
    totalDue: Math.round(billingDetails.reduce((sum: number, row: any) => sum + Number(row?.amountDue || 0), 0) * 100) / 100,
    totalPaid: Math.round(billingDetails.reduce((sum: number, row: any) => sum + Number(row?.amountPaid || 0), 0) * 100) / 100,
    unpaidCount: billingDetails.filter((row: any) => ['Unpaid', 'Partial', 'Overdue'].includes(String(row?.status || ''))).length,
    financeSummary: undefined,
  };
}

async function handleAppComputeBilling(req: express.Request, res: express.Response) {
  try {
    const authCtx = await authenticateRequest(req, PB_URL);
    const projectId = resolveAuthorizedProjectId(authCtx.user, req.body?.project_id || req.query.project_id);
    const year = Number(req.body?.year || req.query.year);
    const month = Number(req.body?.month || req.query.month);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      res.status(400).json(envelope({ ok: false, message: '缺少 year / month (1-12)' }));
      return;
    }
    const result = await computeBilling(projectId, year, month - 1);
    const scoped = scopeBillingResultForReceivableScopes(
      result,
      authCtx.user.receivablePermissions || ['rent_receivable'],
    );
    res.status(scoped.ok === false ? 500 : 200).json(envelope({
      ...scoped,
      source: 'compute-engine',
      project_id: projectId,
      data_version: (scoped as any).dataVersion,
    } as Record<string, unknown>));
  } catch (e) {
    sendAppError(res, e, '应收明细计算失败');
  }
}

/** 重算 KPI 并回写到 pb_kpi_snapshots，使后续 GET /api/integration/kpi 直接命中 */

// per-project 防抖：5 秒内同一 project 的多次请求合并为一次
const REFRESH_DEBOUNCE_MS = 5000;
const _refreshJobs = new Map<string, Promise<any>>();

async function upsertIntegrationSnapshotFromDashboard(
  projectId: string,
  year: number,
  dashboard: Awaited<ReturnType<typeof computeDashboardData>>,
): Promise<void> {
  if (!dashboard.ok) {
    console.warn('[compute/refresh] 集成快照计算失败:', dashboard.message || 'unknown');
    return;
  }
  const snapshot = buildIntegrationFullSnapshotV1(
    dashboard.processedData,
    dashboard.fullYearMonthlyTrends,
    {
      statsYear: year,
      projectId,
      baselineData: dashboard.baselineData,
      recordMeta: dashboard.recordMeta,
      loadScope: dashboard.loadScope,
    },
  );
  const existing = await pb.collection('pb_integration_snapshots').getList(1, 1, {
    filter: `project_id="${escapeFilter(projectId)}" && snapshot_kind="${escapeFilter(INTEGRATION_FULL_SNAPSHOT_KIND)}"`,
    fields: 'id',
  });
  const row = {
    project_id: projectId,
    snapshot_kind: INTEGRATION_FULL_SNAPSHOT_KIND,
    payload: snapshot as unknown as Record<string, unknown>,
  };
  if (existing.items.length > 0) {
    await pb.collection('pb_integration_snapshots').update((existing.items[0] as any).id, row);
  } else {
    await pb.collection('pb_integration_snapshots').create(row);
  }
  console.log(`[compute/refresh] 已回写 pb_integration_snapshots project=${projectId} year=${year}`);
}

async function runComputeRefresh(projectId: string, year: number): Promise<Awaited<ReturnType<typeof computeKpi>> & { refreshed?: boolean; debounced?: boolean }> {
  const jobKey = `${projectId}:${year}`;
  const existing = _refreshJobs.get(jobKey);
  if (existing) {
    console.log(`[compute/refresh] ${jobKey} 合并到已有任务`);
    const result = await existing;
    return { ...result, refreshed: true, debounced: true };
  }

  const job = (async () => {
    console.log(`[compute/refresh] project=${projectId} year=${year}`);
    clearComputeCaches(projectId);
    const dashboard = await computeDashboardData(projectId, {
      year,
      quarter: 'All',
      quickMode: false,
      includeCurrentMonthBilling: false,
      includePrevYearTrends: false,
      loadScope: { kind: 'year', year },
    });
    const result = buildComputeKpiResultFromDashboardData(dashboard);
    if (!result.ok) return result;

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

    try {
      await upsertIntegrationSnapshotFromDashboard(projectId, year, dashboard);
    } catch (e: any) {
      console.warn('[compute/refresh] 回写 pb_integration_snapshots 失败:', e?.message || e);
    }

    return result;
  })();

  _refreshJobs.set(jobKey, job);
  setTimeout(() => { _refreshJobs.delete(jobKey); }, REFRESH_DEBOUNCE_MS);
  const result = await job;
  return { ...result, refreshed: true };
}

async function refreshAfterBusinessWrite(
  projectId: string,
  year: number,
  affectedMetrics: string[],
  dataVersion?: number | null,
): Promise<RefreshStatus> {
  if (!affectedMetrics.includes('kpi') && !affectedMetrics.includes('billing') && !affectedMetrics.includes('dashboard')) {
    return { refresh_status: 'skipped', data_version: dataVersion ?? undefined };
  }
  try {
    const refreshed = await runComputeRefresh(projectId, year);
    if (!refreshed.ok) {
      return {
        refresh_status: 'failed',
        refresh_error: refreshed.message || 'KPI 重算失败',
        data_version: dataVersion ?? undefined,
      };
    }
    return {
      refresh_status: 'success',
      refreshed_at: refreshed.computedAt,
      data_version: dataVersion ?? refreshed.dataVersion,
      debounced: refreshed.debounced,
    };
  } catch (e: any) {
    return {
      refresh_status: 'failed',
      refresh_error: e?.message || 'KPI 重算失败',
      data_version: dataVersion ?? undefined,
    };
  }
}

async function handleComputeRefresh(req: express.Request, res: express.Response) {
  const authCtx = await requireIntegrationAuth(req, res);
  if (!authCtx) return;
  try {
    const projectId = authCtx.projectId!;
    const year = Number(req.body?.year || new Date().getFullYear());
    const result = await runComputeRefresh(projectId, year);
    if (!result.ok) {
      res.status(500).json(result);
      return;
    }
    res.json(result);
  } catch (e: any) {
    console.error('[compute/refresh] error:', e?.message || e);
    res.status(500).json({ ok: false, message: e?.message || '内部错误' });
  }
}

type DraftComputeInput = {
  ok: true;
  data: DashboardData;
  source: 'draft-data' | 'draft-payload';
  baseVersion?: number | null;
  currentVersion?: number;
  payloadSummary?: ReturnType<typeof payloadCount>;
} | {
  ok: false;
  status: number;
  message: string;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function normalizeDirtyPayload(value: unknown): DirtyPayload | null {
  if (!isPlainRecord(value)) return null;
  const normalized: DirtyPayload = {};
  for (const [collection, bucketValue] of Object.entries(value)) {
    if (!isPlainRecord(bucketValue)) continue;
    const creates = Array.isArray(bucketValue.creates)
      ? bucketValue.creates
          .filter((item): item is Record<string, unknown> => isPlainRecord(item))
          .map((item) => ({
            originalId: String(item.originalId || ''),
            data: isPlainRecord(item.data) ? item.data : {},
          }))
          .filter((item) => item.originalId)
      : [];
    const updates = Array.isArray(bucketValue.updates)
      ? bucketValue.updates
          .filter((item): item is Record<string, unknown> => isPlainRecord(item))
          .map((item) => ({
            originalId: String(item.originalId || ''),
            changedFields: isPlainRecord(item.changedFields) ? item.changedFields : {},
            baseUpdated: String(item.baseUpdated || ''),
          }))
          .filter((item) => item.originalId)
      : [];
    const deletes = Array.isArray(bucketValue.deletes)
      ? bucketValue.deletes
          .filter((item): item is Record<string, unknown> => isPlainRecord(item))
          .map((item) => ({
            originalId: String(item.originalId || ''),
            baseUpdated: String(item.baseUpdated || ''),
          }))
          .filter((item) => item.originalId)
      : [];
    if (creates.length > 0 || updates.length > 0 || deletes.length > 0) {
      normalized[collection] = { creates, updates, deletes };
    }
  }
  return normalized;
}

async function resolveDraftComputeInput(
  projectId: string,
  body: Record<string, unknown>,
  year: number,
  user: AuthUser,
): Promise<DraftComputeInput> {
  const draftData = body.draft_data || body.draftData;
  if (isPlainRecord(draftData)) {
    return {
      ok: true,
      data: draftData as DashboardData,
      source: 'draft-data',
      baseVersion:
        typeof body.draft_base_version === 'number'
          ? body.draft_base_version
          : typeof body.draftBaseVersion === 'number'
            ? body.draftBaseVersion
            : null,
    };
  }

  const draftPayload = body.draft_payload || body.draftPayload;
  const payload = normalizeDirtyPayload(draftPayload);
  if (!payload) {
    return {
      ok: false,
      status: 400,
      message: '缺少 draft_data 或 draft_payload',
    };
  }

  const fetchRes = await fetchPocketBaseBackup(projectId, { year });
  if (!fetchRes.success || !fetchRes.data) {
    return {
      ok: false,
      status: 500,
      message: fetchRes.message || '加载草稿计算基线失败',
    };
  }

  const baselineData: DashboardData = { ...generateInitialData(), ...fetchRes.data };
  const filteredPayload = filterDirtyPayloadForRentMaskedUser(payload, user);
  const summary = payloadCount(filteredPayload);
  const baseVersionRaw = body.draft_base_version ?? body.draftBaseVersion;
  const baseVersion = Number.isFinite(Number(baseVersionRaw)) ? Number(baseVersionRaw) : null;
  return {
    ok: true,
    data: summary.total > 0
      ? applyDirtyPayloadToDashboardData(baselineData, filteredPayload)
      : baselineData,
    source: 'draft-payload',
    baseVersion,
    currentVersion: typeof baselineData.cloudSaveVersion === 'number' ? baselineData.cloudSaveVersion : undefined,
    payloadSummary: summary,
  };
}

async function handleAppComputeBillingDraft(req: express.Request, res: express.Response) {
  try {
    const authCtx = await authenticateRequest(req, PB_URL);
    const projectId = resolveAuthorizedProjectId(authCtx.user, req.body?.project_id || req.query.project_id);
    const year = Number(req.body?.year);
    const month = Number(req.body?.month) - 1;
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 0 || month > 11) {
      res.status(400).json(envelope({
        ok: false,
        project_id: projectId,
        message: '缺少 year / month (1-12)',
      }));
      return;
    }

    const draftInput = await resolveDraftComputeInput(projectId, req.body || {}, year, authCtx.user);
    if (!draftInput.ok) {
      res.status(draftInput.status).json(envelope({
        ok: false,
        project_id: projectId,
        message: draftInput.message,
      }));
      return;
    }

    const result = await computeBillingDraft(projectId, draftInput.data, year, month);
    res.status(result.ok === false ? 500 : 200).json(envelope({
      ...scopeBillingResultForReceivableScopes(result, authCtx.user.receivablePermissions || ['rent_receivable', 'mgmt_fee_receivable']),
      source: draftInput.source === 'draft-payload' ? 'draft-payload-compute-engine' : 'draft-compute-engine',
      draft_payload_summary: draftInput.payloadSummary,
      draft_base_version: draftInput.baseVersion,
      current_data_version: draftInput.currentVersion,
    }));
  } catch (e) {
    sendAppError(res, e, '草稿应收计算失败');
  }
}

async function handleAppBudgetedBillsPreview(req: express.Request, res: express.Response) {
  try {
    const authCtx = await authenticateRequest(req, PB_URL);
    const body = (req.body || {}) as Record<string, unknown>;
    const projectId = resolveAuthorizedProjectId(authCtx.user, body.project_id || req.query.project_id);
    const tenant = body.tenant;
    if (!tenant || typeof tenant !== 'object' || Array.isArray(tenant)) {
      res.status(400).json(envelope({
        ok: false,
        project_id: projectId,
        message: '缺少 tenant',
      }));
      return;
    }

    const startDate = body.start_date || body.startDate;
    const endDate = body.end_date || body.endDate;
    if (!startDate || !endDate) {
      res.status(400).json(envelope({
        ok: false,
        project_id: projectId,
        message: '缺少 start_date / end_date',
      }));
      return;
    }

    const result = await computeBudgetedBillsPreview(projectId, {
      tenant: tenant as Tenant,
      assumptions: Array.isArray(body.assumptions) ? body.assumptions as BudgetAssumption[] : [],
      adjustments: Array.isArray(body.adjustments) ? body.adjustments as BudgetAdjustment[] : [],
      startDate: startDate as string,
      endDate: endDate as string,
      options: body.options && typeof body.options === 'object' ? body.options as GenerateBudgetedBillsOptions : undefined,
    });
    res.json(envelope({
      ...result,
      project_id: projectId,
      source: 'budgeted-bills-preview-engine',
    }));
  } catch (e) {
    sendAppError(res, e, '账单预览计算失败');
  }
}

async function handleAppBudgetedBillsPreviewBatch(req: express.Request, res: express.Response) {
  try {
    const authCtx = await authenticateRequest(req, PB_URL);
    const body = (req.body || {}) as Record<string, unknown>;
    const projectId = resolveAuthorizedProjectId(authCtx.user, body.project_id || req.query.project_id);
    const items = body.items;
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json(envelope({
        ok: false,
        project_id: projectId,
        message: '缺少 items',
      }));
      return;
    }

    const result = await computeBudgetedBillsPreviewBatch(projectId, items.map((item, index) => {
      const raw = (item || {}) as Record<string, unknown>;
      return {
        id: String(raw.id || index),
        tenant: raw.tenant as Tenant,
        assumptions: Array.isArray(raw.assumptions) ? raw.assumptions as BudgetAssumption[] : [],
        adjustments: Array.isArray(raw.adjustments) ? raw.adjustments as BudgetAdjustment[] : [],
        startDate: (raw.start_date || raw.startDate) as string,
        endDate: (raw.end_date || raw.endDate) as string,
        options: raw.options && typeof raw.options === 'object' ? raw.options as GenerateBudgetedBillsOptions : undefined,
      };
    }));
    res.json(envelope({
      ...result,
      project_id: projectId,
      source: 'budgeted-bills-preview-batch-engine',
    }));
  } catch (e) {
    sendAppError(res, e, '批量账单预览计算失败');
  }
}

async function handleAppContractReceivableMonthly(req: express.Request, res: express.Response) {
  try {
    const authCtx = await authenticateRequest(req, PB_URL);
    const body = (req.body || {}) as Record<string, unknown>;
    const projectId = resolveAuthorizedProjectId(authCtx.user, body.project_id || req.query.project_id);
    const year = Math.floor(Number(body.year) || new Date().getFullYear());

    const result = await computeContractReceivableMonthly(projectId, {
      year,
      tenants: Array.isArray(body.tenants) ? body.tenants as Tenant[] : [],
      buildings: Array.isArray(body.buildings) ? body.buildings as Building[] : [],
      payments: Array.isArray(body.payments) ? body.payments as PaymentRecord[] : [],
      initializationData: Array.isArray(body.initialization_data)
        ? body.initialization_data as MonthlyInitData[]
        : Array.isArray(body.initializationData)
          ? body.initializationData as MonthlyInitData[]
          : [],
      budgetAssumptions: Array.isArray(body.budget_assumptions)
        ? body.budget_assumptions as BudgetAssumption[]
        : Array.isArray(body.budgetAssumptions)
          ? body.budgetAssumptions as BudgetAssumption[]
          : [],
      budgetAdjustments: Array.isArray(body.budget_adjustments)
        ? body.budget_adjustments as BudgetAdjustment[]
        : Array.isArray(body.budgetAdjustments)
          ? body.budgetAdjustments as BudgetAdjustment[]
          : [],
      budgetScenarios: Array.isArray(body.budget_scenarios)
        ? body.budget_scenarios as BudgetScenario[]
        : Array.isArray(body.budgetScenarios)
          ? body.budgetScenarios as BudgetScenario[]
          : [],
    });
    res.json(envelope({
      ...result,
      project_id: projectId,
      source: 'contract-receivable-monthly-engine',
    }));
  } catch (e) {
    sendAppError(res, e, '合同应收月度汇总失败');
  }
}

async function handleAppSourceAgentMetrics(req: express.Request, res: express.Response) {
  try {
    const authCtx = await authenticateRequest(req, PB_URL);
    const body = (req.body || {}) as Record<string, unknown>;
    const projectId = resolveAuthorizedProjectId(authCtx.user, body.project_id || req.query.project_id);
    const result = await computeSourceAgentMetricsPreview(projectId, {
      tenants: Array.isArray(body.tenants) ? body.tenants as Tenant[] : [],
      period: body.period as any,
      referenceDate: body.reference_date || body.referenceDate,
    });
    res.json(envelope({
      ...result,
      project_id: projectId,
      source: 'source-agent-metrics-engine',
    }));
  } catch (e) {
    sendAppError(res, e, '来源分析计算失败');
  }
}

async function handleAppContractAnalysisMetrics(req: express.Request, res: express.Response) {
  try {
    const authCtx = await authenticateRequest(req, PB_URL);
    const body = (req.body || {}) as Record<string, unknown>;
    const projectId = resolveAuthorizedProjectId(authCtx.user, body.project_id || req.query.project_id);
    const result = await computeContractAnalysisMetricsPreview(projectId, {
      tenants: Array.isArray(body.tenants) ? body.tenants as Tenant[] : [],
      period: body.period as any,
      referenceDate: body.reference_date || body.referenceDate,
    });
    res.json(envelope({
      ...result,
      project_id: projectId,
      source: 'contract-analysis-metrics-engine',
    }));
  } catch (e) {
    sendAppError(res, e, '合同分析计算失败');
  }
}

async function handleAppTenantHistoricalArrears(req: express.Request, res: express.Response) {
  try {
    const authCtx = await authenticateRequest(req, PB_URL);
    const body = (req.body || {}) as Record<string, unknown>;
    const projectId = resolveAuthorizedProjectId(authCtx.user, body.project_id || req.query.project_id);
    const result = await computeTenantHistoricalArrears(projectId, {
      referenceDate: body.reference_date || body.referenceDate || req.query.reference_date,
      receivablePermissions: normalizeReceivablePermissions(authCtx.user.receivablePermissions, authCtx.user.role),
    });
    res.status(result.ok === false ? 500 : 200).json(envelope({
      ...result,
      project_id: projectId,
      source: 'tenant-historical-arrears-engine',
      data_version: result.dataVersion,
      computed_at: result.computedAt,
      start_period: result.startPeriod,
      end_period: result.endPeriod,
      unavailable_reason: result.unavailableReason,
    }));
  } catch (e) {
    sendAppError(res, e, '客户历史欠费计算失败');
  }
}

async function handleAppComputeRefresh(req: express.Request, res: express.Response) {
  try {
    const authCtx = await authenticateRequest(req, PB_URL);
    const projectId = resolveAuthorizedProjectId(authCtx.user, req.body?.project_id || req.query.project_id);
    const year = Number(req.body?.year || req.query.year || new Date().getFullYear());
    const result = await runComputeRefresh(projectId, year);
    res.status(result.ok === false ? 500 : 200).json(envelope({
      ok: result.ok,
      project_id: projectId,
      year,
      data_version: result.dataVersion,
      refresh_status: result.ok ? 'success' : 'failed',
      refreshed_at: result.computedAt,
      message: result.message,
      debounced: result.debounced,
    }));
  } catch (e) {
    sendAppError(res, e, 'KPI 刷新失败');
  }
}

async function handleAppDashboardBootstrap(req: express.Request, res: express.Response) {
  const startedAt = Date.now();
  try {
    const authCtx = await authenticateRequest(req, PB_URL);
    const projectId = resolveAuthorizedProjectId(authCtx.user, req.body?.project_id || req.query.project_id);
    const year = Number(req.body?.year || req.query.year || new Date().getFullYear());
    const rawQuarter = String(req.body?.quarter || req.query.quarter || 'All');
    const quarter = (['All', 'Q1', 'Q2', 'Q3', 'Q4'].includes(rawQuarter) ? rawQuarter : 'All') as 'All' | 'Q1' | 'Q2' | 'Q3' | 'Q4';
    const includePrevYearTrends = !(
      req.body?.include_prev_year_trends === false ||
      req.body?.includePrevYearTrends === false ||
      req.query.include_prev_year_trends === '0'
    );
    // 园区授权已由 resolveAuthorizedProjectId 校验；快照读取用后端 admin client，
    // 避免用户态 PB rule 只允许 auth.project_id 时把其它已授权园区误判为 snapshot-miss。
    const snapshotClient = pb;
    const currentVersion = await readDashboardDataVersion(projectId, snapshotClient);

    const list = await snapshotClient.collection('pb_integration_snapshots').getList(1, 1, {
      filter: `project_id="${escapeFilter(projectId)}" && snapshot_kind="${escapeFilter(INTEGRATION_FULL_SNAPSHOT_KIND)}"`,
      fields: 'payload,updated',
    });
    const full = list.items[0] as any;
    const payload = full?.payload as any;
    const processedData = payload?.dashboard as DashboardData | undefined;

    if (!processedData) {
      console.info('[dashboard/bootstrap] snapshot miss', {
        projectId,
        year,
        currentVersion,
        elapsedMs: Date.now() - startedAt,
      });
      setImmediate(() => {
        runComputeRefresh(projectId, year).catch((e: any) => {
          console.warn('[dashboard/bootstrap] 后台刷新快照失败:', e?.message || e);
        });
      });
      res.status(202).json(envelope({
        ok: false,
        project_id: projectId,
        year,
        quarter,
        source: 'snapshot-miss',
        data_version: currentVersion,
        message: '暂无启动快照，已安排后台刷新',
      }));
      return;
    }

    const snapshotVersion = Number(payload.source_cloud_save_version ?? processedData.cloudSaveVersion ?? 0);
    const safeSnapshotVersion =
      Number.isFinite(snapshotVersion) && snapshotVersion >= 0 ? Math.floor(snapshotVersion) : 0;
    const stale = currentVersion > 0 && safeSnapshotVersion !== currentVersion;
    if (stale) {
      console.info('[dashboard/bootstrap] snapshot stale', {
        projectId,
        year,
        snapshotVersion: safeSnapshotVersion,
        currentVersion,
        elapsedMs: Date.now() - startedAt,
      });
      setImmediate(() => {
        runComputeRefresh(projectId, year).catch((e: any) => {
          console.warn('[dashboard/bootstrap] 过期快照后台刷新失败:', e?.message || e);
        });
      });
    }

    const baselineData = (payload.baseline_dashboard || payload.baselineData || payload.dashboard) as DashboardData;
    if (!stale) {
      console.info('[dashboard/bootstrap] snapshot hit', {
        projectId,
        year,
        snapshotVersion: safeSnapshotVersion,
        currentVersion,
        elapsedMs: Date.now() - startedAt,
      });
    }
    const responseProcessedData = includePrevYearTrends
      ? processedData
      : { ...processedData, prevYearMonthlyTrends: [] };
    const responseBaselineData = includePrevYearTrends
      ? baselineData
      : { ...baselineData, prevYearMonthlyTrends: [] };
    res.json(envelope({
      ok: true,
      project_id: projectId,
      year,
      quarter,
      load_scope: payload.load_scope || { kind: 'full' },
      source: stale ? 'snapshot-stale' : 'snapshot',
      stale,
      processed_data: applyDashboardDataScope(responseProcessedData, authCtx.user),
      baseline_data: applyDashboardDataScope(responseBaselineData, authCtx.user),
      record_meta: payload.record_meta || {},
      full_year_monthly_trends: payload.full_year_monthly_trends || [],
      data_version: safeSnapshotVersion,
      current_data_version: currentVersion,
      computed_at: payload.generated_at || full.updated,
      snapshot_generated_at: payload.generated_at || full.updated,
    }));
  } catch (e) {
    sendAppError(res, e, '启动快照加载失败');
  }
}

async function handleAppDashboardCompute(req: express.Request, res: express.Response) {
  try {
    const authCtx = await authenticateRequest(req, PB_URL);
    const projectId = resolveAuthorizedProjectId(authCtx.user, req.body?.project_id || req.query.project_id);
    const year = Number(req.body?.year || req.query.year || new Date().getFullYear());
    const rawQuarter = String(req.body?.quarter || req.query.quarter || 'All');
    const quarter = (['All', 'Q1', 'Q2', 'Q3', 'Q4'].includes(rawQuarter) ? rawQuarter : 'All') as 'All' | 'Q1' | 'Q2' | 'Q3' | 'Q4';
    const billingSelectedMonth = String(req.body?.billing_selected_month || req.body?.billingSelectedMonth || req.query.billing_selected_month || '').trim();
    const quickMode = req.body?.quick_mode === true || req.body?.quickMode === true || req.query.quick_mode === '1';
    const includeCurrentMonthBilling =
      req.body?.include_current_month_billing === true ||
      req.body?.includeCurrentMonthBilling === true ||
      req.query.include_current_month_billing === '1';
    const includePrevYearTrends = !(
      req.body?.include_prev_year_trends === false ||
      req.body?.includePrevYearTrends === false ||
      req.query.include_prev_year_trends === '0'
    );

    const result = await computeDashboardData(projectId, {
      year,
      quarter,
      billingSelectedMonth: billingSelectedMonth || undefined,
      quickMode,
      includeCurrentMonthBilling,
      includePrevYearTrends,
      loadScope: includePrevYearTrends ? { kind: 'full' } : undefined,
    });
    if (!result.ok) {
      res.status(500).json(envelope({
        ok: false,
        project_id: projectId,
        year,
        message: result.message || '看板计算失败',
      }));
      return;
    }

    res.json(envelope({
      ok: true,
      project_id: projectId,
      year,
      quarter,
      load_scope: result.loadScope,
      source: 'compute-engine',
      processed_data: applyDashboardDataScope(result.processedData, authCtx.user),
      baseline_data: applyDashboardDataScope(result.baselineData, authCtx.user),
      record_meta: result.recordMeta || {},
      full_year_monthly_trends: result.fullYearMonthlyTrends,
      data_version: result.dataVersion,
      computed_at: result.computedAt,
    }));
  } catch (e) {
    sendAppError(res, e, '看板计算失败');
  }
}

async function handleAppDashboardDraftCompute(req: express.Request, res: express.Response) {
  try {
    const authCtx = await authenticateRequest(req, PB_URL);
    const projectId = resolveAuthorizedProjectId(authCtx.user, req.body?.project_id || req.query.project_id);
    const year = Number(req.body?.year || req.query.year || new Date().getFullYear());
    const rawQuarter = String(req.body?.quarter || req.query.quarter || 'All');
    const quarter = (['All', 'Q1', 'Q2', 'Q3', 'Q4'].includes(rawQuarter) ? rawQuarter : 'All') as 'All' | 'Q1' | 'Q2' | 'Q3' | 'Q4';
    const billingSelectedMonth = String(req.body?.billing_selected_month || req.body?.billingSelectedMonth || req.query.billing_selected_month || '').trim();
    const quickMode = req.body?.quick_mode === true || req.body?.quickMode === true || req.query.quick_mode === '1';
    const includeCurrentMonthBilling =
      req.body?.include_current_month_billing === true ||
      req.body?.includeCurrentMonthBilling === true ||
      req.query.include_current_month_billing === '1';
    const includePrevYearTrends = !(
      req.body?.include_prev_year_trends === false ||
      req.body?.includePrevYearTrends === false ||
      req.query.include_prev_year_trends === '0'
    );

    const draftInput = await resolveDraftComputeInput(projectId, req.body || {}, year, authCtx.user);
    if (!draftInput.ok) {
      res.status(draftInput.status).json(envelope({
        ok: false,
        project_id: projectId,
        year,
        message: draftInput.message,
      }));
      return;
    }

    const result = await computeDashboardDraft(projectId, draftInput.data, {
      year,
      quarter,
      billingSelectedMonth: billingSelectedMonth || undefined,
      quickMode,
      includeCurrentMonthBilling,
      includePrevYearTrends,
    });
    if (!result.ok) {
      res.status(500).json(envelope({
        ok: false,
        project_id: projectId,
        year,
        message: result.message || '草稿看板计算失败',
      }));
      return;
    }

    res.json(envelope({
      ok: true,
      project_id: projectId,
      year,
      quarter,
      source: draftInput.source === 'draft-payload' ? 'draft-payload-compute-engine' : 'draft-compute-engine',
      processed_data: applyDashboardDataScope(result.processedData, authCtx.user),
      full_year_monthly_trends: result.fullYearMonthlyTrends,
      data_version: result.dataVersion,
      draft_payload_summary: draftInput.payloadSummary,
      draft_base_version: draftInput.baseVersion,
      current_data_version: draftInput.currentVersion,
      computed_at: result.computedAt,
    }));
  } catch (e) {
    sendAppError(res, e, '草稿看板计算失败');
  }
}

const parseParkIds = (raw: unknown): string[] => {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((x) => String(x || '').trim()).filter(Boolean))];
  }
  return [...new Set(
    String(raw || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )];
};

const mapParkRow = (row: any): ParkInfo => ({
  id: String(row.id || ''),
  projectId: String(row.project_id || '').trim(),
  name: String(row.name || row.project_id || '').trim(),
  city: String(row.city || '').trim(),
  enabled: row.enabled !== false,
  sortOrder: Number(row.sort_order || 0),
});

async function listAuthorizedAppParks(user: Awaited<ReturnType<typeof authenticateRequest>>['user'], requestedIds: string[]): Promise<ParkInfo[]> {
  const requested = new Set(requestedIds);
  const rows = await pb.collection('pb_parks').getFullList({
    filter: 'enabled = true',
    sort: 'sort_order,name',
  });
  return rows
    .map(mapParkRow)
    .filter((park) => park.projectId)
    .filter((park) => requested.size === 0 || requested.has(park.projectId))
    .filter((park) => canAccessProject(user, park.projectId));
}

async function handleAppBigScreen(req: express.Request, res: express.Response) {
  try {
    const authCtx = await authenticateRequest(req, PB_URL);
    const now = new Date();
    const year = Number(req.body?.year || req.query.year || now.getFullYear());
    const safeYear = Number.isFinite(year) ? Math.floor(year) : now.getFullYear();
    const billingMonth = String(
      req.body?.billing_month ||
      req.body?.billingMonth ||
      req.query.billing_month ||
      `${safeYear}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    ).trim();
    const requestedIds = parseParkIds(req.body?.park_ids || req.body?.parkIds || req.query.parks);
    const parks = await listAuthorizedAppParks(authCtx.user, requestedIds);

    const results = await Promise.all(parks.map(async (park) => {
      try {
        const dashboard = await computeDashboardData(park.projectId, {
          year: safeYear,
          quarter: 'All',
          billingSelectedMonth: billingMonth,
          quickMode: false,
          includeCurrentMonthBilling: true,
          loadScope: { kind: 'full' },
        });
        if (!dashboard.ok) {
          console.warn('[app/big-screen] 园区计算失败:', park.projectId, dashboard.message || 'unknown');
          return null;
        }
        return {
          park,
          rawData: dashboard.baselineData,
          processedData: dashboard.processedData,
        };
      } catch (e: any) {
        console.warn('[app/big-screen] 园区计算异常:', park.projectId, e?.message || e);
        return null;
      }
    }));

    const inputs = results.filter((item): item is NonNullable<typeof item> => item !== null);
    if (parks.length > 0 && inputs.length < parks.length) {
      res.status(503).json(envelope({
        ok: false,
        source: 'compute-engine',
        requested_park_count: parks.length,
        skipped_park_count: parks.length - inputs.length,
        message: '部分园区大屏数据计算失败，前端应回退到逐园区数据源',
      }));
      return;
    }

    const bigScreenData = buildBigScreenDataFromParkInputs(
      inputs,
      safeYear,
      billingMonth,
      new Date().toISOString(),
    );

    res.json(envelope({
      ok: true,
      source: 'compute-engine',
      requested_park_count: parks.length,
      skipped_park_count: parks.length - inputs.length,
      big_screen_data: bigScreenData,
    }));
  } catch (e) {
    sendAppError(res, e, '大屏数据计算失败');
  }
}

// ── 月度封账（D1）──
// 每月把上月应收/欠款定格成 pb_sealed_months 一行；看板/网关读历史月走快照、只实时算当月。
// arrears_increment 永远自洽；cumulative_arrears 为便利字段（prev + increment），
// 消费方应以「各月 increment 求和」为准（不依赖累计链的连续性）。

/** 读上一月已封账的累计欠款（缺失按 0） */
async function readPrevSealedCumulative(projectId: string, year: number, month: number /*1-12*/): Promise<number> {
  let py = year, pm = month - 1;
  if (pm < 1) { pm = 12; py -= 1; }
  try {
    const list = await pb.collection('pb_sealed_months').getList(1, 1, {
      filter: `project_id="${escapeFilter(projectId)}" && sealed_year=${py} && sealed_month=${pm}`,
    });
    const row = list.items[0] as any;
    return row ? Number(row.cumulative_arrears || 0) : 0;
  } catch { return 0; }
}

/** 计算并 upsert 一个 (project, year, monthIndex 0-11) 的封账行 */
async function sealProjectMonth(projectId: string, year: number, monthIndex: number): Promise<{ ok: boolean; message?: string; row?: Record<string, unknown> }> {
  const seal = await sealMonth(projectId, year, monthIndex);
  if (!seal.ok) return { ok: false, message: seal.message };
  const prevCumulative = await readPrevSealedCumulative(projectId, seal.year, seal.month);
  const cumulative = Math.round((prevCumulative + seal.arrearsIncrement) * 100) / 100;
  const record = {
    project_id: projectId,
    sealed_year: seal.year,
    sealed_month: seal.month,
    receivable_total: seal.receivableTotal,
    unpaid_sum: seal.unpaidSum,
    arrears_increment: seal.arrearsIncrement,
    cumulative_arrears: cumulative,
    details_json: seal.billingDetails,
    data_version: seal.dataVersion,
    sealed_at: seal.computedAt,
  };
  const existing = await pb.collection('pb_sealed_months').getList(1, 1, {
    filter: `project_id="${escapeFilter(projectId)}" && sealed_year=${seal.year} && sealed_month=${seal.month}`,
  });
  if (existing.items.length > 0) await pb.collection('pb_sealed_months').update((existing.items[0] as any).id, record);
  else await pb.collection('pb_sealed_months').create(record);
  clearComputeCaches(projectId);
  return { ok: true, row: record };
}

/** 手动封账端点：默认封「上月」，也可指定 { year, month(1-12) } 补算/重算 */
async function handleComputeSeal(req: express.Request, res: express.Response) {
  const authCtx = await requireIntegrationAuth(req, res);
  if (!authCtx) return;
  try {
    const projectId = authCtx.projectId!;
    let year = Number(req.body?.year);
    let month = Number(req.body?.month); // 1-12
    if (!year || !month) {
      const now = new Date();
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      year = prev.getFullYear();
      month = prev.getMonth() + 1;
    }
    const result = await sealProjectMonth(projectId, year, month - 1);
    if (!result.ok) { res.status(500).json({ ok: false, message: result.message }); return; }
    res.json({ ok: true, sealed: result.row });
  } catch (e: any) {
    console.error('[compute/seal] error:', e?.message || e);
    res.status(500).json({ ok: false, message: e?.message || '内部错误' });
  }
}

/** 封上月（所有园区），已封则跳过（幂等）。启动补算 + 每日检查共用。 */
async function sealPreviousMonthAllProjects(): Promise<void> {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = prev.getFullYear();
  const monthIndex = prev.getMonth();
  for (const projectId of SEAL_PROJECTS) {
    try {
      const existing = await pb.collection('pb_sealed_months').getList(1, 1, {
        filter: `project_id="${escapeFilter(projectId)}" && sealed_year=${year} && sealed_month=${monthIndex + 1}`,
      });
      if (existing.items.length > 0) continue;
      await sealProjectMonth(projectId, year, monthIndex);
      await runComputeRefresh(projectId, year);
      console.log(`[seal] sealed ${projectId} ${year}-${monthIndex + 1}`);
    } catch (e: any) {
      console.warn(`[seal] ${projectId} ${year}-${monthIndex + 1} failed:`, e?.message || e);
    }
  }
}

const DAILY_MS = 24 * 60 * 60 * 1000;

// ── 审计/快照增长治理（D3）──
// 只有 pb_integration_audit_logs 是「每写一条」无界增长（无唯一索引）；
// pb_integration_snapshots / pb_kpi_snapshots / pb_sealed_months 均有唯一索引、行数有界，无需清理。
const AUDIT_RETENTION_DAYS = Number(process.env.AUDIT_RETENTION_DAYS || 180);
async function runRetentionCleanup(): Promise<void> {
  const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * DAILY_MS);
  const cutoffStr = cutoff.toISOString().slice(0, 19).replace('T', ' '); // PB datetime 比较格式
  let deleted = 0;
  try {
    const probe = await pb.collection('pb_integration_audit_logs').getList(1, 1, {
      fields: 'id,created',
    });
    const sample = probe.items[0] as Record<string, unknown> | undefined;
    if (probe.totalItems > 0 && typeof sample?.created !== 'string') {
      console.log('[cleanup] 审计日志集合未暴露 created 字段，跳过保留期清理');
      return;
    }
    // 分批删除（每批 200，最多 50 批/次），避免一次拉取过多
    for (let batch = 0; batch < 50; batch++) {
      const list = await pb.collection('pb_integration_audit_logs').getList(1, 200, {
        filter: `created < "${cutoffStr}"`,
        fields: 'id',
        sort: 'created',
      });
      if (list.items.length === 0) break;
      for (const it of list.items) {
        try { await pb.collection('pb_integration_audit_logs').delete((it as any).id); deleted++; } catch { /* 跳过单行失败 */ }
      }
      if (list.items.length < 200) break;
    }
    if (deleted > 0) console.log(`[cleanup] 已清理 ${deleted} 条 ${AUDIT_RETENTION_DAYS} 天前的审计日志`);
  } catch (e: any) {
    console.warn('[cleanup] 审计日志清理失败:', e?.message || e);
  }
}

function startScheduledJobs(): void {
  // 启动补算（跨月时机错过也能追上）+ 每日检查
  sealPreviousMonthAllProjects().catch((e) => console.warn('[seal] startup catch-up failed:', e?.message || e));
  runRetentionCleanup().catch((e) => console.warn('[cleanup] startup failed:', e?.message || e));
  setInterval(() => {
    sealPreviousMonthAllProjects().catch((e) => console.warn('[seal] daily failed:', e?.message || e));
    runRetentionCleanup().catch((e) => console.warn('[cleanup] daily failed:', e?.message || e));
  }, DAILY_MS);
}

let computePrewarmRunning = false;

async function prewarmComputeCachesOnce(reason: string): Promise<void> {
  if (computePrewarmRunning) {
    console.log(`[compute/prewarm] skip overlapping run reason=${reason}`);
    return;
  }
  computePrewarmRunning = true;
  const startedAt = Date.now();
  const now = new Date();
  const year = now.getFullYear();
  const monthIndex = now.getMonth();
  const billingSelectedMonth = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  console.log(`[compute/prewarm] start reason=${reason} projects=${COMPUTE_PREWARM_PROJECTS.join(',')} period=${billingSelectedMonth}`);
  try {
    for (const projectId of COMPUTE_PREWARM_PROJECTS) {
      const projectStartedAt = Date.now();
      try {
        const dashboard = await computeDashboardData(projectId, {
          year,
          quarter: 'All',
          billingSelectedMonth,
          quickMode: false,
          includeCurrentMonthBilling: false,
          loadScope: { kind: 'full' },
        });
        const billing = await computeBilling(projectId, year, monthIndex);
        console.log('[compute/prewarm] project complete', {
          projectId,
          dashboardOk: dashboard.ok,
          billingOk: billing.ok,
          dataVersion: dashboard.dataVersion,
          elapsedMs: Date.now() - projectStartedAt,
        });
      } catch (e: any) {
        console.warn(`[compute/prewarm] project=${projectId} failed:`, e?.message || e);
      }
    }
  } finally {
    computePrewarmRunning = false;
    console.log('[compute/prewarm] complete', {
      reason,
      elapsedMs: Date.now() - startedAt,
    });
  }
}

function startComputePrewarmJobs(): void {
  setTimeout(() => {
    prewarmComputeCachesOnce('startup').catch((e) => console.warn('[compute/prewarm] startup failed:', e?.message || e));
  }, COMPUTE_PREWARM_STARTUP_DELAY_MS);
  setInterval(() => {
    prewarmComputeCachesOnce('interval').catch((e) => console.warn('[compute/prewarm] interval failed:', e?.message || e));
  }, COMPUTE_PREWARM_INTERVAL_MS);
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
  app.post('/api/v1/app/compute/billing', handleAppComputeBilling);
  app.post('/api/v1/app/compute/billing-draft', handleAppComputeBillingDraft);
  app.post('/api/v1/app/compute/budgeted-bills-preview', handleAppBudgetedBillsPreview);
  app.post('/api/v1/app/compute/budgeted-bills-preview-batch', handleAppBudgetedBillsPreviewBatch);
  app.post('/api/v1/app/compute/contract-receivable-monthly', handleAppContractReceivableMonthly);
  app.post('/api/v1/app/compute/source-agent-metrics', handleAppSourceAgentMetrics);
  app.post('/api/v1/app/compute/contract-analysis-metrics', handleAppContractAnalysisMetrics);
  app.post('/api/v1/app/compute/tenant-historical-arrears', handleAppTenantHistoricalArrears);
  app.post('/api/v1/app/compute/refresh', handleAppComputeRefresh);
  app.post('/api/v1/app/dashboard/bootstrap', handleAppDashboardBootstrap);
  app.post('/api/v1/app/dashboard/compute', handleAppDashboardCompute);
  app.post('/api/v1/app/dashboard/compute-draft', handleAppDashboardDraftCompute);
  app.post('/api/v1/app/big-screen', handleAppBigScreen);
  app.get('/api/v1/app/preferences/dashboard-custom-fields', handleAppDashboardCustomFieldsPreferenceGet);
  app.put('/api/v1/app/preferences/dashboard-custom-fields', handleAppDashboardCustomFieldsPreferenceSave);
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
  app.post('/api/integration/app/compute/billing', handleAppComputeBilling);
  app.post('/api/integration/app/compute/billing-draft', handleAppComputeBillingDraft);
  app.post('/api/integration/app/compute/budgeted-bills-preview', handleAppBudgetedBillsPreview);
  app.post('/api/integration/app/compute/budgeted-bills-preview-batch', handleAppBudgetedBillsPreviewBatch);
  app.post('/api/integration/app/compute/contract-receivable-monthly', handleAppContractReceivableMonthly);
  app.post('/api/integration/app/compute/source-agent-metrics', handleAppSourceAgentMetrics);
  app.post('/api/integration/app/compute/contract-analysis-metrics', handleAppContractAnalysisMetrics);
  app.post('/api/integration/app/compute/tenant-historical-arrears', handleAppTenantHistoricalArrears);
  app.post('/api/integration/app/compute/refresh', handleAppComputeRefresh);
  app.post('/api/integration/app/dashboard/bootstrap', handleAppDashboardBootstrap);
  app.post('/api/integration/app/dashboard/compute', handleAppDashboardCompute);
  app.post('/api/integration/app/dashboard/compute-draft', handleAppDashboardDraftCompute);
  app.post('/api/integration/app/big-screen', handleAppBigScreen);
  app.get('/api/integration/app/preferences/dashboard-custom-fields', handleAppDashboardCustomFieldsPreferenceGet);
  app.put('/api/integration/app/preferences/dashboard-custom-fields', handleAppDashboardCustomFieldsPreferenceSave);

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
  app.post('/api/integration/compute/seal', handleComputeSeal);

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
      const affectedHints = affectedMetricsForCollection(result.collection);
      const dataVersion = affectedHints.length
        ? await bumpDashboardDataVersion(source.projectId!)
        : null;
      if (affectedHints.length) clearComputeCaches(source.projectId!);
      const year = Number(req.body?.year || req.body?.data?.year || new Date().getFullYear());
      const refresh = await refreshAfterBusinessWrite(source.projectId!, year, affectedHints, dataVersion);

      res.json({
        success: true, project_id: source.projectId, result,
        affected_metrics: affectedHints.length ? affectedHints : undefined,
        data_version: refresh.data_version,
        refresh_status: refresh.refresh_status,
        refreshed_at: refresh.refresh_status === 'success' ? refresh.refreshed_at : undefined,
        refresh_error: refresh.refresh_status === 'failed' ? refresh.refresh_error : undefined,
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
    console.log(`  POST /api/integration/compute/seal     — 封账（默认上月，可指定 year/month）`);
    console.log(`  POST /api/integration/app/compute/source-agent-metrics — 用户态来源分析计算（不落库）`);
    console.log(`  POST /api/integration/app/compute/contract-analysis-metrics — 用户态合同分析计算（不落库）`);
    console.log(`  POST /api/integration/app/compute/tenant-historical-arrears — 用户态客户级历史欠费计算（不落库）`);
    // 定时任务（封账 + 审计清理）默认关闭：部署网关本身零行为变化；
    // 手动 /compute/seal 端点始终可用。确认要启用封账（写 pb_sealed_months、冻结已封月欠款）后，
    // 设 GATEWAY_SCHEDULER_ENABLED=1 再重启即可。
    if (process.env.GATEWAY_SCHEDULER_ENABLED === '1') {
      startScheduledJobs();
      console.log(`[integration-gateway] 定时任务已启动：封账(${SEAL_PROJECTS.join(',')}) + 审计清理(${AUDIT_RETENTION_DAYS}d)`);
    } else {
      console.log(`[integration-gateway] 定时任务未启用（GATEWAY_SCHEDULER_ENABLED=1 开启封账+审计清理）；手动 /compute/seal 仍可用`);
    }
    if (COMPUTE_PREWARM_ENABLED) {
      startComputePrewarmJobs();
      console.log(`[integration-gateway] 计算缓存预热已启动：projects=${COMPUTE_PREWARM_PROJECTS.join(',')} intervalMs=${COMPUTE_PREWARM_INTERVAL_MS}`);
    } else {
      console.log('[integration-gateway] 计算缓存预热未启用（COMPUTE_PREWARM_ENABLED=1 开启，不影响封账调度）');
    }
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
    console.log(`  POST /api/v1/app/compute/billing       — 用户态应收明细计算`);
    console.log(`  POST /api/v1/app/compute/billing-draft — 用户态草稿应收明细计算（不落库）`);
    console.log(`  POST /api/v1/app/compute/tenant-historical-arrears — 用户态客户级历史欠费计算（不落库）`);
    console.log(`  POST /api/v1/app/compute/refresh       — 用户态 KPI 刷新`);
    console.log(`  POST /api/v1/app/dashboard/compute-draft — 用户态草稿看板计算（不落库）`);
    console.log(`  /api/integration/app/*                 — 兼容 Caddy 现有 gateway 路由`);
    console.log(`[integration-gateway] App API write flags: global=${APP_API_WRITE_ENABLED} payment=${APP_API_PAYMENT_WRITE_ENABLED} tenant=${APP_API_TENANT_WRITE_ENABLED}`);
  });
}

main().catch((err) => {
  console.error('[integration-gateway] failed:', err?.data || err);
  process.exit(1);
});
