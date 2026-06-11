#!/usr/bin/env node
/**
 * 园区收款核销 API
 *
 * 默认需用户登录（看板 users 账号），按园区 + 核销权限隔离读写。
 *
 * 认证方式（三选一）：
 *   1. POST /api/auth/login → Authorization: Bearer <token>
 *   2. 请求头 X-Park-Email + X-Park-Password（适合 Agent 每次带账号密码）
 *   3. PAYMENT_API_ALLOW_ANONYMOUS=1 时回退为 Admin 无鉴权（仅开发）
 *
 * 端点：
 *   POST /api/auth/login
 *   GET  /api/auth/me
 *   GET  /health
 *   GET  /api/payments
 *   GET  /api/payments/:id
 *   POST /api/payments
 *   PUT  /api/payments/:id
 *   DELETE /api/payments/:id
 *   GET  /api/receivables
 *   GET  /api/tenants
 */

import express from 'express';
import PocketBase from 'pocketbase';
import { computeBilling } from './compute-engine.js';
import type { AuthUser } from '../types';
import {
  AuthError,
  ForbiddenError,
  assertPaymentWriteAllowed,
  authenticateRequest,
  filterPaymentsForUser,
  loginWithPassword,
  publicUserProfile,
  resolveAuthorizedProjectId,
} from './paymentApiAuth.js';

// ── 配置 ──

const PB_URL: string = process.env.PB_URL || 'http://127.0.0.1:1002';
const ADMIN_EMAIL: string = process.env.PB_ADMIN_EMAIL || process.env.VITE_POCKETBASE_EMAIL || '';
const ADMIN_PASSWORD: string = process.env.PB_ADMIN_PASSWORD || process.env.VITE_POCKETBASE_PASSWORD || '';
const PORT: number = Number(process.env.PAYMENT_API_PORT || 18788);
const DEFAULT_PROJECT = String(process.env.PAYMENT_API_DEFAULT_PROJECT || 'shanghai_park').trim();
const REQUIRE_AUTH = process.env.PAYMENT_API_ALLOW_ANONYMOUS !== '1';

const PAYMENT_TYPES = [
  'Rent', 'Deposit', 'ManagementFee', 'ParkingFee', 'Other',
  'DepositToRent', 'DepositRefund',
] as const;

const PAYMENT_STATUSES = ['Received', 'Pending'] as const;
const INVOICE_STATUSES = ['Pending', 'Invoiced'] as const;

type PaymentType = typeof PAYMENT_TYPES[number];
type PaymentStatus = typeof PAYMENT_STATUSES[number];
type InvoiceStatus = typeof INVOICE_STATUSES[number];

/** Admin 客户端：仅用于 compute-engine / 匿名模式 */
const adminPb = new PocketBase(PB_URL);

interface RequestContext {
  user: AuthUser | null;
  pb: PocketBase;
  anonymous: boolean;
}

// ── 工具 ──

function escapeFilter(value: string): string {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidPeriod(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}

function sendError(res: express.Response, e: unknown, fallback = '内部错误') {
  if (e instanceof AuthError) {
    res.status(401).json({ ok: false, message: e.message });
    return;
  }
  if (e instanceof ForbiddenError) {
    res.status(403).json({ ok: false, message: e.message });
    return;
  }
  const err = e as { status?: number; message?: string; data?: { message?: string } };
  const status = err?.status === 404 ? 404 : err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  const message = err?.data?.message || err?.message || fallback;
  res.status(status).json({ ok: false, message });
}

async function authAdmin(): Promise<void> {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('缺少 PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD');
  }
  try {
    await adminPb.collection('_superusers').authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
  } catch (_) {
    await adminPb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
  }
}

async function resolveContext(req: express.Request): Promise<RequestContext> {
  if (!REQUIRE_AUTH) {
    return { user: null, pb: adminPb, anonymous: true };
  }
  const auth = await authenticateRequest(req, PB_URL);
  return { user: auth.user, pb: auth.userPb, anonymous: false };
}

function resolveProject(ctx: RequestContext, req: express.Request, fromBody?: unknown): string {
  if (ctx.anonymous || !ctx.user) {
    return String(fromBody ?? req.query.project_id ?? DEFAULT_PROJECT).trim();
  }
  return resolveAuthorizedProjectId(
    ctx.user,
    fromBody ?? req.query.project_id,
    DEFAULT_PROJECT,
  );
}

function assertRecordProject(ctx: RequestContext, recordProjectId: string, projectId: string) {
  if (ctx.anonymous || !ctx.user) return;
  const rid = String(recordProjectId || '').trim();
  if (rid && rid !== projectId) {
    throw new ForbiddenError(`无权操作园区 ${rid} 的数据`);
  }
}

async function findPaymentRecord(
  pb: PocketBase,
  idOrOriginalId: string,
  projectId: string,
): Promise<any> {
  try {
    const record = await pb.collection('pb_payments').getOne(idOrOriginalId);
    if (String(record.project_id || '').trim() !== projectId) {
      const err = new Error('收款记录不存在') as Error & { status: number };
      err.status = 404;
      throw err;
    }
    return record;
  } catch (e: any) {
    if (e?.status !== 404) throw e;
  }
  return pb.collection('pb_payments').getFirstListItem(
    `project_id="${escapeFilter(projectId)}" && original_id="${escapeFilter(idOrOriginalId)}"`,
  );
}

async function resolveTenantName(pb: PocketBase, tenantId: string, projectId: string): Promise<string> {
  try {
    const tenant = await pb.collection('pb_tenants').getFirstListItem(
      `project_id="${escapeFilter(projectId)}" && original_id="${escapeFilter(tenantId)}"`,
    );
    return String(tenant.name || '').trim();
  } catch {
    return '';
  }
}

function corsMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Park-Email, X-Park-Password');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

type AuthedHandler = (req: express.Request, res: express.Response, ctx: RequestContext) => Promise<void>;

function withAuth(handler: AuthedHandler) {
  return async (req: express.Request, res: express.Response) => {
    try {
      const ctx = await resolveContext(req);
      await handler(req, res, ctx);
    } catch (e) {
      sendError(res, e);
    }
  };
}

// ── 认证 ──

async function handleLogin(req: express.Request, res: express.Response) {
  try {
    const { email, password } = (req.body || {}) as { email?: string; password?: string };
    const auth = await loginWithPassword(PB_URL, email || '', password || '');
    res.json({
      ok: true,
      token: auth.token,
      user: publicUserProfile(auth.user),
      authHint: '后续请求请携带 Authorization: Bearer <token>，或 X-Park-Email / X-Park-Password',
    });
  } catch (e) {
    sendError(res, e, '登录失败');
  }
}

const handleMe = withAuth(async (_req, res, ctx) => {
  if (!ctx.user) {
    res.json({ ok: true, anonymous: true, message: '当前为匿名 Admin 模式' });
    return;
  }
  res.json({ ok: true, user: publicUserProfile(ctx.user) });
});

// ── 收款 CRUD ──

const listPayments = withAuth(async (req, res, ctx) => {
  const projectId = resolveProject(ctx, req);
  const filters: string[] = [`project_id="${escapeFilter(projectId)}"`];

  const tenantId = String(req.query.tenant_id || '').trim();
  if (tenantId) filters.push(`tenant_id="${escapeFilter(tenantId)}"`);

  const originalId = String(req.query.original_id || '').trim();
  if (originalId) filters.push(`original_id="${escapeFilter(originalId)}"`);

  const period = String(req.query.period || '').trim();
  if (period) {
    if (!isValidPeriod(period)) {
      res.status(400).json({ ok: false, message: 'period 格式应为 YYYY-MM' });
      return;
    }
    filters.push(`period="${escapeFilter(period)}"`);
  }

  const type = String(req.query.type || '').trim();
  if (type) {
    if (!PAYMENT_TYPES.includes(type as PaymentType)) {
      res.status(400).json({ ok: false, message: `无效的 type: ${type}` });
      return;
    }
    filters.push(`type="${escapeFilter(type)}"`);
  }

  const status = String(req.query.status || '').trim();
  if (status) {
    if (!PAYMENT_STATUSES.includes(status as PaymentStatus)) {
      res.status(400).json({ ok: false, message: `无效的 status: ${status}` });
      return;
    }
    filters.push(`status="${escapeFilter(status)}"`);
  }

  const dateFrom = String(req.query.date_from || '').trim();
  if (dateFrom) {
    if (!isValidDate(dateFrom)) {
      res.status(400).json({ ok: false, message: 'date_from 格式应为 YYYY-MM-DD' });
      return;
    }
    filters.push(`date>="${escapeFilter(dateFrom)}"`);
  }

  const dateTo = String(req.query.date_to || '').trim();
  if (dateTo) {
    if (!isValidDate(dateTo)) {
      res.status(400).json({ ok: false, message: 'date_to 格式应为 YYYY-MM-DD' });
      return;
    }
    filters.push(`date<="${escapeFilter(dateTo)}"`);
  }

  const search = String(req.query.search || '').trim();
  if (search) filters.push(`tenant_name~"${escapeFilter(search)}"`);

  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = Math.min(500, Math.max(1, Number(req.query.perPage) || 50));
  const sort = String(req.query.sort || '-date').trim();

  const result = await ctx.pb.collection('pb_payments').getList(page, perPage, {
    filter: filters.join(' && '),
    sort,
  });

  const payments = ctx.user ? filterPaymentsForUser(ctx.user, result.items) : result.items;

  res.json({
    ok: true,
    project_id: projectId,
    page: result.page,
    perPage: result.perPage,
    totalItems: result.totalItems,
    totalPages: result.totalPages,
    payments,
  });
});

const getPayment = withAuth(async (req, res, ctx) => {
  const projectId = resolveProject(ctx, req);
  const record = await findPaymentRecord(ctx.pb, req.params.id, projectId);
  if (ctx.user) assertRecordProject(ctx, record.project_id, projectId);
  if (ctx.user && !filterPaymentsForUser(ctx.user, [record]).length) {
    throw new ForbiddenError('无权查看该收款记录');
  }
  res.json({ ok: true, payment: record });
});

const createPayment = withAuth(async (req, res, ctx) => {
  const {
    tenant_id, amount, type, date, status, period, remarks,
    tenant_name, invoice_status, original_id, project_id,
  } = req.body || {};

  if (!tenant_id) { res.status(400).json({ ok: false, message: '缺少 tenant_id' }); return; }
  if (amount == null || amount === '') { res.status(400).json({ ok: false, message: '缺少 amount' }); return; }
  if (!date) { res.status(400).json({ ok: false, message: '缺少 date' }); return; }
  if (!isValidDate(date)) { res.status(400).json({ ok: false, message: 'date 格式应为 YYYY-MM-DD' }); return; }

  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount)) {
    res.status(400).json({ ok: false, message: 'amount 必须为有效数字' });
    return;
  }

  const payType = type || 'Rent';
  if (!PAYMENT_TYPES.includes(payType)) {
    res.status(400).json({ ok: false, message: `无效的 type: ${payType}` });
    return;
  }
  if (status && !PAYMENT_STATUSES.includes(status)) {
    res.status(400).json({ ok: false, message: `无效的 status: ${status}` });
    return;
  }
  if (invoice_status && !INVOICE_STATUSES.includes(invoice_status)) {
    res.status(400).json({ ok: false, message: `无效的 invoice_status: ${invoice_status}` });
    return;
  }

  const finalProjectId = resolveProject(ctx, req, project_id);
  const finalPeriod = period || date.slice(0, 7);
  if (!isValidPeriod(finalPeriod)) {
    res.status(400).json({ ok: false, message: 'period 格式应为 YYYY-MM' });
    return;
  }

  if (ctx.user) assertPaymentWriteAllowed(ctx.user, payType);

  const finalOriginalId = String(
    original_id || `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  ).trim();

  try {
    const dup = await ctx.pb.collection('pb_payments').getFirstListItem(
      `project_id="${escapeFilter(finalProjectId)}" && original_id="${escapeFilter(finalOriginalId)}"`,
    );
    if (dup) {
      res.status(409).json({
        ok: false,
        message: `original_id "${finalOriginalId}" 已存在`,
        existing_id: dup.id,
        payment: dup,
      });
      return;
    }
  } catch (_) { /* 不存在，可继续 */ }

  const resolvedTenantName = tenant_name || await resolveTenantName(ctx.pb, tenant_id, finalProjectId);

  const payload: Record<string, unknown> = {
    original_id: finalOriginalId,
    tenant_id,
    tenant_name: resolvedTenantName,
    amount: numAmount,
    type: payType,
    date,
    status: status || 'Received',
    invoice_status: invoice_status || 'Pending',
    period: finalPeriod,
    remarks: remarks || '',
    project_id: finalProjectId,
  };

  const record = await ctx.pb.collection('pb_payments').create(payload);
  console.log(`[payment-api] created payment ${record.id} tenant=${tenant_id} amount=${numAmount} by=${ctx.user?.email || 'anonymous'}`);
  res.status(201).json({ ok: true, payment: record });
});

const updatePayment = withAuth(async (req, res, ctx) => {
  const {
    tenant_id, amount, type, date, status, period, remarks,
    tenant_name, invoice_status, project_id,
  } = req.body || {};

  if (type && !PAYMENT_TYPES.includes(type)) {
    res.status(400).json({ ok: false, message: `无效的 type: ${type}` });
    return;
  }
  if (status && !PAYMENT_STATUSES.includes(status)) {
    res.status(400).json({ ok: false, message: `无效的 status: ${status}` });
    return;
  }
  if (invoice_status && !INVOICE_STATUSES.includes(invoice_status)) {
    res.status(400).json({ ok: false, message: `无效的 invoice_status: ${invoice_status}` });
    return;
  }
  if (date !== undefined && date !== '' && !isValidDate(date)) {
    res.status(400).json({ ok: false, message: 'date 格式应为 YYYY-MM-DD' });
    return;
  }
  if (period !== undefined && period !== '' && !isValidPeriod(period)) {
    res.status(400).json({ ok: false, message: 'period 格式应为 YYYY-MM' });
    return;
  }

  const lookupProjectId = resolveProject(ctx, req, project_id);
  let existing: any;
  try {
    existing = await findPaymentRecord(ctx.pb, req.params.id, lookupProjectId);
  } catch {
    res.status(404).json({ ok: false, message: '收款记录不存在' });
    return;
  }

  if (ctx.user) {
    assertRecordProject(ctx, existing.project_id, lookupProjectId);
    assertPaymentWriteAllowed(ctx.user, String(existing.type || ''));
    if (type) assertPaymentWriteAllowed(ctx.user, type);
  }

  const payload: Record<string, unknown> = {};
  if (tenant_id !== undefined) payload.tenant_id = tenant_id;
  if (amount !== undefined && amount !== '') {
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount)) {
      res.status(400).json({ ok: false, message: 'amount 必须为有效数字' });
      return;
    }
    payload.amount = numAmount;
  }
  if (type !== undefined) payload.type = type;
  if (date !== undefined) payload.date = date;
  if (status !== undefined) payload.status = status;
  if (period !== undefined) payload.period = period;
  if (remarks !== undefined) payload.remarks = remarks;
  if (tenant_name !== undefined) payload.tenant_name = tenant_name;
  if (invoice_status !== undefined) payload.invoice_status = invoice_status;

  const record = await ctx.pb.collection('pb_payments').update(existing.id, payload);
  console.log(`[payment-api] updated payment ${existing.id} by=${ctx.user?.email || 'anonymous'}`);
  res.json({ ok: true, payment: record });
});

const deletePayment = withAuth(async (req, res, ctx) => {
  const projectId = resolveProject(ctx, req);
  const existing = await findPaymentRecord(ctx.pb, req.params.id, projectId);
  if (ctx.user) {
    assertRecordProject(ctx, existing.project_id, projectId);
    assertPaymentWriteAllowed(ctx.user, String(existing.type || ''));
  }
  await ctx.pb.collection('pb_payments').delete(existing.id);
  console.log(`[payment-api] deleted payment ${existing.id} by=${ctx.user?.email || 'anonymous'}`);
  res.json({ ok: true, deleted: existing.id, original_id: existing.original_id });
});

// ── 应收明细 ──

const listReceivables = withAuth(async (req, res, ctx) => {
  const projectId = resolveProject(ctx, req);
  const year = Number(req.query.year) || new Date().getFullYear();
  const monthParam = req.query.month;

  let monthIndex: number;
  if (typeof monthParam === 'string' && /^\d{4}-\d{2}$/.test(monthParam)) {
    monthIndex = Number(monthParam.slice(5, 7)) - 1;
  } else {
    const month = Number(monthParam);
    if (!Number.isFinite(month) || month < 1 || month > 12) {
      res.status(400).json({ ok: false, message: '请提供 month（1-12）或 YYYY-MM' });
      return;
    }
    monthIndex = month - 1;
  }

  const tenantId = String(req.query.tenant_id || '').trim();
  const statusFilter = String(req.query.status || '').trim();

  const result = await computeBilling(projectId, year, monthIndex);
  if (!result.ok) {
    res.status(500).json({ ok: false, message: '应收计算失败', ...result });
    return;
  }

  let details = result.billingDetails;
  if (ctx.user && ctx.user.role !== 'platform_admin' && !ctx.user.receivablePermissions?.includes('rent_receivable')) {
    details = details.filter((d) => d.feeKind === 'management_fee');
  }
  if (tenantId) details = details.filter((d) => d.tenantId === tenantId);
  if (statusFilter) details = details.filter((d) => d.status === statusFilter);

  res.json({
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
  });
});

// ── 租户 ──

const listTenants = withAuth(async (req, res, ctx) => {
  const projectId = resolveProject(ctx, req);
  const search = String(req.query.search || '').trim();
  const tenantId = String(req.query.tenant_id || '').trim();

  const filters: string[] = [`project_id="${escapeFilter(projectId)}"`];
  if (search) filters.push(`name~"${escapeFilter(search)}"`);
  if (tenantId) filters.push(`original_id="${escapeFilter(tenantId)}"`);

  const tenants = await ctx.pb.collection('pb_tenants').getFullList({
    filter: filters.join(' && '),
    sort: 'name',
    fields: 'id,original_id,name,unit_price,monthly_rent,deposit_amount,status,building_id,project_id',
  });

  res.json({ ok: true, project_id: projectId, count: tenants.length, tenants });
});

// ── 主程序 ──

async function main() {
  process.env.PB_URL = PB_URL;
  if (ADMIN_EMAIL) process.env.PB_ADMIN_EMAIL = ADMIN_EMAIL;
  if (ADMIN_PASSWORD) process.env.PB_ADMIN_PASSWORD = ADMIN_PASSWORD;

  await authAdmin();

  const app = express();
  app.use(corsMiddleware);
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({
    ok: true,
    service: 'payment-api',
    pb: PB_URL,
    default_project: DEFAULT_PROJECT,
    require_auth: REQUIRE_AUTH,
  }));

  app.post('/api/auth/login', handleLogin);
  app.get('/api/auth/me', handleMe);

  app.get('/api/payments', listPayments);
  app.get('/api/payments/:id', getPayment);
  app.post('/api/payments', createPayment);
  app.put('/api/payments/:id', updatePayment);
  app.delete('/api/payments/:id', deletePayment);
  app.get('/api/receivables', listReceivables);
  app.get('/api/tenants', listTenants);

  app.use((_req, res) => {
    res.status(404).json({ ok: false, message: '接口不存在' });
  });

  app.listen(PORT, () => {
    console.log(`[payment-api] listening on http://0.0.0.0:${PORT}`);
    console.log(`[payment-api] PocketBase: ${PB_URL}`);
    console.log(`[payment-api] auth: ${REQUIRE_AUTH ? 'users login required' : 'ANONYMOUS (dev only)'}`);
    console.log('[payment-api] endpoints:');
    console.log('  POST   /api/auth/login');
    console.log('  GET    /api/auth/me');
    console.log('  GET    /api/payments');
    console.log('  POST   /api/payments');
    console.log('  GET    /api/receivables');
    console.log('  GET    /api/tenants');
  });
}

main().catch((err) => {
  console.error('[payment-api] failed:', err?.data || err);
  process.exit(1);
});
