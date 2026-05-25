import {
  loginPropertySystem,
  loginWithPassword,
  publicUserProfile,
} from '../../park-mcp/src/lib/auth.js';
import {
  createEmptySession,
  setDashboardSession,
  setFacilitySession,
  setPropertySession,
} from '../../park-mcp/src/session.js';
import { FACILITY_PB_URL, PB_URL, PROPERTY_PB_URL } from './config.js';

export async function unifiedLogin(email: string, password: string) {
  const systems: Record<string, boolean> = {
    dashboard: false,
    facility: false,
    property: false,
  };
  const messages: string[] = [];

  const session = createEmptySession();

  try {
    session.dashboard = await loginWithPassword(PB_URL, email, password);
    systems.dashboard = true;
  } catch (e) {
    messages.push(`招商看板：${e instanceof Error ? e.message : e}`);
  }

  try {
    session.facility = await loginWithPassword(FACILITY_PB_URL, email, password, {
      requireProject: false,
    });
    systems.facility = true;
  } catch {
    messages.push('设备设施：账号未开通或密码不可用（报修功能受限）');
  }

  try {
    session.property = await loginPropertySystem(PROPERTY_PB_URL, email, password);
    systems.property = true;
  } catch {
    messages.push('物业系统：账号未开通（水电/物业费功能受限）');
  }

  if (!systems.dashboard) {
    throw new Error(messages.join('；') || '登录失败');
  }

  setDashboardSession(session.dashboard);
  if (session.facility) setFacilitySession(session.facility);
  if (session.property) setPropertySession(session.property);

  return {
    ok: true,
    message: '登录成功',
    user: publicUserProfile(session.dashboard.user),
    systems,
    notes: messages.filter((m) => !m.startsWith('招商')),
  };
}
