import type PocketBase from 'pocketbase';
import { escapeFilter } from './filters.js';

const REPAIR_CATEGORIES = new Set(['REPAIR', 'MAINTENANCE']);
const REPAIR_PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH']);
const REPAIR_STATUSES = new Set(['PENDING', 'PROCESSING', 'COMPLETED', 'REPLACED']);
const SYSTEM_TYPES = new Set(['HVAC', 'ELEC', 'SAFETY', 'NETWORK', 'ARCH']);

export async function listRepairRequests(
  userPb: PocketBase,
  opts: {
    status?: string;
    floor_name?: string;
    page?: number;
    perPage?: number;
  },
) {
  const filters: string[] = [];
  if (opts.status) {
    if (!REPAIR_STATUSES.has(opts.status)) throw new Error(`无效 status: ${opts.status}`);
    filters.push(`status="${escapeFilter(opts.status)}"`);
  }
  if (opts.floor_name) filters.push(`floorName~"${escapeFilter(opts.floor_name)}"`);

  const page = Math.max(1, opts.page || 1);
  const perPage = Math.min(100, Math.max(1, opts.perPage || 20));

  const result = await userPb.collection('repair_requests').getList(page, perPage, {
    filter: filters.length ? filters.join(' && ') : '',
    sort: '-created',
  });

  return {
    ok: true,
    page: result.page,
    perPage: result.perPage,
    totalItems: result.totalItems,
    repairs: result.items,
  };
}

export async function createRepairRequest(
  userPb: PocketBase,
  input: {
    category: string;
    floorName: string;
    assetName: string;
    description: string;
    reporter: string;
    reportDate?: string;
    priority?: string;
    status?: string;
    systemType?: string;
    source?: string;
    technician?: string;
    assetIds?: string[];
  },
) {
  const category = String(input.category || 'REPAIR').trim();
  if (!REPAIR_CATEGORIES.has(category)) {
    throw new Error('category 应为 REPAIR 或 MAINTENANCE');
  }
  if (!input.floorName?.trim()) throw new Error('缺少 floorName（位置/楼层）');
  if (!input.assetName?.trim()) throw new Error('缺少 assetName（设备名称）');
  if (!input.description?.trim()) throw new Error('缺少 description（故障描述）');
  if (!input.reporter?.trim()) throw new Error('缺少 reporter（报修人）');

  const priority = String(input.priority || 'MEDIUM').trim();
  if (!REPAIR_PRIORITIES.has(priority)) throw new Error('priority 应为 LOW / MEDIUM / HIGH');

  const status = String(input.status || 'PENDING').trim();
  if (!REPAIR_STATUSES.has(status)) throw new Error('无效 status');

  const payload: Record<string, unknown> = {
    category,
    floorName: input.floorName.trim(),
    assetName: input.assetName.trim(),
    description: input.description.trim(),
    reporter: input.reporter.trim(),
    reportDate: input.reportDate || new Date().toISOString().slice(0, 10),
    priority,
    status,
  };

  if (input.systemType) {
    const st = input.systemType.trim();
    if (!SYSTEM_TYPES.has(st)) throw new Error('systemType 应为 HVAC/ELEC/SAFETY/NETWORK/ARCH');
    payload.systemType = st;
  }
  if (input.source) payload.source = input.source;
  if (input.technician) payload.technician = input.technician;
  if (input.assetIds?.length) payload.assetIds = input.assetIds;

  const record = await userPb.collection('repair_requests').create(payload);
  return { ok: true, repair: record };
}

const STATUS_FLOW: Record<string, Set<string>> = {
  PENDING: new Set(['PROCESSING']),
  PROCESSING: new Set(['COMPLETED', 'REPLACED']),
  COMPLETED: new Set(),
  REPLACED: new Set(),
};

function assertStatusTransition(from: string, to: string): void {
  const allowed = STATUS_FLOW[from];
  if (!allowed) throw new Error(`当前状态 ${from} 不可变更`);
  if (!allowed.has(to)) {
    throw new Error(`不允许从 ${from} 直接变更为 ${to}，允许：${[...allowed].join('、') || '无'}`);
  }
}

export async function updateRepairRequest(
  userPb: PocketBase,
  input: {
    id: string;
    status?: string;
    technician?: string;
    priority?: string;
    description?: string;
  },
) {
  const id = String(input.id || '').trim();
  if (!id) throw new Error('缺少工单 id');

  const existing = await userPb.collection('repair_requests').getOne(id);
  const prevStatus = String((existing as { status?: string }).status || 'PENDING');

  const patch: Record<string, unknown> = {};
  if (input.status) {
    const next = input.status.trim();
    if (!REPAIR_STATUSES.has(next)) throw new Error('无效 status');
    assertStatusTransition(prevStatus, next);
    patch.status = next;
  }
  if (input.priority) {
    const p = input.priority.trim();
    if (!REPAIR_PRIORITIES.has(p)) throw new Error('无效 priority');
    patch.priority = p;
  }
  if (input.technician !== undefined) patch.technician = input.technician;
  if (input.description !== undefined) patch.description = input.description;

  if (Object.keys(patch).length === 0) throw new Error('未提供可更新字段');

  const record = await userPb.collection('repair_requests').update(id, patch);
  return { ok: true, repair: record, previous_status: prevStatus };
}
