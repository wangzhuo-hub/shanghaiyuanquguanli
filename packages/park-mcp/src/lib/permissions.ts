import type { AuthUser, ReceivablePermission, UserRole } from './types.js';

export function isPropertyStaffRole(role: UserRole | string | undefined): boolean {
  return String(role || '') === 'property_staff';
}

export function normalizeReceivablePermissions(
  raw: unknown,
  role?: UserRole,
): ReceivablePermission[] {
  if (isPropertyStaffRole(role)) return ['mgmt_fee_receivable'];
  const list = Array.isArray(raw)
    ? raw.filter((x): x is ReceivablePermission => x === 'rent_receivable' || x === 'mgmt_fee_receivable')
    : [];
  if (list.length > 0) return list;
  if (role === 'platform_admin' || role === 'group_admin' || role === 'park_admin') {
    return ['rent_receivable', 'mgmt_fee_receivable'];
  }
  return ['rent_receivable'];
}

export function resolveHideRentPricing(role: UserRole | string | undefined, flag: unknown): boolean {
  if (isPropertyStaffRole(role)) return true;
  return flag === true;
}

export function canWriteReceivableScope(
  user: AuthUser | null | undefined,
  scope: 'rent' | 'management_fee',
): boolean {
  if (!user) return true;
  if (user.role === 'platform_admin') return true;
  if (isPropertyStaffRole(user.role) && scope === 'rent') return false;
  const perms = normalizeReceivablePermissions(user.receivablePermissions, user.role);
  if (scope === 'rent') return perms.includes('rent_receivable');
  return perms.includes('mgmt_fee_receivable');
}

export function filterPaymentsForUser<T extends { type?: string }>(user: AuthUser, rows: T[]): T[] {
  if (user.role === 'platform_admin') return rows;
  if (canWriteReceivableScope(user, 'rent')) return rows;
  return rows.filter((p) => String(p.type || '') === 'ManagementFee');
}

export function filterReceivablesForUser<T extends { feeKind?: string }>(
  user: AuthUser,
  rows: T[],
): T[] {
  if (user.role === 'platform_admin') return rows;
  if (user.receivablePermissions?.includes('rent_receivable')) return rows;
  return rows.filter((d) => d.feeKind === 'management_fee');
}

export function paymentTypeToReceivableScope(
  type: string,
): 'rent' | 'management_fee' | 'other' {
  if (type === 'ManagementFee') return 'management_fee';
  if (type === 'Rent' || type === 'DepositToRent' || type === 'Deposit' || type === 'DepositRefund') {
    return 'rent';
  }
  return 'other';
}

export function assertPaymentWriteAllowed(user: AuthUser, type: string): void {
  const scope = paymentTypeToReceivableScope(type);
  if (scope === 'other') return;
  if (!canWriteReceivableScope(user, scope)) {
    const label = scope === 'rent' ? '租金' : '物业费';
    throw new Error(`当前账号无「${label}」核销权限，无法保存该收款记录`);
  }
}

const ADMIN_ROLES = new Set<UserRole>(['platform_admin', 'group_admin', 'park_admin']);

export function isAdminRole(role: UserRole): boolean {
  return ADMIN_ROLES.has(role);
}

export function canAccessPropertySystem(user: AuthUser): boolean {
  if (isAdminRole(user.role)) return true;
  return isPropertyStaffRole(user.role);
}
