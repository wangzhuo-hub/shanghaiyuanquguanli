import type PocketBase from 'pocketbase';
import { resolveAuthorizedProjectId } from './auth.js';
import { escapeFilter, isValidPeriod } from './filters.js';
import { assertPaymentWriteAllowed, isAdminRole } from './permissions.js';
import type { AuthUser } from './types.js';

export const WRITABLE_COLLECTIONS = new Set([
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

/** 建议仅通过看板 UI 操作 */
const UI_PREFERRED_COLLECTIONS = new Set([
  'pb_budget_assumptions',
  'pb_budget_adjustments',
  'pb_budget_scenarios',
  'pb_yearly_targets',
  'pb_monthly_init_data',
]);

const PAYMENT_TYPES = [
  'Rent', 'Deposit', 'ManagementFee', 'ParkingFee', 'Other',
  'DepositToRent', 'DepositRefund',
] as const;

function assertCollectionWriteAllowed(
  user: AuthUser,
  collection: string,
  action: string,
  confirm_risky: boolean,
): void {
  if (!WRITABLE_COLLECTIONS.has(collection)) {
    throw new Error(`不允许写入集合 ${collection}`);
  }
  if (!['create', 'update', 'upsert', 'delete'].includes(action)) {
    throw new Error(`不支持的 action: ${action}`);
  }

  if (UI_PREFERRED_COLLECTIONS.has(collection) && !confirm_risky) {
    throw new Error(
      `集合 ${collection} 涉及预算/目标，风险较高。若确需 API 写入请设 confirm_risky=true，否则请使用看板前端。`,
    );
  }

  if (action === 'delete') {
    if (['pb_buildings', 'pb_units', 'pb_tenants'].includes(collection) && !isAdminRole(user.role)) {
      throw new Error('删除楼宇/单元/租户需要园区管理员权限');
    }
    if (collection === 'pb_tenants' && user.role === 'property_staff') {
      throw new Error('物业账号不可删除租户');
    }
  }
}

function buildOriginalIdFilter(collection: string, body: Record<string, unknown>, projectId: string): string {
  if (collection === 'pb_yearly_targets') {
    return `project_id="${escapeFilter(projectId)}" && year=${Number(body.data && (body.data as Record<string, unknown>).year)}`;
  }
  if (collection === 'pb_monthly_init_data') {
    const data = body.data as Record<string, unknown>;
    return `project_id="${escapeFilter(projectId)}" && year=${Number(data?.year)} && month=${Number(data?.month)}`;
  }
  const originalId = String(body.original_id || (body.data as Record<string, unknown>)?.original_id || '').trim();
  if (!originalId) throw new Error('缺少 original_id');
  return `project_id="${escapeFilter(projectId)}" && original_id="${escapeFilter(originalId)}"`;
}

function assertPaymentPayload(user: AuthUser, data: Record<string, unknown>, action: string): void {
  if (action === 'delete') return;
  const payType = String(data.type || 'Rent');
  if (!PAYMENT_TYPES.includes(payType as (typeof PAYMENT_TYPES)[number])) {
    throw new Error(`无效的收款 type: ${payType}`);
  }
  assertPaymentWriteAllowed(user, payType);
  const rentTypes = new Set(['Rent', 'DepositToRent', 'Deposit', 'DepositRefund']);
  if (rentTypes.has(payType) && user.role === 'property_staff') {
    throw new Error('物业账号不可写入租金类收款');
  }
}

export async function writeDashboardRecord(
  userPb: PocketBase,
  user: AuthUser,
  input: {
    collection: string;
    action: string;
    project_id?: string;
    original_id?: string;
    data?: Record<string, unknown>;
    confirm_risky?: boolean;
  },
) {
  const collection = String(input.collection || '').trim();
  const action = String(input.action || 'upsert').trim();
  const projectId = resolveAuthorizedProjectId(user, input.project_id);
  const confirmRisky = input.confirm_risky === true;

  assertCollectionWriteAllowed(user, collection, action, confirmRisky);

  const body: Record<string, unknown> = {
    original_id: input.original_id,
    data: { ...(input.data || {}) },
  };
  const requestedProject = String(
    input.project_id || (body.data as Record<string, unknown>)?.project_id || '',
  ).trim();
  if (requestedProject && requestedProject !== projectId) {
    throw new Error(`禁止跨园区写入：授权 ${projectId}，请求 ${requestedProject}`);
  }

  if (collection === 'pb_payments') assertPaymentPayload(user, body.data as Record<string, unknown>, action);
  if (collection === 'pb_tenants' && action === 'delete' && user.role === 'property_staff') {
    throw new Error('物业账号不可删除租户');
  }

  const payload = { ...(body.data as Record<string, unknown>), project_id: projectId };
  const filter = buildOriginalIdFilter(collection, body, projectId);
  const existing = await userPb.collection(collection).getList(1, 1, { filter, fields: 'id' });
  const current = existing.items[0] as { id: string } | undefined;

  if (action === 'delete') {
    if (current) await userPb.collection(collection).delete(current.id);
    return { ok: true, collection, action, id: current?.id || null, project_id: projectId };
  }
  if (action === 'create') {
    const created = await userPb.collection(collection).create(payload);
    return { ok: true, collection, action, id: created.id, project_id: projectId, record: created };
  }
  if (current) {
    const updated = await userPb.collection(collection).update(current.id, payload);
    return { ok: true, collection, action: 'update', id: updated.id, project_id: projectId, record: updated };
  }
  const created = await userPb.collection(collection).create(payload);
  return { ok: true, collection, action: 'create', id: created.id, project_id: projectId, record: created };
}

export async function createPayment(
  userPb: PocketBase,
  user: AuthUser,
  input: {
    project_id?: string;
    tenant_id: string;
    amount: number;
    type?: string;
    date: string;
    status?: string;
    period?: string;
    remarks?: string;
    tenant_name?: string;
    invoice_status?: string;
    original_id?: string;
  },
) {
  const projectId = resolveAuthorizedProjectId(user, input.project_id);
  const payType = input.type || 'Rent';
  assertPaymentWriteAllowed(user, payType);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw new Error('date 格式应为 YYYY-MM-DD');
  }
  const finalPeriod = input.period || input.date.slice(0, 7);
  if (!isValidPeriod(finalPeriod)) throw new Error('period 格式应为 YYYY-MM');

  const finalOriginalId = String(
    input.original_id || `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  ).trim();

  try {
    const dup = await userPb.collection('pb_payments').getFirstListItem(
      `project_id="${escapeFilter(projectId)}" && original_id="${escapeFilter(finalOriginalId)}"`,
    );
    return {
      ok: false,
      message: `original_id "${finalOriginalId}" 已存在`,
      existing_id: dup.id,
    };
  } catch {
    /* continue */
  }

  let tenantName = input.tenant_name || '';
  if (!tenantName) {
    try {
      const tenant = await userPb.collection('pb_tenants').getFirstListItem(
        `project_id="${escapeFilter(projectId)}" && original_id="${escapeFilter(input.tenant_id)}"`,
      );
      tenantName = String((tenant as { name?: string }).name || '').trim();
    } catch {
      tenantName = '';
    }
  }

  const record = await userPb.collection('pb_payments').create({
    original_id: finalOriginalId,
    tenant_id: input.tenant_id,
    tenant_name: tenantName,
    amount: input.amount,
    type: payType,
    date: input.date,
    status: input.status || 'Received',
    invoice_status: input.invoice_status || 'Pending',
    period: finalPeriod,
    remarks: input.remarks || '',
    project_id: projectId,
  });

  return { ok: true, project_id: projectId, payment: record };
}
