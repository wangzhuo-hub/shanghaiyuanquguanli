/**
 * payment-api 用户认证与权限校验（与看板 users 集合 / receivablePermissions 对齐）
 */

import PocketBase from 'pocketbase';
import type { AuthUser, PaymentRecord, UserRole } from '../types';
import {
  canWriteReceivableScope,
  normalizeReceivablePermissions,
  paymentTypeToReceivableScope,
  resolveHideRentPricing,
} from '../services/receivablePermissions';

export function normalizeProjectIds(raw: unknown, fallback = ''): string[] {
  const base = String(fallback || '').trim();
  const list = Array.isArray(raw)
    ? raw.map((x) => String(x || '').trim()).filter(Boolean)
    : [];
  const merged = base ? [base, ...list] : list;
  return [...new Set(merged)];
}

export function mapAuthUser(record: Record<string, unknown> | null | undefined): AuthUser | null {
  if (!record?.id) return null;
  const projectId = String(record.project_id || '').trim();
  const allowedProjectIds = normalizeProjectIds(record.allowed_project_ids, projectId);
  const role = String(record.role || 'park_user') as UserRole;
  return {
    id: String(record.id),
    email: String(record.email || ''),
    name: String(record.name || record.username || ''),
    projectId: projectId || allowedProjectIds[0] || '',
    role,
    allowedProjectIds,
    enabled: record.enabled !== false,
    receivablePermissions: normalizeReceivablePermissions(record.receivable_permissions, role),
    hideRentPricing: resolveHideRentPricing(role, record.hide_rent_pricing),
  };
}

export function canAccessProject(user: AuthUser, projectId: string): boolean {
  const pid = String(projectId || '').trim();
  if (!pid) return false;
  if (user.role === 'platform_admin') return true;
  if (user.projectId === pid) return true;
  return user.allowedProjectIds.includes(pid);
}

/** 解析并校验请求的 project_id，无权限时抛错 */
export function resolveAuthorizedProjectId(
  user: AuthUser,
  requested: unknown,
  defaultProject?: string,
): string {
  const pid = String(requested || defaultProject || user.projectId || '').trim();
  if (!pid) throw new Error('缺少 project_id，且账号未绑定默认园区');
  if (!canAccessProject(user, pid)) {
    throw new Error(`无权访问园区 ${pid}，您的授权范围为：${[user.projectId, ...user.allowedProjectIds].filter(Boolean).join('、')}`);
  }
  return pid;
}

export function assertPaymentWriteAllowed(user: AuthUser, type: string): void {
  const scope = paymentTypeToReceivableScope(type as PaymentRecord['type']);
  if (scope === 'other') return;
  if (!canWriteReceivableScope(user, scope)) {
    const label = scope === 'rent' ? '租金' : '物业费';
    throw new Error(`当前账号无「${label}」核销权限，无法保存该收款记录`);
  }
}

/** 读列表时按核销权限过滤（物业账号只看物业费） */
export function filterPaymentsForUser<T extends { type?: string }>(user: AuthUser, rows: T[]): T[] {
  if (user.role === 'platform_admin') return rows;
  if (canWriteReceivableScope(user, 'rent')) return rows;
  return rows.filter((p) => String(p.type || '') === 'ManagementFee');
}

export class AuthError extends Error {
  status = 401;
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends Error {
  status = 403;
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export interface AuthContext {
  user: AuthUser;
  userPb: PocketBase;
  token: string;
}

export async function authenticateRequest(
  req: { headers: Record<string, unknown>; body?: unknown },
  pbUrl: string,
): Promise<AuthContext> {
  const authHeader = String(req.headers.authorization || '');
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const email = String(req.headers['x-park-email'] || '').trim();
  const password = String(req.headers['x-park-password'] || '');

  const userPb = new PocketBase(pbUrl);

  if (bearer) {
    userPb.authStore.save(bearer, null);
    try {
      const refreshed = await userPb.collection('users').authRefresh();
      const user = mapAuthUser(refreshed.record as Record<string, unknown>);
      if (!user) throw new AuthError('登录无效');
      if (!user.enabled) throw new AuthError('账号已停用，请联系管理员');
      if (!user.projectId && user.allowedProjectIds.length === 0) {
        throw new AuthError('账号未绑定园区，请联系管理员');
      }
      return { user, userPb, token: userPb.authStore.token };
    } catch (e) {
      if (e instanceof AuthError) throw e;
      throw new AuthError('登录已过期，请重新 POST /api/auth/login');
    }
  }

  if (email && password) {
    try {
      const authData = await userPb.collection('users').authWithPassword(email, password);
      const user = mapAuthUser(authData.record as Record<string, unknown>);
      if (!user) throw new AuthError('登录失败');
      if (!user.enabled) throw new AuthError('账号已停用，请联系管理员');
      if (!user.projectId && user.allowedProjectIds.length === 0) {
        throw new AuthError('账号未绑定园区，请联系管理员');
      }
      return { user, userPb, token: userPb.authStore.token };
    } catch (e) {
      if (e instanceof AuthError) throw e;
      throw new AuthError('账号或密码错误');
    }
  }

  throw new AuthError(
    '未登录。请先 POST /api/auth/login 获取 token，或在请求头携带 Authorization: Bearer <token>，或 X-Park-Email + X-Park-Password',
  );
}

export async function loginWithPassword(
  pbUrl: string,
  email: string,
  password: string,
): Promise<AuthContext> {
  const safeEmail = String(email || '').trim();
  const safePassword = String(password || '').trim();
  if (!safeEmail || !safePassword) throw new AuthError('请输入 email 和 password');

  const userPb = new PocketBase(pbUrl);
  try {
    const authData = await userPb.collection('users').authWithPassword(safeEmail, safePassword);
    const user = mapAuthUser(authData.record as Record<string, unknown>);
    if (!user) throw new AuthError('登录失败');
    if (!user.enabled) throw new AuthError('账号已停用，请联系管理员');
    if (!user.projectId && user.allowedProjectIds.length === 0) {
      throw new AuthError('账号未绑定园区，请联系管理员');
    }
    return { user, userPb, token: userPb.authStore.token };
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new AuthError('账号或密码错误');
  }
}

export function publicUserProfile(user: AuthUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    projectId: user.projectId,
    allowedProjectIds: user.allowedProjectIds,
    receivablePermissions: user.receivablePermissions,
    hideRentPricing: user.hideRentPricing,
  };
}
