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
import type { DirtyPayload } from './dirtyTracker';
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

export type SaveRefreshStatus =
  | { refresh_status: 'success'; refreshed_at?: string; data_version?: number; debounced?: boolean }
  | { refresh_status: 'failed'; refresh_error: string; data_version?: number }
  | { refresh_status: 'skipped'; data_version?: number };

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

export function affectedMetricsFromDirtyPayload(payload: DirtyPayload): string[] {
  const affected = new Set<string>();
  const add = (items: string[]) => items.forEach((x) => affected.add(x));
  if (payload.pb_payments) add(['kpi', 'billing']);
  if (payload.pb_tenants) add(['kpi', 'tenants', 'billing', 'dashboard']);
  if (payload.pb_buildings || payload.pb_units) add(['kpi', 'tenants', 'dashboard']);
  if (
    payload.pb_budget_scenarios ||
    payload.pb_budget_assumptions ||
    payload.pb_budget_adjustments ||
    payload.pb_yearly_targets ||
    payload.pb_monthly_init_data ||
    payload.pb_billing_period_notes
  ) {
    add(['kpi', 'dashboard']);
  }
  return [...affected];
}

async function triggerServerComputeRefresh(projectId: string, year: number, dataVersion?: number | null): Promise<SaveRefreshStatus> {
  const token = String(
    process.env.INTEGRATION_INTERNAL_TOKEN || '',
  ).trim();
  if (!token) return { refresh_status: 'skipped', data_version: dataVersion ?? undefined };
  try {
    const res = await fetch(computeRefreshUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Integration-Internal-Token': token,
      },
      body: JSON.stringify({ project_id: projectId, year }),
    });
    const body = await res.json().catch(() => null) as
      | { ok?: boolean; dataVersion?: number; computedAt?: string; debounced?: boolean; message?: string }
      | null;
    if (!res.ok || body?.ok === false) {
      return {
        refresh_status: 'failed',
        refresh_error: body?.message || `compute/refresh HTTP ${res.status}`,
        data_version: dataVersion ?? body?.dataVersion,
      };
    }
    return {
      refresh_status: 'success',
      refreshed_at: body?.computedAt,
      data_version: dataVersion ?? body?.dataVersion,
      debounced: body?.debounced,
    };
  } catch {
    return { refresh_status: 'failed', refresh_error: 'compute/refresh 请求失败', data_version: dataVersion ?? undefined };
  }
}

/**
 * 定向保存：不拉全量、不 diff，直接构建 DirtyPayload 提交。
 * 用于单对象操作（一笔收款/一个租户），从 O(全量) 降为 O(1)。
 */
async function runDirectedSave(
  payload: DirtyPayload,
  ctx: McpSaveContext,
): Promise<{ ok: boolean; result: SaveIncrementalResult; message: string; dataVersion?: number; refresh: SaveRefreshStatus; affectedMetrics: string[] }> {
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
      refresh: { refresh_status: 'skipped' },
      affectedMetrics: [],
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
      refresh: { refresh_status: 'skipped' },
      affectedMetrics: affectedMetricsFromDirtyPayload(filteredPayload),
    };
  }
  if (res.errors.length > 0) {
    return {
      ok: false,
      result: res,
      message: res.errors.map((e) => `${e.collection}/${e.originalId}: ${e.message}`).join('；'),
      refresh: { refresh_status: 'skipped' },
      affectedMetrics: affectedMetricsFromDirtyPayload(filteredPayload),
    };
  }

  let dataVersion: number | null = null;
  try {
    dataVersion = await bumpCloudSaveVersion(cloudConfig);
  } catch { /* 非关键 */ }

  const year = ctx.year || new Date().getFullYear();
  const affectedMetrics = affectedMetricsFromDirtyPayload(filteredPayload);
  const refresh = await triggerServerComputeRefresh(projectId, year, dataVersion);

  return { ok: true, result: res, message: res.message, dataVersion: dataVersion ?? undefined, refresh, affectedMetrics };
}

async function runIncrementalSaveFromDashboardData(
  currentData: DashboardData,
  ctx: McpSaveContext,
): Promise<{ ok: boolean; result: SaveIncrementalResult; message: string; dataVersion?: number; refresh: SaveRefreshStatus; affectedMetrics: string[] }> {
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
      refresh: { refresh_status: 'skipped' },
      affectedMetrics: [],
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
      refresh: { refresh_status: 'skipped' },
      affectedMetrics: [],
    };
  }

  const consistency = validateDataProjectConsistency(currentData, projectId);
  if (!consistency.consistent) {
    return {
      ok: false,
      result: { success: false, applied: [], conflicts: [], errors: [], message: '跨园区数据' },
      message: `数据一致性校验失败：${consistency.mismatchCount} 条租户不属于 ${projectId}`,
      refresh: { refresh_status: 'skipped' },
      affectedMetrics: [],
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
      refresh: { refresh_status: 'skipped' },
      affectedMetrics: affectedMetricsFromDirtyPayload(payload),
    };
  }
  if (res.errors.length > 0) {
    return {
      ok: false,
      result: res,
      message: res.errors.map((e) => `${e.collection}/${e.originalId}: ${e.message}`).join('；'),
      refresh: { refresh_status: 'skipped' },
      affectedMetrics: affectedMetricsFromDirtyPayload(payload),
    };
  }

  let dataVersion: number | null = null;
  try {
    dataVersion = await bumpCloudSaveVersion(cloudConfig);
  } catch {
    /* 非关键 */
  }

  const year = ctx.year || new Date().getFullYear();
  const affectedMetrics = affectedMetricsFromDirtyPayload(payload);
  const refresh = await triggerServerComputeRefresh(projectId, year, dataVersion);

  return {
    ok: true,
    result: res,
    message: '保存成功（增量路径，与看板一致）',
    dataVersion: dataVersion ?? undefined,
    refresh,
    affectedMetrics,
  };
}

function saveResponseMeta(save: {
  dataVersion?: number;
  refresh: SaveRefreshStatus;
  affectedMetrics: string[];
}) {
  return {
    data_version: save.refresh.data_version ?? save.dataVersion,
    affected_metrics: save.affectedMetrics,
    refresh_status: save.refresh.refresh_status,
    refreshed_at: save.refresh.refresh_status === 'success' ? save.refresh.refreshed_at : undefined,
    refresh_error: save.refresh.refresh_status === 'failed' ? save.refresh.refresh_error : undefined,
  };
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
    ...saveResponseMeta(save),
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
    ...saveResponseMeta(save),
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
    ...saveResponseMeta(save),
  };
}

function hasOwnField(data: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, key);
}

function readTenantField(
  data: Record<string, unknown>,
  camelKey: string,
  snakeKey: string = camelKey,
): unknown {
  if (hasOwnField(data, camelKey)) return data[camelKey];
  if (snakeKey !== camelKey && hasOwnField(data, snakeKey)) return data[snakeKey];
  return undefined;
}

function setTenantField(
  row: Record<string, unknown>,
  field: string,
  data: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
  options: { applyDefaults: boolean; defaultValue?: unknown | (() => unknown) },
): void {
  const value = readTenantField(data, camelKey, snakeKey);
  if (value !== undefined) {
    row[field] = value;
    return;
  }
  if (!options.applyDefaults) return;
  row[field] = typeof options.defaultValue === 'function'
    ? (options.defaultValue as () => unknown)()
    : options.defaultValue;
}

export function mapTenantAppDataToPbTenantRow(
  data: Record<string, unknown>,
  originalId: string,
  projectId: string,
  options: { applyDefaults?: boolean } = {},
): Record<string, unknown> {
  const applyDefaults = options.applyDefaults === true;
  const row: Record<string, unknown> = {
    original_id: originalId,
    project_id: projectId,
  };

  setTenantField(row, 'root_id', data, 'rootId', 'root_id', { applyDefaults, defaultValue: '' });
  setTenantField(row, 'name', data, 'name', 'name', { applyDefaults, defaultValue: '' });
  setTenantField(row, 'source_agent_name', data, 'sourceAgentName', 'source_agent_name', { applyDefaults, defaultValue: '' });
  setTenantField(row, 'contact_info', data, 'contactInfo', 'contact_info', { applyDefaults, defaultValue: '' });
  setTenantField(row, 'industry', data, 'industry', 'industry', { applyDefaults, defaultValue: '' });
  setTenantField(row, 'founding_date', data, 'foundingDate', 'founding_date', { applyDefaults, defaultValue: '' });
  setTenantField(row, 'legal_rep_name', data, 'legalRepName', 'legal_rep_name', { applyDefaults, defaultValue: '' });
  setTenantField(row, 'legal_rep_birthday', data, 'legalRepBirthday', 'legal_rep_birthday', { applyDefaults, defaultValue: '' });
  setTenantField(row, 'contact_name', data, 'contactName', 'contact_name', { applyDefaults, defaultValue: '' });
  setTenantField(row, 'contact_birthday', data, 'contactBirthday', 'contact_birthday', { applyDefaults, defaultValue: '' });
  setTenantField(row, 'building_id', data, 'buildingId', 'building_id', { applyDefaults, defaultValue: '' });
  setTenantField(row, 'unit_ids', data, 'unitIds', 'unit_ids', { applyDefaults, defaultValue: () => [] });
  setTenantField(row, 'total_area', data, 'totalArea', 'total_area', { applyDefaults, defaultValue: 0 });
  setTenantField(row, 'signing_date', data, 'signingDate', 'signing_date', { applyDefaults, defaultValue: '' });
  setTenantField(row, 'lease_start', data, 'leaseStart', 'lease_start', { applyDefaults, defaultValue: '' });
  setTenantField(row, 'lease_end', data, 'leaseEnd', 'lease_end', { applyDefaults, defaultValue: '' });
  setTenantField(row, 'move_in_date', data, 'moveInDate', 'move_in_date', { applyDefaults, defaultValue: '' });
  setTenantField(row, 'unit_price', data, 'unitPrice', 'unit_price', { applyDefaults, defaultValue: 0 });
  setTenantField(row, 'unit_price_mode', data, 'unitPriceMode', 'unit_price_mode', { applyDefaults, defaultValue: 'daily' });
  setTenantField(row, 'monthly_rent', data, 'monthlyRent', 'monthly_rent', { applyDefaults, defaultValue: 0 });
  setTenantField(row, 'rent_free_periods', data, 'rentFreePeriods', 'rent_free_periods', { applyDefaults, defaultValue: () => [] });
  setTenantField(row, 'rent_reductions', data, 'rentReductions', 'rent_reductions', { applyDefaults, defaultValue: () => [] });
  setTenantField(row, 'payment_cycle', data, 'paymentCycle', 'payment_cycle', { applyDefaults, defaultValue: 'Monthly' });

  const unitTerms = readTenantField(data, 'unitTerms', 'payment_terms');
  if (unitTerms !== undefined) {
    row.payment_terms = unitTerms;
  } else {
    setTenantField(row, 'payment_terms', data, 'paymentTerms', 'payment_terms', { applyDefaults, defaultValue: () => [] });
  }

  setTenantField(row, 'payment_cycle_months', data, 'paymentCycleMonths', 'payment_cycle_months', { applyDefaults, defaultValue: null });
  setTenantField(row, 'first_payment_date', data, 'firstPaymentDate', 'first_payment_date', { applyDefaults, defaultValue: '' });
  setTenantField(row, 'first_payment_months', data, 'firstPaymentMonths', 'first_payment_months', { applyDefaults, defaultValue: null });
  setTenantField(row, 'first_receivable_amount', data, 'firstReceivableAmount', 'first_receivable_amount', { applyDefaults, defaultValue: null });
  setTenantField(row, 'first_receivable_start_date', data, 'firstReceivableStartDate', 'first_receivable_start_date', { applyDefaults, defaultValue: '' });
  setTenantField(row, 'first_receivable_end_date', data, 'firstReceivableEndDate', 'first_receivable_end_date', { applyDefaults, defaultValue: '' });
  setTenantField(row, 'free_rent_handling', data, 'freeRentHandling', 'free_rent_handling', { applyDefaults, defaultValue: null });
  setTenantField(row, 'deposit_amount', data, 'depositAmount', 'deposit_amount', { applyDefaults, defaultValue: 0 });
  setTenantField(row, 'deposit_status', data, 'depositStatus', 'deposit_status', { applyDefaults, defaultValue: 'Unpaid' });
  setTenantField(row, 'status', data, 'status', 'status', { applyDefaults, defaultValue: 'Active' });
  setTenantField(row, 'termination_date', data, 'terminationDate', 'termination_date', { applyDefaults, defaultValue: '' });
  setTenantField(row, 'termination_type', data, 'terminationType', 'termination_type', { applyDefaults, defaultValue: null });
  setTenantField(row, 'termination_reason', data, 'terminationReason', 'termination_reason', { applyDefaults, defaultValue: '' });
  setTenantField(row, 'parent_contract_id', data, 'parentContractId', 'parent_contract_id', { applyDefaults, defaultValue: '' });
  setTenantField(row, 'early_termination_fr_clawback_override', data, 'earlyTerminationFreeRentClawbackOverride', 'early_termination_fr_clawback_override', { applyDefaults, defaultValue: null });
  setTenantField(row, 'early_termination_deposit_deduction', data, 'earlyTerminationDepositDeduction', 'early_termination_deposit_deduction', { applyDefaults, defaultValue: null });
  setTenantField(row, 'early_termination_other_adjustment', data, 'earlyTerminationOtherAdjustment', 'early_termination_other_adjustment', { applyDefaults, defaultValue: null });
  setTenantField(row, 'special_requirements', data, 'specialRequirements', 'special_requirements', { applyDefaults, defaultValue: '' });
  setTenantField(row, 'is_risk', data, 'isRisk', 'is_risk', { applyDefaults, defaultValue: false });
  setTenantField(row, 'is_special_business', data, 'isSpecialBusiness', 'is_special_business', { applyDefaults, defaultValue: false });
  setTenantField(row, 'contract_parking_spaces', data, 'contractParkingSpaces', 'contract_parking_spaces', { applyDefaults, defaultValue: 0 });
  setTenantField(row, 'actual_parking_spaces', data, 'actualParkingSpaces', 'actual_parking_spaces', { applyDefaults, defaultValue: 0 });
  setTenantField(row, 'parking_unit_price', data, 'parkingUnitPrice', 'parking_unit_price', { applyDefaults, defaultValue: 0 });
  setTenantField(row, 'key_moments', data, 'keyMoments', 'key_moments', { applyDefaults, defaultValue: () => [] });
  setTenantField(row, 'name_history', data, 'nameHistory', 'name_history', { applyDefaults, defaultValue: () => [] });
  setTenantField(row, 'payment_cycle_changes', data, 'paymentCycleChanges', 'payment_cycle_changes', { applyDefaults, defaultValue: () => [] });
  setTenantField(row, 'payment_period_adjustments', data, 'paymentPeriodAdjustments', 'payment_period_adjustments', { applyDefaults, defaultValue: () => [] });
  setTenantField(row, 'payment_period_shift_months', data, 'paymentPeriodShiftMonths', 'payment_period_shift_months', { applyDefaults, defaultValue: 0 });
  setTenantField(row, 'management_fee_enabled', data, 'managementFeeEnabled', 'management_fee_enabled', { applyDefaults, defaultValue: null });
  setTenantField(row, 'management_fee_exempt', data, 'managementFeeExempt', 'management_fee_exempt', { applyDefaults, defaultValue: null });
  setTenantField(row, 'management_fee_free_periods', data, 'managementFeeFreePeriods', 'management_fee_free_periods', { applyDefaults, defaultValue: () => [] });
  setTenantField(row, 'management_fee_unit_price', data, 'managementFeeUnitPrice', 'management_fee_unit_price', { applyDefaults, defaultValue: null });
  setTenantField(row, 'management_fee_unit_price_mode', data, 'managementFeeUnitPriceMode', 'management_fee_unit_price_mode', { applyDefaults, defaultValue: 'monthly' });
  setTenantField(row, 'management_fee_monthly_amount', data, 'managementFeeMonthlyAmount', 'management_fee_monthly_amount', { applyDefaults, defaultValue: null });
  setTenantField(row, 'management_fee_first_payment_date', data, 'managementFeeFirstPaymentDate', 'management_fee_first_payment_date', { applyDefaults, defaultValue: '' });
  setTenantField(row, 'management_fee_start_with_occupancy', data, 'managementFeeStartWithOccupancy', 'management_fee_start_with_occupancy', { applyDefaults, defaultValue: null });
  setTenantField(row, 'management_fee_start_date', data, 'managementFeeStartDate', 'management_fee_start_date', { applyDefaults, defaultValue: '' });
  setTenantField(row, 'type', data, 'type', 'type', { applyDefaults, defaultValue: undefined });

  return row;
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

  const tenantData = mapTenantAppDataToPbTenantRow(params.data, oid, projectId, {
    applyDefaults: !isUpdate || params.mode === 'create',
  });

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
    ...saveResponseMeta(save),
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
    ...saveResponseMeta(save),
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
    ...saveResponseMeta(save),
  };
}
