import PocketBase from 'pocketbase';
import type { AuthUser, UserRole } from './types.js';
import { normalizeReceivablePermissions, resolveHideRentPricing } from './permissions.js';

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

export function resolveAuthorizedProjectId(
  user: AuthUser,
  requested: unknown,
  defaultProject?: string,
): string {
  const pid = String(requested || defaultProject || user.projectId || '').trim();
  if (!pid) throw new Error('缺少 project_id，且账号未绑定默认园区');
  if (!canAccessProject(user, pid)) {
    const scope = [user.projectId, ...user.allowedProjectIds].filter(Boolean).join('、');
    throw new Error(`无权访问园区 ${pid}，您的授权范围为：${scope}`);
  }
  return pid;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthContext {
  user: AuthUser;
  userPb: PocketBase;
  token: string;
}

async function authCollection(
  userPb: PocketBase,
  collection: string,
  email: string,
  password: string,
): Promise<AuthContext> {
  const authData = await userPb.collection(collection).authWithPassword(email, password);
  const user = mapAuthUser(authData.record as Record<string, unknown>);
  if (!user) throw new AuthError('登录失败');
  if (!user.enabled) throw new AuthError('账号已停用，请联系管理员');
  return { user, userPb, token: userPb.authStore.token };
}

export async function loginWithPassword(
  pbUrl: string,
  email: string,
  password: string,
  options?: { collections?: string[]; requireProject?: boolean },
): Promise<AuthContext> {
  const safeEmail = String(email || '').trim();
  const safePassword = String(password || '').trim();
  if (!safeEmail || !safePassword) throw new AuthError('请输入 email 和 password');

  const collections = options?.collections ?? ['users'];
  const requireProject = options?.requireProject !== false;
  const userPb = new PocketBase(pbUrl);
  let lastErr: unknown;

  for (const coll of collections) {
    try {
      const ctx = await authCollection(userPb, coll, safeEmail, safePassword);
      if (requireProject && !ctx.user.projectId && ctx.user.allowedProjectIds.length === 0) {
        throw new AuthError('账号未绑定园区，请联系管理员');
      }
      return ctx;
    } catch (e) {
      lastErr = e;
      if (e instanceof AuthError && e.message.includes('未绑定园区')) throw e;
      userPb.authStore.clear();
    }
  }

  if (lastErr instanceof AuthError) throw lastErr;
  throw new AuthError('账号或密码错误');
}

/** 物业系统可能使用 app_users 集合 */
export async function loginPropertySystem(
  pbUrl: string,
  email: string,
  password: string,
): Promise<AuthContext> {
  return loginWithPassword(pbUrl, email, password, {
    collections: ['users', 'app_users'],
    requireProject: false,
  });
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
