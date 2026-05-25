/**
 * MCP / Agent 写入 —— 与 App.tsx `runCloudSave` 相同增量保存路径。
 */
import type PocketBase from 'pocketbase';
import type { AuthUser, DashboardData, PaymentRecord, Tenant } from '../types';
import { saveIncrementalToCloud, bumpCloudSaveVersion } from './cloudService';
import {
  dashboardDataToPbRecords,
  diffPbRecords,
  payloadCount,
} from './dataDiff';
import { generateInitialData } from './mockData';
import {
  fetchPocketBaseBackup,
  restorePocketBaseUserSession,
  type RecordMeta,
  type SaveIncrementalResult,
} from './pocketbaseService';
import {
  assertPaymentWriteAllowed,
  resolveAuthorizedProjectId,
} from '../scripts/paymentApiAuth.js';
import {
  filterDirtyPayloadForRentMaskedUser,
  preserveRentFieldsInTenantPbMap,
} from './tenantRentFieldGuard';

export interface McpSaveContext {
  user: AuthUser;
  userPb: PocketBase;
  pbUrl: string;
  projectId?: string;
  /** KPI 重算年份，默认当年 */
  year?: number;
}

export function buildMcpSaveContext(
  user: AuthUser,
  userPb: PocketBase,
  pbUrl: string,
  opts?: { projectId?: string; year?: number },
): McpSaveContext {
  return {
    user,
    userPb,
    pbUrl: pbUrl.replace(/\/$/, ''),
    projectId: opts?.projectId,
    year: opts?.year,
  };
}

function validateDataProjectConsistency(
  data: DashboardData,
  expectedProjectId: string,
): { consistent: boolean; mismatchCount: number } {
  const tenants = data.tenants || [];
  let mismatchCount = 0;
  for (const t of tenants) {
    if (t.projectId && t.projectId !== expectedProjectId) mismatchCount++;
  }
  return { consistent: mismatchCount === 0, mismatchCount };
}

function computeRefreshUrl(): string {
  const raw = String(
    process.env.INTEGRATION_COMPUTE_REFRESH_URL
      || process.env.VITE_INTEGRATION_GATEWAY_URL
      || '',
  ).trim();
  if (raw.includes('/api/integration/compute/refresh')) return raw;
  if (raw) return `${raw.replace(/\/$/, '')}/api/integration/compute/refresh`;
  return 'http://127.0.0.1:8787/api/integration/compute/refresh';
}

async function triggerServerComputeRefresh(projectId: string, year: number): Promise<void> {
  const token = String(
    process.env.INTEGRATION_INTERNAL_TOKEN || process.env.VITE_INTEGRATION_INTERNAL_TOKEN || '',
  ).trim();
  if (!token) return;
  try {
    await fetch(computeRefreshUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Integration-Internal-Token': token,
      },
      body: JSON.stringify({ project_id: projectId, year }),
    });
  } catch {
    /* 与前端一致：静默失败 */
  }
}

async function runIncrementalSaveFromDashboardData(
  currentData: DashboardData,
  ctx: McpSaveContext,
): Promise<{ ok: boolean; result: SaveIncrementalResult; message: string }> {
  const projectId = resolveAuthorizedProjectId(ctx.user, ctx.projectId);
  restorePocketBaseUserSession(
    ctx.pbUrl,
    ctx.userPb.authStore.token,
    ctx.userPb.authStore.model as Record<string, unknown> | null,
  );

  const backupRes = await fetchPocketBaseBackup(projectId);
  if (!backupRes.success || !backupRes.data) {
    return {
      ok: false,
      result: { success: false, applied: [], conflicts: [], errors: [], message: backupRes.message },
      message: backupRes.message || '无法读取云端基线',
    };
  }

  const baselineData = { ...generateInitialData(), ...backupRes.data };
  const baseline = dashboardDataToPbRecords(baselineData, projectId);
  const recordMeta: RecordMeta = backupRes.recordMeta || {};

  const nextSnapshot = dashboardDataToPbRecords(currentData, projectId);
  const scopedSnapshot = preserveRentFieldsInTenantPbMap(nextSnapshot, baseline, ctx.user);
  let payload = diffPbRecords(baseline, scopedSnapshot, recordMeta);
  payload = filterDirtyPayloadForRentMaskedUser(payload, ctx.user);

  const summary = payloadCount(payload);
  if (summary.total === 0) {
    return {
      ok: true,
      result: { success: true, applied: [], conflicts: [], errors: [], message: '无改动' },
      message: '无改动，无需保存',
    };
  }

  const consistency = validateDataProjectConsistency(currentData, projectId);
  if (!consistency.consistent) {
    return {
      ok: false,
      result: { success: false, applied: [], conflicts: [], errors: [], message: '跨园区数据' },
      message: `数据一致性校验失败：${consistency.mismatchCount} 条租户不属于 ${projectId}`,
    };
  }

  const res = await saveIncrementalToCloud(payload, { projectId, pocketbaseUrl: ctx.pbUrl }, recordMeta);

  if (res.conflicts.length > 0) {
    return {
      ok: false,
      result: res,
      message: `保存冲突 ${res.conflicts.length} 条，请在前端冲突对话框处理或使用最新数据重试`,
    };
  }
  if (res.errors.length > 0) {
    return {
      ok: false,
      result: res,
      message: res.errors.map((e) => `${e.collection}/${e.originalId}: ${e.message}`).join('；'),
    };
  }

  try {
    await bumpCloudSaveVersion({ projectId, pocketbaseUrl: ctx.pbUrl });
  } catch {
    /* 非关键 */
  }

  const year = ctx.year || new Date().getFullYear();
  await triggerServerComputeRefresh(projectId, year);

  return { ok: true, result: res, message: '保存成功（增量路径，与看板一致）' };
}

export async function savePaymentLikeFrontend(
  params: {
    tenant_id: string;
    amount: number;
    date: string;
    type?: string;
    period?: string;
    status?: PaymentRecord['status'];
    invoice_status?: PaymentRecord['invoiceStatus'];
    remarks?: string;
    tenant_name?: string;
    original_id?: string;
    project_id?: string;
  },
  ctx: McpSaveContext,
) {
  const projectId = resolveAuthorizedProjectId(ctx.user, params.project_id);
  const payType = (params.type || 'Rent') as PaymentRecord['type'];
  assertPaymentWriteAllowed(ctx.user, payType);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
    return { ok: false, message: 'date 格式应为 YYYY-MM-DD' };
  }
  const finalPeriod = params.period || params.date.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(finalPeriod)) {
    return { ok: false, message: 'period 格式应为 YYYY-MM' };
  }

  const backupRes = await (async () => {
    restorePocketBaseUserSession(
      ctx.pbUrl,
      ctx.userPb.authStore.token,
      ctx.userPb.authStore.model as Record<string, unknown> | null,
    );
    return fetchPocketBaseBackup(projectId);
  })();

  if (!backupRes.success || !backupRes.data) {
    return { ok: false, message: backupRes.message || '无法加载云端数据' };
  }

  const data: DashboardData = { ...generateInitialData(), ...backupRes.data };
  const tenant = data.tenants?.find((t) => t.id === params.tenant_id);
  const tenantName = params.tenant_name || tenant?.name || '';

  const paymentId = String(
    params.original_id || `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  );

  const newPayment: PaymentRecord = {
    id: paymentId,
    tenantId: params.tenant_id,
    tenantName,
    amount: params.amount,
    type: payType,
    date: params.date,
    status: params.status || 'Received',
    invoiceStatus: params.invoice_status || 'Pending',
    period: finalPeriod,
    remarks: params.remarks || '',
  };

  data.payments = [...(data.payments || []), newPayment];

  const save = await runIncrementalSaveFromDashboardData(data, { ...ctx, projectId });
  return {
    ok: save.ok,
    message: save.message,
    payment_id: paymentId,
    save_path: 'frontend_incremental',
    applied: save.result.applied,
  };
}

export async function saveTenantLikeFrontend(
  params: {
    original_id?: string;
    mode?: 'create' | 'update';
    data: Record<string, unknown>;
    project_id?: string;
  },
  ctx: McpSaveContext,
) {
  const projectId = resolveAuthorizedProjectId(ctx.user, params.project_id);
  restorePocketBaseUserSession(
    ctx.pbUrl,
    ctx.userPb.authStore.token,
    ctx.userPb.authStore.model as Record<string, unknown> | null,
  );
  const backupRes = await fetchPocketBaseBackup(projectId);
  if (!backupRes.success || !backupRes.data) {
    return { ok: false, message: backupRes.message || '无法加载云端数据' };
  }

  const dashboard: DashboardData = { ...generateInitialData(), ...backupRes.data };
  const oid = String(params.original_id || params.data.original_id || params.data.id || '').trim();
  if (!oid) return { ok: false, message: '缺少 original_id / 租户 id' };

  const patch = params.data as Partial<Tenant>;
  const existingIdx = (dashboard.tenants || []).findIndex((t) => t.id === oid);

  const tenantRow: Tenant = {
    ...(existingIdx >= 0 ? dashboard.tenants![existingIdx] : ({} as Tenant)),
    ...patch,
    id: oid,
    projectId,
  } as Tenant;

  if (existingIdx >= 0) {
    dashboard.tenants![existingIdx] = tenantRow;
  } else {
    dashboard.tenants = [...(dashboard.tenants || []), tenantRow];
  }

  const save = await runIncrementalSaveFromDashboardData(dashboard, { ...ctx, projectId });
  return {
    ok: save.ok,
    message: save.message,
    tenant_id: oid,
    save_path: 'frontend_incremental',
    applied: save.result.applied,
  };
}
