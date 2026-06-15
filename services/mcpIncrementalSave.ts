/**
 * MCP / Agent 写入 —— 与 App.tsx `runCloudSave` 相同增量保存路径。
 */
import type PocketBase from 'pocketbase';
import type { AuthUser, CloudConfig, DashboardData, PaymentRecord, Tenant } from '../types';
import { saveIncrementalToCloud, bumpCloudSaveVersion } from './cloudService';
import {
  dashboardDataToPbRecords,
  diffPbRecords,
  payloadCount,
} from './dataDiff';
import type { DirtyPayload } from './dataDiff';
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

/**
 * 定向保存：不拉全量、不 diff，直接构建 DirtyPayload 提交。
 * 用于单对象操作（一笔收款/一个租户），从 O(全量) 降为 O(1)。
 */
async function runDirectedSave(
  payload: DirtyPayload,
  ctx: McpSaveContext,
): Promise<{ ok: boolean; result: SaveIncrementalResult; message: string }> {
  const projectId = resolveAuthorizedProjectId(ctx.user, ctx.projectId);
  restorePocketBaseUserSession(
    ctx.pbUrl,
    ctx.userPb.authStore.token,
    ctx.userPb.authStore.model as Record<string, unknown> | null,
  );

  // 权限过滤
  let filteredPayload = filterDirtyPayloadForRentMaskedUser(payload, ctx.user);

  const summary = payloadCount(filteredPayload);
  if (summary.total === 0) {
    return {
      ok: true,
      result: { success: true, applied: [], conflicts: [], errors: [], message: '无改动' },
      message: '无改动，无需保存',
    };
  }

  const cloudConfig: CloudConfig = {
    provider: 'pocketbase',
    autoSync: false,
    projectId,
    pocketbaseUrl: ctx.pbUrl,
  };

  const res = await saveIncrementalToCloud(filteredPayload, cloudConfig, undefined);

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
    await bumpCloudSaveVersion(cloudConfig);
  } catch { /* 非关键 */ }

  const year = ctx.year || new Date().getFullYear();
  await triggerServerComputeRefresh(projectId, year);

  return { ok: true, result: res, message: res.message };
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

  const cloudConfig: CloudConfig = {
    provider: 'pocketbase',
    autoSync: false,
    projectId,
    pocketbaseUrl: ctx.pbUrl,
  };

  const res = await saveIncrementalToCloud(payload, cloudConfig, recordMeta);

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
    await bumpCloudSaveVersion(cloudConfig);
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

  restorePocketBaseUserSession(
    ctx.pbUrl,
    ctx.userPb.authStore.token,
    ctx.userPb.authStore.model as Record<string, unknown> | null,
  );

  // 定向查询：仅验证租户存在并获取名称，不拉全量
  let tenantName = params.tenant_name || '';
  if (!tenantName) {
    try {
      const tenantRows = await ctx.userPb.collection('pb_tenants').getList(1, 1, {
        filter: `project_id="${projectId}" && original_id="${params.tenant_id}"`,
        fields: 'name',
      });
      tenantName = tenantRows.items[0]?.name || '';
    } catch { /* 查不到也继续 */ }
  }

  const paymentId = String(
    params.original_id || `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  );

  const newPayment: Record<string, unknown> = {
    original_id: paymentId,
    tenant_id: params.tenant_id,
    tenant_name: tenantName,
    amount: params.amount,
    type: payType,
    date: params.date,
    status: params.status || 'Received',
    invoice_status: params.invoice_status || 'Pending',
    period: finalPeriod,
    remarks: params.remarks || '',
    project_id: projectId,
  };

  const payload: DirtyPayload = {
    pb_payments: {
      creates: [{ originalId: paymentId, data: newPayment }],
      updates: [],
      deletes: [],
    },
  };

  const save = await runDirectedSave(payload, { ...ctx, projectId });
  return {
    ok: save.ok,
    message: save.message,
    payment_id: paymentId,
    save_path: 'directed',
    applied: save.result.applied,
  };
}

function validatePaymentPatch(patch: Partial<PaymentRecord>): string | null {
  if (patch.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(patch.date))) {
    return 'date 格式应为 YYYY-MM-DD';
  }
  if (patch.period !== undefined && patch.period && !/^\d{4}-\d{2}(,\s*\d{4}-\d{2})*$/.test(String(patch.period))) {
    return 'period 格式应为 YYYY-MM，多个账期用英文逗号分隔';
  }
  if (patch.amount !== undefined && !Number.isFinite(Number(patch.amount))) {
    return 'amount 必须为有效数字';
  }
  return null;
}

export async function updatePaymentLikeFrontend(
  params: {
    original_id?: string;
    payment_id?: string;
    project_id?: string;
    patch: Partial<PaymentRecord>;
  },
  ctx: McpSaveContext,
) {
  const projectId = resolveAuthorizedProjectId(ctx.user, params.project_id);
  const paymentId = String(params.original_id || params.payment_id || '').trim();
  if (!paymentId) return { ok: false, message: '缺少 original_id / payment_id' };

  const validationMessage = validatePaymentPatch(params.patch);
  if (validationMessage) return { ok: false, message: validationMessage };

  restorePocketBaseUserSession(
    ctx.pbUrl,
    ctx.userPb.authStore.token,
    ctx.userPb.authStore.model as Record<string, unknown> | null,
  );

  // 定向查询：仅查目标收款，不拉全量
  const existing = await ctx.userPb.collection('pb_payments').getList(1, 1, {
    filter: `project_id="${projectId}" && original_id="${paymentId}"`,
  });
  if (existing.items.length === 0) {
    return { ok: false, message: `收款记录不存在：${paymentId}` };
  }
  const row = existing.items[0] as any;
  if (row.type) assertPaymentWriteAllowed(ctx.user, row.type);
  if (params.patch.type) assertPaymentWriteAllowed(ctx.user, params.patch.type);

  // 构建更新字段
  const changedFields: Record<string, unknown> = {};
  if (params.patch.amount !== undefined) changedFields.amount = Number(params.patch.amount);
  if (params.patch.date !== undefined) changedFields.date = params.patch.date;
  if (params.patch.period !== undefined) changedFields.period = params.patch.period;
  if (params.patch.status !== undefined) changedFields.status = params.patch.status;
  if (params.patch.invoiceStatus !== undefined) changedFields.invoice_status = params.patch.invoiceStatus;
  if (params.patch.remarks !== undefined) changedFields.remarks = params.patch.remarks;
  if (params.patch.type !== undefined) changedFields.type = params.patch.type;

  const payload: DirtyPayload = {
    pb_payments: {
      creates: [],
      updates: [{ originalId: paymentId, changedFields, baseUpdated: row.updated || '' }],
      deletes: [],
    },
  };

  const save = await runDirectedSave(payload, { ...ctx, projectId });
  return {
    ok: save.ok,
    message: save.message,
    payment_id: paymentId,
    save_path: 'directed',
    applied: save.result.applied,
  };
}

export async function deletePaymentLikeFrontend(
  params: {
    original_id?: string;
    payment_id?: string;
    project_id?: string;
  },
  ctx: McpSaveContext,
) {
  const projectId = resolveAuthorizedProjectId(ctx.user, params.project_id);
  const paymentId = String(params.original_id || params.payment_id || '').trim();
  if (!paymentId) return { ok: false, message: '缺少 original_id / payment_id' };

  restorePocketBaseUserSession(
    ctx.pbUrl,
    ctx.userPb.authStore.token,
    ctx.userPb.authStore.model as Record<string, unknown> | null,
  );

  // 定向查询：仅查目标收款是否存在并校验权限
  const existing = await ctx.userPb.collection('pb_payments').getList(1, 1, {
    filter: `project_id="${projectId}" && original_id="${paymentId}"`,
  });
  if (existing.items.length === 0) {
    return { ok: false, message: `收款记录不存在：${paymentId}` };
  }
  const row = existing.items[0] as any;
  if (row.type) assertPaymentWriteAllowed(ctx.user, row.type);

  const payload: DirtyPayload = {
    pb_payments: {
      creates: [],
      updates: [],
      deletes: [{ originalId: paymentId, baseUpdated: row.updated || '' }],
    },
  };

  const save = await runDirectedSave(payload, { ...ctx, projectId });
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

  const oid = String(params.original_id || params.data.original_id || params.data.id || '').trim();
  if (!oid) return { ok: false, message: '缺少 original_id / 租户 id' };

  // 定向查询：仅查目标租户是否存在
  const existing = await ctx.userPb.collection('pb_tenants').getList(1, 1, {
    filter: `project_id="${projectId}" && original_id="${oid}"`,
  });
  const isUpdate = existing.items.length > 0;

  // 构建 PB 行数据（与 dashboardDataToPbRecords 中 tenant 映射对齐）
  const d = params.data;
  const tenantData: Record<string, unknown> = {
    original_id: oid,
    project_id: projectId,
    name: d.name,
    building_id: d.buildingId || d.building_id,
    unit_ids: d.unitIds || d.unit_ids,
    total_area: d.totalArea,
    monthly_rent: d.monthlyRent,
    unit_price: d.unitPrice || d.unit_price,
    payment_cycle: d.paymentCycle || d.payment_cycle,
    lease_start: d.leaseStart || d.lease_start,
    lease_end: d.leaseEnd || d.lease_end,
    status: d.status,
    signing_date: d.signingDate || d.signing_date,
    deposit_status: d.depositStatus || d.deposit_status || 'Unpaid',
    type: d.type,
  };

  const payload: DirtyPayload = {
    pb_tenants: isUpdate
      ? { creates: [], updates: [{ originalId: oid, changedFields: tenantData, baseUpdated: (existing.items[0] as any).updated || '' }], deletes: [] }
      : { creates: [{ originalId: oid, data: tenantData }], updates: [], deletes: [] },
  };

  const save = await runDirectedSave(payload, { ...ctx, projectId });
  return {
    ok: save.ok,
    message: save.message,
    tenant_id: oid,
    save_path: 'directed',
    applied: save.result.applied,
  };
}

export async function archiveTenantLikeFrontend(
  params: {
    original_id?: string;
    tenant_id?: string;
    project_id?: string;
    termination_date?: string;
    termination_reason?: string;
  },
  ctx: McpSaveContext,
) {
  const projectId = resolveAuthorizedProjectId(ctx.user, params.project_id);
  const tenantId = String(params.original_id || params.tenant_id || '').trim();
  if (!tenantId) return { ok: false, message: '缺少 original_id / tenant_id' };
  assertPaymentWriteAllowed(ctx.user, 'Rent');

  restorePocketBaseUserSession(
    ctx.pbUrl,
    ctx.userPb.authStore.token,
    ctx.userPb.authStore.model as Record<string, unknown> | null,
  );

  // 定向查询：仅查目标租户
  const existing = await ctx.userPb.collection('pb_tenants').getList(1, 1, {
    filter: `project_id="${projectId}" && original_id="${tenantId}"`,
  });
  if (existing.items.length === 0) return { ok: false, message: `租户不存在：${tenantId}` };

  const changedFields: Record<string, unknown> = {
    status: 'Terminated',
    termination_date: params.termination_date || new Date().toISOString().slice(0, 10),
  };
  if (params.termination_reason) changedFields.termination_reason = params.termination_reason;

  const payload: DirtyPayload = {
    pb_tenants: {
      creates: [],
      updates: [{ originalId: tenantId, changedFields, baseUpdated: (existing.items[0] as any).updated || '' }],
      deletes: [],
    },
  };

  const save = await runDirectedSave(payload, { ...ctx, projectId });
  return {
    ok: save.ok,
    message: save.message,
    tenant_id: tenantId,
    save_path: 'directed',
    applied: save.result.applied,
  };
}

export async function deleteTenantLikeFrontend(
  params: {
    original_id?: string;
    tenant_id?: string;
    project_id?: string;
  },
  ctx: McpSaveContext,
) {
  const projectId = resolveAuthorizedProjectId(ctx.user, params.project_id);
  const tenantId = String(params.original_id || params.tenant_id || '').trim();
  if (!tenantId) return { ok: false, message: '缺少 original_id / tenant_id' };
  assertPaymentWriteAllowed(ctx.user, 'Rent');

  restorePocketBaseUserSession(
    ctx.pbUrl,
    ctx.userPb.authStore.token,
    ctx.userPb.authStore.model as Record<string, unknown> | null,
  );

  // 定向查询：仅查目标租户
  const existing = await ctx.userPb.collection('pb_tenants').getList(1, 1, {
    filter: `project_id="${projectId}" && original_id="${tenantId}"`,
  });
  if (existing.items.length === 0) return { ok: false, message: `租户不存在：${tenantId}` };

  const payload: DirtyPayload = {
    pb_tenants: {
      creates: [],
      updates: [],
      deletes: [{ originalId: tenantId, baseUpdated: (existing.items[0] as any).updated || '' }],
    },
  };

  const save = await runDirectedSave(payload, { ...ctx, projectId });
  return {
    ok: save.ok,
    message: save.message,
    tenant_id: tenantId,
    save_path: 'frontend_incremental',
    applied: save.result.applied,
  };
}
