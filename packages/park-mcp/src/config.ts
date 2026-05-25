import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PACKAGE_ROOT = path.resolve(__dirname, '..');
/**  monorepo 仓库根（packages/park-mcp 的上两级） */
export const REPO_ROOT = path.resolve(PACKAGE_ROOT, '../..');
export const RESOURCES_DIR = path.join(PACKAGE_ROOT, 'resources');

/** 招商看板 PocketBase（users 集合所在实例，默认与 payment-api 一致） */
export const PB_URL = (process.env.PARK_PB_URL || process.env.PB_URL || 'http://127.0.0.1:1002').replace(/\/$/, '');

/** 设备设施 PocketBase（生产 wyxj；本地隧道常用 11002） */
export const FACILITY_PB_URL = (
  process.env.PARK_FACILITY_PB_URL || process.env.FACILITY_PB_URL || 'http://127.0.0.1:11002'
).replace(/\/$/, '');

/** 物业水电 PocketBase（生产 sdsf；本地隧道常用 11006） */
export const PROPERTY_PB_URL = (
  process.env.PARK_PROPERTY_PB_URL || process.env.PROPERTY_PB_URL || 'http://127.0.0.1:11006'
).replace(/\/$/, '');

/** 可选：启动时用环境变量自动登录 */
export const AUTO_LOGIN_EMAIL = String(process.env.PARK_EMAIL || '').trim();
export const AUTO_LOGIN_PASSWORD = String(process.env.PARK_PASSWORD || '');

export const AUTO_FACILITY_LOGIN = process.env.PARK_FACILITY_AUTO_LOGIN !== '0';
export const AUTO_PROPERTY_LOGIN = process.env.PARK_PROPERTY_AUTO_LOGIN !== '0';

/** 应收/KPI 实时计算需 Admin（与 compute-engine 相同，仅服务端持有） */
export const PB_ADMIN_EMAIL = String(process.env.PB_ADMIN_EMAIL || process.env.VITE_POCKETBASE_EMAIL || '').trim();
export const PB_ADMIN_PASSWORD = String(process.env.PB_ADMIN_PASSWORD || process.env.VITE_POCKETBASE_PASSWORD || '').trim();

export function adminComputeAvailable(): boolean {
  return Boolean(PB_ADMIN_EMAIL && PB_ADMIN_PASSWORD);
}

/** HTTP / Streamable MCP（Phase 3） */
export const MCP_HTTP_HOST = String(process.env.MCP_HTTP_HOST || '127.0.0.1').trim();
export const MCP_HTTP_PORT = Number(process.env.MCP_HTTP_PORT || 3099);
export const MCP_HTTP_ALLOWED_HOSTS = String(process.env.MCP_HTTP_ALLOWED_HOSTS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
