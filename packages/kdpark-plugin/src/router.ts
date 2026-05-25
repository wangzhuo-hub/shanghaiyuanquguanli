import { auditLog } from '../../park-mcp/src/lib/audit.js';
import { createRepairRequest, listRepairRequests, updateRepairRequest } from '../../park-mcp/src/lib/facility.js';
import {
  fetchBuildings,
  fetchKpi,
  fetchPayments,
  fetchReceivables,
  fetchTenants,
  fetchUnits,
} from '../../park-mcp/src/lib/queries.js';
import {
  listPropertyFees,
  listUtilityRecords,
  updatePropertyFeeRecord,
  updateUtilityRecord,
} from '../../park-mcp/src/lib/property.js';
import {
  getAppSession,
  requireDashboardSession,
  requireFacilitySession,
  requirePropertySession,
} from '../../park-mcp/src/session.js';
import {
  buildMcpSaveContext,
  savePaymentLikeFrontend,
  saveTenantLikeFrontend,
} from '../../../services/mcpIncrementalSave.js';
import { PB_URL } from './config.js';

function actorEmail(): string | undefined {
  const s = getAppSession();
  return s.dashboard?.user.email || s.facility?.user.email || s.property?.user.email;
}

export async function runQuery(kind: string, params: Record<string, unknown>) {
  const k = String(kind || '').trim().toLowerCase();
  const { user, userPb } = requireDashboardSession();

  switch (k) {
    case 'kpi':
      return fetchKpi(
        userPb,
        user,
        params.project_id as string | undefined,
        params.year as number | undefined,
      );
    case 'tenants':
      return fetchTenants(userPb, user, {
        project_id: params.project_id as string | undefined,
        search: params.search as string | undefined,
        tenant_id: params.tenant_id as string | undefined,
      });
    case 'payments':
      return fetchPayments(userPb, user, {
        project_id: params.project_id as string | undefined,
        tenant_id: params.tenant_id as string | undefined,
        period: params.period as string | undefined,
        type: params.type as string | undefined,
        page: params.page as number | undefined,
        perPage: params.perPage as number | undefined,
      });
    case 'receivables':
      return fetchReceivables(user, {
        project_id: params.project_id as string | undefined,
        year: params.year as number | undefined,
        month: params.month as number | undefined,
        tenant_id: params.tenant_id as string | undefined,
      });
    case 'buildings':
      return fetchBuildings(userPb, user, { project_id: params.project_id as string | undefined });
    case 'units':
      return fetchUnits(userPb, user, {
        project_id: params.project_id as string | undefined,
        building_id: params.building_id as string | undefined,
        status: params.status as string | undefined,
      });
    case 'repairs': {
      const { userPb: fpb } = requireFacilitySession();
      return listRepairRequests(fpb, {
        status: params.status as string | undefined,
        floor_name: params.floor_name as string | undefined,
        page: params.page as number | undefined,
        perPage: params.perPage as number | undefined,
      });
    }
    case 'utility_bills': {
      const { userPb: ppb } = requirePropertySession();
      return listUtilityRecords(ppb, {
        period: params.period as string | undefined,
        unit_id: params.unit_id as string | undefined,
        page: params.page as number | undefined,
      });
    }
    case 'property_fees': {
      const { userPb: ppb } = requirePropertySession();
      return listPropertyFees(ppb, {
        period: params.period as string | undefined,
        page: params.page as number | undefined,
      });
    }
    default:
      throw new Error(
        `未知 kind: ${k}。可用: kpi, tenants, payments, receivables, buildings, units, repairs, utility_bills, property_fees`,
      );
  }
}

export async function runSubmit(action: string, params: Record<string, unknown>) {
  const a = String(action || '').trim().toLowerCase();

  switch (a) {
    case 'payment': {
      const { user, userPb } = requireDashboardSession();
      const ctx = buildMcpSaveContext(user, userPb, PB_URL, {
        projectId: params.project_id as string | undefined,
      });
      const data = await savePaymentLikeFrontend(
        {
          project_id: params.project_id as string | undefined,
          tenant_id: String(params.tenant_id || ''),
          amount: Number(params.amount),
          type: params.type as string | undefined,
          date: String(params.date || ''),
          period: params.period as string | undefined,
          remarks: params.remarks as string | undefined,
          tenant_name: params.tenant_name as string | undefined,
          original_id: params.original_id as string | undefined,
          status: params.status as 'Received' | 'Pending' | 'Overdue' | undefined,
          invoice_status: params.invoice_status as 'Issued' | 'Pending' | 'NotRequired' | undefined,
        },
        ctx,
      );
      await auditLog({
        tool: 'kdpark_submit',
        action: 'payment',
        actor: actorEmail(),
        project_id: user.projectId,
        ok: data.ok !== false,
      });
      return data;
    }
    case 'tenant': {
      const { user, userPb } = requireDashboardSession();
      const data = params.data as Record<string, unknown> | undefined;
      if (!data || typeof data !== 'object') throw new Error('tenant 须传 data 对象（合同/租户字段）');
      const ctx = buildMcpSaveContext(user, userPb, PB_URL, {
        projectId: params.project_id as string | undefined,
      });
      const result = await saveTenantLikeFrontend(
        {
          original_id: String(params.original_id || data.original_id || ''),
          mode: (params.mode as string) === 'create' ? 'create' : 'update',
          data,
          project_id: params.project_id as string | undefined,
        },
        ctx,
      );
      await auditLog({
        tool: 'kdpark_submit',
        action: 'tenant',
        actor: actorEmail(),
        project_id: user.projectId,
        collection: 'pb_tenants',
        ok: result.ok !== false,
      });
      return result;
    }
    case 'repair': {
      const { userPb } = requireFacilitySession();
      const result = await createRepairRequest(userPb, {
        category: String(params.category || 'REPAIR'),
        floorName: String(params.floorName || ''),
        assetName: String(params.assetName || ''),
        description: String(params.description || ''),
        reporter: String(params.reporter || ''),
        reportDate: params.reportDate as string | undefined,
        priority: params.priority as string | undefined,
        systemType: params.systemType as string | undefined,
        source: params.source as string | undefined,
      });
      await auditLog({ tool: 'kdpark_submit', action: 'repair', actor: actorEmail(), ok: true });
      return result;
    }
    case 'repair_update': {
      const { userPb } = requireFacilitySession();
      return updateRepairRequest(userPb, {
        id: String(params.id || ''),
        status: params.status as string | undefined,
        technician: params.technician as string | undefined,
        priority: params.priority as string | undefined,
        description: params.description as string | undefined,
      });
    }
    case 'utility_update': {
      const { userPb } = requirePropertySession();
      return updateUtilityRecord(userPb, {
        id: String(params.id || ''),
        status: params.status as string | undefined,
        current_reading: params.current_reading as number | undefined,
        remarks: params.remarks as string | undefined,
      });
    }
    case 'property_fee': {
      const { userPb } = requirePropertySession();
      return updatePropertyFeeRecord(userPb, {
        id: String(params.id || ''),
        status: params.status as string | undefined,
        amount: params.amount as number | undefined,
      });
    }
    case 'record': {
      const { user, userPb } = requireDashboardSession();
      const collection = String(params.collection || '').trim();
      const ctx = buildMcpSaveContext(user, userPb, PB_URL, {
        projectId: params.project_id as string | undefined,
      });
      if (collection === 'pb_payments') {
        const d = params.data as Record<string, unknown> | undefined;
        if (!d) throw new Error('record pb_payments 须传 data');
        return savePaymentLikeFrontend(
          {
            project_id: params.project_id as string | undefined,
            tenant_id: String(d.tenant_id || params.tenant_id || ''),
            amount: Number(d.amount ?? params.amount),
            type: String(d.type || params.type || 'Rent'),
            date: String(d.date || params.date || ''),
            period: (d.period || params.period) as string | undefined,
            remarks: (d.remarks || params.remarks) as string | undefined,
            tenant_name: (d.tenant_name || params.tenant_name) as string | undefined,
            original_id: String(params.original_id || d.original_id || ''),
          },
          ctx,
        );
      }
      if (collection === 'pb_tenants') {
        const d = params.data as Record<string, unknown> | undefined;
        if (!d) throw new Error('record pb_tenants 须传 data');
        return saveTenantLikeFrontend(
          {
            original_id: String(params.original_id || d.original_id || ''),
            mode: String(params.mode || 'upsert') === 'create' ? 'create' : 'update',
            data: d,
            project_id: params.project_id as string | undefined,
          },
          ctx,
        );
      }
      throw new Error(
        `集合 ${collection} 须通过看板前端保存，或改用 action=payment / tenant（MCP 与前端同路径仅支持收款与租户）`,
      );
    }
    default:
      throw new Error(
        `未知 action: ${a}。可用: payment, tenant, repair, repair_update, utility_update, property_fee, record`,
      );
  }
}
