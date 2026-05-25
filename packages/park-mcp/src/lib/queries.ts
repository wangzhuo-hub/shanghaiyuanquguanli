import type PocketBase from 'pocketbase';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { adminComputeAvailable, PB_URL, REPO_ROOT } from '../config.js';
import type { AuthUser } from './types.js';
import { resolveAuthorizedProjectId } from './auth.js';
import { escapeFilter } from './filters.js';
import { filterPaymentsForUser, filterReceivablesForUser } from './permissions.js';

export async function fetchKpi(
  userPb: PocketBase,
  user: AuthUser,
  projectIdInput: string | undefined,
  yearInput: number | undefined,
) {
  const projectId = resolveAuthorizedProjectId(user, projectIdInput);
  const year = yearInput || new Date().getFullYear();

  try {
    const list = await userPb.collection('pb_kpi_snapshots').getList(1, 1, {
      filter: `project_id="${escapeFilter(projectId)}" && year=${year}`,
      sort: '-calculated_at',
    });
    const snapshot = list.items[0] as Record<string, unknown> | undefined;
    if (snapshot) {
      return {
        ok: true,
        source: 'pb_kpi_snapshots',
        project_id: projectId,
        year,
        summary: snapshot.summary_json,
        monthlyTrends: snapshot.monthly_trends_json ?? null,
        calculated_at: snapshot.calculated_at,
        data_version: snapshot.data_version,
      };
    }
  } catch {
    /* 集合可能无读权限或不存在 */
  }

  if (!adminComputeAvailable()) {
    return {
      ok: false,
      message:
        'KPI 快照未命中，且服务端未配置 PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD，无法实时计算。请联系管理员刷新快照或配置计算凭证。',
      project_id: projectId,
      year,
    };
  }

  process.env.PB_URL = PB_URL;
  const engine = await import(pathToFileURL(path.join(REPO_ROOT, 'scripts/compute-engine.ts')).href);
  await engine.ensureInit();
  const { computeKpi } = engine;
  const result = await computeKpi(projectId, year);
  if (!result.ok) return result;

  return {
    ok: true,
    source: 'compute-engine',
    project_id: projectId,
    year,
    summary: result.summary,
    monthlyTrends: result.fullYearTrends,
    calculated_at: result.computedAt,
    data_version: result.dataVersion,
  };
}

export async function fetchBuildings(
  userPb: PocketBase,
  user: AuthUser,
  opts: { project_id?: string },
) {
  const projectId = resolveAuthorizedProjectId(user, opts.project_id);
  const buildings = await userPb.collection('pb_buildings').getFullList({
    filter: `project_id="${escapeFilter(projectId)}"`,
    sort: 'name',
    fields: 'id,original_id,name,project_id',
  });
  return { ok: true, project_id: projectId, count: buildings.length, buildings };
}

export async function fetchUnits(
  userPb: PocketBase,
  user: AuthUser,
  opts: { project_id?: string; building_id?: string; status?: string },
) {
  const projectId = resolveAuthorizedProjectId(user, opts.project_id);
  const filters: string[] = [`project_id="${escapeFilter(projectId)}"`];
  if (opts.building_id) filters.push(`building_id="${escapeFilter(opts.building_id)}"`);
  if (opts.status) filters.push(`status="${escapeFilter(opts.status)}"`);

  const units = await userPb.collection('pb_units').getFullList({
    filter: filters.join(' && '),
    sort: 'original_id',
    fields: 'id,original_id,building_id,room,area,status,project_id',
  });
  return { ok: true, project_id: projectId, count: units.length, units };
}

export async function fetchTenants(
  userPb: PocketBase,
  user: AuthUser,
  opts: { project_id?: string; search?: string; tenant_id?: string },
) {
  const projectId = resolveAuthorizedProjectId(user, opts.project_id);
  const filters: string[] = [`project_id="${escapeFilter(projectId)}"`];
  if (opts.search) filters.push(`name~"${escapeFilter(opts.search)}"`);
  if (opts.tenant_id) filters.push(`original_id="${escapeFilter(opts.tenant_id)}"`);

  const tenants = await userPb.collection('pb_tenants').getFullList({
    filter: filters.join(' && '),
    sort: 'name',
    fields: 'id,original_id,name,unit_price,monthly_rent,deposit_amount,status,building_id,project_id',
  });

  return { ok: true, project_id: projectId, count: tenants.length, tenants };
}

export async function fetchPayments(
  userPb: PocketBase,
  user: AuthUser,
  opts: {
    project_id?: string;
    tenant_id?: string;
    period?: string;
    type?: string;
    page?: number;
    perPage?: number;
  },
) {
  const projectId = resolveAuthorizedProjectId(user, opts.project_id);
  const filters: string[] = [`project_id="${escapeFilter(projectId)}"`];
  if (opts.tenant_id) filters.push(`tenant_id="${escapeFilter(opts.tenant_id)}"`);
  if (opts.period) filters.push(`period="${escapeFilter(opts.period)}"`);
  if (opts.type) filters.push(`type="${escapeFilter(opts.type)}"`);

  const page = Math.max(1, opts.page || 1);
  const perPage = Math.min(200, Math.max(1, opts.perPage || 50));

  const result = await userPb.collection('pb_payments').getList(page, perPage, {
    filter: filters.join(' && '),
    sort: '-date',
  });

  const payments = filterPaymentsForUser(
    user,
    result.items as Array<{ type?: string }>,
  );

  return {
    ok: true,
    project_id: projectId,
    page: result.page,
    perPage: result.perPage,
    totalItems: result.totalItems,
    totalPages: result.totalPages,
    payments,
  };
}

export async function fetchReceivables(
  user: AuthUser,
  opts: { project_id?: string; year?: number; month?: number; tenant_id?: string },
) {
  const projectId = resolveAuthorizedProjectId(user, opts.project_id);
  const year = opts.year || new Date().getFullYear();
  const monthIndex = (opts.month || new Date().getMonth() + 1) - 1;
  if (monthIndex < 0 || monthIndex > 11) {
    throw new Error('month 应为 1-12');
  }

  if (!adminComputeAvailable()) {
    return {
      ok: false,
      message: '应收明细需服务端配置 PB_ADMIN_EMAIL/PB_ADMIN_PASSWORD 后由计算引擎生成。',
      project_id: projectId,
    };
  }

  process.env.PB_URL = PB_URL;
  const engine = await import(pathToFileURL(path.join(REPO_ROOT, 'scripts/compute-engine.ts')).href);
  await engine.ensureInit();
  const { computeBilling } = engine;
  const result = await computeBilling(projectId, year, monthIndex);
  if (!result.ok) return result;

  let details = result.billingDetails;
  details = filterReceivablesForUser(user, details);
  if (opts.tenant_id) {
    details = details.filter((d: { tenantId?: string }) => d.tenantId === opts.tenant_id);
  }

  return {
    ok: true,
    project_id: projectId,
    year,
    month: monthIndex + 1,
    period: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
    totalDue: result.totalDue,
    totalPaid: result.totalPaid,
    unpaidCount: result.unpaidCount,
    count: details.length,
    receivables: details,
    computedAt: result.computedAt,
  };
}
