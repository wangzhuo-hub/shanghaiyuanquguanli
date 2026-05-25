import { AsyncLocalStorage } from 'node:async_hooks';
import type PocketBase from 'pocketbase';
import type { AuthContext } from './lib/auth.js';

export interface AppSession {
  dashboard: AuthContext | null;
  facility: AuthContext | null;
  property: AuthContext | null;
}

export function createEmptySession(): AppSession {
  return { dashboard: null, facility: null, property: null };
}

/** stdio 模式下的进程级会话 */
const stdioSession = createEmptySession();

const requestSession = new AsyncLocalStorage<AppSession>();

export function runWithSession<T>(session: AppSession, fn: () => T): T {
  return requestSession.run(session, fn);
}

function active(): AppSession {
  return requestSession.getStore() ?? stdioSession;
}

export function getAppSession(): AppSession {
  return active();
}

export function setDashboardSession(ctx: AuthContext | null): void {
  active().dashboard = ctx;
}

export function setFacilitySession(ctx: AuthContext | null): void {
  active().facility = ctx;
}

export function setPropertySession(ctx: AuthContext | null): void {
  active().property = ctx;
}

export function clearSession(): void {
  const s = active();
  s.dashboard = null;
  s.facility = null;
  s.property = null;
}

export function setSession(ctx: AuthContext): void {
  setDashboardSession(ctx);
}

export function requireDashboardSession(): AuthContext {
  const ctx = active().dashboard;
  if (!ctx) {
    throw new Error(
      '招商看板未登录。请先 park_login，或 POST /auth/login（HTTP 模式），或设置 PARK_EMAIL / PARK_PASSWORD。',
    );
  }
  return ctx;
}

export function requireFacilitySession(): AuthContext {
  const ctx = active().facility;
  if (!ctx) {
    throw new Error(
      '设备设施系统未登录。请先 park_facility_login 或 /auth/login 勾选 facility。',
    );
  }
  return ctx;
}

export function requirePropertySession(): AuthContext {
  const ctx = active().property;
  if (!ctx) {
    throw new Error(
      '物业系统未登录。请先 park_property_login 或 /auth/login 勾选 property。',
    );
  }
  return ctx;
}

export function getUserPb(): PocketBase {
  return requireDashboardSession().userPb;
}

export const requireSession = requireDashboardSession;
