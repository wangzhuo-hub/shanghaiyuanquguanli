import type { Request, Response } from 'express';
import {
  AUTO_FACILITY_LOGIN,
  AUTO_LOGIN_EMAIL,
  AUTO_LOGIN_PASSWORD,
  AUTO_PROPERTY_LOGIN,
  FACILITY_PB_URL,
  PB_URL,
  PROPERTY_PB_URL,
} from './config.js';
import { AuthError, loginPropertySystem, loginWithPassword, publicUserProfile } from './lib/auth.js';
import { createEmptySession, type AppSession } from './session.js';
import { issueToken, revokeToken, getTokenEntry } from './token-store.js';

export type LoginSystem = 'dashboard' | 'facility' | 'property';

export async function buildSessionFromCredentials(
  email: string,
  password: string,
  systems: LoginSystem[],
): Promise<AppSession> {
  const session = createEmptySession();
  const wantDash = systems.includes('dashboard');
  const wantFac = systems.includes('facility');
  const wantProp = systems.includes('property');

  if (wantDash) {
    session.dashboard = await loginWithPassword(PB_URL, email, password);
  }
  if (wantFac) {
    try {
      session.facility = await loginWithPassword(FACILITY_PB_URL, email, password, {
        requireProject: false,
      });
    } catch (e) {
      if (wantFac && systems.length === 1) throw e;
    }
  }
  if (wantProp) {
    try {
      session.property = await loginPropertySystem(PROPERTY_PB_URL, email, password);
    } catch (e) {
      if (wantProp && systems.length === 1) throw e;
    }
  }

  if (!session.dashboard && !session.facility && !session.property) {
    throw new AuthError('所有子系统登录均失败，请检查账号与各系统开通情况');
  }
  return session;
}

export async function handleAuthLogin(req: Request, res: Response): Promise<void> {
  try {
    const { email, password, systems } = (req.body || {}) as {
      email?: string;
      password?: string;
      systems?: LoginSystem[];
    };
    const list: LoginSystem[] = Array.isArray(systems) && systems.length > 0
      ? systems
      : ['dashboard', 'facility', 'property'];
    const session = await buildSessionFromCredentials(email || '', password || '', list);
    const entry = issueToken(session.dashboard?.user.email || email || '', session);

    res.json({
      ok: true,
      token: entry.token,
      expires_at: new Date(entry.expiresAt).toISOString(),
      email: entry.email,
      systems: {
        dashboard: Boolean(session.dashboard),
        facility: Boolean(session.facility),
        property: Boolean(session.property),
      },
      user: session.dashboard ? publicUserProfile(session.dashboard.user) : null,
      mcp_hint: '请求 /mcp 时携带 Authorization: Bearer <token>',
    });
  } catch (e) {
    const message = e instanceof AuthError ? e.message : (e instanceof Error ? e.message : String(e));
    res.status(401).json({ ok: false, message });
  }
}

export function handleAuthMe(req: Request, res: Response): void {
  const entry = getTokenEntry(parseBearer(req));
  if (!entry) {
    res.status(401).json({ ok: false, message: '无效或已过期的 token' });
    return;
  }
  const dash = entry.session.dashboard?.user;
  res.json({
    ok: true,
    email: entry.email,
    expires_at: new Date(entry.expiresAt).toISOString(),
    user: dash ? publicUserProfile(dash) : null,
    systems: {
      dashboard: Boolean(entry.session.dashboard),
      facility: Boolean(entry.session.facility),
      property: Boolean(entry.session.property),
    },
  });
}

export function handleAuthLogout(req: Request, res: Response): void {
  const token = parseBearer(req);
  if (token) revokeToken(token);
  res.json({ ok: true, message: '已注销' });
}

export function parseBearer(req: Request): string | undefined {
  const h = String(req.headers.authorization || '');
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim();
}

/** 环境变量一键登录（HTTP 启动时可选） */
export async function envBootstrapSession(): Promise<AppSession | null> {
  if (!AUTO_LOGIN_EMAIL || !AUTO_LOGIN_PASSWORD) return null;
  const systems: LoginSystem[] = ['dashboard'];
  if (AUTO_FACILITY_LOGIN) systems.push('facility');
  if (AUTO_PROPERTY_LOGIN) systems.push('property');
  try {
    return await buildSessionFromCredentials(AUTO_LOGIN_EMAIL, AUTO_LOGIN_PASSWORD, systems);
  } catch {
    return null;
  }
}
