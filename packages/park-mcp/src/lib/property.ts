import type PocketBase from 'pocketbase';
import { escapeFilter } from './filters.js';

export async function listUtilityRecords(
  userPb: PocketBase,
  opts: { period?: string; unit_id?: string; page?: number; perPage?: number },
) {
  const filters: string[] = [];
  if (opts.period) filters.push(`period="${escapeFilter(opts.period)}"`);
  if (opts.unit_id) filters.push(`unit_id="${escapeFilter(opts.unit_id)}"`);

  const page = Math.max(1, opts.page || 1);
  const perPage = Math.min(200, Math.max(1, opts.perPage || 50));

  const result = await userPb.collection('pm_utility_records').getList(page, perPage, {
    filter: filters.length ? filters.join(' && ') : '',
    sort: '-period',
  });

  return {
    ok: true,
    page: result.page,
    perPage: result.perPage,
    totalItems: result.totalItems,
    records: result.items,
  };
}

export async function listPropertyFees(
  userPb: PocketBase,
  opts: { period?: string; page?: number; perPage?: number },
) {
  const filters: string[] = [];
  if (opts.period) filters.push(`period="${escapeFilter(opts.period)}"`);

  const page = Math.max(1, opts.page || 1);
  const perPage = Math.min(200, Math.max(1, opts.perPage || 50));

  const result = await userPb.collection('pm_property_fees').getList(page, perPage, {
    filter: filters.length ? filters.join(' && ') : '',
    sort: '-period',
  });

  return {
    ok: true,
    page: result.page,
    perPage: result.perPage,
    totalItems: result.totalItems,
    records: result.items,
  };
}

const UTILITY_FORBIDDEN_PATCH = new Set([
  'base_reading',
  'rate',
  'meter_cost',
  'ac_apportionment',
  'public_pool_cost',
  'water_apportionment',
  'drainage_cost',
  'total_cost',
]);

const UTILITY_STATUS = new Set(['PAID', 'PENDING', 'OVERDUE']);
const FEE_STATUS = new Set(['PAID', 'PENDING', 'OVERDUE']);

export async function updateUtilityRecord(
  userPb: PocketBase,
  input: {
    id: string;
    status?: string;
    current_reading?: number;
    remarks?: string;
  },
) {
  const id = String(input.id || '').trim();
  if (!id) throw new Error('缺少记录 id');

  const patch: Record<string, unknown> = {};
  if (input.status) {
    const st = input.status.trim();
    if (!UTILITY_STATUS.has(st)) throw new Error('status 应为 PAID / PENDING / OVERDUE');
    patch.status = st;
  }
  if (input.current_reading !== undefined) {
    if (!Number.isFinite(input.current_reading)) throw new Error('current_reading 须为数字');
    patch.current_reading = input.current_reading;
  }
  if (input.remarks !== undefined) patch.remarks = input.remarks;

  for (const k of Object.keys(patch)) {
    if (UTILITY_FORBIDDEN_PATCH.has(k)) {
      throw new Error(`禁止写入计算字段 ${k}`);
    }
  }
  if (Object.keys(patch).length === 0) throw new Error('未提供可更新字段');

  const record = await userPb.collection('pm_utility_records').update(id, patch);
  return {
    ok: true,
    record,
    hint: patch.current_reading !== undefined
      ? '已更新读数，请在物业前端触发重算以刷新费用字段'
      : undefined,
  };
}

export async function updatePropertyFeeRecord(
  userPb: PocketBase,
  input: { id: string; status?: string; amount?: number },
) {
  const id = String(input.id || '').trim();
  if (!id) throw new Error('缺少记录 id');

  const patch: Record<string, unknown> = {};
  if (input.status) {
    const st = input.status.trim();
    if (!FEE_STATUS.has(st)) throw new Error('status 应为 PAID / PENDING / OVERDUE');
    patch.status = st;
  }
  if (input.amount !== undefined) {
    if (!Number.isFinite(input.amount) || input.amount < 0) throw new Error('amount 须为非负数');
    patch.amount = input.amount;
  }
  if (Object.keys(patch).length === 0) throw new Error('未提供可更新字段');

  const record = await userPb.collection('pm_property_fees').update(id, patch);
  return { ok: true, record };
}
