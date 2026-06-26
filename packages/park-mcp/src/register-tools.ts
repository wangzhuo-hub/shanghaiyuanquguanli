import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  adminComputeAvailable,
  AUTO_FACILITY_LOGIN,
  AUTO_LOGIN_EMAIL,
  AUTO_LOGIN_PASSWORD,
  AUTO_PROPERTY_LOGIN,
  FACILITY_PB_URL,
  PB_URL,
  PROPERTY_PB_URL,
} from './config.js';
import { AuthError, loginPropertySystem, loginWithPassword, publicUserProfile } from './lib/auth.js';
import { auditLog } from './lib/audit.js';
import { createRepairRequest, listRepairRequests, updateRepairRequest } from './lib/facility.js';
import { canAccessPropertySystem } from './lib/permissions.js';
import {
  fetchBuildings,
  fetchKpi,
  fetchPayments,
  fetchReceivables,
  fetchTenants,
  fetchUnits,
} from './lib/queries.js';
import {
  listPropertyFees,
  listUtilityRecords,
  updatePropertyFeeRecord,
  updateUtilityRecord,
} from './lib/property.js';
import {
  buildMcpSaveContext,
  savePaymentLikeFrontend,
  saveTenantLikeFrontend,
} from '../../../services/mcpIncrementalSave.js';
import {
  clearSession,
  getAppSession,
  requireDashboardSession,
  requireFacilitySession,
  requirePropertySession,
  setDashboardSession,
  setFacilitySession,
  setPropertySession,
} from './session.js';

export function textResult(data: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

export function toolError(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  return textResult({ ok: false, message }, true);
}

const dataRecordSchema = z.record(z.unknown()).optional();

function actorEmail(): string | undefined {
  const s = getAppSession();
  return s.dashboard?.user.email || s.facility?.user.email || s.property?.user.email;
}

export function registerTools(server: McpServer): void {
  server.tool(
    'park_login',
    '登录招商看板（users 账号）',
    { email: z.string(), password: z.string() },
    async ({ email, password }) => {
      try {
        const ctx = await loginWithPassword(PB_URL, email, password);
        setDashboardSession(ctx);
        return textResult({ ok: true, user: publicUserProfile(ctx.user), pb_url: PB_URL });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.tool(
    'park_facility_login',
    '登录设备设施系统（wyxj PocketBase，账号需在该系统开通）',
    { email: z.string(), password: z.string() },
    async ({ email, password }) => {
      try {
        const ctx = await loginWithPassword(FACILITY_PB_URL, email, password);
        setFacilitySession(ctx);
        return textResult({ ok: true, email: ctx.user.email, pb_url: FACILITY_PB_URL });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.tool(
    'park_property_login',
    '登录物业水电系统（sdsf PocketBase）',
    { email: z.string(), password: z.string() },
    async ({ email, password }) => {
      try {
        const ctx = await loginPropertySystem(PROPERTY_PB_URL, email, password);
        setPropertySession(ctx);
        return textResult({ ok: true, email: ctx.user.email, pb_url: PROPERTY_PB_URL });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.tool('park_logout', '退出所有子系统登录', {}, async () => {
    clearSession();
    return textResult({ ok: true, message: '已退出全部会话' });
  });

  server.tool('park_whoami', '查看各子系统登录状态与招商看板权限', {}, async () => {
    try {
      const s = getAppSession();
      const dash = s.dashboard?.user;
      return textResult({
        ok: true,
        dashboard: dash
          ? { loggedIn: true, user: publicUserProfile(dash), pb_url: PB_URL }
          : { loggedIn: false },
        facility: s.facility
          ? { loggedIn: true, email: s.facility.user.email, pb_url: FACILITY_PB_URL }
          : { loggedIn: false, pb_url: FACILITY_PB_URL },
        property: s.property
          ? { loggedIn: true, email: s.property.user.email, pb_url: PROPERTY_PB_URL }
          : { loggedIn: false, pb_url: PROPERTY_PB_URL },
        admin_compute: adminComputeAvailable(),
        property_access_hint: dash
          ? canAccessPropertySystem(dash)
          : '需先登录招商看板以判断物业权限',
      });
    } catch (e) {
      return toolError(e);
    }
  });

  server.tool(
    'park_kpi_get',
    '查询 KPI',
    { project_id: z.string().optional(), year: z.number().int().optional() },
    async (args) => {
      try {
        const { user, userPb } = requireDashboardSession();
        const data = await fetchKpi(userPb, user, args.project_id, args.year);
        return textResult(data, data.ok === false);
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.tool(
    'park_buildings_list',
    '查询楼宇列表',
    { project_id: z.string().optional() },
    async (args) => {
      try {
        const { user, userPb } = requireDashboardSession();
        return textResult(await fetchBuildings(userPb, user, args));
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.tool(
    'park_units_list',
    '查询租赁单元（写入合同前可先查空置单元）',
    {
      project_id: z.string().optional(),
      building_id: z.string().optional(),
      status: z.string().optional().describe('如 空置 / 已租'),
    },
    async (args) => {
      try {
        const { user, userPb } = requireDashboardSession();
        return textResult(await fetchUnits(userPb, user, args));
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.tool(
    'park_tenants_list',
    '查询租户列表',
    {
      project_id: z.string().optional(),
      search: z.string().optional(),
      tenant_id: z.string().optional(),
    },
    async (args) => {
      try {
        const { user, userPb } = requireDashboardSession();
        return textResult(await fetchTenants(userPb, user, args));
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.tool(
    'park_payments_list',
    '查询收款记录',
    {
      project_id: z.string().optional(),
      tenant_id: z.string().optional(),
      period: z.string().optional(),
      type: z.string().optional(),
      page: z.number().int().optional(),
      perPage: z.number().int().optional(),
    },
    async (args) => {
      try {
        const { user, userPb } = requireDashboardSession();
        return textResult(await fetchPayments(userPb, user, args));
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.tool(
    'park_receivables_list',
    '查询应收明细',
    {
      project_id: z.string().optional(),
      year: z.number().int().optional(),
      month: z.number().int().min(1).max(12).optional(),
      tenant_id: z.string().optional(),
    },
    async (args) => {
      try {
        const { user } = requireDashboardSession();
        const data = await fetchReceivables(user, args);
        return textResult(data, data.ok === false);
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.tool(
    'park_payment_create',
    '创建收款核销记录（校验核销权限；写入前请先确认租户与金额）',
    {
      project_id: z.string().optional(),
      tenant_id: z.string(),
      amount: z.number(),
      type: z.string().optional().describe('Rent / ManagementFee / Deposit 等'),
      date: z.string().describe('YYYY-MM-DD'),
      period: z.string().optional().describe('YYYY-MM'),
      status: z.string().optional(),
      remarks: z.string().optional(),
      tenant_name: z.string().optional(),
      original_id: z.string().optional(),
    },
    async (input) => {
      try {
        const { user, userPb } = requireDashboardSession();
        const ctx = buildMcpSaveContext(user, userPb, PB_URL, { projectId: input.project_id });
        const data = await savePaymentLikeFrontend(
          {
            project_id: input.project_id,
            tenant_id: input.tenant_id,
            amount: input.amount,
            type: input.type,
            date: input.date,
            period: input.period,
            remarks: input.remarks,
            tenant_name: input.tenant_name,
            original_id: input.original_id,
            status: input.status as 'Received' | 'Pending' | undefined,
          },
          ctx,
        );
        await auditLog({
          tool: 'park_payment_create',
          action: 'create',
          actor: actorEmail(),
          project_id: user.projectId,
          collection: 'pb_payments',
          ok: data.ok !== false,
          detail: data.ok === false
            ? data
            : { tenant_id: input.tenant_id, save_path: 'save_path' in data ? data.save_path : undefined },
        });
        return textResult(data, data.ok === false);
      } catch (e) {
        await auditLog({
          tool: 'park_payment_create',
          action: 'create',
          actor: actorEmail(),
          ok: false,
          detail: e instanceof Error ? e.message : e,
        });
        return toolError(e);
      }
    },
  );

  server.tool(
    'park_dashboard_write',
    '通用看板写入（upsert/create/update/delete）。预算类默认拒绝除非 confirm_risky=true',
    {
      collection: z.string().describe('pb_tenants / pb_payments / pb_units 等'),
      action: z.enum(['create', 'update', 'upsert', 'delete']),
      project_id: z.string().optional(),
      original_id: z.string().optional(),
      data: dataRecordSchema,
      confirm_risky: z.boolean().optional().describe('预算/目标类写入须显式确认'),
    },
    async (input) => {
      try {
        const { user, userPb } = requireDashboardSession();
        const ctx = buildMcpSaveContext(user, userPb, PB_URL, { projectId: input.project_id });
        const collection = String(input.collection || '').trim();

        if (collection === 'pb_payments') {
          const d = input.data || {};
          const data = await savePaymentLikeFrontend(
            {
              project_id: input.project_id,
              tenant_id: String(d.tenant_id || ''),
              amount: Number(d.amount),
              type: String(d.type || 'Rent'),
              date: String(d.date || ''),
              period: d.period as string | undefined,
              remarks: d.remarks as string | undefined,
              tenant_name: d.tenant_name as string | undefined,
              original_id: String(input.original_id || d.original_id || ''),
            },
            ctx,
          );
          await auditLog({
            tool: 'park_dashboard_write',
            action: input.action,
            actor: actorEmail(),
            project_id: user.projectId,
            collection: input.collection,
            ok: data.ok !== false,
          });
          return textResult(data, data.ok === false);
        }

        if (collection === 'pb_tenants') {
          if (input.action === 'delete') {
            throw new Error('删除租户请使用看板前端（增量路径暂不支持 MCP 删除）');
          }
          const d = input.data || {};
          const data = await saveTenantLikeFrontend(
            {
              original_id: String(input.original_id || d.original_id || ''),
              mode: input.action === 'create' ? 'create' : 'update',
              data: d,
              project_id: input.project_id,
            },
            ctx,
          );
          await auditLog({
            tool: 'park_dashboard_write',
            action: input.action,
            actor: actorEmail(),
            project_id: user.projectId,
            collection: input.collection,
            ok: data.ok !== false,
          });
          return textResult(data, data.ok === false);
        }

        throw new Error(
          `集合 ${collection} 须通过看板前端保存；MCP 增量路径仅支持 pb_payments / pb_tenants`,
        );
      } catch (e) {
        await auditLog({
          tool: 'park_dashboard_write',
          action: input.action,
          actor: actorEmail(),
          collection: input.collection,
          ok: false,
          detail: e instanceof Error ? e.message : e,
        });
        return toolError(e);
      }
    },
  );

  server.tool(
    'park_facility_repairs_list',
    '查询设备报修工单（需 park_facility_login）',
    {
      status: z.string().optional(),
      floor_name: z.string().optional(),
      page: z.number().int().optional(),
      perPage: z.number().int().optional(),
    },
    async (args) => {
      try {
        const { userPb } = requireFacilitySession();
        return textResult(await listRepairRequests(userPb, args));
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.tool(
    'park_facility_repair_create',
    '创建设备报修/维保工单',
    {
      category: z.enum(['REPAIR', 'MAINTENANCE']),
      floorName: z.string(),
      assetName: z.string(),
      description: z.string(),
      reporter: z.string(),
      reportDate: z.string().optional(),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
      systemType: z.enum(['HVAC', 'ELEC', 'SAFETY', 'NETWORK', 'ARCH']).optional(),
      source: z.string().optional(),
      technician: z.string().optional(),
    },
    async (input) => {
      try {
        const { userPb } = requireFacilitySession();
        const data = await createRepairRequest(userPb, input);
        await auditLog({
          tool: 'park_facility_repair_create',
          action: 'create',
          actor: actorEmail(),
          collection: 'repair_requests',
          ok: true,
          detail: { floorName: input.floorName, assetName: input.assetName },
        });
        return textResult(data);
      } catch (e) {
        await auditLog({
          tool: 'park_facility_repair_create',
          action: 'create',
          actor: actorEmail(),
          ok: false,
          detail: e instanceof Error ? e.message : e,
        });
        return toolError(e);
      }
    },
  );

  server.tool(
    'park_facility_repair_update',
    '更新报修工单（状态须按 PENDING→PROCESSING→COMPLETED 流转，不可跳步）',
    {
      id: z.string().describe('PocketBase 记录 id'),
      status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'REPLACED']).optional(),
      technician: z.string().optional(),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
      description: z.string().optional(),
    },
    async (input) => {
      try {
        const { userPb } = requireFacilitySession();
        const data = await updateRepairRequest(userPb, input);
        await auditLog({
          tool: 'park_facility_repair_update',
          action: 'update',
          actor: actorEmail(),
          collection: 'repair_requests',
          record_id: input.id,
          ok: true,
          detail: { status: input.status },
        });
        return textResult(data);
      } catch (e) {
        await auditLog({
          tool: 'park_facility_repair_update',
          action: 'update',
          actor: actorEmail(),
          record_id: input.id,
          ok: false,
          detail: e instanceof Error ? e.message : e,
        });
        return toolError(e);
      }
    },
  );

  server.tool(
    'park_property_utility_list',
    '查询水电费收缴记录（需 park_property_login）',
    { period: z.string().optional(), unit_id: z.string().optional(), page: z.number().int().optional() },
    async (args) => {
      try {
        const { userPb } = requirePropertySession();
        return textResult(await listUtilityRecords(userPb, args));
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.tool(
    'park_property_fees_list',
    '查询物业费收缴记录',
    { period: z.string().optional(), page: z.number().int().optional() },
    async (args) => {
      try {
        const { userPb } = requirePropertySession();
        return textResult(await listPropertyFees(userPb, args));
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.tool(
    'park_property_utility_update',
    '更新水电费记录（仅 status / current_reading / remarks；禁止写计算字段）',
    {
      id: z.string(),
      status: z.enum(['PAID', 'PENDING', 'OVERDUE']).optional(),
      current_reading: z.number().optional(),
      remarks: z.string().optional(),
    },
    async (input) => {
      try {
        const { userPb } = requirePropertySession();
        const data = await updateUtilityRecord(userPb, input);
        await auditLog({
          tool: 'park_property_utility_update',
          action: 'update',
          actor: actorEmail(),
          collection: 'pm_utility_records',
          record_id: input.id,
          ok: true,
        });
        return textResult(data);
      } catch (e) {
        await auditLog({
          tool: 'park_property_utility_update',
          action: 'update',
          actor: actorEmail(),
          record_id: input.id,
          ok: false,
          detail: e instanceof Error ? e.message : e,
        });
        return toolError(e);
      }
    },
  );

  server.tool(
    'park_property_fee_update',
    '更新物业费收缴记录（status / amount）',
    {
      id: z.string(),
      status: z.enum(['PAID', 'PENDING', 'OVERDUE']).optional(),
      amount: z.number().optional(),
    },
    async (input) => {
      try {
        const { userPb } = requirePropertySession();
        const data = await updatePropertyFeeRecord(userPb, input);
        await auditLog({
          tool: 'park_property_fee_update',
          action: 'update',
          actor: actorEmail(),
          collection: 'pm_property_fees',
          record_id: input.id,
          ok: true,
        });
        return textResult(data);
      } catch (e) {
        await auditLog({
          tool: 'park_property_fee_update',
          action: 'update',
          actor: actorEmail(),
          record_id: input.id,
          ok: false,
          detail: e instanceof Error ? e.message : e,
        });
        return toolError(e);
      }
    },
  );
}

export async function tryAutoLoginAll(): Promise<void> {
  if (!AUTO_LOGIN_EMAIL || !AUTO_LOGIN_PASSWORD) return;

  try {
    const dash = await loginWithPassword(PB_URL, AUTO_LOGIN_EMAIL, AUTO_LOGIN_PASSWORD);
    setDashboardSession(dash);
    console.error(`[park-mcp] dashboard login: ${dash.user.email}`);
  } catch (e) {
    const msg = e instanceof AuthError ? e.message : String(e);
    console.error(`[park-mcp] dashboard login failed: ${msg}`);
  }

  if (AUTO_FACILITY_LOGIN) {
    try {
      const fac = await loginWithPassword(FACILITY_PB_URL, AUTO_LOGIN_EMAIL, AUTO_LOGIN_PASSWORD);
      setFacilitySession(fac);
      console.error(`[park-mcp] facility login: ${fac.user.email}`);
    } catch (e) {
      console.error(`[park-mcp] facility login skipped: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (AUTO_PROPERTY_LOGIN) {
    try {
      const prop = await loginPropertySystem(PROPERTY_PB_URL, AUTO_LOGIN_EMAIL, AUTO_LOGIN_PASSWORD);
      setPropertySession(prop);
      console.error(`[park-mcp] property login: ${prop.user.email}`);
    } catch (e) {
      console.error(`[park-mcp] property login skipped: ${e instanceof Error ? e.message : e}`);
    }
  }
}
